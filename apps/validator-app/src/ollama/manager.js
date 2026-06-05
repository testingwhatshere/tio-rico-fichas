const path = require('path');
const fs = require('fs');
const https = require('https');
const { execFile, spawn } = require('child_process');
const logger = require('../logger');
const configMod = require('../config');

function createOllamaManager(deps) {
  // deps = { config, sendToRenderer, getMainWindow }
  let ollamaAvailable = false;
  let ollamaProcess = null;
  let ollamaSpawnedByApp = false; // Only kill on quit if WE started it.
  let ollamaHealthInterval = null;
  let memoryCheckInterval = null;
  let lastAutoSelectedModel = null; // For surfacing silent model swaps to UI.

  // Check if Ollama is installed and running
  async function checkOllama(autoPullVisionModel = true) {
    console.log('[checkOllama] Starting check, autoPull:', autoPullVisionModel);
    deps.sendToRenderer('ollama-checking', {});
    deps.sendToRenderer('log', { message: 'Verificando motor de IA...', type: 'info' });

    let statusSent = false;

    try {
      // Create abort controller for timeout (more compatible than AbortSignal.timeout)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        console.log('[checkOllama] Request timeout');
        controller.abort();
      }, 8000); // Increased timeout to 8 seconds

      console.log('[checkOllama] Fetching from:', `${deps.config.ollamaUrl}/api/tags`);

      let response;
      try {
        response = await fetch(`${deps.config.ollamaUrl}/api/tags`, {
          signal: controller.signal,
        });
      } catch (fetchError) {
        clearTimeout(timeoutId);
        // More specific error messages
        if (fetchError.name === 'AbortError') {
          throw new Error('Tiempo agotado conectando a Ollama');
        } else if (fetchError.code === 'ECONNREFUSED') {
          throw new Error('Ollama no esta corriendo (conexion rechazada)');
        } else {
          throw new Error(`No se pudo conectar a Ollama: ${fetchError.message}`);
        }
      }

      clearTimeout(timeoutId);
      console.log('[checkOllama] Response status:', response.status);

      if (!response.ok) {
        throw new Error(`Ollama respondio con error: ${response.status}`);
      }

      const data = await response.json();
      console.log('[checkOllama] Models found:', data.models?.length || 0);
      ollamaAvailable = true;

      const models = data.models || [];
      const visionModels = models.filter(m =>
        m.name.includes('vision') ||
        m.name.includes('qwen2.5-vl') ||
        m.name.includes('qwen2-vl') ||
        m.name.includes('llava') ||
        m.name.includes('llama3.2-vision') ||
        m.name.includes('minicpm-v')
      );

      console.log('[checkOllama] Vision models:', visionModels.map(m => m.name));

      // Send status first before any auto-pull
      deps.sendToRenderer('ollama-status', {
        installed: true,
        running: true,
        hasVisionModel: visionModels.length > 0,
        models: models.map(m => m.name),
        visionModels: visionModels.map(m => m.name),
        selectedModel: deps.config.ollamaModel,
      });
      statusSent = true;

      deps.sendToRenderer('log', { message: 'Motor de IA activo', type: 'success' });

      // Auto-pull vision model if none found and auto-pull is enabled
      if (visionModels.length === 0 && autoPullVisionModel) {
        console.log('[checkOllama] No vision model, starting auto-download');
        logger.info('OLLAMA', 'No vision model found, auto-downloading qwen2.5-vl...');

        // Send UI event to show auto-download is starting
        deps.sendToRenderer('auto-download-started', { model: 'qwen2.5-vl' });
        deps.sendToRenderer('log', { message: 'No se encontro modelo de vision. Descargando qwen2.5-vl automaticamente...', type: 'info' });

        // Pull qwen2.5-vl (better accuracy than llava for payment proof validation)
        const pullResult = await pullModel('qwen2.5-vl');

        if (pullResult.success) {
          // Auto-select the downloaded model
          deps.config.ollamaModel = 'qwen2.5-vl';
          deps.sendToRenderer('auto-download-complete', { model: 'qwen2.5-vl' });
          deps.sendToRenderer('log', { message: 'Modelo qwen2.5-vl descargado y seleccionado!', type: 'success' });
          deps.sendToRenderer('model-selected', { model: 'qwen2.5-vl' });
          return { installed: true, running: true, hasVisionModel: true, autoDownloaded: true };
        } else {
          console.log('[checkOllama] Auto-download failed:', pullResult.error);
          deps.sendToRenderer('auto-download-failed', { error: pullResult.error });
          deps.sendToRenderer('log', { message: `Error descargando modelo: ${pullResult.error}`, type: 'error' });
          return { installed: true, running: true, hasVisionModel: false, error: pullResult.error };
        }
      }

      // Auto-select best vision model if current selection is not a vision model
      // Priority order: qwen2.5-vl > qwen2-vl > llama3.2-vision > llava > minicpm-v > any
      if (visionModels.length > 0 && !visionModels.some(m => m.name === deps.config.ollamaModel)) {
        const MODEL_PRIORITY = ['qwen2.5-vl', 'qwen2-vl', 'llama3.2-vision', 'llava', 'minicpm-v'];
        let selectedModel = visionModels[0].name;
        for (const preferred of MODEL_PRIORITY) {
          const match = visionModels.find(m => m.name.includes(preferred));
          if (match) {
            selectedModel = match.name;
            break;
          }
        }
        const previous = deps.config.ollamaModel;
        deps.config.ollamaModel = selectedModel;
        // Persist so next boot uses the same model without re-deciding.
        try { configMod.saveConfig(); } catch (e) { logger.warn('OLLAMA', `Could not persist auto-selected model: ${e.message}`); }
        logger.info('OLLAMA', `Auto-selected vision model: ${selectedModel}`, { previous });
        // Surface the swap so the operator knows we changed their picked model.
        if (previous && previous !== selectedModel && lastAutoSelectedModel !== selectedModel) {
          deps.sendToRenderer('log', { message: `Cambiamos el modelo a "${selectedModel}" porque "${previous}" no soporta vision`, type: 'warning' });
          deps.sendToRenderer('model-auto-switched', { previous, selected: selectedModel, reason: 'no_vision_support' });
        } else {
          deps.sendToRenderer('log', { message: `Modelo de vision seleccionado: ${selectedModel}`, type: 'success' });
        }
        lastAutoSelectedModel = selectedModel;
        deps.sendToRenderer('model-selected', { model: selectedModel });
      } else if (visionModels.length > 0) {
        // Model already selected, just confirm
        deps.sendToRenderer('log', { message: `Modelo activo: ${deps.config.ollamaModel}`, type: 'info' });
      }

      return { installed: true, running: true, hasVisionModel: visionModels.length > 0 };

    } catch (error) {
      console.log('[checkOllama] Error:', error.message);

      // Ollama not running, check if installed
      let installed = false;
      try {
        installed = await isOllamaInstalled();
      } catch (installCheckError) {
        console.log('[checkOllama] Error checking installation:', installCheckError.message);
      }

      console.log('[checkOllama] Ollama installed:', installed);
      ollamaAvailable = false;

      // Always send status update
      deps.sendToRenderer('ollama-status', {
        installed,
        running: false,
        hasVisionModel: false,
        error: error.message,
      });
      statusSent = true;

      if (installed) {
        deps.sendToRenderer('log', { message: 'Ollama instalado pero no esta corriendo. Haz clic en "Iniciar Ollama".', type: 'warning' });
      } else {
        deps.sendToRenderer('log', { message: 'Ollama no esta instalado. Haz clic en "Instalar Ollama".', type: 'error' });
      }

      return { installed, running: false, hasVisionModel: false, error: error.message };
    } finally {
      // Safety net: if status was never sent, send a failure status
      if (!statusSent) {
        console.log('[checkOllama] Status was never sent, sending fallback');
        deps.sendToRenderer('ollama-status', {
          installed: false,
          running: false,
          hasVisionModel: false,
          error: 'Error desconocido verificando Ollama',
        });
        deps.sendToRenderer('log', { message: 'Error verificando Ollama', type: 'error' });
      }
    }
  }

  // Check if Ollama is installed on the system
  async function isOllamaInstalled() {
    return new Promise((resolve) => {
      const command = process.platform === 'win32' ? 'where' : 'which';
      console.log('[isOllamaInstalled] Running:', command, 'ollama');

      // Add timeout to prevent hanging
      const timeout = setTimeout(() => {
        console.log('[isOllamaInstalled] Timeout - checking common paths');
        // On Windows, also check common install locations
        if (process.platform === 'win32') {
          const foundPath = findOllamaOnWindows();
          if (foundPath) {
            console.log('[isOllamaInstalled] Found Ollama at:', foundPath);
            global.ollamaExePath = foundPath;
            resolve(true);
            return;
          }
        }
        resolve(false);
      }, 3000);

      execFile(command, ['ollama'], (error) => {
        clearTimeout(timeout);
        if (!error) {
          console.log('[isOllamaInstalled] Found in PATH');
          resolve(true);
          return;
        }

        // On Windows, check common install locations if not in PATH
        if (process.platform === 'win32') {
          const foundPath = findOllamaOnWindows();
          if (foundPath) {
            console.log('[isOllamaInstalled] Found Ollama at:', foundPath);
            global.ollamaExePath = foundPath;
            resolve(true);
            return;
          }
        }

        console.log('[isOllamaInstalled] Not found');
        resolve(false);
      });
    });
  }

  // Find Ollama on Windows in common installation locations
  function findOllamaOnWindows() {
    const localAppData = process.env.LOCALAPPDATA || '';
    const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';

    const possiblePaths = [
      path.join(localAppData, 'Programs', 'Ollama', 'ollama.exe'),
      path.join(localAppData, 'Ollama', 'ollama.exe'),
      path.join(programFiles, 'Ollama', 'ollama.exe'),
      'C:\\Program Files\\Ollama\\ollama.exe',
    ];

    for (const ollamaPath of possiblePaths) {
      try {
        if (fs.existsSync(ollamaPath)) {
          return ollamaPath;
        }
      } catch (e) {
        // Ignore access errors
      }
    }

    return null;
  }

  // Download and install Ollama
  async function installOllama() {
    const platform = process.platform;
    const { shell } = require('electron');

    deps.sendToRenderer('install-progress', {
      step: 'downloading',
      message: 'Descargando Ollama...',
      progress: 0
    });

    try {
      if (platform === 'darwin') {
        // Mac - open download page (requires manual install due to .app bundle)
        shell.openExternal('https://ollama.com/download/mac');
        deps.sendToRenderer('install-progress', {
          step: 'manual',
          message: 'Descarga iniciada. Instala Ollama y vuelve a esta app.',
        });
        return { success: false, manual: true };
      }

      if (platform === 'win32') {
        // Windows - download installer
        const { app } = require('electron');
        const userDataPath = app.getPath('userData');
        const installerPath = path.join(userDataPath, 'OllamaSetup.exe');
        const downloadUrl = 'https://ollama.com/download/OllamaSetup.exe';

        await downloadFile(downloadUrl, installerPath, (progress) => {
          deps.sendToRenderer('install-progress', {
            step: 'downloading',
            message: `Descargando... ${progress}%`,
            progress
          });
        });

        deps.sendToRenderer('install-progress', {
          step: 'installing',
          message: 'Ejecutando instalador...',
          progress: 100
        });

        // Run installer
        execFile(installerPath, [], (error) => {
          if (error) {
            deps.sendToRenderer('install-progress', {
              step: 'error',
              message: `Error: ${error.message}`
            });
          } else {
            deps.sendToRenderer('install-progress', {
              step: 'done',
              message: 'Ollama instalado! Reinicia la app.'
            });
          }
        });

        return { success: true };
      }

      if (platform === 'linux') {
        // Linux - run install script
        shell.openExternal('https://ollama.com/download/linux');
        deps.sendToRenderer('install-progress', {
          step: 'manual',
          message: 'Abre una terminal y ejecuta: curl -fsSL https://ollama.com/install.sh | sh',
        });
        return { success: false, manual: true };
      }
    } catch (error) {
      deps.sendToRenderer('install-progress', {
        step: 'error',
        message: `Error: ${error.message}`
      });
      return { success: false, error: error.message };
    }
  }

  // Download file with progress
  function downloadFile(url, destPath, onProgress) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(destPath);
      const http = require('http');

      // Choose protocol based on URL
      const protocol = url.startsWith('https://') ? https : http;
      const urlObj = new URL(url);

      // Set timeout for the request
      const requestTimeout = setTimeout(() => {
        file.close();
        fs.unlink(destPath, () => {});
        reject(new Error('Download timeout after 60 seconds'));
      }, 60000);

      const request = protocol.get(url, (response) => {
        // Handle all redirect status codes (301, 302, 303, 307, 308)
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          clearTimeout(requestTimeout);
          file.close();
          try {
            fs.unlinkSync(destPath);
          } catch (e) {}

          const redirectUrl = response.headers.location;
          if (!redirectUrl) {
            reject(new Error('Redirect without location header'));
            return;
          }

          // Handle relative redirects
          const absoluteUrl = redirectUrl.startsWith('http')
            ? redirectUrl
            : new URL(redirectUrl, url).href;

          return downloadFile(absoluteUrl, destPath, onProgress)
            .then(resolve)
            .catch(reject);
        }

        // Validate response status
        if (response.statusCode !== 200) {
          clearTimeout(requestTimeout);
          file.close();
          fs.unlink(destPath, () => {});
          reject(new Error(`HTTP error: ${response.statusCode}`));
          return;
        }

        const totalSize = parseInt(response.headers['content-length'], 10);
        let downloadedSize = 0;

        response.on('data', (chunk) => {
          downloadedSize += chunk.length;
          if (totalSize) {
            const progress = Math.round((downloadedSize / totalSize) * 100);
            onProgress(progress);
          }
        });

        response.pipe(file);

        file.on('finish', () => {
          clearTimeout(requestTimeout);
          file.close();
          resolve();
        });

        file.on('error', (error) => {
          clearTimeout(requestTimeout);
          fs.unlink(destPath, () => {});
          reject(error);
        });
      });

      request.on('error', (error) => {
        clearTimeout(requestTimeout);
        file.close();
        fs.unlink(destPath, () => {});
        reject(error);
      });

      request.on('timeout', () => {
        clearTimeout(requestTimeout);
        request.destroy();
        file.close();
        fs.unlink(destPath, () => {});
        reject(new Error('Request timeout'));
      });
    });
  }

  // Start Ollama service
  async function startOllama() {
    deps.sendToRenderer('ollama-starting', {});

    try {
      // Use discovered path if available, otherwise fallback to default command
      let command;
      let spawnOptions = {
        detached: true,
        stdio: 'ignore',
      };

      if (process.platform === 'win32') {
        // On Windows, prefer the discovered path
        if (global.ollamaExePath && fs.existsSync(global.ollamaExePath)) {
          command = global.ollamaExePath;
          // Set working directory to Ollama's install folder
          spawnOptions.cwd = path.dirname(global.ollamaExePath);
          console.log('[startOllama] Using discovered path:', command);
        } else {
          // Try to find it again
          const foundPath = findOllamaOnWindows();
          if (foundPath) {
            command = foundPath;
            spawnOptions.cwd = path.dirname(foundPath);
            console.log('[startOllama] Found at:', command);
          } else {
            command = 'ollama.exe';
            console.log('[startOllama] Using default command');
          }
        }
      } else {
        command = 'ollama';
      }

      ollamaProcess = spawn(command, ['serve'], spawnOptions);
      ollamaSpawnedByApp = true;

      ollamaProcess.unref();

      // Wait for it to start
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Check if it's running (true = allow auto-pull since this is a fresh start)
      const status = await checkOllama(true);

      if (status.running) {
        deps.sendToRenderer('log', { message: 'Motor de IA iniciado correctamente', type: 'success' });
      } else {
        deps.sendToRenderer('log', { message: 'No se pudo iniciar el motor de IA', type: 'error' });
      }

      return status;
    } catch (error) {
      deps.sendToRenderer('log', { message: `Error al iniciar motor de IA: ${error.message}`, type: 'error' });
      return { running: false, error: error.message };
    }
  }

  // Pull vision model
  async function pullModel(modelName = 'qwen2.5-vl') {
    console.log('[pullModel] Starting download for:', modelName);

    deps.sendToRenderer('model-progress', {
      step: 'pulling',
      message: `Descargando modelo ${modelName}...`,
      progress: 0
    });
    deps.sendToRenderer('log', { message: `Iniciando descarga de ${modelName}...`, type: 'info' });

    try {
      const controller = new AbortController();
      // 30 minute timeout for large model downloads
      const timeoutId = setTimeout(() => controller.abort(), 30 * 60 * 1000);

      const response = await fetch(`${deps.config.ollamaUrl}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName, stream: true }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Ollama pull failed: ${response.status} ${response.statusText}`);
      }

      // Use Node.js compatible streaming with readable stream reader
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let lastProgress = 0;
      let hasReceivedData = false;

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          console.log('[pullModel] Stream ended');
          break;
        }

        hasReceivedData = true;
        const text = decoder.decode(value, { stream: true });
        buffer += text;

        // Process complete lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const data = JSON.parse(line);
            console.log('[pullModel] Progress data:', data.status, data.completed, data.total);

            if (data.total && data.completed) {
              const progress = Math.round((data.completed / data.total) * 100);
              // Only update UI if progress changed significantly (avoid spam)
              if (progress !== lastProgress) {
                lastProgress = progress;
                deps.sendToRenderer('model-progress', {
                  step: 'pulling',
                  message: `Descargando... ${progress}%`,
                  progress,
                  status: data.status,
                });
              }
            } else if (data.status) {
              // Show status messages
              deps.sendToRenderer('model-progress', {
                step: 'pulling',
                message: data.status,
              });
              deps.sendToRenderer('log', { message: `Modelo: ${data.status}`, type: 'info' });
            }

            if (data.status === 'success') {
              console.log('[pullModel] Download complete!');
              deps.sendToRenderer('model-progress', {
                step: 'done',
                message: 'Modelo descargado correctamente!',
                progress: 100,
              });
              deps.sendToRenderer('log', { message: `Modelo ${modelName} descargado!`, type: 'success' });

              // Refresh ollama status (false = don't auto-pull again to prevent recursion)
              await checkOllama(false);
              return { success: true };
            }

            // Handle errors from Ollama
            if (data.error) {
              throw new Error(data.error);
            }
          } catch (parseError) {
            if (parseError.message && !parseError.message.includes('JSON')) {
              throw parseError; // Re-throw non-parse errors
            }
            // Ignore JSON parse errors for incomplete chunks
            console.log('[pullModel] Parse error (likely incomplete chunk):', parseError.message);
          }
        }
      }

      // Process any remaining buffer content
      if (buffer.trim()) {
        try {
          const data = JSON.parse(buffer);
          if (data.status === 'success') {
            deps.sendToRenderer('model-progress', {
              step: 'done',
              message: 'Modelo descargado correctamente!',
              progress: 100,
            });
            deps.sendToRenderer('log', { message: `Modelo ${modelName} descargado!`, type: 'success' });
            await checkOllama(false);
            return { success: true };
          }
        } catch (e) {
          // Ignore
        }
      }

      if (!hasReceivedData) {
        throw new Error('No se recibieron datos de Ollama');
      }

      // If we got here without success, check ollama anyway
      console.log('[pullModel] Stream ended, checking ollama status');
      await checkOllama(false);
      return { success: true };
    } catch (error) {
      console.error('[pullModel] Error:', error.message);
      deps.sendToRenderer('model-progress', {
        step: 'error',
        message: `Error: ${error.message}`
      });
      deps.sendToRenderer('log', { message: `Error descargando modelo: ${error.message}`, type: 'error' });
      return { success: false, error: error.message };
    }
  }

  // Periodic Ollama health check
  function startHealthCheck() {
    if (ollamaHealthInterval) {
      clearInterval(ollamaHealthInterval);
    }

    ollamaHealthInterval = setInterval(async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(`${deps.config.ollamaUrl}/api/tags`, {
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (response.ok) {
          // Ollama is responsive
          if (!ollamaAvailable) {
            logger.success('OLLAMA', 'Ollama recovered — now available');
            ollamaAvailable = true;
            checkOllama(false).catch(() => {});
            deps.sendToRenderer('log', { message: 'Motor de IA recuperado y disponible', type: 'success' });
          }
        } else {
          throw new Error(`HTTP ${response.status}`);
        }
      } catch (error) {
        if (ollamaAvailable) {
          ollamaAvailable = false;
          logger.error('OLLAMA', `Ollama health check failed: ${error.message}`);
          deps.sendToRenderer('ollama-status', {
            installed: true,
            running: false,
            hasVisionModel: false,
            error: `Ollama no responde: ${error.message}`,
          });
          deps.sendToRenderer('log', { message: `Motor de IA no responde: ${error.message}`, type: 'error' });
        }
      }
    }, 60 * 1000); // Every 60 seconds (fast recovery after Ollama crash/restart)
  }

  // Memory monitoring
  function startMemoryMonitoring() {
    memoryCheckInterval = setInterval(() => {
      const memoryUsage = process.memoryUsage();
      const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
      const heapTotalMB = Math.round(memoryUsage.heapTotal / 1024 / 1024);
      const heapPercentage = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;

      // Warn if heap usage is above 80%
      if (heapPercentage > 80) {
        logger.warn('MEMORY', `High memory usage: ${heapUsedMB}MB / ${heapTotalMB}MB (${Math.round(heapPercentage)}%)`, {
          heapUsed: heapUsedMB,
          heapTotal: heapTotalMB,
          heapPercentage: Math.round(heapPercentage),
          rss: Math.round(memoryUsage.rss / 1024 / 1024),
        });
        deps.sendToRenderer('log', { message: `Advertencia: Uso de memoria alto (${Math.round(heapPercentage)}%)`, type: 'warning' });
      }

      // Critical if above 90%
      if (heapPercentage > 90) {
        logger.error('MEMORY', `Critical memory usage: ${heapUsedMB}MB / ${heapTotalMB}MB (${Math.round(heapPercentage)}%)`);
        deps.sendToRenderer('log', { message: `CRITICO: Memoria casi llena (${Math.round(heapPercentage)}%)`, type: 'error' });
      }
    }, 60000); // Check every minute
  }

  function isAvailable() {
    return ollamaAvailable;
  }

  function setAvailable(value) {
    ollamaAvailable = value;
  }

  function stopHealthCheck() {
    if (ollamaHealthInterval) {
      clearInterval(ollamaHealthInterval);
      ollamaHealthInterval = null;
    }
  }

  function stopMemoryMonitoring() {
    if (memoryCheckInterval) {
      clearInterval(memoryCheckInterval);
      memoryCheckInterval = null;
    }
  }

  /**
   * Kill the Ollama subprocess we spawned, including child workers (the model server).
   * No-op if Ollama was already running before this app started.
   */
  function killSpawnedOllama() {
    if (!ollamaSpawnedByApp || !ollamaProcess || !ollamaProcess.pid) return false;
    try {
      let treeKill;
      try { treeKill = require('tree-kill'); } catch (_) { treeKill = null; }
      if (treeKill) {
        treeKill(ollamaProcess.pid, 'SIGTERM');
      } else if (process.platform === 'win32') {
        // Fallback: taskkill /T kills the whole tree.
        try { execFile('taskkill', ['/PID', String(ollamaProcess.pid), '/T', '/F']); } catch (_) {}
      } else {
        try { process.kill(-ollamaProcess.pid, 'SIGTERM'); } catch (_) { try { ollamaProcess.kill('SIGTERM'); } catch (_) {} }
      }
      logger.info('OLLAMA', `Sent SIGTERM to ollama tree (pid ${ollamaProcess.pid})`);
      return true;
    } catch (err) {
      logger.warn('OLLAMA', `Failed to kill ollama: ${err.message}`);
      return false;
    } finally {
      ollamaProcess = null;
      ollamaSpawnedByApp = false;
    }
  }

  return {
    checkOllama,
    isOllamaInstalled,
    findOllamaOnWindows,
    installOllama,
    downloadFile,
    startOllama,
    pullModel,
    isAvailable,
    setAvailable,
    startHealthCheck,
    stopHealthCheck,
    startMemoryMonitoring,
    stopMemoryMonitoring,
    killSpawnedOllama,
  };
}

module.exports = { createOllamaManager };
