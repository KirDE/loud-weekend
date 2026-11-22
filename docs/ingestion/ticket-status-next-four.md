# Four stock producers from the remaining 31 (22 November 2026)

Scope: source-specific **proposals**, not production acceptance or a claim that
all 60 festival paths are covered. Based on deployed main #482 (`ebe9cd3`).
No production configuration change, import, provider write, merge or deployment.

| Source | Reviewed stock evidence | Public purchase gateway |
| --- | --- | --- |
| 2000trees | Official Ticket Tailor event 2213997: exact current event/dates, scheduled state, ordinary priced GBP admission `Offer` with `schema.org/InStock`, enabled shop control. Child/accessory stock does not count. | Same public event page |
| Pinkpop | Current ordinary on-sale/availability assertion **and** one Regulier weekend admission card, price, entry description and enabled reviewed Ticketmaster event control. | Official `/tickets/` |
| Eurockéennes | Current dated ticket-page title, one ordinary `FORFAIT 4 JOURS` card with price and explicit `Disponible`, plus enabled official Weezevent widget. The future-formulas card is excluded. `OFFRE LIMITÉE` is an offer, not proof of low inventory. | Official `/achat/` |
| Jera On Air | Official ticket page links Impericon collection, collection links the ordinary 2027 Weekend product; public product JSON validates vendor/type/handle/title/URL, the one regular SKU/variant, price and matching product/variant `available=true`. Camping and unknown/changed variants do not count. | Official linked Impericon collection (never a `.js` download) |

Routes are explicitly restricted to the audited 2027 edition and existing
source identities. Jera's existing independent `/en/info/` and `/en/line-up/`
sources retain their primary extraction paths. Nothing rewrites DB source
configuration or discovers arbitrary secondary URLs from untrusted markup.
The configured primary is still fetched/extracted: artist, lifecycle, source
identity and edition warnings are not removed by a successful stock check.

## Transport, persistence and rollback

- GET only, bounded bodies, existing bounded retry transport, public secondary
  requests without inherited primary authorization headers. Unexpected redirects,
  error codes and wrong media types are errors, not healthy empty inventory.
- Jera alone permits the audited JSON/JavaScript media types at its exact public
  product JSON URL; other ticket sources still require HTML.
- Durable proof URL stays distinct from the human purchase gateway for Jera.
  Both request and stored normalized provenance trigger canonical validation;
  source, year, fields, values, evidence URL/excerpt/timestamp must agree.
- Absent/ambiguous/hidden/disabled/conflicting data retains review/last-good
  state. None of these producers guesses global sellout from one unavailable
  pass, child/camping stock, dated news, partial sold capacity or an offsale URL.
- No checkout, cart, stock reservation, customer login or real provider writes
  were used. Ticket Tailor checkout controls are inspected, never followed.

## Reproducible verification

`tests/remaining-ticket-stock.test.mjs` covers audited positives plus wrong
edition, source overrides, access/schema failure, hidden/disabled products,
duplicate cards, conflicting stock, accessory-only products and wrong sellers.
Minified DOM regressions preserve `<br>` word boundaries.

`tests/remaining-ticket-publication.e2e.test.ts` runs **all four** actual
`fetchSource`→existing primary parser + stock producer→policy→persisted
candidate/diff/evidence→canonical publisher→public reader→same-attempt replay and
unchanged reevaluation. It also rejects old-edition and concurrent stale
publication, rolls back the transaction and verifies no provider refresh/binding.
The shared helper restores prior source/artist state and removes owned fixtures.
Quality explicitly executes the new source DB tests, in addition to existing
catalog, browser, account-route, Python, build and production-archive checks.

Fixtures are minimal, reduced **real public structural captures** from the
source URLs above on 22-Nov-2026, plus existing reduced primary Pinkpop capture.
Legal/contact/customer/cookie content and full raw pages are not committed.
Mutated negative fixtures are tests, not claims that the live source was in that
state. The dated audit of the original remaining 31 is separate JSON/Markdown;
source transport or offline success is never release acceptance.
