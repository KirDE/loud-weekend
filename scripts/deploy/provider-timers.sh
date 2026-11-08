#!/usr/bin/env bash
# Timer lifecycle for the two current provider workers. Never interrupt services:
# an acknowledged provider mutation may still be awaiting readback.
pause_provider_timers() {
  local failed=false load unit
  for provider_job in playlists-db playlists-youtube; do
    unit="$service-collection-$provider_job.timer"
    load="$(systemctl show --property=LoadState --value "$unit" 2>/dev/null)" || { failed=true; continue; }
    case "$load" in
      not-found) [[ "$(systemctl is-active "$unit" 2>/dev/null || true)" == inactive ]] || failed=true ;;
      loaded) systemctl disable --now "$unit" || failed=true ;;
      *) failed=true ;;
    esac
  done
  [[ "$failed" == false ]]
}
install_provider_timers() {
  if ! systemctl enable --now "$service-collection-playlists-db.timer" ||
     ! systemctl enable --now "$service-collection-playlists-youtube.timer"; then
    pause_provider_timers || true
    echo 'provider timer installation failed' >&2
    return 6
  fi
}
