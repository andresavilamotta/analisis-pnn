# src/dependency_tagger.py
import os
import json
import re
import pandas as pd

# Define Regex dependency dictionary
RULES = {
    r"(?i)(negocios\s+verdes|crecimiento\s+verde)": "Oficina de Negocios Verdes",
    r"(?i)(control\s+interno)": "Oficina de Control Interno",
    r"(?i)(cambio\s+clim[aá]tico)": "Dirección de Cambio Climático",
    r"(?i)(bosques|biodiversidad|servicios\s+ecosist[eé]micos)": "Dirección de Bosques y Biodiversidad",
    r"(?i)(recurso\s+h[ií]drico|mares|costas)": "Dirección de Recurso Hídrico y Marino",
    r"(?i)(jur[ií]dica|defensa\s+judicial)": "Oficina Asesora Jurídica",
    r"(?i)(tecnolog[ií]a|sistemas|informaci[oó]n)": "Oficina de TIC"
}

def tag_contract(row):
    desc = str(row.get("descripcion_del_proceso") or "")
    ref = str(row.get("referencia_del_contrato") or "")
    combined_text = f"{desc} {ref}"
    
    for regex, tag in RULES.items():
        if re.search(regex, combined_text):
            return tag
            
    return "Dependencia No Especificada / Transversal"

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Etiquetado semántico de dependencias para contratos.")
    parser.add_argument("--entity", type=str, default="minambiente", choices=["minambiente", "pnn"],
                        help="Entidad a procesar (minambiente o pnn)")
    args = parser.parse_args()
    
    raw_path = f"data/contratos_{args.entity}_raw.json"
    output_path = f"data/contratos_{args.entity}_etiquetados.json"
    
    print(f"Iniciando etiquetado semántico de dependencias para la entidad: {args.entity.upper()}...")
    
    if not os.path.exists(raw_path):
        print(f"Error: No se encontró el archivo raw en {raw_path}")
        return
        
    df = pd.read_json(raw_path)
    print(f"Leídos {len(df)} contratos para procesar.")
    
    # Apply tagging function
    df["dependencia_identificada"] = df.apply(tag_contract, axis=1)
    
    # Group counts print
    counts = df["dependencia_identificada"].value_counts()
    print("\nResumen de clasificación por dependencias:")
    for dep, count in counts.items():
        print(f"- {dep}: {count}")
        
    # Save labeled contracts
    df.to_json(output_path, orient="records", indent=4, force_ascii=False)
    print(f"\nContratos etiquetados guardados con éxito en {output_path}")

if __name__ == "__main__":
    main()

