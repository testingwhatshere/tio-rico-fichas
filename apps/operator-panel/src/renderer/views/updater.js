// renderer/views/updater.js — Auto-update check and UI logic

/**
 * Check for app update on launch. If an update is available,
 * shows a blocking overlay and returns a never-resolving promise
 * so the rest of the app init is blocked until the user updates.
 * If no update or backend unreachable, returns immediately.
 */
export async function checkForAppUpdate() {
  if (!window.api?.checkUpdate) return;

  try {
    const result = await window.api.checkUpdate();
    if (!result || !result.updateAvailable) return;

    // Show update overlay
    const overlay = document.getElementById('update-overlay');
    if (!overlay) return;
    overlay.classList.remove('hidden');

    document.getElementById('update-version').textContent = result.latestVersion;

    if (result.changelog) {
      document.getElementById('update-changelog').classList.remove('hidden');
      document.getElementById('update-changelog-text').textContent = result.changelog;
    }

    const btn = document.getElementById('update-btn');
    const progressContainer = document.getElementById('update-progress-container');
    const progressFill = document.getElementById('update-progress-fill');
    const progressText = document.getElementById('update-progress-text');
    const errorContainer = document.getElementById('update-error');
    const errorText = document.getElementById('update-error-text');

    // Listen for download progress
    window.api.onUpdateProgress(({ percent }) => {
      progressFill.style.width = `${percent}%`;
      progressText.textContent = `Descargando... ${percent}%`;
    });

    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = 'Descargando...';
      errorContainer.classList.add('hidden');
      progressContainer.classList.remove('hidden');

      const downloadResult = await window.api.downloadUpdate(result.downloadUrl);

      if (!downloadResult.success) {
        progressContainer.classList.add('hidden');
        errorContainer.classList.remove('hidden');
        errorText.textContent = downloadResult.error || 'Error al descargar la actualizacion';
        btn.disabled = false;
        btn.textContent = 'Reintentar';
        return;
      }

      // Download complete — launch installer
      btn.textContent = 'Instalando...';
      progressText.textContent = 'Abriendo instalador...';

      await window.api.installUpdate(downloadResult.filePath);
      // App will quit after launching installer
    };

    // Block further initialization — never resolves
    return new Promise(() => {});
  } catch (err) {
    console.error('[Updater] Error checking for update:', err);
    // On error, let the app continue normally
  }
}
