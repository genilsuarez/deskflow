#!/usr/bin/env bash
# Genera un <archivo>.min.css junto a cada CSS fuente del repo (raíz).
# Corre en build.sh antes del commit, así el .min.css nunca queda
# desactualizado respecto al fuente legible que se edita a mano.
#
# El HTML (index.html) enlaza directamente los .min.css — el .css original
# se mantiene como fuente editable y versionada en git.
set -euo pipefail
cd "$(dirname "$0")/.."

ESBUILD_VERSION="0.24.0"

shopt -s nullglob
for css in *.css; do
  [[ "$css" == *.min.css ]] && continue
  out="${css%.css}.min.css"
  npx --yes "esbuild@${ESBUILD_VERSION}" "$css" --bundle --minify --outfile="$out" --log-level=warning
  echo "  ✓ $css → $out"
done
