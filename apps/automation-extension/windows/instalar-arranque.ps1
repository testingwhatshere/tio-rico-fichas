<#
  Deja la PC del bot recuperándose sola:
    1. Tarea "TioRico Bot - inicio": abre Chrome con el panel al iniciar sesión.
    2. Tarea "TioRico Bot - vigilante": cada 5 minutos, si Chrome no está
       corriendo (se cerró o se colgó), lo vuelve a abrir.
    3. La PC no se suspende ni hiberna enchufada (la pantalla sí puede apagarse).

  Uso (PowerShell, en la PC del bot, con el usuario que usa Chrome):
    powershell -ExecutionPolicy Bypass -File instalar-arranque.ps1 -PanelUrl "https://<panel>/users"
  Opcional: -Perfil "Profile 1" si la extensión está en otro perfil de Chrome
  (se ve en chrome://version → "Ruta del perfil").
#>
param(
  [Parameter(Mandatory = $true)][string]$PanelUrl,
  [string]$Perfil = "Default"
)

$ErrorActionPreference = "Stop"
$destino = Join-Path $env:LOCALAPPDATA "TioRicoBot"
New-Item -ItemType Directory -Force -Path $destino | Out-Null
$script = Join-Path $destino "iniciar-bot.ps1"
Copy-Item -Force (Join-Path $PSScriptRoot "iniciar-bot.ps1") $script

$accion = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`" -PanelUrl `"$PanelUrl`" -Perfil `"$Perfil`""
$usuario = "$env:USERDOMAIN\$env:USERNAME"
# Interactiva: Chrome tiene que abrirse en el escritorio del usuario, no en segundo plano.
$principal = New-ScheduledTaskPrincipal -UserId $usuario -LogonType Interactive -RunLevel Limited
$opciones = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2)

# 1. Al iniciar sesión (con 30 s de espera para que la red esté lista).
$alIniciar = New-ScheduledTaskTrigger -AtLogOn -User $usuario
$alIniciar.Delay = "PT30S"
Register-ScheduledTask -TaskName "TioRico Bot - inicio" -Action $accion -Trigger $alIniciar `
  -Principal $principal -Settings $opciones -Force | Out-Null

# 2. Vigilante cada 5 minutos.
$cada5 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName "TioRico Bot - vigilante" -Action $accion -Trigger $cada5 `
  -Principal $principal -Settings $opciones -Force | Out-Null

# 3. Que la PC no se duerma enchufada.
powercfg /change standby-timeout-ac 0 | Out-Null
powercfg /change hibernate-timeout-ac 0 | Out-Null

Write-Host "Listo. Tareas creadas:"
Write-Host "  - TioRico Bot - inicio      (al iniciar sesión)"
Write-Host "  - TioRico Bot - vigilante   (cada 5 minutos, reabre Chrome si se cerró)"
Write-Host "La PC ya no se suspende enchufada. Registro: $destino\arranque.log"
