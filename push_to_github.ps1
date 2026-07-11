# push_to_github.ps1
# Script para inicializar Git, hacer commit y guiar en la subida a GitHub

$ErrorActionPreference = "Stop"

# 1. Verificar si Git está instalado
$gitCmd = Get-Command git -ErrorAction SilentlyContinue
if (-not $gitCmd) {
    Write-Host "==========================================================" -ForegroundColor Yellow
    Write-Host "   GIT NO DETECTADO - INSTALANDO MEDIANTE WINGET          " -ForegroundColor Yellow
    Write-Host "==========================================================" -ForegroundColor Yellow
    Write-Host "Por favor, si aparece una ventana de Windows pidiendo permisos de Administrador (UAC), haz clic en 'Sí' para permitir la instalación." -ForegroundColor Cyan
    Write-Host ""
    
    try {
        & winget install --id Git.Git --exact --interactive
        Write-Host "Instalación completada. Reiniciando la sesión de Git..." -ForegroundColor Green
        # Actualizar la variable de entorno PATH para la sesión actual
        $env:PATH = "C:\Program Files\Git\cmd;" + $env:PATH
    } catch {
        Write-Host "No se pudo instalar Git automáticamente." -ForegroundColor Red
        Write-Host "Por favor descarga e instala Git manualmente desde: https://git-scm.com/download/win" -ForegroundColor Cyan
        exit 1
    }
}

# 2. Inicializar repositorio Git si no existe
if (-not (Test-Path ".git")) {
    Write-Host "Inicializando repositorio Git..." -ForegroundColor Blue
    git init
} else {
    Write-Host "Repositorio Git ya inicializado." -ForegroundColor Blue
}

# 3. Configurar usuario si no está configurado
$gitUser = git config user.name
$gitEmail = git config user.email

if (-not $gitUser -or -not $gitEmail) {
    Write-Host ""
    Write-Host "--- CONFIGURACIÓN DE IDENTIDAD DE GIT ---" -ForegroundColor Yellow
    if (-not $gitUser) {
        $name = Read-Host "Introduce tu nombre para Git (ej. Andres Avila)"
        git config --global user.name "$name"
    }
    if (-not $gitEmail) {
        $email = Read-Host "Introduce tu correo para Git (ej. andres@example.com)"
        git config --global user.email "$email"
    }
}

# 4. Crear archivo .gitignore para evitar subir el entorno virtual (.venv)
if (-not (Test-Path ".gitignore")) {
    Write-Host "Creando archivo .gitignore..." -ForegroundColor Blue
    @("*.pyc", "__pycache__/", ".venv/", ".env", "node_modules/", "dist/") | Out-File -FilePath ".gitignore" -Encoding utf8
}

# 5. Agregar archivos y hacer primer commit
Write-Host "Agregando archivos al área de preparación..." -ForegroundColor Blue
git add .

Write-Host "Creando commit..." -ForegroundColor Blue
try {
    git commit -m "Preparación para despliegue en Vercel" -q
    Write-Host "Commit creado con éxito." -ForegroundColor Green
} catch {
    # Podría fallar si no hay cambios
    Write-Host "No hay cambios nuevos para realizar commit o ya estaban agregados." -ForegroundColor Yellow
}

# 6. Vincular y subir a GitHub
Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "   LISTO PARA SUBIR A GITHUB                             " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host ""
Write-Host "1. Ve a https://github.com/new y crea un repositorio (ej. 'analisis-pnn')." -ForegroundColor Cyan
Write-Host "2. Copia la URL del repositorio (debe lucir como https://github.com/tu-usuario/analisis-pnn.git)." -ForegroundColor Cyan
Write-Host ""

$repoUrl = Read-Host "Pega la URL de tu repositorio de GitHub aquí"
$repoUrl = $repoUrl.Trim()

if ($repoUrl) {
    # Quitar origen anterior si ya existe
    git remote remove origin 2>$null
    
    Write-Host "Vinculando repositorio remoto..." -ForegroundColor Blue
    git remote add origin $repoUrl
    git branch -M main
    
    Write-Host "Subiendo código a GitHub (esto abrirá una ventana para iniciar sesión en tu cuenta)..." -ForegroundColor Blue
    Write-Host "Por favor completa la autenticación en el navegador si es solicitado." -ForegroundColor Yellow
    
    git push -u origin main
    
    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host "   ¡CÓDIGO SUBIDO A GITHUB CON ÉXITO!                     " -ForegroundColor Green
    Write-Host "==========================================================" -ForegroundColor Green
} else {
    Write-Host "Operación cancelada. Puedes subirlo manualmente más tarde usando:" -ForegroundColor Yellow
    Write-Host "  git remote add origin <URL_DE_TU_REPOSITORIO>" -ForegroundColor Yellow
    Write-Host "  git branch -M main" -ForegroundColor Yellow
    Write-Host "  git push -u origin main" -ForegroundColor Yellow
}
