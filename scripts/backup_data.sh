#!/usr/bin/env bash
# Backup of the portal's data layer (not node_modules / dist / images).
# Usage: bash scripts/backup_data.sh            -> /workspace/BCSFP/_backups/bcs_hub_data_<ts>.tar.gz
# Restore: cd /workspace/BCSFP/11_bcs_hub && tar -xzf /workspace/BCSFP/_backups/bcs_hub_data_<ts>.tar.gz
#          then: CONTEXT=production npm run build  (see OPERATIONS.md)
set -euo pipefail
HUB="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${BACKUP_DIR:-/workspace/BCSFP/_backups}"
TS="$(date +%Y%m%d_%H%M)"
mkdir -p "$DEST"
cd "$HUB"
OUT="$DEST/bcs_hub_data_${TS}.tar.gz"
tar -czf "$OUT" --exclude='scripts/_cache' --exclude='__pycache__' \
  src/data src/content src/lib src/components src/pages \
  netlify/functions/*.json netlify/functions/*.mjs netlify/lib \
  scripts \
  $(ls public/*.json 2>/dev/null) \
  netlify.toml package.json astro.config.* 2>/dev/null || true
test -s "$OUT" || { echo "backup failed: $OUT empty" >&2; exit 1; }
echo "OK $OUT ($(du -h "$OUT" | cut -f1))"
# keep the 15 most recent data backups
ls -1t "$DEST"/bcs_hub_data_*.tar.gz 2>/dev/null | tail -n +16 | xargs -r rm -f
