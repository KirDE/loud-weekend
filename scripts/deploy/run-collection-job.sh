#!/usr/bin/env bash
set -euo pipefail
job="${1:?usage: run-collection-job.sh JOB}"
app_root="${APP_ROOT:-/opt/festival-radar}"
umask 027
shared="$app_root/shared"
current="$app_root/current"
output="$shared/collection-jobs/$job"
install -d -m 0750 "$output"
cd "$current"
case "$job" in
  artist-identities)
    IDENTITY_BATCH_SIZE="${IDENTITY_BATCH_SIZE:-20}" "$current/.runtime/node" scripts/resolve-artist-identities.mjs > "$output/latest.json.tmp"
    mv -f "$output/latest.json.tmp" "$output/latest.json" ;;
  spotify-stats)
    "$current/.runtime/node" --experimental-strip-types scripts/refresh-spotify-stats.mjs > "$output/latest.json.tmp"
    mv -f "$output/latest.json.tmp" "$output/latest.json" ;;
  source-monitor)
    "$current/.runtime/node" scripts/check-festival-sources.mjs > "$output/latest.json.tmp"
    mv -f "$output/latest.json.tmp" "$output/latest.json" ;;
  playlists-db)
    "$current/.runtime/node" --experimental-strip-types scripts/playlist-provider-worker.ts spotify ;;
  playlists-youtube)
    "$current/.runtime/node" --experimental-strip-types scripts/playlist-provider-worker.ts youtube_music ;;
  *) echo "unsupported collection job: $job" >&2; exit 2 ;;
esac
