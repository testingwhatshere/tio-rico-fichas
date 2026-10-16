// Build-time panel lock.
//
// When PANEL_LOCK is set, this extension build is hardcoded to a single panel:
// it overrides config.panelId everywhere (WS handshake, polling, options page)
// and the options dropdown shows the panel as fixed/no-editable. Combined with
// the DEFAULT_CONFIG (backendUrl + apiKey) in service-worker.js, a locked
// build works with zero configuration: instalar y listo.
//
// The per-panel build script (scripts/build-extension-per-panel.sh) rewrites
// this file for each panel. Generic/dev build: no lock (panel elegido en
// Options).
//
// Loaded as side-effect import from the service worker (ES module) and as a
// plain <script> from options.html — that's why it assigns to globalThis
// instead of using `export`.
globalThis.PANEL_LOCK = null;
