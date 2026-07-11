# verify.ps1
# Script to verify Datos.gov.co credentials using PowerShell

# Load environment variables from .env file if it exists
if (Test-Path ".env") {
    Get-Content .env | ForEach-Object {
        if ($_ -match '^([^=]+)=(.*)$') {
            [System.Environment]::SetEnvironmentVariable($Matches[1], $Matches[2])
        }
    }
}

$apiId = [System.Environment]::GetEnvironmentVariable("DATOS_GOV_CO_API_ID")
$apiSecret = [System.Environment]::GetEnvironmentVariable("DATOS_GOV_CO_API_SECRET")

if (-not $apiId -or -not $apiSecret) {
    Write-Error "Credentials not found in .env file or environment variables."
    exit 1
}

Write-Host "Verifying credentials with Datos.gov.co..."
$pair = "$($apiId):$($apiSecret)"
$bytes = [System.Text.Encoding]::ASCII.GetBytes($pair)
$base64 = [Convert]::ToBase64String($bytes)

$headers = @{
    "Authorization" = "Basic $base64"
    "Accept"        = "application/json"
}

try {
    $response = Invoke-RestMethod -Uri "https://www.datos.gov.co/api/users/current.json" -Headers $headers -Method Get
    Write-Host "Verification SUCCESS: Credentials are valid!" -ForegroundColor Green
    Write-Host "User Profile details:"
    Write-Host "--------------------"
    Write-Host "ID: $($response.id)"
    Write-Host "Display Name: $($response.displayName)"
    Write-Host "Email: $($response.email)"
    Write-Host "API Key Name: $($response.usingApiKey.keyName)"
} catch {
    Write-Host "Verification FAILED: The credentials might be invalid or there was a network/server issue." -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
}
