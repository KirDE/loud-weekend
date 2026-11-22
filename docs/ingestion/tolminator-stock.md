# Tolminator ordinary-admission stock: local parser checkpoint

`observeTolminatorStock` is a pure, **unregistered** stock observer. It is not a
production source, collector, health signal or publication path. Existing source
configuration is unchanged. No migration or production writes are involved.

## Reviewed evidence

The ordinary Slovenian product linked from the seller listing is fixed to
`TOLMINATOR_PRODUCT` (2027, product 1235366). The earlier public response captured
2026-11-22 at 17:01 UTC contained one Event/AggregateOffer/Offer with literal
`In stock`, a valid sale window, visible ordinary festival admission identity,
210 EUR price and an active buy control. The minimized fixture retains only
those structural fields, no contacts, account data or tokens. The parser also
passes against that complete cached response, not just the minimized fixture.

A subsequent ordinary product GET returned **HTTP 403**. That is an access error,
not fresh availability, healthy-empty inventory or a successful refresh. No
challenge bypass or basket request was attempted. Fixture/cached parsing is not
live verification. Transport and error-health integration remain unfinished.

## Guards and deliberate limits

- Exact product route, edition, Event identity, schema, one ordinary Offer,
  matching price/currency, scheduled event and current sale window required.
- Inventory must explicitly say `In stock`; price and CTA alone never suffice.
- Visible identity, price and enabled control corroborate metadata. Hidden
  ancestors, ambiguous metadata and visible sellout conflicts fail closed.
- No sellout is inferred when this one tier is absent, expired or sold out.
- `EventScheduled` is the observed compact enum; its schema.org URL equivalent
  is also recognized. Other values are rejected.
- Basket action URL is compared as inert text ONLY; never followed or returned
  as the user-facing tickets destination. Return the ordinary product page.
- Seller Event ends July 31, whereas festival ABC says August 1. Vendor dates
  are used only as a strict product identity and NEVER returned as festival
  dates. No price/fee or lineup change is returned either.
- Changed future product, tariff or layout needs review, not broad fallback.

## Remaining before source completion

Use existing bounded read-only transport with exact status/MIME/redirect guards;
preserve primary roster failures independently. Do not silently turn the current
403 into success or switch to unrelated products. Bind source/edition/observed
time/value to persisted proof, exercise canonical readback, idempotent replay and
rollback on stale or tampered evidence in synthetic DB. Only then wire a reviewed
source route and seek full exact-head CI/Codex gates in a focused PR. None of
these remaining gates are claimed by this parser checkpoint.
