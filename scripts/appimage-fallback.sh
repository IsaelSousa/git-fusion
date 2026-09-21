#!/usr/bin/env bash
# Fecha o AppImage à mão quando o `tauri build` falha no plugin GTK do linuxdeploy
# (Arch com gdk-pixbuf >= 2.44 não tem mais o diretório de loaders).
set -euo pipefail

cd "$(dirname "$0")/.."
CACHE="$HOME/.cache/tauri"
PLUGIN="$CACHE/linuxdeploy-plugin-gtk.sh"
APPIMAGE_DIR="src-tauri/target/release/bundle/appimage"

[ -f "$PLUGIN" ] || { echo "plugin não encontrado em $PLUGIN (rode 'npm run build:appimage' uma vez)"; exit 1; }
[ -d "$APPIMAGE_DIR/GitFusion.AppDir" ] || { echo "AppDir não encontrado em $APPIMAGE_DIR"; exit 1; }

# Patch idempotente: pula a cópia dos loaders quando o diretório não existe
if ! grep -q 'if \[ -d "\$gdk_pixbuf_binarydir" \]' "$PLUGIN"; then
  cp -n "$PLUGIN" "$PLUGIN.orig"
  sed -i \
    -e 's|^copy_lib_tree "\$gdk_pixbuf_binarydir".*|if [ -d "$gdk_pixbuf_binarydir" ]; then\n&|' \
    -e 's|^sed -i "s\|\$gdk_pixbuf_moduledir/\|\|g".*|&\nfi|' \
    "$PLUGIN"
  bash -n "$PLUGIN"
fi

export NO_STRIP=true APPIMAGE_EXTRACT_AND_RUN=1 DEPLOY_GTK_VERSION=3 ARCH=x86_64
export LINUXDEPLOY="$CACHE/linuxdeploy-x86_64.AppImage"
export PATH="$CACHE:$PATH"

cd "$APPIMAGE_DIR"
bash "$PLUGIN" --appdir GitFusion.AppDir
"$LINUXDEPLOY" --appdir GitFusion.AppDir --output appimage
ls -la ./*.AppImage
