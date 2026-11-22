# Source-specific ticket publication regressions

A parser fixture test is not canonical publication acceptance. For each source
proposal, add a `tests/<source>-ticket-publication.e2e.test.ts` that calls
`ticketProducerPublication` with the actual source configuration and a producer
using mocked read-only `fetchSource` responses from source-shaped fixtures.
Assertions in the callback must reject unexpected destinations. The archived
variant keeps configured edition unchanged and changes only the fixture year.
Never use live ticket/provider or production database calls in these tests.

The guarded disposable-DB helper seeds the observed artists unchanged so a
stock observation cannot silently authorize artist/provider work. It exercises
actual policy, persisted candidate/diff/evidence, canonical publication and
public catalogue reader, idempotent replay and unchanged re-evaluation. It
rejects archived-source publication and stale concurrent inventory, proving
transaction rollback and no new playlist refresh/provider binding. It checks
stored evidence value, URL and publication-linked evidence IDs for each field.

This does not replace source-specific DOM/transport negatives or artist-policy
regressions, and does not claim live import or production acceptance. Keep those
cases in the source parser suite. Mixed artist+stock publication with additional
source guards (e.g. Impericon/I-Days) requires its own integration scenarios.

Quality runs the source-specific test files sequentially after the existing
catalogue suite via `tests/*ticket-publication.e2e.test.ts`. Locally use the
repository Node version, a guarded loopback disposable database and the normal
memory-limited test scope. After integrating onto the accepted/deployed main,
require fresh full Quality and completed Codex review for the exact head.
