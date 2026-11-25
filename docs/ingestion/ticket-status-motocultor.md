# Motocultor ordinary four-day ticket stock (#434)

Read-only official homepage observation: **2026-11-22**. The ordinary
`Pass 4 jours` card explicitly contains a regular `Tarif normal`, `En vente`,
a numeric euro price and an enabled Fever `Prendre mon pass` control. Earlier
Early Bird tiers and a news headline say sold out; those are not the ordinary
regular pass and do not imply a global sellout.

The configured current-edition artist news discovery is preserved. The
existing homepage/news source additionally fetches the exact official homepage
for the ticket card. Explicit fetch/follow/manual overrides do not get replaced.
The dynamic artist document retains exact discovered-URL redirect checks;
`verifiedPrimaryUrl` reports that internally verified document to the aggregate
fetch wrapper, not an arbitrary alternate allowed origin.

The page title/canonical URL and decorative year/date stub identify the edition.
The aria-hidden stub is identity metadata only (like JSON-LD), never inventory.
Stock must be proven by the visible four-day card, its unique regular tier,
explicit on-sale state, price and enabled official purchase control. Hidden or
disabled stock/control elements, wrong page/product edition, duplicates,
foreign sellers and contradictory tier states abstain and retain last-good data.
No global sold-out state is inferred if that regular pass is unavailable, since
one-day admission or later sale phases may remain.

Tests cover the original announcement pipeline, source-shaped ticket fixtures,
normal/negative DOM and transport cases, and disposable PostgreSQL
fetch→producer→policy→durable evidence→canonical readback/replay/tamper rejection.
Stock-only observations create no playlist refresh or provider binding. The
publisher reuses #482's normalized `ticketSupplement` provenance checks.

This is one additional proposal, dependent on #482, not deployment or closure
of #434. The separate 2026-11-22 ledger in #489 remains a dated 28/60 snapshot;
this source would bring the proposal count to 29/60 (31 still unverified), not
29 production-accepted paths. Parent acceptance/deployment and fresh main
integration gates remain necessary. No production/provider writes were made.
