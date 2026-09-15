#!/usr/bin/env bash
# Reports raw and gzip sizes of the production bundle.
set -euo pipefail
DIST="${1:-dist}"
if [ ! -d "$DIST" ]; then
  echo "no dist directory at $DIST - run pnpm build first" >&2
  exit 1
fi
total_raw=0
total_gz=0
echo "file raw_bytes gzip_bytes"
while IFS= read -r f; do
  raw=$(wc -c < "$f" | tr -d ' ')
  gz=$(gzip -9 -c "$f" | wc -c | tr -d ' ')
  total_raw=$((total_raw + raw))
  total_gz=$((total_gz + gz))
  echo "$f $raw $gz"
done < <(find "$DIST" -type f | sort)
echo "TOTAL raw=${total_raw} gzip=${total_gz}"
