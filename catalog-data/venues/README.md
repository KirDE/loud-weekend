# Reviewed festival venues

The map reads the precise venue from the matching edition in PostgreSQL. Without it, the map labels
city coordinates as approximate. No venue coordinates are shipped with the application.

For supported editions of Brutal Assault, run `npm run venues:import -- --edition=YYYY` to stage
the organizer's current observation for review. Staging records source evidence but does not change
the catalogue. Review the resulting source URL, edition, place, and coordinates.

To publish the reviewed observation, repeat the command with `--apply=<candidate token>` and
`--actor=<non-personal operator identifier>`. The collector re-fetches the organizer page and compares
it with the persisted evidence before publishing. Changed, superseded, archived or mismatched
observations are rejected. Approval, publication and the public venue update commit together.
