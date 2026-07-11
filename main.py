# main.py
import os
import sys

# Ensure the workspace directory is in python search path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from src.downloader import run_download, DOCUMENTS, RAW_DIR
from src.parser import parse_document
from src.tagger import tag_node
from src.db_manager import init_db, clear_db, get_connection, insert_document, insert_node

def main():
    print("==========================================================")
    print("INICIANDO PIPELINE DE GESTIÓN DOCUMENTAL Y NORMATIVA LEGAL")
    print("==========================================================")
    
    # 1. Download documents
    run_download()
    
    # 2. Re-initialize database
    print("\n--- INICIALIZANDO BASE DE DATOS ---")
    clear_db()
    
    # 3. Process and index Laws and Decrees (HTMLs)
    print("\n--- PROCESANDO E INDEXANDO LEYES Y DECRETOS (HTML) ---")
    conn = get_connection()
    
    indexed_docs_count = 0
    indexed_nodes_count = 0
    
    # Default category map for documents
    # (Tagger will dynamically refine these based on content keywords)
    for key, doc in DOCUMENTS["laws"].items():
        filename = doc["filename"]
        filepath = os.path.join(RAW_DIR, filename)
        
        if not os.path.exists(filepath):
            print(f"File not found: {filepath}. Skipping...")
            continue
            
        doc_category = "Principios y Normas Generales"
        
        # Insert document metadata
        doc_id = insert_document(
            conn, 
            doc["title"], 
            doc["law_number"], 
            doc["year"], 
            doc_category, 
            doc["url"], 
            filepath,
            doc["rank"]
        )
        indexed_docs_count += 1
        
        # Parse document nodes (Títulos, Capítulos, Artículos, Parágrafos)
        try:
            nodes = parse_document(filepath)
            print(f"Document '{doc['title']}' parsed into {len(nodes)} hierarchical sections.")
            
            for node in nodes:
                # Classify and tag the node content
                tags, node_category = tag_node(
                    node["title"], 
                    node["content"], 
                    filename, 
                    doc_category
                )
                
                # Insert into DB and FTS index
                insert_node(
                    conn, 
                    doc_id, 
                    doc["title"], 
                    node["node_type"], 
                    node["title"], 
                    node["content"], 
                    node["hierarchy_path"], 
                    tags, 
                    node_category
                )
                indexed_nodes_count += 1
                
        except Exception as e:
            print(f"Error processing document {doc['title']}: {e}")
            import traceback
            traceback.print_exc()

    # 4. Process and index Manuals and Technical Guides (PDFs)
    print("\n--- PROCESANDO E INDEXANDO MANUALES Y GUÍAS (PDF) ---")
    for key, doc in DOCUMENTS["manuals"].items():
        filename = doc["filename"]
        filepath = os.path.join(RAW_DIR, filename)
        
        if not os.path.exists(filepath):
            print(f"File not found: {filepath}. Skipping...")
            continue
            
        doc_category = "Guías Operativas y Manuales de Entidad"
        
        # Insert document metadata
        doc_id = insert_document(
            conn, 
            doc["title"], 
            None,  # No law number
            None,  # Year not explicitly set or varies
            doc_category, 
            doc["url"], 
            filepath,
            doc["rank"]
        )
        indexed_docs_count += 1
        
        # Parse document logical sections
        try:
            nodes = parse_document(filepath)
            print(f"Manual '{doc['title']}' parsed into {len(nodes)} sections.")
            
            for node in nodes:
                # Classify and tag the node content
                tags, node_category = tag_node(
                    node["title"], 
                    node["content"], 
                    filename, 
                    doc_category
                )
                
                # Insert into DB and FTS index
                insert_node(
                    conn, 
                    doc_id, 
                    doc["title"], 
                    node["node_type"], 
                    node["title"], 
                    node["content"], 
                    node["hierarchy_path"], 
                    tags, 
                    node_category,
                    page_num=node.get("page_num")
                )
                indexed_nodes_count += 1
                
        except Exception as e:
            print(f"Error processing manual {doc['title']}: {e}")
            import traceback
            traceback.print_exc()
            
    conn.commit()
    conn.close()
    
    print("\n==========================================================")
    print("PIPELINE DE INDEXACIÓN COMPLETADO CON ÉXITO")
    print(f"Documentos indexados: {indexed_docs_count}")
    print(f"Nodos/Artículos indexados: {indexed_nodes_count}")
    print("Base de datos de búsqueda creada en: data/procurement_normative.db")
    print("==========================================================")

if __name__ == "__main__":
    main()
