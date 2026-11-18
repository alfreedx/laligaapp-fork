# Copia el ejecutable compilado (npm run build:electron) a la carpeta fija
# que usa la tarea programada "LaLigaFantasy - Informe diario".
$ErrorActionPreference = 'Stop'
$src = Join-Path $PSScriptRoot '..\dist\LaLiga-Fantasy-App\win-unpacked'
$dst = Join-Path $env:LOCALAPPDATA 'Programs\LaLigaFantasyFork'

if (-not (Test-Path (Join-Path $src 'LaLiga Fantasy App.exe'))) {
    Write-Error "No hay compilación en $src. Ejecuta antes: npm run build:electron"
}
if (Get-Process -Name 'LaLiga Fantasy App' -ErrorAction SilentlyContinue) {
    Write-Error 'La app está abierta. Ciérrala (también desde la bandeja del sistema) y vuelve a ejecutar este script.'
}

robocopy $src $dst /MIR /NFL /NDL /NJH /NP | Out-Null
if ($LASTEXITCODE -ge 8) { Write-Error "robocopy falló con código $LASTEXITCODE" }
Write-Output "Instalado en $dst"
