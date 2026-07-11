# src/db_manager.py
import sqlite3
import os

# Smart DB path: use backend/data if folder exists (restructured), fallback to data/
if os.path.exists("backend/data"):
    DB_PATH = "backend/data/procurement_normative.db"
else:
    DB_PATH = "data/procurement_normative.db"

def get_connection(db_path=DB_PATH):
    """Returns a connection to the SQLite database, enabling support for foreign keys."""
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn

def init_db(db_path=DB_PATH):
    """Initializes the database schema and creates FTS5 search tables."""
    conn = get_connection(db_path)
    cursor = conn.cursor()
    
    # 1. Create Documents Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        law_number TEXT,
        year INTEGER,
        category TEXT,
        url TEXT,
        filepath TEXT,
        rank INTEGER
    );
    """)
    
    # 2. Create Document Nodes Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS document_nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER,
        node_type TEXT,
        title TEXT,
        content TEXT,
        hierarchy_path TEXT,
        tags TEXT,
        category TEXT,
        page_num INTEGER,
        FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
    );
    """)
    
    # 3. Create FTS5 Virtual Table for Spanish Search
    # unicode61 tokenization with remove_diacritics=1 handles accents (tildes) automatically.
    try:
        cursor.execute("""
        CREATE VIRTUAL TABLE IF NOT EXISTS document_nodes_fts USING fts5(
            node_id UNINDEXED,
            document_title,
            node_type,
            title,
            content,
            tags,
            category,
            tokenize="unicode61 remove_diacritics 1"
        );
        """)
    except sqlite3.OperationalError as e:
        # Fallback if remove_diacritics or fts5 is unsupported (very rare on modern pythons)
        print(f"Warning FTS5 setup: {e}. Attempting basic FTS5 setup...")
        cursor.execute("""
        CREATE VIRTUAL TABLE IF NOT EXISTS document_nodes_fts USING fts5(
            node_id UNINDEXED,
            document_title,
            node_type,
            title,
            content,
            tags,
            category
        );
        """)
        
    conn.commit()
    conn.close()
    print(f"Database initialized at: {db_path}")

def clear_db(db_path=DB_PATH):
    """Clears all existing database records to allow clean re-indexing."""
    conn = get_connection(db_path)
    cursor = conn.cursor()
    cursor.execute("DROP TABLE IF EXISTS document_nodes_fts;")
    cursor.execute("DROP TABLE IF EXISTS document_nodes;")
    cursor.execute("DROP TABLE IF EXISTS documents;")
    conn.commit()
    conn.close()
    print("Database cleared.")
    init_db(db_path)

def insert_document(conn, title, law_number, year, category, url, filepath, rank):
    """Inserts document metadata and returns the generated document_id."""
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO documents (title, law_number, year, category, url, filepath, rank)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (title, law_number, year, category, url, filepath, rank))
    return cursor.lastrowid

def insert_node(conn, doc_id, doc_title, node_type, title, content, hierarchy_path, tags_list, category, page_num=None):
    """Inserts a structured normative node into the relational table and FTS5 search table."""
    cursor = conn.cursor()
    tags_str = ", ".join(tags_list) if tags_list else ""
    
    # 1. Insert into relational table
    cursor.execute("""
    INSERT INTO document_nodes (document_id, node_type, title, content, hierarchy_path, tags, category, page_num)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (doc_id, node_type, title, content, hierarchy_path, tags_str, category, page_num))
    
    node_id = cursor.lastrowid
    
    # 2. Insert into FTS5 table
    cursor.execute("""
    INSERT INTO document_nodes_fts (node_id, document_title, node_type, title, content, tags, category)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (node_id, doc_title, node_type, title, content, tags_str, category))
    
    return node_id

if __name__ == "__main__":
    init_db()
