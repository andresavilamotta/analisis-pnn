# src/parser.py
import re
import os
from bs4 import BeautifulSoup
from pypdf import PdfReader

# Regex patterns for Spanish normative divisions
RE_TITULO = re.compile(r'^\s*(T[ÍI]TULO\s+[IVXLCDM\d\w\-\:\.]+)\.?\s*(.*)$', re.IGNORECASE)
RE_CAPITULO = re.compile(r'^\s*(CAP[ÍI]TULO\s+[IVXLCDM\d\w\-\:\.]+)\.?\s*(.*)$', re.IGNORECASE)
RE_ARTICULO = re.compile(r'^\s*(ART[ÍI]CULO\s+\d+[\d\w\-\:\.oºª]*)\.?\s*(.*)$', re.IGNORECASE)
RE_PARAGRAFO = re.compile(r'^\s*(PAR[ÁA]GRAFO\s*[\d\w\-\:\.oºª]*)\.?\s*(.*)$', re.IGNORECASE)

def clean_text(text):
    """Cleans up extra whitespaces, HTML/XML artifacts, and formatting oddities."""
    if not text:
        return ""
    # Replace non-breaking spaces and vertical spaces
    text = text.replace('\xa0', ' ').replace('\r', '\n')
    # Collapse multiple spaces
    text = re.sub(r'[ \t]+', ' ', text)
    # Collapse multiple newlines
    text = re.sub(r'\n+', '\n', text)
    return text.strip()

def parse_suin_html(filepath):
    """Parses a SUIN HTML document and extracts structural nodes hierarchically."""
    print(f"Parsing HTML document: {filepath}")
    with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
        html_content = f.read()
        
    soup = BeautifulSoup(html_content, "html.parser")
    
    # Strip scripts, styles, etc.
    for tag in soup(["script", "style", "meta", "link", "noscript"]):
        tag.decompose()
        
    # Get all paragraph-like text tags using leaf-traversal to prevent duplicates
    elements = []
    for el in soup.find_all(['p', 'div', 'td']):
        text = el.get_text().strip()
        if not text:
            continue
        # Only keep if it doesn't contain nested text containers of interest
        if not el.find(['p', 'div', 'td']):
            if not elements or elements[-1] != text:
                elements.append(text)
            
    # Reconstruct hierarchy
    nodes = []
    
    current_titulo = ""
    current_capitulo = ""
    current_articulo = ""
    
    # Maintain active node info
    active_node = {
        "node_type": "PREAMBLE",
        "title": "Preámbulo / Introducción",
        "content": "",
        "hierarchy_path": "Preámbulo"
    }
    
    for text in elements:
        text_clean = clean_text(text)
        if not text_clean:
            continue
            
        # Ignore boilerplate texts like "SUIN", copyrights, website UI headers, etc.
        if any(bp in text_clean.upper() for bp in ["SISTEMA ÚNICO DE INFORMACIÓN", "MINISTERIO DE JUSTICIA", "TODOS LOS DERECHOS RESERVADOS", "BUSCADOR DE NORMAS"]):
            continue
            
        # Test for structural headings
        m_tit = RE_TITULO.match(text_clean)
        m_cap = RE_CAPITULO.match(text_clean)
        m_art = RE_ARTICULO.match(text_clean)
        m_par = RE_PARAGRAFO.match(text_clean)
        
        if m_tit:
            # Save the current active node
            if active_node["content"].strip():
                nodes.append(active_node)
            current_titulo = f"{m_tit.group(1)}: {m_tit.group(2)}".strip(': ')
            current_capitulo = ""
            current_articulo = ""
            active_node = {
                "node_type": "TITULO",
                "title": current_titulo,
                "content": text_clean,
                "hierarchy_path": current_titulo
            }
            
        elif m_cap:
            if active_node["content"].strip():
                nodes.append(active_node)
            current_capitulo = f"{m_cap.group(1)}: {m_cap.group(2)}".strip(': ')
            current_articulo = ""
            path = f"{current_titulo} > {current_capitulo}" if current_titulo else current_capitulo
            active_node = {
                "node_type": "CAPITULO",
                "title": current_capitulo,
                "content": text_clean,
                "hierarchy_path": path
            }
            
        elif m_art:
            if active_node["content"].strip():
                nodes.append(active_node)
            current_articulo = f"{m_art.group(1)}: {m_art.group(2)}".strip(': ')
            # Build hierarchy path
            parts = [p for p in [current_titulo, current_capitulo, current_articulo] if p]
            path = " > ".join(parts)
            active_node = {
                "node_type": "ARTICULO",
                "title": current_articulo,
                "content": text_clean,
                "hierarchy_path": path
            }
            
        elif m_par:
            # We can treat paragraphs as child nodes under the active article, 
            # but we also append it to the current article context.
            # Here we append it to the active node content and also create a child sub-node.
            par_title = f"{m_par.group(1)}: {m_par.group(2)}".strip(': ')
            active_node["content"] += f"\n\n{text_clean}"
            
            parts = [p for p in [current_titulo, current_capitulo, current_articulo, par_title] if p]
            path = " > ".join(parts)
            nodes.append({
                "node_type": "PARAGRAFO",
                "title": par_title,
                "content": text_clean,
                "hierarchy_path": path
            })
            
        else:
            # Regular content line (Inciso)
            # Append to active node
            if active_node["content"]:
                active_node["content"] += f"\n{text_clean}"
            else:
                active_node["content"] = text_clean
                
    # Append the last active node
    if active_node["content"].strip() and active_node not in nodes:
        nodes.append(active_node)
        
    # Deduplicate nodes by content
    unique_nodes = []
    seen_contents = set()
    for n in nodes:
        c_clean = clean_text(n["content"])
        if c_clean and c_clean not in seen_contents:
            seen_contents.add(c_clean)
            unique_nodes.append(n)
            
    return unique_nodes

def parse_cce_pdf(filepath):
    """Parses a Colombia Compra Eficiente PDF and splits content into logical section nodes."""
    print(f"Parsing PDF document: {filepath}")
    reader = PdfReader(filepath)
    
    pages_text = []
    for i, page in enumerate(reader.pages):
        text = page.extract_text()
        if text:
            pages_text.append((i + 1, text))
            
    nodes = []
    active_section = {
        "node_type": "SECTION",
        "title": "Introducción / Portada",
        "content": "",
        "hierarchy_path": "Introducción",
        "page_num": 1
    }
    
    # Heuristics for PDF Section Headings:
    # 1. Line starts with a number prefix like "1. ", "1.1 ", "II. ", "A. "
    # 2. Line is fully capitalized and shorter than 100 characters.
    RE_PDF_HEADING = re.compile(r'^\s*(\d+(\.\d+)*|[A-Z]|[IVXLCDM]+)\.?\s+([A-ZÁÉÍÓÚÑa-záéíóúñ\s\,\:\-\(\)\'\"]+)$')
    
    for page_num, text in pages_text:
        lines = text.split('\n')
        for line in lines:
            line_clean = clean_text(line)
            if not line_clean:
                continue
                
            # Filter footer boilerplate (e.g. page numbers, web URLs, logo labels)
            if line_clean.isdigit() or any(bp in line_clean.upper() for bp in ["WWW.COLOMBIACOMPRA.GOV.CO", "PÁGINA", "DEPARTAMENTO NACIONAL DE PLANEACIÓN", "COLOMBIA COMPRA EFEICIENTE"]):
                continue
                
            # Check if this line looks like a section heading
            heading_match = RE_PDF_HEADING.match(line_clean)
            is_all_caps_heading = line_clean.isupper() and len(line_clean) < 80 and not line_clean.endswith(('.', ','))
            
            if heading_match or is_all_caps_heading:
                # Save previous section
                if active_section["content"].strip():
                    nodes.append(active_section)
                    
                title = line_clean
                active_section = {
                    "node_type": "SECTION",
                    "title": title,
                    "content": line_clean,
                    "hierarchy_path": title,
                    "page_num": page_num
                }
            else:
                # Append to current section
                if active_section["content"]:
                    active_section["content"] += f"\n{line_clean}"
                else:
                    active_section["content"] = line_clean
                    
    # Save the last section
    if active_section["content"].strip() and active_section not in nodes:
        nodes.append(active_section)
        
    # Deduplicate nodes by content
    unique_nodes = []
    seen_contents = set()
    for n in nodes:
        c_clean = clean_text(n["content"])
        if c_clean and c_clean not in seen_contents:
            seen_contents.add(c_clean)
            unique_nodes.append(n)
            
    return unique_nodes

def parse_document(filepath):
    """Orchestrates parsing depending on the file extension."""
    _, ext = os.path.splitext(filepath.lower())
    if ext == ".html":
        return parse_suin_html(filepath)
    elif ext == ".pdf":
        return parse_cce_pdf(filepath)
    else:
        raise ValueError(f"Unsupported file format: {ext}")

if __name__ == "__main__":
    # Test on a file if run directly
    test_html = "data/raw/ley_1150_2007.html"
    if os.path.exists(test_html):
        nodes = parse_document(test_html)
        print(f"Extracted {len(nodes)} nodes from {test_html}")
        if nodes:
            print("First Node:", nodes[0])
