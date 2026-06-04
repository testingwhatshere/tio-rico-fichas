// Minimal preload for the QR pairing window. We expose only the QR generator (no IPC, no fs)
// because the page is just a self-contained form with no need to talk to the main process.
const { contextBridge } = require('electron');
const QRCode = require('qrcode');

contextBridge.exposeInMainWorld('qrApi', {
  toCanvas: (canvas, text, options) => QRCode.toCanvas(canvas, text, options),
});
