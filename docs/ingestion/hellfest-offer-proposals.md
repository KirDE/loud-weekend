# Hellfest tier extraction — local implementation checkpoint for #446

**Not production-ready or registered with ingestion/publication.** No catalog,
notification, UI, migration, production source or global ticket status changes.

The existing domain has one ticket state. Official Hellfest homepage cards show
separate states for the four-day pass and one-day pass; the page also advertises
resale. Flattening these into one available/sold-out value is incorrect. Existing
Cheerio/TypeScript extraction infrastructure is sufficient; no new dependency or
external service is needed.

`extractHellfestOfferProposals` creates independent review-only observations from
a bounded successful official homepage response with matching edition identity
and visible dates. It supports the observed two ordinary tier cards, not VIP,
camping or resale inventory. Unknown/hidden/ambiguous/changed fields fail closed
atomically, not an empty healthy stock result. No checkout, quantity selection,
customer or authenticated API request is involved.

- Price uses integer minor EUR units. Whether fees are included remains unknown.
- `7 juillet - 13h` remains verbatim date prose, not a guessed UTC timestamp/year.
- A missing announced day-pass price stays null, never zero.
- Tier statuses cannot become `available`; a purchase/resale link proves no stock.
- Each offer retains source URL, observed time and a minimized tier excerpt.
- These are proposals requiring review, not validated canonical publication proof.

Live ordinary GET on 2026-11-22 returned HTTP200: full pass sold out (389 EUR;
fees unknown), day pass not on sale (price unknown). Source URL:
https://hellfest.fr/ . Fixture is a minimized projection of title, visible date
and public ticket cards only, without contacts/legal/customer/token content.

## Required continuation (do not call this a finished source)

1. Design additive durable reviewed tier storage using the existing catalog
   review/evidence mechanism; preserve unknowns, edition/source/value/time binding,
   replay and rollback. Do not wire this proposal batch to global ticketStatus.
2. Canonical public readback + EN/DE/RU accessible/mobile tier presentation;
   verified resale links separate from tier inventory; valid SEO offers only.
3. Integrate reviewed collector with strict transport and source identity guards;
   synthetic DB tests through durable evidence/public reader/replay/rollback.
4. Exact-head full CI/Codex review and maintainer comments before counting ready.

Local rollback: leave the adapter unregistered or remove these isolated files;
there is no production data/schema effect.

## Durable pending snapshots (local continuation)

`stageHellfestOffers` re-extracts a supplied official HTTP response (it does not
accept caller-constructed offers), validates the current canonical Hellfest
edition/source, and stages both tiers atomically in `TicketOfferProposalSnapshot`.
An additive migration creates only this review-staging table. It does not backfill
catalog data, register a collector or approve/publish an observation.

Snapshots bind edition ID/year, source, observed time, parser version and a SHA256
of the strictly validated structured proposal. The minimized tier excerpts remain
inside the proposal. HTML is not persisted. Observations older than 24h or more
than 60s in the future are rejected at ingestion. Edition row locking serializes
concurrent observations even when no snapshot exists; identical latest replay
returns the existing ID; conflicting same-time/older updates fail. Newer changes
append rather than overwrite history.

`readPendingHellfestOffers` validates the latest stored identity/time/value hash
and schema before returning explicit **pending** data to a reviewer. Corrupt latest
data is an error, not healthy empty stock or a fallback to an older snapshot.
This is NOT the canonical public reader. These snapshots are not signed proof of
the HTTP response and do not replace the later reviewed publication mechanism.
No production entry point calls either function; no new runtime process or cron.

Synthetic PostgreSQL integration tests run on an isolated local disposable DB:
staging/readback, null price/unknown fees, idempotency, concurrent replay, immutable
history, HTTP/URL/edition/schema/time failures, stored proof drift. Rejections leave
the last valid snapshot intact. Global edition rows, publication counts, source
health and provider job counts stay unchanged. Run with:

```
DATABASE_URL=<local-disposable-test-db> node scripts/prepare-test-db.mjs
DATABASE_URL=<local-disposable-test-db> node --import tsx --test tests/hellfest-offer-proposal-store.e2e.test.ts
```

Still outstanding: actual bounded collector transport and registration, reviewed
approval/publication/rejection flow, canonical public tier reader, EN/DE/RU/mobile
UI/SEO, complete source-to-public DB rollback tests, CI and exact-head Codex review.
Hellfest remains unfinished. Do not apply the migration to production as part of
this work.
