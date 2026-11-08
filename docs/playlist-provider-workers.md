# Independent playlist provider workers

`playlists-db` now invokes Spotify only. `playlists-youtube` invokes YouTube only.
Each has its own systemd service invocation and ten-minute timer. Their process
locks are independent and share the legacy compatibility lock in read mode.
They can process different festivals concurrently; the existing festival/parent
lease deliberately serializes two providers editing the same generation.

Plans, creation markers, pending writes and archive protections remain on the
original `CatalogPlaylistRefresh`. No task is copied, cleared or silently retried.
`OperationalState` keys `playlist-provider:v1:<provider>:<job>` contain independent
attempts, retry times, diagnostics and completion. A durable parent before-image
allows recovery of an expired bridge lease. A provider failure cannot claim the
other provider succeeded. The parent completes only when every explicitly
requested provider has completed. Explicit provider-only publications are honored.
Legacy failed rows without a retry time remain held; cancellation is never inferred
from status text. Initial YouTube retries retain their existing native schedule.
Spotify does not inherit a YouTube delay. Newest edition publications are selected
before eligibility, so older generations cannot win by being older in the queue.

Only an exact structured `403 quotaExceeded` response establishes an account-wide
YouTube block. Its reset uses America/Los_Angeles midnight including DST. Read
quota failures retain creation/insert uncertainty; a read refusal never releases a
write intent. Expiry permits normal attempts, not replay of unknown writes.

## Quota and useful work

The 5,000-unit local attempt bound is not 5,000 writes: reads cost 1, modifications
cost 50. One hundred modifications is therefore an upper bound before reads and
metadata operations. Per-attempt `quotaUsed` does not measure remaining account
quota, and published playlist counts omit verified-but-unfinished generations.

YouTube reconciliation retains a longest ordered subsequence of desired videos,
then removes only incompatible items and inserts only missing items at explicit
positions. Existing complete lists are no-ops. Full ordered readback, uniqueness,
owned edition identity and durable per-insert intent confirmation remain required.
Legacy prefix-only intents retain their original interpretation. The regression
scenario adds 50 front-loaded videos to an existing 54-video suffix with exactly
50 modifications, zero deletions and fewer than 3,000 local units.

Spotify batches also use explicit insertion positions and verify each acknowledged
chunk before submitting the next. Creation retries read only after transient 404;
acknowledged or ambiguous creation requests are never resent.

## Release acceptance

Run PostgreSQL provider-worker and actual fileless CLI tests, provider/legacy lock
tests, retained-intent JSONB validation, delayed/unknown-write Python regressions,
installer tests, typecheck and build. Verify installed file hashes and both timer
routes, original catalogue/archive identities, provider state separation and actual
owned ordered playlist content separately from job labels.
