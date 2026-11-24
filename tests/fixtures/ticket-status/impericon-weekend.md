# Impericon weekend inventory fixture

Reduced from the official public Shopify Ajax endpoint `https://www.impericon.com/products/25-26-06-2027-2-preisstufe-weekend-ticket.js`, observed 2026-11-17 23:43 UTC: HTTP 200, text/javascript JSON; both product and standard variant `available: true`. Kept only title/handle/URL/vendor/type, boolean inventory, price and purchase quantity shape. Removed IDs, barcode, images and unrelated fields.

Existing normalized/synthetic official home/news fixtures exercise the already-reviewed product-title structure and dynamic artist gates; this fixture is the actual reduced inventory response, not invented inventory markup. Product paths for subsequent stages/years must be discovered from visible current weekend product titles and their official purchase controls. A stage's false flag does not prove global sellout or unavailable festival entry.

All traffic is read-only. No cart/checkout/provider writes. Fixture verification is not production acceptance or a current inventory guarantee.
