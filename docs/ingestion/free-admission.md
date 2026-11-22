# Free, unticketed admission

`ticketStatus: free` / database `FREE` describes ordinary festival admission that
explicitly requires **no ticket**. It is not a stock signal, a complimentary ticket,
a free child tariff, a campsite offer, or a prediction about capacity.

This prerequisite does not set any production festival to `free` or implement a
new source producer. An automated producer still needs current-edition, official,
ordinary-admission evidence, persisted through the canonical publication path.
Unknown/missing/blocked responses must preserve last-good data, never imply free
admission. No historic festival copy may silently establish next year's policy.

- EN/DE/RU detail views say free admission / no ticket needed and link to the
  festival's official information, never an ancillary `ticketsUrl`.
- The existing **tickets available** filter remains paid-ticket inventory only.
  Free events remain in the default catalogue; they do not claim available stock.
- Schema.org exposes `isAccessibleForFree: true`, with no `Offer`, price,
  `InStock` or `SoldOut` assertion.
- Neither a free-admission status change nor a camping/info URL change for a free
  event generates an on-sale/sold-out notification. Artist notifications remain.
- An additive PostgreSQL enum migration preserves existing statuses. Apply it
  before running code that can write/read `FREE`; production deployment is out of
  scope for this PR. No source configuration or production data is changed.

## Acceptance

`tickets.test.mjs` renders EN/DE/RU and verifies CTA, filtering and structured data;
`notification-pipeline.test.mjs` protects combined status/URL changes. The canonical
`catalog-publication.e2e.test.ts` suite covers persisted ingestion evidence, public
readback, idempotent replay, absence of provider jobs and transactional rollback
when another writer changes the status. The reviewed admin-state roundtrip also
includes `free`.

## Next source: Pol'and'Rock

On 22 November 2026 the official public newsroom homepage
<https://newsroom.polandrockfestival.pl/> returned HTTP 200 using ordinary GET. It
states that the festival is free and unticketed, and separately announces the
33rd edition on 29–31 July 2027. This is a promising official source, not yet an
implemented producer. The main festival homepage returned HTTP 403 to a plain
request in this run. A future source integration must explicitly validate event
identity, edition/date and ordinary-admission scope, preserve full provenance, and
fail closed on changed schema, stale text, network failures or contradictory
statements. Do not use the search engine's cached response as production proof.
