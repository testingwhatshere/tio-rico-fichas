<# Quita las tareas creadas por instalar-arranque.ps1. No toca Chrome ni la extensión. #>
foreach ($t in @("TioRico Bot - inicio", "TioRico Bot - vigilante")) {
  if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $t -Confirm:$false
    Write-Host "Quitada: $t"
  }
}
Write-Host "La configuración de suspensión de la PC no se modificó; se cambia en Configuración > Sistema > Inicio/apagado y suspensión."
