# Ticket availability

Ticket states describe verified source observations, not the presence of a link:

| Catalogue state | UI meaning | Offer availability |
| --- | --- | --- |
| `available` | Tickets available | InStock |
| `low` | Few tickets left | LimitedAvailability |
| `not_on_sale` | Sales have not started | Omitted |
| `sold_out` | Explicit verified sellout | SoldOut |
| `sales_ended` | Sales have ended | Omitted |
| `unavailable` | Legacy/unspecified unavailability | Omitted |
| `unknown` | Availability not verified | Omitted |

An official ticket URL is required to emit any Offer or match the actionable-ticket
filter. A known low-stock observation remains visible even without a usable link.
Legacy UNAVAILABLE database rows are **not** migrated to SOLD_OUT. In particular,
source failures, absent URLs and ambiguous parser output must not manufacture a
sellout. Existing parsers remain conservative; the reviewed ingestion contract
and transactional publisher accept explicit states with the existing evidence
and publication gates. No on-sale timestamp is inferred from a state.

The enum migration is additive. Apply it before deploying the new application;
old application versions can ignore new enum members, but do not remove enum
members on rollback or rewrite historical evidence.

Regression coverage: `tests/tickets.test.mjs` (EN/DE/RU rendering, filters and JSON-LD)
and the ticket publication case in `tests/catalog-publication.e2e.test.ts` against
a guarded, disposable local database. No production provider calls are required.
