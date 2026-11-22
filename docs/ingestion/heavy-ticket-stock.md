# Heavy Week-End 2027: ordinary public stock

Audited 2026-11-22. This is a proposed producer, not a deployment receipt.

The existing official home + linked artist/detail/logo producer is preserved.
Its verified dates must be 2027-06-04–06. The publicly linked Weezevent widget
`734dcd1a-6e7c-4465-b353-3bd5dcddd20b` exposes event 2166331 through the public
widget metadata API. The anonymous first step is a metadata-only initial-render
form, not a selected-ticket/customer/cart/reservation/order action.

## Runtime boundary

1. GET the exact public widget API using fresh public headers.
2. Verify widget/event/year/status/date/currency and the reviewed `4-redirect`
   action. Its fixed vendor render destination and query are allowlisted; its
   sole form field is the provider-issued, event-bound, short-lived token.
   The HTTPS API is the token issuer/trust boundary. Claims are checked only
   to restrict forwarding; the application neither signs nor edits the token.
3. Forward that unchanged token once to the exact initial-render URL with
   redirects disabled. No quantity or customer fields, no session/cart/order
   API, no blind POST retry. HTTP/media/size/schema failures remain failures.
4. Before evidence persistence, discard the issued token, API extras, hidden
   form/session values, scripts, unrelated rates and whole provider document.
   Retain only the actual three-day/standard headers and ordinary rate table,
   preserving visibility, quantity, disabled state and price attributes.

The reviewed unrestricted ordinary rate is 5629650 in standard subcategory
1873636 / three-day category 1901845. Its exact ordinary label, matching EUR
price, unselected quantity zero and enabled option one must agree. Hidden,
disabled, conflicting, duplicate, foreign-edition or preselected forms do not
produce availability. Friends/group-minimum, student/age-restricted, GOLD/VIP and
day-ticket inventory cannot rescue the ordinary pass. No global sellout is
inferred if this particular ordinary rate becomes unavailable.

Evidence uses the exact event/widget-bound machine render URL. The human
purchase destination remains the public embedded ticket page. No token or
session-bearing URL is exposed as a purchase link or normalized evidence.

## Verification

- Reduced real public DOM + public metadata fixture; all tokens in tests are
  generated synthetic placeholders, never captured provider credentials.
- Source/visibility/ordinary-rate/stock/price/quantity/action/expiry/transport
  and privacy-negative tests; existing artist guards and failure accounting.
- Mocked transport → extraction → policy → persisted evidence → canonical
  public readback → idempotent replay → archived-source rejection and
  stale-publication rollback in disposable local PostgreSQL. No provider jobs.
- Live normal application fetch: HTTP 200, ordinary `available`, 11 primary
  artist labels, zero warnings. Live primary linked documents can grow; the
  frozen minimal fixture uses ten requests including metadata and render.
- Local `npm run typecheck`, `npm run test:data`, source tests and DB chain pass.
  PR CI/review results must be checked separately against the published head.
