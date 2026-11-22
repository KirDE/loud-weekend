# Hellfest tier extraction — local implementation checkpoint for #446

**Not production-ready or registered with ingestion/publication.** No catalog,
notification, UI, production migration/source or global ticket status changes.
Additive migrations have only been applied to the disposable local test DB.

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
and schema before returning the latest snapshot and its explicit **pending/approved/rejected** review state to a reviewer. Corrupt latest
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

Still outstanding: collector registration, authenticated review API/UI and public
catalog/UI integration, EN/DE/RU/mobile presentation/SEO, CI and exact-head Codex review.
The internal collector and explicit review/read service milestones are described below.
Hellfest remains unfinished. Do not apply the migration to production as part of
this work.

## Bounded collector (still pending-only)

`fetchHellfestOfferObservation` uses the normal native Fetch/AbortController and
stream reader primitives already used by ingestion; no browser or new library.
It performs exactly one credential-free GET of `https://hellfest.fr/`, refuses
redirects, and requires exact final URL, HTTP 200 and an HTML content type. A
20-second deadline covers headers and the entire body (not only initial fetch).
Both advertised and streamed sizes are bounded to 2 MB; invalid UTF-8, empty,
partial/error responses, read failures and timeouts fail without staging data.
No retry, alternate endpoint, shop, account or reservation access is attempted.
The observed timestamp is generated only after the document finishes reading.

`collectPendingHellfestOffers` composes that transport directly with existing
re-extraction/staging. Callers supply only an edition ID, not arbitrary offers,
source URLs or timestamps. It remains **unregistered and not public**; there is
no runtime job, source-health refresh or automatic approval/publication. The
reviewer readback reports the actual stored decision (initially pending). This does
not replace the required authenticated review API/UI or public catalog integration.

Tests cover strict request/status/identity/MIME/size, malformed/empty/failed
streams, deadline over stalled headers and stalled bodies, network failures, and
synthetic GET→atomic DB pending readback. Challenge HTML, wrong edition, malformed
tier prices and HTTP/network errors preserve the last valid pending observation.
The native collector also completed one live GET200, matching both tiers with no
warnings (not a public inventory write or a readiness/acceptance claim).

## Explicit review and approved-only read service (local checkpoint)

`decideHellfestOffers` is an **internal service, not an HTTP endpoint**. It requires
an actor ID from a future authenticated session boundary; it rechecks the user's
persisted EDITOR/ADMIN role and the same ADMIN_EMAILS allowlist as currentAdmin.
No request-body actor or arbitrary caller-built offer is acceptable. No route
or production entry point has been registered yet.

A decision binds the exact snapshot ID and expected content hash. Under the same
edition row lock used for staging, only the latest fresh proposal may receive a
first decision. Approve/reject is final through this service; identical retries
by the same actor are idempotent, conflicting/reversed decisions fail. Decision
and existing append-only AdminAuditEntry write commit atomically; injected audit
failure rolls back both. Actor labels use internal IDs, not email copies. Pending
readback now returns the actual pending/approved/rejected state.

`readApprovedHellfestOffers` selects only explicitly approved snapshots and
revalidates edition/source/parser/value/hash and decision hash. New pending or
rejected observations cannot replace the previous approved one. Corrupt approved
proof errors instead of falling back; approval older than 24h or >60s in the
future returns null rather than current inventory. Publication uses this separate
approved tier view, never a flattened global ticketStatus. The **existing public
catalog is not yet wired to it**, and no notification/provider/source-health work
is emitted. These are application-level append-only service operations, not a
claim that a database administrator cannot alter rows.

Synthetic collector→staging→review→approved-reader tests include denied reviewer
role/allowlist/missing actor, stale revision/superseded snapshot rejection,
concurrent idempotent approval, reversal conflict, audit rollback, preservation
across pending/rejected changes, tampered snapshot/decision and edition drift,
and expiry. All tests use the isolated local DB; append-only audit rows and their
synthetic actors are retained there while fixture editions cascade-clean normally.
No real user data or production writes are involved.
