# run_dashboard.ps1
# Script para iniciar el servidor unificado del Dashboard (FastAPI + React Frontend)

Write-Host "==========================================================" -ForegroundColor Green
Write-Host "   INICIANDO DASHBOARD DE CONTRATACIÓN - MINAMBIENTE      " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host ""
Write-Host "1. Levantando el Backend API en http://127.0.0.1:8000/api/contratos/minambiente" -ForegroundColor Yellow
Write-Host "2. Levantando el Frontend React en http://127.0.0.1:8000/" -ForegroundColor Yellow
Write-Host ""
Write-Host "Presiona CTRL+C para detener el servidor." -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Green
Write-Host ""

& .venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
