# src/query.py
import sqlite3
import argparse
import os
import requests
import json
from dotenv import load_dotenv

# Load env variables (useful for GEMINI_API_KEY)
load_dotenv()

# Smart DB path: use backend/data if folder exists (restructured), fallback to data/
if os.path.exists("backend/data"):
    DB_PATH = "backend/data/procurement_normative.db"
else:
    DB_PATH = "data/procurement_normative.db"

# ANSI Colors for beautiful CLI
class Colors:
    HEADER = '\033[95m'
    BLUE = '\033[94m'
    GREEN = '\033[92m'
    WARNING = '\033[93m'
    FAIL = '\033[91m'
    END = '\033[0m'
    BOLD = '\033[1m'

def format_color(text, color):
    # Check if we are running in an environment that supports color
    # Windows 10/11 PowerShell usually supports it.
    return f"{color}{text}{Colors.END}"

def search_normative(query_text, tag_filter=None, category_filter=None, limit=5):
    """Performs BM25 search in the FTS5 table with optional metadata filtering."""
    if not os.path.exists(DB_PATH):
        print(format_color(f"Error: La base de datos no existe en {DB_PATH}. Por favor ejecuta main.py primero.", Colors.FAIL))
        return []
        
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # We retrieve fields from relational table joined with FTS5 rank
    # BM25 ranking is ordered ascending (smaller is better/more relevant in FTS5 rank)
    sql = """
    SELECT 
        dn.id, 
        d.title as doc_title, 
        dn.node_type, 
        dn.title as node_title, 
        dn.content, 
        dn.hierarchy_path, 
        dn.tags, 
        dn.category, 
        dn.page_num,
        fts.rank,
        d.rank as doc_rank
    FROM document_nodes_fts fts
    JOIN document_nodes dn ON fts.node_id = dn.id
    JOIN documents d ON dn.document_id = d.id
    WHERE 1=1
    """
    params = []
    
    if query_text and query_text.strip():
        # FTS5 match query
        sql += " AND document_nodes_fts MATCH ?"
        params.append(query_text)
    
    if tag_filter:
        sql += " AND dn.tags LIKE ?"
        params.append(f"%{tag_filter}%")
        
    if category_filter:
        sql += " AND dn.category = ?"
        params.append(category_filter)
        
    if query_text and query_text.strip():
        sql += " ORDER BY d.rank ASC, fts.rank ASC LIMIT ?"
    else:
        sql += " ORDER BY d.rank ASC, dn.id LIMIT ?"
        
    params.append(limit)
    
    cursor.execute(sql, params)
    rows = cursor.fetchall()
    conn.close()
    
    results = []
    for row in rows:
        results.append({
            "id": row[0],
            "doc_title": row[1],
            "node_type": row[2],
            "node_title": row[3],
            "content": row[4],
            "hierarchy_path": row[5],
            "tags": row[6],
            "category": row[7],
            "page_num": row[8],
            "rank": row[9] if len(row) > 9 else 0,
            "doc_rank": row[10] if len(row) > 10 else 3
        })
    return results

def get_gemini_response(query, contexts):
    """Uses Google Gemini REST API to perform RAG if GEMINI_API_KEY is available."""
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return "Clave de API 'GEMINI_API_KEY' no encontrada en el entorno. Agrega tu clave al archivo .env para habilitar respuestas RAG sintetizadas."
        
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={api_key}"
    
    context_str = ""
    for idx, c in enumerate(contexts):
        rank_desc = "Ley (Rango 1)" if c['doc_rank'] == 1 else ("Decreto (Rango 2)" if c['doc_rank'] == 2 else "Manual/Guía (Rango 3)")
        context_str += f"--- FRAGMENTO {idx+1} [Jerarquía: {rank_desc}] ({c['doc_title']} - {c['hierarchy_path']}) ---\n"
        context_str += f"{c['content']}\n\n"
        
    prompt = f"""Actúas como un asesor experto legal en contratación pública estatal de Colombia.
Responde la pregunta del usuario utilizando únicamente los fragmentos normativos proporcionados a continuación.

IMPORTANTE SOBRE LA JERARQUÍA NORMATIVA:
Los fragmentos de soporte tienen un rango jerárquico (Rango 1: Ley, Rango 2: Decreto Reglamentario, Rango 3: Guía o Manual).
Los manuales y guías internos (Rango 3) tienen carácter orientativo y están subordinados a las Leyes y Decretos. No pueden estar por encima de ellos.
Si en los fragmentos hay contradicción o conflicto entre lo dispuesto por una Ley (Rango 1) o Decreto (Rango 2) y lo dispuesto por un Manual o Guía (Rango 3), debes priorizar y hacer prevalecer lo establecido en la Ley o el Decreto. Explica esta supremacía en tu respuesta si es relevante para el caso.

Si la respuesta no se puede deducir de los fragmentos, indícalo explícitamente y sugiere qué norma consultar.
Cita siempre el número de la ley, decreto, artículo o guía y el nombre de la sección correspondiente.

Fragmentos Normativos de Soporte:
{context_str}

Pregunta del Usuario: {query}

Respuesta estructurada, clara y con fundamentos normativos (en español):"""

    payload = {
        "contents": [
            {
                "parts": [
                    {"text": prompt}
                ]
            }
        ]
    }
    
    headers = {"Content-Type": "application/json"}
    
    try:
        import urllib3
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        response = requests.post(url, headers=headers, json=payload, timeout=30, verify=False)
        response.raise_for_status()
        res_json = response.json()
        answer = res_json['candidates'][0]['content']['parts'][0]['text']
        return answer
    except Exception as e:
        return f"Error al invocar la API de Gemini: {e}"

def get_rank_label(rank_val):
    if rank_val == 1:
        return "Rango 1: Ley (Prevalece sobre Decretos y Manuales)"
    elif rank_val == 2:
        return "Rango 2: Decreto Reglamentario (Prevalece sobre Manuales)"
    elif rank_val == 3:
        return "Rango 3: Guía/Manual Operativo (Carácter orientativo, subordinado a Leyes y Decretos)"
    return "Desconocido"

def display_results(results):
    """Displays the retrieved results in a user-friendly console layout."""
    if not results:
        print(format_color("\nNo se encontraron resultados que coincidan con la búsqueda.", Colors.WARNING))
        return
        
    for idx, r in enumerate(results):
        print("\n" + "="*80)
        rank_score = r['rank'] if r['rank'] is not None else 0.0
        print(format_color(f"RESULTADO #{idx+1} - Coincidencia Semántica (Rank Score: {rank_score:.4f})", Colors.HEADER))
        print("="*80)
        print(f"{format_color('Documento:', Colors.BOLD)} {r['doc_title']}")
        print(f"{format_color('Rango Jerárquico:', Colors.BOLD)} {get_rank_label(r['doc_rank'])}")
        print(f"{format_color('Jerarquía:', Colors.BOLD)} {r['hierarchy_path']}")
        print(f"{format_color('Categoría:', Colors.BOLD)} {r['category']}")
        if r['tags']:
            print(f"{format_color('Etiquetas:', Colors.BOLD)} {format_color(r['tags'], Colors.GREEN)}")
        if r['page_num']:
            print(f"{format_color('Página (PDF):', Colors.BOLD)} {r['page_num']}")
            
        print("-"*80)
        # Trim content if too long for preview
        content_preview = r['content']
        if len(content_preview) > 800:
            content_preview = content_preview[:800] + "\n... [Texto truncado para vista previa]"
        print(content_preview)
        print("="*80)

def main():
    parser = argparse.ArgumentParser(description="Consulta la base de datos de contratación pública en Colombia.")
    parser.add_argument("query", type=str, nargs="?", help="Texto a buscar en la normativa.")
    parser.add_argument("-t", "--tag", type=str, help="Filtrar por etiqueta (ej. #Riesgos, #Garantías).")
    parser.add_argument("-c", "--category", type=str, choices=[
        "Principios y Normas Generales", 
        "Modalidades de Selección", 
        "Guías Operativas y Manuales de Entidad"
    ], help="Filtrar por categoría normativa.")
    parser.add_argument("-l", "--limit", type=int, default=5, help="Límite de resultados a retornar.")
    parser.add_argument("-i", "--interactive", action="store_true", help="Iniciar sesión interactiva de preguntas y respuestas.")
    parser.add_argument("--rag", action="store_true", help="Habilitar respuesta sintetizada por IA (RAG) para la consulta.")
    
    args = parser.parse_args()
    
    if args.interactive:
        print(format_color("\n======================================================================", Colors.BLUE + Colors.BOLD))
        print(format_color("  AGENTE CONSULTOR DE CONTRATACIÓN PÚBLICA COLOMBIANA - INTERACTIVO", Colors.BLUE + Colors.BOLD))
        print(format_color("======================================================================", Colors.BLUE + Colors.BOLD))
        print("Escribe tus consultas sobre Ley 80, Ley 1150, Decreto 1082, Manuales de CCE, etc.")
        print("Comandos especiales: 'salir' o 'exit' para terminar.\n")
        
        while True:
            try:
                user_query = input(format_color("Pregunta> ", Colors.GREEN)).strip()
                if not user_query:
                    continue
                if user_query.lower() in ["salir", "exit"]:
                    print("Sesión interactiva finalizada.")
                    break
                    
                results = search_normative(user_query, limit=3)
                if not results:
                    print(format_color("No se encontraron fragmentos normativos para esta pregunta.", Colors.WARNING))
                    continue
                    
                print(format_color(f"\n--- Se encontraron {len(results)} fragmentos relevantes de soporte ---", Colors.BLUE))
                for idx, r in enumerate(results):
                    print(f"[{idx+1}] {r['doc_title']} - {r['hierarchy_path']}")
                    
                # RAG synthesising
                api_key = os.environ.get("GEMINI_API_KEY")
                if api_key:
                    print(format_color("\nGenerando respuesta fundamentada mediante RAG (Gemini)...", Colors.HEADER))
                    ans = get_gemini_response(user_query, results)
                    print("\n" + format_color("Respuesta del Asesor Legal:", Colors.BOLD))
                    print(ans)
                    print()
                else:
                    print(format_color("\nClave GEMINI_API_KEY no detectada. Mostrando el fragmento principal recuperado:\n", Colors.BOLD))
                    print(results[0]['content'])
                    print()
            except KeyboardInterrupt:
                print("\nSesión interactiva finalizada.")
                break
    else:
        if not args.query and not args.tag and not args.category:
            parser.print_help()
            return
            
        results = search_normative(args.query, args.tag, args.category, args.limit)
        display_results(results)
        
        if args.rag and results:
            print(format_color("\nGenerando síntesis de IA (RAG)...", Colors.BLUE))
            ans = get_gemini_response(args.query, results)
            print("\n" + format_color("Síntesis Normativa RAG:", Colors.BOLD))
            print(ans)

if __name__ == "__main__":
    main()
