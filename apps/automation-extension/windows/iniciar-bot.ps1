<#
  Abre Chrome con el perfil del bot y la pestaña del panel. Lo usan las dos tareas
  programadas (al iniciar sesión y el vigilante cada 5 minutos).

  - Chrome cerrado: lo abre.
  - Chrome abierto y respondiendo: no hace nada (nunca abre una segunda instancia
    ni toca una carga en curso).
  - Chrome abierto pero COLGADO ("No responde") en dos revisiones seguidas
    (~10 minutos): lo cierra y lo vuelve a abrir. Un Chrome colgado no puede estar
    cargando, así que no se interrumpe nada.

  La extensión, al arrancar Chrome, se conecta sola al servidor y se loguea al
  panel con el usuario/contraseña guardados en sus Opciones.
#>
param(
  [Parameter(Mandatory = $true)][string]$PanelUrl,
  [string]$Perfil = "Default"
)

$ErrorActionPreference = "Stop"
$dir = Join-Path $env:LOCALAPPDATA "TioRicoBot"
$log = Join-Path $dir "arranque.log"
$marcaColgado = Join-Path $dir "chrome-colgado.txt"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
function Log($m) { Add-Content -Path $log -Value ("{0:yyyy-MM-dd HH:mm:ss}  {1}" -f (Get-Date), $m) }

$abiertos = Get-Process -Name "chrome" -ErrorAction SilentlyContinue
if ($abiertos) {
  # Sólo las ventanas visibles dicen si responden; los procesos de fondo no cuentan.
  $ventanas = $abiertos | Where-Object { $_.MainWindowHandle -ne 0 }
  $colgado = $ventanas -and -not ($ventanas | Where-Object { $_.Responding })
  if (-not $colgado) {
    Remove-Item -Force -ErrorAction SilentlyContinue $marcaColgado
    exit 0
  }
  if (-not (Test-Path $marcaColgado)) {
    # Primera vez que se lo ve colgado: puede ser un momento de carga pesada. Se espera
    # a la próxima revisión antes de hacer nada.
    Set-Content -Path $marcaColgado -Value (Get-Date -Format o)
    Log "Chrome no responde; se vuelve a mirar en la próxima revisión"
    exit 0
  }
  Log "Chrome sigue sin responder: se cierra y se vuelve a abrir"
  $abiertos | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 5
  Remove-Item -Force -ErrorAction SilentlyContinue $marcaColgado
}

$candidatos = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chrome = $candidatos | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $chrome) { Log "No se encontró chrome.exe"; exit 1 }

# Después de un corte de luz o de cerrarlo a la fuerza, Chrome marca la sesión como
# "se cerró mal" y muestra el cartel de restaurar páginas. Se la marca como cerrada
# bien para que abra directo en el panel.
$prefs = Join-Path $env:LOCALAPPDATA "Google\Chrome\User Data\$Perfil\Preferences"
if (Test-Path $prefs) {
  try {
    # Con .NET y UTF-8 SIN BOM: Get-Content/Set-Content de PowerShell 5 cambian la
    # codificación, y un Preferences inválido hace que Chrome lo resetee (y con eso
    # puede desactivar la extensión).
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    $texto = [System.IO.File]::ReadAllText($prefs, $utf8)
    $nuevo = $texto -replace '"exit_type":\s*"[A-Za-z]+"', '"exit_type":"Normal"' -replace '"exited_cleanly":\s*false', '"exited_cleanly":true'
    if ($nuevo -ne $texto) {
      Copy-Item -Force $prefs "$prefs.tiorico-bak"
      [System.IO.File]::WriteAllText($prefs, $nuevo, $utf8)
      Log "Sesión de Chrome marcada como cerrada bien"
    }
  } catch { Log "No se pudo ajustar Preferences: $($_.Exception.Message)" }
}

# Sin flags de automatización: es el Chrome de siempre. Estos sólo evitan que Chrome
# "duerma" la pestaña del panel cuando la ventana queda tapada o minimizada (la página
# no los ve), y que pregunte cosas de primer uso.
$argumentos = @(
  "--profile-directory=`"$Perfil`"",
  "--no-first-run",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
  "`"$PanelUrl`""
)
Start-Process -FilePath $chrome -ArgumentList $argumentos
Log "Chrome iniciado (perfil $Perfil)"
