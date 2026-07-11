# src/install_env.ps1
# Script to set up Python and virtual environment for the procurement normative project

$ErrorActionPreference = "Stop"

# 1. Check if python is available in current PATH
$pythonCmd = $null
try {
    $cmd = Get-Command python -ErrorAction SilentlyContinue
    if ($cmd) {
        # Check if it is the real python, not the MS Store wrapper
        $output = & python --version 2>&1
        if ($output -match "Python 3\.") {
            $pythonCmd = "python"
            Write-Host "Real Python found in PATH: $output"
        }
    }
} catch {
    Write-Host "Python in PATH is the MS Store wrapper or not working."
}

# 2. If python is not found, install using winget
if (-not $pythonCmd) {
    Write-Host "Python not found in PATH or is invalid. Installing Python 3.12 using winget..."
    try {
        & winget install --id Python.Python.3.12 --exact --silent --scope user --accept-source-agreements --accept-package-agreements
        Write-Host "Python installation command finished."
        
        # Look for the python executable in AppData/Local/Programs/Python
        $userPath = "$env:LOCALAPPDATA\Programs\Python"
        if (Test-Path $userPath) {
            $pyDirs = Get-ChildItem $userPath -Directory -Filter "Python3*"
            if ($pyDirs) {
                # Pick the latest
                $pyDir = $pyDirs | Sort-Object Name -Descending | Select-Object -First 1
                $pyExe = Join-Path $pyDir.FullName "python.exe"
                if (Test-Path $pyExe) {
                    $pythonCmd = $pyExe
                    Write-Host "Python installed successfully at: $pythonCmd"
                    
                    # Update current path session
                    $env:PATH = "$($pyDir.FullName);" + $env:PATH
                    Write-Host "Updated PATH env variable for this session."
                }
            }
        }
    } catch {
        Write-Error "Failed to install Python using winget: $_"
        exit 1
    }
}

if (-not $pythonCmd) {
    Write-Error "Python installation could not be verified. Please install Python 3.12 manually or ensure winget installed it."
    exit 1
}

# 3. Create virtual environment
Write-Host "Creating virtual environment in '.venv'..."
if (Test-Path ".venv") {
    Write-Host ".venv directory already exists. Skipping creation."
} else {
    & $pythonCmd -m venv .venv
    Write-Host "Virtual environment created."
}

# 4. Determine venv python path
$venvPython = Join-Path (Get-Item ".venv").FullName "Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    $venvPython = Join-Path (Get-Item ".venv").FullName "bin/python"
}

if (-not (Test-Path $venvPython)) {
    Write-Error "Could not find virtual environment python executable."
    exit 1
}

Write-Host "Using venv python: $venvPython"

# 5. Upgrade pip and install dependencies
Write-Host "Upgrading pip..."
& $venvPython -m pip install --upgrade pip

Write-Host "Installing dependencies..."
& $venvPython -m pip install requests beautifulsoup4 pypdf python-dotenv fastapi uvicorn

Write-Host "Environment setup SUCCESSFUL!"
