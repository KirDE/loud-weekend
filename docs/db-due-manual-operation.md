# Database scheduler operations

The root-owned `start-db-due COMMIT health|ingest|drain` wrapper checks the exact
active release and serializes with deployment. Source fetching also holds the
shared source-fetch lock. Only the fixed `due-health` and `due-scheduler-health`
operations are exposed through the deploy-user activation entrypoint.

`due-health` returns count-only database health. `due-scheduler-health` returns
bounded timer/service and heartbeat status. No command exposes private artifacts,
credentials, raw systemd output or arbitrary shell arguments.

The scheduled tick runs one bounded database-due fetch and drains notifications
on idle and failed fetches. Its audited heartbeat distinguishes fetch and drain
errors. Missing or stale heartbeat evidence is not healthy. Paused timers remain
paused across deployment; exact release and database health are required to rearm
a timer that was previously active.
