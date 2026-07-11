# src/tagger.py
import re

# Tag keyword configuration
TAG_RULES = {
    "#Garantías": [
        r"garant[íi]a", r"p[óo]liza", r"amparo", r"asegurador", r"cauci[óo]n", r"fiador"
    ],
    "#Anticipos": [
        r"anticipo", r"pago\s+anticipado"
    ],
    "#CapacidadResidual": [
        r"capacidad\s+residual", r"capacidad\s+de\s+contrataci[óo]n", r"k\s+de\s+contrataci[óo]n"
    ],
    "#Riesgos": [
        r"riesgo", r"matriz\s+de\s+riesgo", r"previsible", r"mitigaci[óo]n", r"cobertura", r"tipificaci[óo]n"
    ],
    "#Supervisión": [
        r"supervis[i[óo]n]", r"supervisor", r"interventor[íi]a", r"interventor"
    ],
    "#OfertasBajas": [
        r"artificialmente\s+baja", r"precio\s+artificial", r"oferta\s+baja"
    ],
    "#Principios": [
        r"principio", r"transparencia", r"econom[íi]a", r"responsabilidad", r"igualdad", 
        r"moralidad", r"eficacia", r"celeridad", r"imparcialidad", r"buena\s+fe", 
        r"debido\s+proceso", r"selecci[óo]n\s+objetiva"
    ],
    "#Licitación": [
        r"licitaci[óo]n", r"pliego\s+de\s+condiciones"
    ],
    "#SelecciónAbreviada": [
        r"selecci[óo]n\s+abreviada", r"menor\s+cuant[íi]a", r"subasta\s+inversa", 
        r"acuerdo\s+marco", r"bolsa\s+de\s+productos"
    ],
    "#ConcursoMéritos": [
        r"concurso\s+de\s+m[ée]ritos", r"criterio\s+t[ée]cnico", r"consultor", r"consultor[íi]a", r"lista\s+corta"
    ],
    "#ContrataciónDirecta": [
        r"contrataci[óo]n\s+directa", r"urgencia\s+manifiesta", r"proveedor\s+[úu]nico", r"arrendamiento", 
        r"prestaci[óo]n\s+de\s+servicios"
    ],
    "#MínimaCuantía": [
        r"m[íi]nima\s+cuant[íi]a", r"invitaci[óo]n\s+p[úu]blica"
    ],
    "#Planeación": [
        r"planeaci[óo]n", r"estudio\s+previo", r"estudios\s+previos", r"estudio\s+de\s+sector", 
        r"estudios\s+de\s+sector", r"an[áa]lisis\s+del\s+sector"
    ],
    "#Liquidación": [
        r"liquidaci[óo]n", r"liquidar", r"acta\s+de\s+liquidaci[óo]n"
    ],
    "#Sanciones": [
        r"sanci[óo]n", r"sanciones", r"multa", r"incumplimiento", r"caducidad", r"cl[áa]usula\s+penal"
    ]
}

# Compile the patterns for performance
COMPILED_RULES = {tag: [re.compile(pattern, re.IGNORECASE) for pattern in patterns] 
                  for tag, patterns in TAG_RULES.items()}

# Keywords that define a segment as related to Modalities of Selection
MODALITY_KEYWORDS = [
    r"modalidad\s+de\s+selecci[óo]n",
    r"modalidades\s+de\s+selecci[óo]n",
    r"licitaci[óo]n\s+p[úu]blica",
    r"selecci[óo]n\s+abreviada",
    r"concurso\s+de\s+m[ée]ritos",
    r"contrataci[óo]n\s+directa",
    r"m[íi]nima\s+cuant[íi]a"
]
COMPILED_MODALITY_KEYWORDS = [re.compile(kw, re.IGNORECASE) for kw in MODALITY_KEYWORDS]

def tag_node(node_title, node_content, doc_filename, doc_category):
    """Analyze node content and title to determine its tags and refine its category."""
    text_to_scan = f"{node_title} \n {node_content}"
    
    # 1. Generate Tags
    tags = []
    for tag, regex_list in COMPILED_RULES.items():
        for regex in regex_list:
            if regex.search(text_to_scan):
                tags.append(tag)
                break # Move to next tag if we found a match
                
    # 2. Refine Category
    # Default category inherits from the document level
    category = doc_category
    
    # If the document is not a manual (meaning it is a law or decree)
    # but the text explicitly mentions selection modalities, we put it in "Modalidades de Selección"
    if doc_category != "Guías Operativas y Manuales de Entidad":
        is_modality = False
        for regex in COMPILED_MODALITY_KEYWORDS:
            if regex.search(text_to_scan):
                is_modality = True
                break
        if is_modality:
            category = "Modalidades de Selección"
            
    return tags, category

if __name__ == "__main__":
    # Test tagging
    t, c = tag_node(
        "Artículo 24. Del principio de transparencia", 
        "En virtud de este principio, la licitación pública es la regla general, y se regulan las pólizas de garantía.",
        "ley_80_1993.html", 
        "Principios y Normas Generales"
    )
    print("Tags:", t)
    print("Category:", c)
