# Tolminator ordinary-admission stock: local observer checkpoint

`observeTolminatorStock` is a pure, **unregistered** stock observer. It is not a
production source, registered collector, health signal or publication path. Existing source
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
live verification. Registered error-health and publication integration remain unfinished.

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

## Bounded read-only transport (unregistered)

`collectTolminatorStock` reuses the bounded public-document pattern from the
Hellfest collector, with the same existing Fetch/stream/AbortController APIs.
It performs only one exact product GET, no retries, redirects or credentials.
The 20-second maximum deadline covers headers and the streamed body, including
transports that ignore abort. The decompressed stream is capped at 2 MB, decoded
as strict UTF-8, and requires status 200, exact final URL, HTML MIME and a
compatible charset. Other statuses (including 403) throw an explicit HTTP error;
challenge/changed-schema pages fail the stock observer, never healthy-empty.
Cancellation is attempted without waiting on an uncooperative stream.

Only minimized stock/source/edition/time evidence is returned after full parsing;
no raw HTML, cookies, dates, prices or basket destination escapes. This function
has NO DB, scheduler, source health or catalog mutation, and is not registered
with the runner. Existing last-good data therefore remains untouched on failure.
Its tests inject synthetic responses, including current test-only sale windows;
they are NOT fresh seller verification. The earlier real 403 remains unresolved,
with no blind repeated request, UA change or bypass attempt.

## Remaining before source completion

Preserve primary roster failures independently. Do not silently turn the current
403 into success or switch to unrelated products. Bind source/edition/observed
time/value to persisted proof, exercise canonical readback, idempotent replay and
rollback on stale or tampered evidence in synthetic DB. Only then wire a reviewed
source route and seek full exact-head CI/Codex gates in a focused PR. None of
these remaining gates are claimed by this parser checkpoint.
