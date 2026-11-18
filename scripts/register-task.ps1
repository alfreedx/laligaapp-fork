# Crea (o elimina) la tarea programada que genera el informe diario.
# Uso:
#   powershell -ExecutionPolicy Bypass -File scripts/register-task.ps1            # 19:05
#   powershell -ExecutionPolicy Bypass -File scripts/register-task.ps1 -At 19:10
#   powershell -ExecutionPolicy Bypass -File scripts/register-task.ps1 -Remove
param(
    [string]$At = '19:05',
    [switch]$Remove
)
$ErrorActionPreference = 'Stop'
$taskName = 'LaLigaFantasy - Informe diario'

if ($Remove) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Output "Tarea '$taskName' eliminada."
    return
}

$exe = Join-Path $env:LOCALAPPDATA 'Programs\LaLigaFantasyFork\LaLiga Fantasy App.exe'
if (-not (Test-Path $exe)) {
    Write-Error "No existe $exe. Compila e instala antes: npm run build:electron; scripts/install-local.ps1"
}

$action = New-ScheduledTaskAction -Execute $exe -Argument '--daily-run' -WorkingDirectory (Split-Path $exe)
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet -WakeToRun -StartWhenAvailable -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force `
    -Description 'Abre LaLiga Fantasy (fork) tras el reseteo del mercado, genera el informe y ejecuta el auto-mercado; despierta el equipo si está en suspensión.' | Out-Null

$next = (Get-ScheduledTaskInfo -TaskName $taskName).NextRunTime
Write-Output "Tarea '$taskName' registrada. Próxima ejecución: $next"
