# PC del bot: arranque automático

Objetivo: que la PC del bot se recupere sola. Si se reinicia, se corta la luz o
Chrome se cierra, el bot vuelve a quedar cargando sin que nadie toque nada.

## Instalar (una sola vez, en la PC del bot)

1. Instalar la extensión (zip del panel) en Chrome y completar sus Opciones,
   **incluido usuario y contraseña del panel**: con eso se loguea sola.
2. Copiar esta carpeta `windows` a la PC.
3. Abrir PowerShell **con el mismo usuario de Windows que usa Chrome** y correr:

   ```powershell
   powershell -ExecutionPolicy Bypass -File instalar-arranque.ps1 -PanelUrl "https://<dirección del panel>/users"
   ```

   Si la extensión está en otro perfil de Chrome, agregar `-Perfil "Profile 1"`.
   El nombre del perfil se ve en `chrome://version`, en "Ruta del perfil".

4. **(Recomendado) Que entre sola a Windows y no la reinicien las actualizaciones.**
   Bajar `Autologon64.exe` de
   https://learn.microsoft.com/sysinternals/downloads/autologon , dejarlo en esta
   carpeta, abrir PowerShell **como administrador** y correr:

   ```powershell
   powershell -ExecutionPolicy Bypass -File configurar-windows.ps1 -Usuario "<usuario de Windows>"
   ```

   Pide la contraseña de Windows una vez y la guarda cifrada (no en texto plano).

## Qué queda configurado

- **Al iniciar sesión en Windows**, Chrome se abre con el panel. La extensión se
  conecta y se loguea sola.
- **Cada 5 minutos**, si Chrome no está abierto (se cerró), se vuelve a abrir.
  Si está abierto y respondiendo no se toca, así nunca interrumpe una carga. Si
  quedó **colgado** ("No responde") dos revisiones seguidas (~10 min), se cierra
  y se vuelve a abrir: colgado no puede estar cargando.
- Al abrir Chrome después de un corte de luz no aparece el cartel de "restaurar
  páginas": abre directo en el panel.
- Con `configurar-windows.ps1`: **entra sola a Windows** al prender la PC, y
  **Windows Update no la reinicia** mientras la sesión está abierta.
- **La PC no se suspende** mientras está enchufada.
- El registro queda en `%LOCALAPPDATA%\TioRicoBot\arranque.log`.

## Lo que no se automatiza

- **Que la PC prenda sola después de un corte de luz:** eso se configura en la
  BIOS ("Restore on AC power loss" / "After power loss: Power On"). Con eso y el
  inicio automático, vuelve sola de punta a punta.
- **Captchas / "Verificá que sos humano"**: el bot no los resuelve. Avisa en la
  web de operadores y alguien lo resuelve en la pestaña del panel.

## Quitar

```powershell
powershell -ExecutionPolicy Bypass -File desinstalar-arranque.ps1
```
