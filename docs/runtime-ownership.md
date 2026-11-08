# Runtime ownership

PostgreSQL owns festival editions, lineups, source configuration, artist profiles,
logos, playlist bindings, immutable plans, write intents and operational checkpoints.
The application and the workers do not read catalogue snapshots from Git or shared
JSON output directories. The offline API is a live database export, not a fallback.

## Current workers

- Source ingestion: `festival-radar-db-due.timer`, serialized root scheduler and
  bounded `db-due-tick.mjs`; source and publication leases fence each operation.
- Spotify: `festival-radar-collection-playlists-db.timer` invokes only the Spotify
  provider worker.
- YouTube: `festival-radar-collection-playlists-youtube.timer` invokes only the
  YouTube provider worker.
- Artist identity, enrichment and Spotify statistics use their durable database
  state and bounded publishers.

Provider locks prevent duplicate processes for the same provider; the parent
festival lease serializes provider writes to the same festival. Unknown writes
remain reserved until exact owned readback or correlated rejection resolves them.
Cancelled or held jobs are not resumed by deployment. Catalogue and archive
identities are not inferred from mutable playlist titles.

Deployment preserves a paused ingestion timer, serializes release changes with
fetches, verifies exact release/database health, and restores pinned scheduler
assets on failed activation. Current provider timers start only after release
health succeeds. Test current locking, persistence, publication and rollback
invariants; do not restore one-time migration checks as recurring release gates.

## Python workers

The production Debian interpreter is `/usr/bin/python3.13`; distribution security
patches remain managed by apt rather than replacing the system interpreter.
Release packaging resolves wheels explicitly for Python 3.13. CI checks the
actual archive under Python 3.13, and activation validates the new package tree
with the installed production interpreter before migrations or switching the
application release. A mismatched interpreter or dependency graph refuses release.
