# Alcatraz 2027 ordinary ticket inventory

Focused follow-up on deployed main #487 (`387fe7d`), independent of #509.
No source-configuration change, production import, provider/account write,
merge or deployment. Not closure of the broader all-festival rollout.

## Reviewed source chain

- Existing primary: `https://www.alcatraz.be/`, with the observed same-site
  redirect to `https://www.alcatraz.be/en/`. No other changed response URL is
  accepted. Existing primary date/banner extraction is preserved unchanged.
- Official current tickets page embeds the public Weeztix shop
  `https://shop.weeztix.com/a22e0ce7-7657-4601-addc-13d7d0cac701`.
- Its normal public browser frontend reads **GET**
  `https://shop.api.openticket.tech/a22e0ce7-7657-4601-addc-13d7d0cac701/data`.
  Confirmed 22-Nov-2026 in an isolated read-only browser: ordinary Combi Wave3
  shows enabled quantity controls; earlier waves and VIP products show soldout.
  A direct public GET returned the same current shop/event/ticket status.

The producer verifies the exact shop/current ordinary event, its dates/status,
EUR currency, latest ordinary numbered Combi wave and its source-provided GUID/event binding and shop-ticket pivot.
The ordinary pass must be public (not coupon-gated, hidden or deleted), in its
active sale window with a valid price/order schema and `status: available`.
An active automatic status is required; forced/manual status overrides and
unknown or ambiguous phases require review. Duplicate/missing/detached products fail
closed. Primary festival dates and observation time are mandatory.

The API's event end is the final night at 01:30 on 9-Aug, while the official
festival-day banner ends 8-Aug; the source dates must corroborate the organizer dates rather
than converting the overnight timestamp into a new festival day.

Sold-out early waves, VIP, camping or a later unavailable Wave3 never imply
whole-event sellout. No global soldout/low-inventory claim is synthesized.
The shop route is audited for 2027 only; later editions need new source review. Last-good stock remains protected on transport/schema failures.

## Persistence / provider isolation

The public API URL is durable stock proof; the human purchase URL remains the
actual official shop. Generic canonical checks validate both request and stored
candidate provenance, source/year/value/excerpt/timestamp and purchase gateway.
Only ticket changes are emitted, so no new artists/playlist/provider jobs.

Tests use a reduced actual public JSON capture (shop/event/tickets/pivots only),
never organizer contacts, legal records, customers or personal data. Raw pages
stay local. No form, counter, checkout, cart, ticket reservation, queue challenge,
login or order endpoint was used; browser mutation/unsafe requests were blocked.
The production producer performs only the existing primary GET and public data
GET, with no copied user cookies or primary authorization headers.

## Verification

- `tests/alcatraz-ticket-stock.test.mjs`: real stock positive plus old/foreign
  shop/event, wrong dates, side products, coupon/visibility, future/expired sale,
  duplicates, pivot drift, overrides, malformed schema and transport negatives.
- `tests/alcatraz-ticket-publication.e2e.test.ts`: actual fetch/primary+stock
  extraction→policy→persisted evidence→canonical readback/replay, unchanged
  reevaluation, archived rejection, concurrent stale rollback, zero provider
  refresh/binding; existing fixture state restored.
- Existing Alcatraz banner, Wacken/Download supplement and Full Rewind cases
  remain passing; Quality runs source DB tests in addition to full CI.

This is one more source proposal, not deployed catalogue coverage. Together
with five proposals in #509 the potential proposal ledger is35/60, leaving25
without a verified implementation; do not count pending gates as completion.

The production path has no proof seed or side table. The parser matches the
provider's event against dates parsed from the current official home page,
then derives the latest ordinary wave from the shop response. The existing
ingestion pipeline persists its edition/source-bound ticket evidence and the
site reads published catalogue fields from PostgreSQL.
