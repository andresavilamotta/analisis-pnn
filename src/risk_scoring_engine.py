# src/risk_scoring_engine.py
import os
import json
import pandas as pd
from datetime import datetime, timedelta

# Electoral restriction start dates (Ley de Garantías)
# June 29, 2023 was the start of Ley de Garantías for 2023 regional elections in Colombia
LEY_GARANTIAS_DATES = [
    datetime(2023, 6, 29)
]

def calculate_risk_score(contrato, year_totals, year_month_totals, supplier_direct_min):
    """
    Calculates the risk score and returns a list of reasons for a given contract.
    Returns:
        score (int), reasons (list of strings)
    """
    score = 0
    reasons = []

    # Get values from contract dictionary/row
    # Standardize dates
    def parse_dt(val):
        if not val or pd.isna(val):
            return None
        if isinstance(val, pd.Timestamp) or isinstance(val, datetime):
            return val
        try:
            return pd.to_datetime(val)
        except Exception:
            return None

    fecha_firma = parse_dt(contrato.get("fecha_de_firma"))
    fecha_inicio = parse_dt(contrato.get("fecha_de_inicio_del_contrato"))
    fecha_fin = parse_dt(contrato.get("fecha_de_fin_del_contrato"))
    estado = str(contrato.get("estado_contrato") or "").strip()
    modalidad = str(contrato.get("modalidad_de_contratacion") or "").strip().lower()
    
    try:
        val_contrato = float(contrato.get("valor_del_contrato") or 0.0)
    except ValueError:
        val_contrato = 0.0
        
    try:
        adiciones_val = float(contrato.get("adiciones_en_valor") or 0.0)
    except ValueError:
        adiciones_val = 0.0

    # Rule 1: Alerta de Ejecución Zombie (Contratos sin cerrar)
    if fecha_fin:
        # Check if current time > fecha_fin + 120 days
        limit_date = fecha_fin + timedelta(days=120)
        # Using fixed reference date of 2026 for execution (matching prompt's current time 2026)
        current_time = datetime(2026, 7, 8) 
        if current_time > limit_date:
            # Check if estado is not 'Liquidado' and not 'Terminado'
            if estado.lower() not in ["liquidado", "terminado"]:
                score += 25
                reasons.append(
                    "Alerta de Cierre: El contrato superó su fecha de finalización hace más de 4 meses y sigue en estado abierto/en ejecución. Posible negligencia en la supervisión y liquidación."
                )

    # Rule 2: Riesgo de Ley de Garantías (Periodos Electorales)
    if fecha_firma and "directa" in modalidad:
        # Check if fecha_firma falls exactly in the 30 days prior to any restrictions
        for restriction_start in LEY_GARANTIAS_DATES:
            start_window = restriction_start - timedelta(days=30)
            if start_window <= fecha_firma <= restriction_start:
                score += 35
                reasons.append(
                    "Alerta Electoral: Contrato directo firmado escasos días antes del inicio de la Ley de Garantías. Patrón histórico de concentración de adjudicaciones por presiones políticas."
                )
                break  # Award only once for electoral risk

    # Rule 3: Ejecución Lenta y Concentración Atípica (Pico de Firmas)
    if fecha_firma:
        year = fecha_firma.year
        month = fecha_firma.month
        year_total = year_totals.get(year, 0)
        month_total = year_month_totals.get((year, month), 0)
        
        if year_total > 0:
            month_ratio = month_total / year_total
            if month_ratio > 0.40:
                score += 15
                reasons.append(
                    "Deficiencia de Planeación Administrativa: El contrato se firmó en un mes de concentración atípica (pico del año), lo que sugiere ejecución presupuestal apresurada o falta de planeación estructurada."
                )

    # Rule 4: Abuso de Contratación Directa por Cuantía
    if "directa" in modalidad and val_contrato > 500000000:
        score += 25
        reasons.append(
            "Riesgo de Modalidad: Adjudicación 'a dedo' (Contratación Directa) por un monto excepcionalmente alto, eludiendo la pluralidad de oferentes de una Licitación Pública."
        )

    # Rule 5: Sobrecostos (Regla del 50%)
    if val_contrato > 0 and adiciones_val > (val_contrato * 0.45):
        score += 30
        reasons.append(
            "Riesgo Financiero Crítico: El contrato ha sufrido adiciones que rozan o superan el límite legal del 50% de su valor original, indicando grave deficiencia en los estudios del sector."
        )

    # Rule 6: Fraccionamiento de Contratos (Evasión de Topes Financieros)
    doc_prov = contrato.get("documento_proveedor")
    if doc_prov and doc_prov != "No Definido":
        if "directa" in modalidad or "mínima" in modalidad or "minima" in modalidad:
            other_contracts = supplier_direct_min.get(doc_prov, [])
            if len(other_contracts) > 1:
                for other in other_contracts:
                    if other["id_contrato"] != contrato.get("id_contrato"):
                        other_time = other["fecha_de_firma"]
                        if fecha_firma and pd.notna(other_time):
                            diff = abs((other_time - fecha_firma).days)
                            if diff < 45:
                                score += 40
                                reasons.append(
                                    "Alerta de Fraccionamiento Financiero: El proveedor registra múltiples contratos adjudicados en un corto periodo (<45 días), dividiendo montos para eludir modalidades más rigurosas y competitivas."
                                )
                                break  # Award once for splitting

    # Rule 7: Carrusel de Prórrogas (Falla Administrativa)
    try:
        prorrogas = float(contrato.get("prorrogas_en_dias") or 0.0)
    except ValueError:
        prorrogas = 0.0

    if fecha_inicio and fecha_fin and prorrogas > 0:
        total_duration = (fecha_fin - fecha_inicio).days
        original_duration = total_duration - prorrogas
        if original_duration > 0 and prorrogas > original_duration:
            score += 20
            reasons.append(
                "Anomalía Administrativa: El tiempo sumado mediante prórrogas supera el plazo inicial estipulado para el contrato. Falla grave en la planeación y estructuración del cronograma."
            )

    # Rule 8: Falsa Competencia (Pliegos Sastre)
    is_competitive = any(term in modalidad for term in ["licitación", "licitacion", "abreviada", "méritos", "meritos"])
    try:
        offers = int(contrato.get("ofertas_recibidas") or 0)
    except ValueError:
        offers = 0

    if is_competitive and offers == 1:
        score += 30
        reasons.append(
            "Riesgo Jurídico de Pliego Sastre: Es un proceso competitivo pero adjudicado a un ÚNICO oferente. Fuerte indicio de direccionamiento o requisitos habilitantes artificialmente restrictivos."
        )

    return score, reasons

def evaluate_and_format_contract(contrato, year_totals, year_month_totals, supplier_direct_min):
    """
    Evaluates a contract dictionary and formats the result output JSON object.
    """
    score, reasons = calculate_risk_score(contrato, year_totals, year_month_totals, supplier_direct_min)
    
    # Determine risk level
    if score >= 70:
        level = "Crítico"
    elif score >= 30:
        level = "Medio"
    else:
        level = "Bajo"
        
    return {
        "id_contrato": contrato.get("id_contrato"),
        "riesgo_total_score": score,
        "nivel_riesgo": level,
        "banderas_rojas": reasons
    }

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Motor de reglas de riesgo de auditoría jurídica para contratos.")
    parser.add_argument("--entity", type=str, default="minambiente", choices=["minambiente", "pnn"],
                        help="Entidad a procesar (minambiente o pnn)")
    args = parser.parse_args()
    
    raw_path = f"data/contratos_{args.entity}_raw.json"
    if args.entity == "minambiente":
        output_path = "data/contratos_riesgo_auditoria.json"
    else:
        output_path = f"data/contratos_{args.entity}_riesgo_auditoria.json"
        
    print(f"Iniciando motor de reglas de riesgo de auditoría jurídica para la entidad: {args.entity.upper()}...")
    
    if not os.path.exists(raw_path):
        print(f"Error: No se encontró el archivo raw en {raw_path}")
        return
        
    df = pd.read_json(raw_path)
    print(f"Leídos {len(df)} contratos para evaluación de riesgo.")
    
    # Pre-convert datetimes once on the entire dataframe to speed up calculations drastically
    df['fecha_de_firma'] = pd.to_datetime(df['fecha_de_firma'], errors='coerce')
    df['fecha_de_inicio_del_contrato'] = pd.to_datetime(df['fecha_de_inicio_del_contrato'], errors='coerce')
    df['fecha_de_fin_del_contrato'] = pd.to_datetime(df['fecha_de_fin_del_contrato'], errors='coerce')
    
    # Pre-calculate year-month totals for Rule 3
    df_valid_dates = df.dropna(subset=['fecha_de_firma']).copy()
    df_valid_dates['year'] = df_valid_dates['fecha_de_firma'].dt.year
    df_valid_dates['month'] = df_valid_dates['fecha_de_firma'].dt.month
    
    year_totals = df_valid_dates.groupby('year').size().to_dict()
    year_month_totals = df_valid_dates.groupby(['year', 'month']).size().to_dict()
    
    # Pre-calculate supplier direct/minima lists for Rule 6
    direct_min_df = df[df['modalidad_de_contratacion'].str.lower().str.contains("directa|mínima|minima", na=False)].copy()
    supplier_direct_min = {}
    for doc, group in direct_min_df.groupby('documento_proveedor'):
        supplier_direct_min[doc] = [
            {"id_contrato": r["id_contrato"], "fecha_de_firma": r["fecha_de_firma"]}
            for r in group.to_dict(orient="records")
        ]
        
    # Convert list of dicts for row-by-row iteration
    records = df.to_dict(orient="records")
    
    risk_results = []
    for r in records:
        eval_res = evaluate_and_format_contract(r, year_totals, year_month_totals, supplier_direct_min)
        risk_results.append(eval_res)
        
    # Write JSON output
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(risk_results, f, indent=4, ensure_ascii=False)
        
    print(f"Resultados de auditoría de riesgo guardados en {output_path}")

    # Summary report
    critical_count = sum(1 for res in risk_results if res["nivel_riesgo"] == "Crítico")
    medium_count = sum(1 for res in risk_results if res["nivel_riesgo"] == "Medio")
    low_count = sum(1 for res in risk_results if res["nivel_riesgo"] == "Bajo")
    
    print("\nResumen de evaluación de riesgos:")
    print(f"- Crítico (Score >= 70): {critical_count}")
    print(f"- Medio (Score 30-69): {medium_count}")
    print(f"- Bajo (Score < 30): {low_count}")

if __name__ == "__main__":
    main()

