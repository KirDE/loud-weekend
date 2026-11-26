# Provinssi 2027 ordinary three-day stock

Read-only audit 2026-11-22. Proposed producer, not a deployed receipt.

The official current primary links public Paylogic sale
`f20f4130e7bd49b99eeb38ad7236ccd9`. GET its public sale metadata, validate exact
published2027 event/public sale, active sale window, no approval or queue, then
forward its unmodified anonymous API-issued token only to the fixed event-bound
storefront GET. No sign-in, customer, cart, quote with quantities, order,
reservation, voucher or queue API is called. No source authorization/cookies,
redirects, token signing or stored credentials. HTTP/schema failures require
review, never healthy-empty stock.

Use the exact ordinary `3 DAYS` product, under current `PROVINSSI TICKETS 2027`
→ `THREE DAYS`, not VIP, youth, day passes or accommodation. Require primary
1–3 July2027 to match API event dates, exact public event/product links and
sale scope, active public non-membership/non-combo/non-personalized entrance,
positive matching EUR prices/service costs, an allowed single-ticket order and
explicit item `is_sold_out=false`. Global availability cannot rescue ordinary
soldout. No unsupported global low/sold_out inference from one price pool.

Paylogic documents that storefront categories account for sale periods, priority
groups and sold-out settings: https://shopping-api-docs.paylogic.com/documentation/storefront.html

Only minimal current sale/event/ordinary product/category stock reaches the
normalized envelope. Issued tokens, organizer/customer/legal/payment and unrelated
products stay out of normalized evidence and fixtures; fixtures use synthetic
tokens. Scope is independently reconstructed and compared for request and stored
JSONB evidence by the canonical publisher.

Stock-only publication has its own narrow canonical path. Independently verified
primary announcement additions may also accompany verified stock; each field
retains its own evidence gate. Forged approval with missing primary artist proof
or conflicting dates still fails. Primary dates,
city, lineup and status must retain matching original-source persisted evidence;
no playlist/provider jobs. The existing announcement publication path remains
unchanged. Scope/stripped-marker refusal, actual mocked source→policy→persisted
proof→canonical reader/replay, archived-source and stale-write rollback are
covered in disposable PostgreSQL, including a combined source-backed artist
addition + unknown→available stock transaction, without provider jobs. Full compatibility checks run separately.

Roadburn uses the same API, but its official buy link still points to `/offsale`
while API ordinary inventory is positive. That conflict is **not** resolved by
this implementation and must not produce automatic availability.

No production seed or proof table supplies the seller dates. The adapter derives
them from the public response and compares them with the independently parsed
organizer dates before persisting the normal stock evidence. Missing or
contradictory observations withhold the stock update.

## Net unit-price repair (26 November 2026)

Current public stock returns `unit_price` and `total` at EUR 214.00, with an
explicit EUR 5.00 service cost and EUR 219.00 service-inclusive breakdown.
Accept either net or gross item pricing only when unit equals total, the net
breakdown equals the ordinary product base, and base plus fee equals gross.
Evidence reports the gross amount. A real reduced fixture, changed-price tests,
contradictory-price negatives and the canonical publication integration cover
this format without relaxing edition/product/stock/provider safeguards.
