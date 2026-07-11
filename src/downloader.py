# src/downloader.py
import os
import requests

DOCUMENTS = {
    "laws": {
        "ley_80_1993": {
            "title": "Ley 80 de 1993 (Estatuto General de Contratación)",
            "url": "https://www.suin-juriscol.gov.co/viewDocument.asp?id=1790106",
            "filename": "ley_80_1993.html",
            "year": 1993,
            "law_number": "80",
            "rank": 1
        },
        "ley_1150_2007": {
            "title": "Ley 1150 de 2007 (Medidas para la eficiencia y transparencia)",
            "url": "https://www.suin-juriscol.gov.co/viewDocument.asp?id=1674903",
            "filename": "ley_1150_2007.html",
            "year": 2007,
            "law_number": "1150",
            "rank": 1
        },
        "decreto_1082_2015": {
            "title": "Decreto 1082 de 2015 (Decreto Único Reglamentario del Sector Planeación)",
            "url": "https://www.suin-juriscol.gov.co/viewDocument.asp?id=30019920",
            "filename": "decreto_1082_2015.html",
            "year": 2015,
            "law_number": "1082",
            "rank": 2
        }
    },
    "manuals": {
        "lineamientos_manuales": {
            "title": "Lineamientos Generales para la Expedición de Manuales de Contratación",
            "url": "https://www.colombiacompra.gov.co/wp-content/uploads/2025/12/Lineamientos-Generales-para-la-Expedicion-de-Manuales-de-Contratacion-V2-OF-1.pdf",
            "filename": "lineamientos_manuales.pdf",
            "rank": 3
        },
        "estudios_sector": {
            "title": "Guía para la Elaboración de Estudios de Sector",
            "url": "https://www.colombiacompra.gov.co/wp-content/uploads/2025/09/Guia-para-la-Elaboracion-de-Estudios-del-Sector-V3.pdf",
            "filename": "estudios_sector.pdf",
            "rank": 3
        },
        "gestion_riesgo": {
            "title": "Manual para la Identificación y Cobertura del Riesgo",
            "url": "https://www.colombiacompra.gov.co/wp-content/uploads/2025/05/2017-manual-para-la-identificacion-y-cobertura-del-riesgo-en-los-procesos-de-contratacion-M-ICR-01.pdf",
            "filename": "gestion_riesgo.pdf",
            "rank": 3
        },
        "supervision_interventoria": {
            "title": "Guía para el ejercicio de la Supervisión e Interventoría",
            "url": "https://www.colombiacompra.gov.co/wp-content/uploads/2025/04/cce-gco-ma-03_manual_de_supervision_e_interventoria_v1_28112024_2_1.pdf",
            "filename": "supervision_interventoria.pdf",
            "rank": 3
        },
        "ofertas_bajas": {
            "title": "Guía para el manejo de ofertas artificialmente bajas",
            "url": "https://relatoria.colombiacompra.gov.co/wp-content/uploads/2024/05/1657815267567-C-299.pdf",
            "filename": "ofertas_bajas.pdf",
            "rank": 3
        }
    }
}

RAW_DIR = "data/raw"

def download_file(url, filepath):
    """Downloads a file with stream enabled and custom user agent to prevent blocks."""
    import urllib3
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    
    print(f"Downloading from: {url} -> {filepath}")
    response = requests.get(url, headers=headers, stream=True, timeout=30, verify=False)
    response.raise_for_status()
    
    with open(filepath, "wb") as f:
        for chunk in response.iter_content(chunk_size=8192):
            if chunk:
                f.write(chunk)
    print(f"Downloaded successfully: {filepath}")

def run_download():
    """Download all laws and manuals if they do not exist."""
    os.makedirs(RAW_DIR, exist_ok=True)
    
    # Download Laws
    print("\n--- DESCAGANDO LEYES Y DECRETOS (HTML) ---")
    for key, doc in DOCUMENTS["laws"].items():
        filepath = os.path.join(RAW_DIR, doc["filename"])
        if os.path.exists(filepath) and os.path.getsize(filepath) > 1000:
            print(f"File already exists: {filepath}")
        else:
            try:
                download_file(doc["url"], filepath)
            except Exception as e:
                print(f"Error downloading {doc['title']}: {e}")
                
    # Download Manuals
    print("\n--- DESCARGANDO MANUALES Y GUÍAS (PDF) ---")
    for key, doc in DOCUMENTS["manuals"].items():
        filepath = os.path.join(RAW_DIR, doc["filename"])
        if os.path.exists(filepath) and os.path.getsize(filepath) > 1000:
            print(f"File already exists: {filepath}")
        else:
            try:
                download_file(doc["url"], filepath)
            except Exception as e:
                print(f"Error downloading {doc['title']}: {e}")

if __name__ == "__main__":
    run_download()
