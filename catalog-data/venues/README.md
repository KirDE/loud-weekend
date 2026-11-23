# Reviewed festival venues

The map reads the precise venue from the matching edition in PostgreSQL. Without it, the map continues
to label city coordinates as approximate. No coordinates are shipped with the application.

For supported editions of Brutal Assault, use `npm run venues:import -- --edition=YYYY` to preview the
organizer's published venue and coordinates. Review the resulting source URL, edition, place, and location.
To apply the reviewed observation, repeat the command with `--apply=<fingerprint>` from that preview.
The collector re-fetches and re-parses the organizer page, and rejects changed evidence, a different
catalogue place or organizer, an archived edition, or an older observation.
