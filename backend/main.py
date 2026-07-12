# backend/main.py
import os
import json
from fastapi import FastAPI, HTTPException, Header
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

app = FastAPI(
    title="PNN Contratación API",
    description="API para servir contratos etiquetados por dependencias de Parques Nacionales Naturales (PNN)",
    version="1.0"
)

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for simplicity in development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class LoginRequest(BaseModel):
    username: str
    password: str

@app.post("/api/login")
def login(req: LoginRequest):
    is_auditor = req.username == "Auditor1" and req.password == "VisitanteTigre"
    is_admin = req.username == "Admin" and req.password == "Andres123"
    
    if is_auditor or is_admin:
        return {"success": True, "token": "session-token-auditor1"}
    raise HTTPException(status_code=401, detail="Usuario o contraseña incorrectos")

# Dynamic path resolver using absolute paths relative to backend/main.py
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def get_paths(entity: str):
    if entity == "minambiente":
        return (
            os.path.join(BASE_DIR, "data", "contratos_minambiente_etiquetados.json"),
            os.path.join(BASE_DIR, "data", "contratos_riesgo_auditoria.json")
        )
    elif entity == "pnn":
        return (
            os.path.join(BASE_DIR, "data", "contratos_pnn_etiquetados.json"),
            os.path.join(BASE_DIR, "data", "contratos_pnn_riesgo_auditoria.json")
        )
    else:
        # Fallback dynamic matching
        return (
            os.path.join(BASE_DIR, "data", f"contratos_{entity}_etiquetados.json"),
            os.path.join(BASE_DIR, "data", f"contratos_{entity}_riesgo_auditoria.json")
        )

@app.get("/api/contratos/{entity}")
def get_contratos(entity: str, x_session_token: str = Header(None)):
    """Returns the list of contracts for the selected entity with their assigned dependency and risk scores."""
    if x_session_token != "session-token-auditor1":
        raise HTTPException(status_code=401, detail="No autorizado")
    data_path, risk_path = get_paths(entity)
    
    if not os.path.exists(data_path):
        raise HTTPException(
            status_code=404, 
            detail=f"El archivo de datos etiquetados en '{data_path}' no existe. Por favor corre el etiquetador primero."
        )
    
    try:
        with open(data_path, "r", encoding="utf-8") as f:
            contracts = json.load(f)
            
        risk_map = {}
        if os.path.exists(risk_path):
            with open(risk_path, "r", encoding="utf-8") as rf:
                risk_data = json.load(rf)
                for item in risk_data:
                    cid = item.get("id_contrato")
                    if cid:
                        risk_map[cid] = item
                        
        # Merge risk data into contracts
        for c in contracts:
            cid = c.get("id_contrato")
            if cid and cid in risk_map:
                c["riesgo_total_score"] = risk_map[cid].get("riesgo_total_score", 0)
                c["nivel_riesgo"] = risk_map[cid].get("nivel_riesgo", "Bajo")
                c["banderas_rojas"] = risk_map[cid].get("banderas_rojas", [])
            else:
                c["riesgo_total_score"] = 0
                c["nivel_riesgo"] = "Bajo"
                c["banderas_rojas"] = []
                
        return contracts
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error procesando los contratos y riesgos: {e}"
        )

# Backward compatibility route for minambiente
@app.get("/api/contratos/minambiente")
def get_contratos_minambiente(x_session_token: str = Header(None)):
    return get_contratos("minambiente", x_session_token=x_session_token)

@app.post("/api/auditoria-ia/{entity}/{id_contrato}")
def get_auditoria_ia(entity: str, id_contrato: str, x_session_token: str = Header(None)):
    """
    Simulates a RAG Legal Auditor using Gemini to generate a tailored markdown audit report.
    It inspects the contract's specific flags, modality, contractor, and values.
    """
    if x_session_token != "session-token-auditor1":
        raise HTTPException(status_code=401, detail="No autorizado")
    data_path, risk_path = get_paths(entity)
    
    if not os.path.exists(data_path):
        raise HTTPException(status_code=404, detail="No se encuentra la base de datos de contratos.")
        
    try:
        # Load contracts and risk scores
        with open(data_path, "r", encoding="utf-8") as f:
            contracts = json.load(f)
            
        risk_map = {}
        if os.path.exists(risk_path):
            with open(risk_path, "r", encoding="utf-8") as rf:
                risk_data = json.load(rf)
                for item in risk_data:
                    cid = item.get("id_contrato")
                    if cid:
                        risk_map[cid] = item
                        
        # Find requested contract
        contrato = None
        for c in contracts:
            if c.get("id_contrato") == id_contrato:
                contrato = c
                break
                
        if not contrato:
            raise HTTPException(status_code=404, detail=f"Contrato {id_contrato} no encontrado.")
            
        # Retrieve risk scores
        risk_info = risk_map.get(id_contrato, {})
        score = risk_info.get("riesgo_total_score", 0)
        nivel = risk_info.get("nivel_riesgo", "Bajo")
        banderas = risk_info.get("banderas_rojas", [])
        
        # Build Markdown response
        val_f = float(contrato.get("valor_del_contrato") or 0)
        val_formatted = f"${val_f:,.0f} COP"
        
        entidad_nombre = "Parques Nacionales Naturales de Colombia (PNN)" if entity == "pnn" else "Ministerio de Ambiente y Desarrollo Sostenible"
        
        # Generate custom markdown report citing specific laws/articles based on flags
        report = []
        report.append(f"# DICTAMEN DE AUDITORÍA CONTRACTUAL JURÍDICA DE IA\n")
        report.append(f"**CONTRATO REFERENCIA:** `{contrato.get('id_contrato')}` | **REF:** `{contrato.get('referencia_del_contrato')}`\n")
        report.append(f"**ENTIDAD:** {entidad_nombre}\n")
        report.append(f"**CONTRATISTA:** {contrato.get('proveedor_adjudicado')} (NIT/CC: {contrato.get('documento_proveedor')})\n")
        report.append(f"**MODALIDAD:** {contrato.get('modalidad_de_contratacion')} | **VALOR:** {val_formatted}\n")
        report.append(f"**SCORE DE RIESGO DE AUDITORÍA:** `{score} / 100` | **NIVEL DE RIESGO:** `{nivel}`\n")
        report.append(f"---\n")
        
        report.append(f"## I. Antecedentes Contractuales")
        report.append(f"El proceso contractual auditado fue firmado el `{contrato.get('fecha_de_firma', 'N/A').split('T')[0]}`. ")
        report.append(f"Se encuentra bajo supervisión del área lógicamente asignada a: **{contrato.get('dependencia_identificada')}**.\n")
        
        report.append(f"## II. Análisis Jurídico de Banderas Rojas y Riesgos Detectados")
        if not banderas:
            report.append("El motor de reglas no detectó alertas graves para este contrato. El proceso de contratación y adjudicación cumple con los estándares paramétricos iniciales de planeación, cuantía y plazos.")
        else:
            for b in banderas:
                report.append(f"### 🚩 {b.split(':')[0]}")
                report.append(f"**Descripción:** {b}\n")
                
                # Cite specific laws based on flags contents
                if "Cierre" in b:
                    report.append(f"**Sustento Normativo:**")
                    report.append(f"* **Ley 80 de 1993, Artículo 60 (Liquidación):** Los contratos de tracto sucesivo deben ser liquidados dentro de los plazos establecidos. La inacción por más de 4 meses constituye una omisión al deber de control de los saldos públicos.")
                    report.append(f"* **Ley 1474 de 2011, Artículo 84 (Supervisión):** El supervisor es responsable civil y administrativamente por no adelantar oportunamente los trámites de liquidación correspondientes.\n")
                elif "Electoral" in b or "Garantías" in b:
                    report.append(f"**Sustento Normativo:**")
                    report.append(f"* **Ley 996 de 2005, Artículo 33 (Ley de Garantías):** Prohíbe expresamente la contratación directa durante los 4 meses anteriores a elecciones. Firmar contratos directos días antes de que inicie la restricción infringe los principios de moralidad administrativa y transparencia, pudiendo constituir desvío de poder.")
                    report.append(f"* **Código Disciplinario Único:** Califica la elusión de plazos electorales como falta grave.\n")
                elif "Planeación" in b or "concentración" in b:
                    report.append(f"**Sustento Normativo:**")
                    report.append(f"* **Ley 80 de 1993, Artículo 25 Numeral 3 (Principio de Planeación):** Exige que los procesos correspondan a estudios precontractuales maduros y estén programados en el PAA. Concentrar adjudicaciones masivamente en un mes indica ejecución de saldos apresurada sin sustento técnico.\n")
                elif "Modalidad" in b or "a dedo" in b:
                    report.append(f"**Sustento Normativo:**")
                    report.append(f"* **Ley 1150 de 2007, Artículo 2 (Modalidades de Selección):** La licitación pública es la regla obligatoria. Adjudicar directamente un contrato que excede el umbral de menor cuantía elude la libre concurrencia de oferentes, configurando una violación flagrante al régimen legal de contratación estatal.\n")
                elif "Sobrecostos" in b or "adiciones" in b:
                    report.append(f"**Sustento Normativo:**")
                    report.append(f"* **Ley 80 de 1993, Artículo 40 (Modificación de Contratos):** Prohíbe expresamente adicionar contratos en más del 50% de su valor inicial. Adiciones cercanas al 45% o que superan dicho límite son indicios de planeación deficiente en la estimación presupuestal del sector.\n")
                elif "Fraccionamiento" in b:
                    report.append(f"**Sustento Normativo:**")
                    report.append(f"* **Ley 80 de 1993, Artículo 24 (Principio de Transparencia):** Prohíbe el fraccionamiento de contratos. Dividir artificialmente el objeto para otorgar múltiples contratos sucesivos de menor cuantía o directos en menos de 45 días elude los pliegos rigurosos de selección competitiva, constituyendo una conducta penalizable en la administración pública.\n")
                elif "Anomalía Administrativa" in b or "prórrogas" in b:
                    report.append(f"**Sustento Normativo:**")
                    report.append(f"* **Principio de Eficiencia y Programación Presupuestal:** Prórrogas de tiempo que duplican o superan el plazo inicial contratado demuestran fallas críticas en los estudios de factibilidad técnica y cronogramas precontractuales.\n")
                elif "Pliego Sastre" in b or "ÚNICO" in b:
                    report.append(f"**Sustento Normativo:**")
                    report.append(f"* **Decreto 1082 de 2015 y Ley 1150 de 2007 (Pluralidad de Oferentes):** El objetivo del pliego de condiciones es asegurar competencia. Que se presente un único proponente en licitación pública o concurso de méritos es sospecha de pliegos dirigidos o condiciones restrictivas ilegales.\n")
                    
        report.append(f"## III. Recomendaciones de Control y Mitigación")
        report.append(f"1. **Revisión del Expediente:** Solicitar de inmediato la justificación precontractual de estudios previos en SECOP II.")
        report.append(f"2. **Auditoría de Pliegos:** En caso de proceso de único oferente, revisar las pólizas y requisitos habilitantes.")
        report.append(f"3. **Plan de Liquidación:** Para contratos en estado abierto superados en tiempo, conminar al supervisor a la firma del acta de liquidación formal.")
        
        return {"report_markdown": "\n".join(report)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al generar auditoría RAG: {e}")

# Backward compatibility route for minambiente
@app.post("/api/auditoria-ia/{id_contrato}")
def get_auditoria_ia_minambiente(id_contrato: str):
    return get_auditoria_ia("minambiente", id_contrato)

# Serve static frontend folder (useful for local execution)
from fastapi.responses import HTMLResponse

frontend_dir = os.path.join(os.path.dirname(BASE_DIR), "frontend")
dist_dir = os.path.join(frontend_dir, "dist")

# Only attempt to mount static files if the frontend folder exists (local execution).
# On Vercel, the frontend folder is not present in the backend runtime container,
# and Vercel itself handles static routing to the frontend.
if os.path.exists(frontend_dir):
    if os.path.exists(dist_dir):
        app.mount("/", StaticFiles(directory=dist_dir, html=True), name="frontend")
    else:
        @app.get("/", response_class=HTMLResponse)
        def read_root():
            static_index = os.path.join(frontend_dir, "index.static.html")
            if os.path.exists(static_index):
                with open(static_index, "r", encoding="utf-8") as f:
                    return f.read()
            raise HTTPException(status_code=404, detail="index.static.html no encontrado en frontend/")
        
        app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    # If run directly, launch the API
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
