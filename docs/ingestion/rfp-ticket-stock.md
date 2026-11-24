# Rock for People 2027 ordinary four-day stock

Audited 2026-11-22. Proposed producer, not an acceptance/deployment receipt.

The official ticket page links regular card 3633368 separately from Comfy+,
VIP, disabled-access, child, junior and senior rates. Its publicly loaded GoOut
partner script embeds Czech public sale `bvcmb` / 579901. The vendor's published
sale-form client obtains data via GET `/services/feeder/v3/sales` with
`saleIds=579901&details=false&language=cs`. No cart, buyer, purchase, reservation,
seat selection, discount or checkout request is used.

Require production HTTP/API success; exact approved current event 3395438 /
schedule 9532556 (2–5 June 2027); active public regular CZK sale 579901; and exact
ordinary `4 dny` deal 3633368. The rate must be active, visible, not print-only,
not preowned/joined/name-restricted, positively priced, purchasable as one
ordinary ticket and have positive public stock. No protected/promo/voucher or
foreign-currency sale is accepted. Available VIP/child/sibling deals cannot
rescue this rate. API per-order `ticketsAvailable` is capped, **not total festival
capacity**: it never justifies low-stock or global sellout inference.

The API also contains vendor contact/legal/payment information. The fetcher
reduces it locally to reviewed sale/schedule/rate public stock fields before
normalized evidence. Fixtures contain only this minimal projection. Machine
proof is the exact sale-bound public API URL; the human purchase link remains
`https://rockforpeople.cz/tickets/`.

The existing primary adapter verifies a current-year rolling announcement.
Require its observed edition to agree; do not invent primary dates from the
stock feed or change artist/additive announcement/provider guard behavior.
Existing primary dates, if provided later, must match the independently verified
stock event. Archive/missing primary edition or stock/schema/access failure
remains unverified rather than healthy-empty or unavailable.

Local verification includes stock/scope/restriction/edition/transport/privacy
negatives; complete mocked source pipeline → policy → persisted evidence →
canonical public reader, idempotent replay, archived-source rejection and stale
publication rollback in disposable local PostgreSQL, without provider jobs.
Full typecheck and test:data pass. Full PR Quality/Codex must be observed on the
published exact head, separately from this local receipt.

Dates and sale windows come from the exact public GoOut response, not from a
seed. Require a valid current four-day schedule and already-open regular sale
and rate windows. If the independently parsed organizer dates are available,
they must agree with the seller schedule. Missing or contradictory observations
do not publish ticket stock.
