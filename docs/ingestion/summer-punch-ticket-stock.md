# Summer Punch 2027: ordinary three-day public stock

Audited 2026-11-22. Proposed implementation, not an acceptance/deployment receipt.

The existing official primary verifies 17–19 June 2027 and current additive
artist links. Its eBilet portal event points to public event `602356450160803841`.
Generic Event/aggregate availability is insufficient because ordinary, VIP,
accessible-admission-with-companion and child products coexist.

## Bounded production collector (no browser runtime)

The public client's documented page script first GETs `/home/token`, then
forwards the issued anonymous anti-forgery token as `X-XSRF-TOKEN` for public
metadata POSTs. The collector follows that protocol without changing/signing
the token or bypassing CSRF: an isolated, ephemeral pair of public `wdctx` and
`.AspNetCore.Antiforgery.*` cookies is forwarded only to the exact vendor host.
No primary authorization/cookies or existing customer/account session is used.
Other cookie names, including anonymous customer/session identifiers emitted by
unrelated responses, are not forwarded or persisted.

Five reviewed public metadata requests supplement the primary:

1. GET exact `/api/event/getevent/<event>`.
2. GET `/home/token` and extract exactly the one public anti-forgery input.
3. POST `/api/event/getpricezonestickettypeslimit`, **only** event ID and
   price-zone/ticket-type IDs (`140247054` / ordinary `140247050`). No quantity,
   selected seat, customer, basket, reservation, purchase, payment or order data.
4. GET current ordinary unnumbered-sector limit flags.
5. GET the official public sector occupancy fragment; require ordinary sector
   capacity, not just available VIP/child allocation.

All requests have fixed allowlisted HTTPS identities, bounded bodies/timeouts,
HTTP/media/schema checks, and redirects disabled. The metadata POST has one
attempt, never a blind retry. No cart/customer endpoint, automatic reservation
client, queue, sign-in or challenge-solving request is made. Ordinary scope IDs
are public routing keys, not customer or credential IDs. Preserve 64-bit event
IDs as strings; never round-trip them through JavaScript Number.

## Interpretation and durable scope

Require current exact primary/event dates and three-day title, active/open
business flags, the reviewed public distribution channel, PLN currency, public unrestricted ordinary rate and matching
positive gross/fee-inclusive price. Require successful positive ordinary
price-pool stock **and** positive ordinary-sector capacity **and** limit-not-
reached. Missing/foreign/hidden/restricted/zero/error/archived data requires
review. VIP/child/companion stock never rescues the ordinary pass. Neither one
price pool nor capped allocation proves low global capacity or global sellout.

The stock POST URL is shared between events. Durable proof therefore includes
an explicit namespace=event / product=zone:ordinary-rate scope. The canonical
publisher independently reconstructs it from the allowlisted source, checks
both request and JSONB-stored markers, and rejects missing/foreign scopes even
with forged policy approval, including attempts stripping both markers. `isDeepStrictEqual` is used only for marker object
comparison (JSONB reorders nested keys), not to weaken global diff validation.

The normalized source contains only public event/rate stock fields and scalar
capacity/limit assertions. Tokens, cookie/session values, basket/customer,
organizer/legal/payment extras and raw provider HTML/JSON remain outside
normalized evidence/fixtures. Vendor business-error text is reduced to a
generic error. Human purchase remains the official `/bilety` link, separate
from machine proof.

## Checks

- 45 focused existing/new stock, scope, primary, transport and privacy cases.
- Mocked six-request pipeline → policy → persisted field evidence → canonical
  PostgreSQL public reader/replay, old primary rejection, stale-write rollback.
- Canonical refusal for missing event scope, foreign event or foreign rate even
  when the caller forges upstream policy approval.
- All existing main ticket-publication chains and full catalog DB suite,
  typecheck, full test:data. Synthetic local PostgreSQL, no provider jobs.
- Live normal application fetch: HTTP200 / available / 16 primary artist labels /
  zero warnings. No production publication or ticket selection/reservation.
- Published full Quality and exact-head completed Codex gates are separate
  receipts and must be checked after publication.

Reviewed edition dates, provider event labels and fixed schedule assertions are
loaded from PostgreSQL by exact festival, source and edition. Missing bindings
do not trigger a supplement request. The existing explicit provider routes and
ordinary rate identities continue to constrain the public stock contract.
