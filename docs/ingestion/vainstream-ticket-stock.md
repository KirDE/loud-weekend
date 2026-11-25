# Vainstream 2027 ordinary regular-ticket stock

Focused proposal on accepted/deployed main #488 (`a66cbdd`). Existing production
source is `https://vainstream.com/artists/`, not the homepage. Its dated unranked
artist extraction, identity/override fences and additive semantics are unchanged.

## Actual stock, not an old sale banner

The official current homepage links its official Shopware store. The current
category links the regular physical admission product:

`https://www.vainstream-shop.de/2027-tickets/10636/regular-festivalticket?c=2423`

A normal isolated browser and then direct public GETs confirmed this exact
linked route on22-Nov-2026. Earlier generic category/product requests failed;
those failures were not interpreted as inventory. No proxy, challenge solver,
forged browser identity, account login or private cookies were used. A direct
run of the application's actual `fetchSource` with its normal public bot headers
returned HTTP200, two attempts, `available`,59 primary artist labels, zero
warnings. This is a dated read, not a guarantee that access will stay healthy.

The producer requires:

- Correct2027 primary festival dates and exact current product-page title.
- One selected schema.org Product, ordinary `Regular Festivalticket`, exact
  product29194 and SKU`VS-TI-0073`; no duplicate offer/identity metadata.
- One selected EUR offer with positive finite price and explicit
  `https://schema.org/InStock`.
- The same SKU in an enabled purchase form, usable ordinary quantity option
  and enabled normal purchase button. The form is inspected, never submitted.
- No hidden/disabled/contradictory ordinary stock or foreign purchase action.

Shipping times alone do not establish ticket stock. Earlier waves, VIP, WOMO,
recommendations and merchandise do not supply the selected product's status.
The regular e-ticket is a separately observed product, not substituted silently.
If the reviewed physical regular admission becomes unavailable or changes schema,
retain review/last-good stock rather than guessing global sellout or claiming
that the other product types are unavailable. No low-stock inference from price.

## Durable publication and verification

Public purchase and actually fetched evidence URLs are the same exact linked
product route. Existing canonical source/year/value/excerpt/timestamp and stored
provenance checks apply. No source DB configuration or standing collector changed.

`tests/vainstream-ticket-stock.test.mjs` covers the reduced real ordinary offer,
old/VIP/foreign identities, duplicate offers, absent/disabled/hidden/conflicting
stock or controls, wrong price/currency, source overrides, redirects and HTTP
failures. It also proves the existing primary artists survive supplementation.

`tests/vainstream-ticket-publication.e2e.test.ts` runs actual source
fetch/extract→policy→persisted evidence→canonical public readback/replay and
unchanged reevaluation; archived and concurrent stale writes roll back, without
playlist refresh/provider bindings. Existing fixture state is restored.
The original onboarding transport test now models both legitimate GETs while
retaining its redirect and explicit-source override rejection assertions.

Only reduced real public structural data is committed. CSRF/session/cookie,
customer/contact/legal and unrelated product contents are removed before fixture
export. DOM reduction uses the same HTML5 parsing semantics as the actual parser,
not an HTML parser that incorrectly nests void metadata tags and duplicates SKU.

No quantity selected, no form/cart/reservation/order/account/provider write,
production import, source change, merge or deployment performed.

This is the seventh new source candidate from the starting31. Together with
#509(five) and #510(Alcatraz), potential proposal coverage is36/60 with24 still
without verified implementations. Keep external CI/review/release acceptance
separate; this does not complete the all-source rollout.

There is no production proof seed. The parser corroborates the product page
edition against the organizer's independently parsed festival dates and reads
the product ID and SKU from the public response. The visible ordinary product,
explicit availability and exact matching form SKU must all agree before the
normal ingestion pipeline records ticket evidence.
