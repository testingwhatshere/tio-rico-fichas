#!/usr/bin/env bash
# Genera un zip de la automation-extension por cada panel, con el panelId
# hardcodeado vía shared/panel-lock.js. Cada build queda cero-configuración:
# backendUrl + apiKey ya vienen como defaults en el service worker, y el panel
# queda fijo e imposible de perder/cambiar desde Options.
#
# Uso: ./scripts/build-extension-per-panel.sh
# Salida: dist-extension/tio-rico-bot-panel-a.zip (y b, c)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXT_DIR="$ROOT_DIR/apps/automation-extension"
OUT_DIR="$ROOT_DIR/dist-extension"

# Paneles de producción (tabla Panel — los ids son fijos). Formato: slug|id|nombre
#
# Renombrados el 2026-08-28 (A→3, B→2, C→Juana). Sólo cambia la etiqueta y el
# nombre del zip: la extensión se identifica con el UUID, así que las que ya
# están instaladas siguen funcionando sin tocarlas.
PANELS=(
  "panel-3|6a6a6b21-c731-47cb-98a1-21777edb965e|Panel 3"
  "panel-2|9751125e-32d7-4137-ac52-bdffb7e3296d|Panel 2"
  "juana|345666ee-1994-493b-b426-436f4037512c|Juana"
)

mkdir -p "$OUT_DIR"

for entry in "${PANELS[@]}"; do
  IFS='|' read -r slug panel_id panel_name <<< "$entry"

  STAGE_DIR="$(mktemp -d)"
  trap 'rm -rf "$STAGE_DIR"' EXIT

  # Copiar la extensión excluyendo lo que no va en el zip
  rsync -a "$EXT_DIR/" "$STAGE_DIR/" \
    --exclude '.git*' \
    --exclude 'node_modules' \
    --exclude 'extension.zip' \
    --exclude 'package.json' \
    --exclude 'windows' \
    --exclude '*.md' \
    --exclude '.DS_Store' \
    --exclude '._*'

  # Hardcodear el panel de esta build
  cat > "$STAGE_DIR/shared/panel-lock.js" <<EOF
// Build bloqueada a un solo panel — generada por scripts/build-extension-per-panel.sh
// NO EDITAR: este archivo fija el panel de esta instalación.
globalThis.PANEL_LOCK = { id: '$panel_id', name: '$panel_name' };
EOF

  # Diferenciar el nombre visible en chrome://extensions
  node -e "
    const fs = require('fs');
    const p = '$STAGE_DIR/manifest.json';
    const m = JSON.parse(fs.readFileSync(p, 'utf8'));
    m.name = m.name + ' — $panel_name';
    fs.writeFileSync(p, JSON.stringify(m, null, 2) + '\n');
  "

  # Limpiar cualquier resto de macOS antes de zippear (rompe la extracción en Windows)
  find "$STAGE_DIR" -name '.DS_Store' -delete 2>/dev/null || true
  find "$STAGE_DIR" -name '._*' -delete 2>/dev/null || true

  ZIP_PATH="$OUT_DIR/tio-rico-bot-$slug.zip"
  rm -f "$ZIP_PATH"
  # -X: no atributos extra de macOS; -x: sin basura por las dudas
  (cd "$STAGE_DIR" && zip -qrX "$ZIP_PATH" . -x '*.DS_Store' '._*')
  rm -rf "$STAGE_DIR"
  trap - EXIT

  echo "✅ $ZIP_PATH ($panel_name → $panel_id)"
done

# Copia para la descarga desde la web de operadores (botón "Descargar extensión").
# La sirve el backend con clave de operador; viaja en la imagen en el próximo deploy.
BACKEND_BUILDS="$ROOT_DIR/apps/backend-api/extension-builds"
rm -rf "$BACKEND_BUILDS" && mkdir -p "$BACKEND_BUILDS"
cp "$OUT_DIR"/tio-rico-bot-*.zip "$BACKEND_BUILDS/"
VERSION="$(node -p "require('$EXT_DIR/manifest.json').version")"
{
  echo "{"
  echo "  \"version\": \"$VERSION\","
  echo "  \"builtAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
  echo "  \"panels\": ["
  first=1
  for entry in "${PANELS[@]}"; do
    IFS='|' read -r slug panel_id panel_name <<< "$entry"
    [ $first -eq 1 ] || echo "    ,"
    first=0
    echo "    { \"slug\": \"$slug\", \"panelId\": \"$panel_id\", \"name\": \"$panel_name\", \"file\": \"tio-rico-bot-$slug.zip\" }"
  done
  echo "  ]"
  echo "}"
} > "$BACKEND_BUILDS/manifest.json"
echo "📦 Copia para la web de operadores: $BACKEND_BUILDS (versión $VERSION) — deployar el backend para publicarla"

echo ""
echo "Listo. Cada zip se instala descomprimiéndolo y cargándolo unpacked en chrome://extensions."
