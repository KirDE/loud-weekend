# Rock am Ring / Rock im Park ordinary admission (#434)

Scope: two additional source-specific proposals, dependent on #482, not a
production release or closure of #434. The 2026-11-22 public offline catalogue
contains 60 festival paths. These are two of the previously unverified paths,
not duplicates of the original 26/59 proposal ledger.

## Public source observations (2026-11-22)

Both `https://www.rock-am-ring.com/` and `https://www.rock-im-park.com/`, and
both corresponding `/en/tickets` pages, returned HTTP 200, HTML, and their
exact requested final URL. HTTP success alone is not inventory evidence.
Minimal structural fixtures retain only the title/canonical identity, ordinary
admission cards, their current edition text and purchase controls, plus a
sold-out non-admission example. Raw captures are not committed.

The existing configured official-markup homepage parsing is preserved. A
bounded secondary fetch follows only the exact registered official ticket
page. Explicit source overrides/manual strategies do not get replaced.

| Source | Ordinary admission | Verified proposal | Canonical DB evidence |
| --- | --- | --- | --- |
| Rock am Ring | Three-day Festival Ticket | Available when current edition card has enabled Eventim Buy now | Persisted source/value/edition proof, canonical reader, replay and tamper rejection |
| Rock im Park | Three-day Festival Ticket – General/Green Camping | Either ordinary admission can establish available; other card sellout does not win | Same per-source positive/negative chain |

Parking, campsite-only passes, upgrades, hotel-only offers, financing controls,
scripts/hidden markup and generic homepage Buy links do not establish ordinary
admission. Missing/duplicated products, invalid source or edition, disabled
controls and contradictory stock require review and retain the last good
snapshot. No global sold-out inference is made when these standard products
are unavailable: other entry packages may remain.

The publisher uses #482's persisted `ticketSupplement` provenance gate; no
artist/provider guard is relaxed. Tests cover the existing official-markup
fetch path, mixed stock, schema/source/edition/visibility/control failures,
transport failure, and per-source persistence/readback/idempotence/rollback
with no playlist refresh or provider binding creation. Fixtures are offline;
no production source configuration, catalog or provider writes are made.

Acceptance still requires exact-head full Quality, Codex review and maintainer
acceptance. Integrate on main only after #482 is accepted/deployed; do not
confuse a feature-branch merge with a production release.
