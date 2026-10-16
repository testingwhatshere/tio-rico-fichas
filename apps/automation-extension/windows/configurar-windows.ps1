<#
  Configuración de Windows para la PC del bot (una sola vez, como ADMINISTRADOR):

    1. Inicio de sesión automático: si la PC se reinicia o vuelve la luz, entra sola
       a Windows y las tareas de instalar-arranque.ps1 abren Chrome con el panel.
       Usa Autologon de Microsoft (Sysinternals), que guarda la clave CIFRADA, no en
       texto plano como el truco del registro. Hay que bajar Autologon64.exe de
       https://learn.microsoft.com/sysinternals/downloads/autologon y dejarlo en esta
       misma carpeta.
    2. Windows Update no reinicia solo la PC mientras hay una sesión abierta (las
       actualizaciones se instalan igual; el reinicio queda para cuando alguien lo haga).

  Uso (PowerShell abierto "como administrador"):
    powershell -ExecutionPolicy Bypass -File configurar-windows.ps1 -Usuario "bot"
  Si sólo se quiere la parte de Windows Update: agregar -SinInicioAutomatico.
#>
param(
  [string]$Usuario = $env:USERNAME,
  [string]$Dominio = $env:USERDOMAIN,
  [switch]$SinInicioAutomatico
)

$ErrorActionPreference = "Stop"
$esAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $esAdmin) {
  Write-Host "Hay que abrir PowerShell como administrador (clic derecho > Ejecutar como administrador)." -ForegroundColor Red
  exit 1
}

# 2. Windows Update: sin reinicios automáticos con la sesión abierta.
$au = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU"
New-Item -Force -Path $au | Out-Null
Set-ItemProperty -Path $au -Name "NoAutoRebootWithLoggedOnUsers" -Type DWord -Value 1
Write-Host "Windows Update: no va a reiniciar la PC solo mientras haya una sesión abierta."

# 1. Inicio de sesión automático.
if (-not $SinInicioAutomatico) {
  $autologon = Join-Path $PSScriptRoot "Autologon64.exe"
  if (-not (Test-Path $autologon)) {
    Write-Host "Falta Autologon64.exe en esta carpeta. Bajalo de:" -ForegroundColor Yellow
    Write-Host "  https://learn.microsoft.com/sysinternals/downloads/autologon"
    Write-Host "y volvé a correr este script. (Lo de Windows Update ya quedó hecho.)"
    exit 1
  }
  $clave = Read-Host -AsSecureString "Contraseña de Windows del usuario $Usuario"
  $plano = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($clave))
  try {
    & $autologon $Usuario $Dominio $plano /accepteula | Out-Null
  } finally {
    $plano = $null
  }
  Write-Host "Inicio de sesión automático activado para $Dominio\$Usuario."
  Write-Host "Ojo: cualquiera que prenda esta PC entra a Windows sin clave. Conviene que esté en un lugar cerrado."
}

Write-Host "Listo."
