# Hellfest tier extraction — local implementation checkpoint for #446

**Not production-ready or registered with ingestion.** Local reviewed public
catalog/UI integration exists (see milestones below); no notification,
production migration/source or global ticket status writes.
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

At this staging checkpoint, outstanding: collector registration, authenticated review API/UI and public
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
not replace the required reviewer UI or public catalog integration.

Tests cover strict request/status/identity/MIME/size, malformed/empty/failed
streams, deadline over stalled headers and stalled bodies, network failures, and
synthetic GET→atomic DB pending readback. Challenge HTML, wrong edition, malformed
tier prices and HTTP/network errors preserve the last valid pending observation.
The native collector also completed one live GET200, matching both tiers with no
warnings (not a public inventory write or a readiness/acceptance claim).

## Explicit review and approved-only read service (local checkpoint)

`decideHellfestOffers` is an **internal service, not an HTTP endpoint**. It requires
an actor ID from the authenticated session boundary; it rechecks the user's
persisted EDITOR/ADMIN role and the same ADMIN_EMAILS allowlist as currentAdmin.
No request-body actor or arbitrary caller-built offer is acceptable. The HTTP review routes below supply the session actor; no collector job is registered.

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
approved tier view, never a flattened global ticketStatus. The public catalog integration is described below; no notification/provider/source-health work
is emitted. These are application-level append-only service operations, not a
claim that a database administrator cannot alter rows.

Synthetic collector→staging→review→approved-reader tests include denied reviewer
role/allowlist/missing actor, stale revision/superseded snapshot rejection,
concurrent idempotent approval, reversal conflict, audit rollback, preservation
across pending/rejected changes, tampered snapshot/decision and edition drift,
and expiry. All tests use the isolated local DB; append-only audit rows and their
synthetic actors are retained there while fixture editions cascade-clean normally.
No real user data or production writes are involved.


## Authenticated review HTTP boundary (local checkpoint)

- `GET /api/admin/ticket-offers/editions/:id/` requires `currentAdmin`
  (persisted EDITOR/ADMIN plus ADMIN_EMAILS) and returns the latest validated
  snapshot with its contentHash and actual review state. Missing is 404;
  failed proof is 409, never a healthy empty result. Responses are private/no-store.
- `POST /api/admin/ticket-offers/snapshots/:id/` checks the existing trusted-origin
  policy and `currentAdmin` before reading the body. Strict JSON accepts only
  `decision` (approve/reject) and the exact `expectedContentHash`; unknown fields
  including actorId/offers are rejected. Snapshot ID comes from the path, actor
  from the session, never the body. The service rechecks persisted authorization.
- The actual streamed body is capped at 4096 bytes (not Content-Length), with
  fatal UTF-8 validation and a five-second whole-body deadline. Responses contain
  only snapshotId/decision or generic errors, not actor IDs or DB diagnostics.
- Review still emits no global ticketStatus, notification, provider or health
  mutations. These routes were exercised only in tests; no deployment performed.

Tests execute the real transpiled route handlers with only explicit boundary
injection. Unit cases cover origin, unauthenticated access, strict schema,
forged actor, revision binding, body bounds/UTF-8/deadline, minimal response and
DB-error isolation. The isolated DB test executes actual GET→revision→POST→audit→
approved-reader, conflict/replay and persisted role-revocation checks; only session
lookup is stubbed there. No claim of end-to-end cookie login/browser verification.

Still required before #446 is complete: reviewer queue UI, collector invocation,
browser/mobile verification, focused PR and
fresh exact-head CI/Codex review. This local checkpoint is not completed coverage.

## Approved public catalog and localized presentation (local checkpoint)

The database catalog now reads the validated approved-only view for current
Hellfest editions. It publishes a minimal `ticketOffers` projection (year, source,
observation timestamp, tier kind/status/price/sale prose), without snapshot IDs,
reviewer identities, hashes or evidence excerpts. Pending/rejected snapshots do
not overwrite the last approval. Expired approvals disappear; corrupt approved
proof fails the read rather than silently returning healthy old data. Archived
editions and other festivals do not query this review view.

`FestivalTicketOffers` is rendered by the real detail component in EN/DE/RU.
It shows independent full/day-pass states, integer-minor-unit currency formatting,
unknown prices/fees, the original unqualified sale prose and its missing year/time
zone, official source and observation time in UTC. Responsive wrapping uses a
single column at narrow widths; browser/mobile layout verification is still due.
No buy/resale button or implied total is invented.

Shared ticket presentation (including the actual comparison cell and sale-only
filter) treats these mixed categories as information, not a global inventory
claim, linking only to their official source. The stored global ticketStatus is
unchanged. SEO deliberately omits global Offer markup when these tiers exist;
there is no sufficiently precise checkout offer or sale timestamp to advertise.

Real isolated DB tests now exercise catalog readback before approval, after an
atomic audited approval, after newer pending/rejected observations, and after
expiry/proof corruption. Render tests use the real detail and comparison cells
in all three languages, including unknown price/fees and preservation of input
objects. Full catalog DB regression and browser/mobile tests remain due, along
with the reviewer queue UI, collector invocation path, focused PR/full CI and
exact-head Codex review. Nothing in this checkpoint is deployed or approved in
production; Hellfest is still unfinished.

## Actionable reviewer queue (local checkpoint)

The existing `/admin` review section now discovers current canonical Hellfest
edition IDs on the authenticated server page. Its EN/DE/RU tier cards explicitly
load the latest snapshot using the existing protected GET API (no polling or
collector invocation). The reviewer sees the two categories, honest unknowns,
official source/observation time, minimized source excerpts and exact revision.
The preview is explicitly pending/not published until a validated decision.

Approve/reject sends only the displayed snapshot ID, hash and decision, never an
actor or offer override. Duplicate in-flight actions are blocked; requests have
a ten-second deadline and unmount cancellation. Successful decisions reread the
server state rather than assuming optimistic success. Conflict, auth failure,
malformed/foreign-edition response or uncertain result clears actionable data and
requires a fresh load. Expired/future observations have disabled decision buttons;
the existing service still checks freshness and persisted reviewer rights at the
write boundary. Network errors never masquerade as an empty queue.

A single browser-safe strict Zod schema now validates both stored proposals and
reviewer responses, retaining existing key/source/time/value binding and field
order (no hash-format change). No server/crypto/Prisma module crosses the client
boundary. Public tier rendering is reused only within the clearly labeled review
preview; no new public data projection or automatic publication is introduced.

Six tests execute the actual component handlers with a deterministic hook host
and the actual API client, covering EN/DE/RU load→approve→reread, exact request
revision/fields, conflict/auth/malformed/uncertain result, schema/edition drift,
expired observations, explicit absence and duplicate in-flight action suppression.
These are NOT browser/cookie-login/mobile verification. The isolated DB, existing
actual HTTP handler and catalog regression suites also pass with the shared
schema. Outstanding: explicit collector invocation, browser/mobile verification,
focused PR/full CI/exact-head Codex review. Hellfest remains unfinished; no
production migrations, writes, scheduler or deployment were performed.

## Explicit operator collection command (local checkpoint)

The collector now has an operator entry point, not a new worker or scheduler:

```sh
npm run tickets:collect-hellfest -- --help
npm run tickets:collect-hellfest -- --year=2027
# Only against an explicitly selected database with migrations already applied:
npm run tickets:collect-hellfest -- --year=2027 --stage-pending --edition-id=EXISTING_ID
```

Default preview makes one bounded official public GET, validates both tiers and
prints only the minimized structured proposal. It neither imports/creates a DB
client nor needs DATABASE_URL. Staging requires explicit DATABASE_URL, both flags
and a matching existing CURRENT Hellfest edition/year/official URL. The target
is checked before fetching and rechecked under the store's lock. The command
never creates an edition, applies migrations, configures sources, approves data,
updates global status, sends notifications or schedules itself. Production
invocation is NOT authorized by this implementation checkpoint.

Unknown/duplicate options, arbitrary source/HTML/time/actor overrides and approval
flags are rejected. Failure returns a nonzero status and a generic redacted error,
not raw response bodies or driver/connection details. The staging result identifies
the exact snapshot/hash for the authenticated reviewer queue; it is not a public
publication acknowledgement. The default CLI completed a live HTTP200 preview
with both tiers and zero warnings; no DB configuration was supplied.

Tests exercise actual CLI help/argument/missing-DB paths in child processes,
preview with a DB access tripwire, pre-fetch target validation, strict source
failures and command→synthetic DB pending readback. Preview/failures preserve all
snapshots, last approval, global edition, decisions, health and outbox/provider
counts. The command does not replace human review. Remaining readiness gates:
actual browser/mobile verification, focused PR, full CI and exact-head Codex review.

## Browser/CI readiness checkpoint

`tests/e2e/hellfest-ticket-offers.spec.mjs` uses the existing real registration
and session flow with its own allowlisted synthetic reviewer (no cookie injection
or production identity). It stages a minimized fixture in a guarded local test
DB, verifies pending isolation, performs exact-revision approval via the actual
queue, reloads the persisted decision, and checks separate public tiers in
EN/DE/RU at 1280/320/375/390px, including expanded evidence/hash wrapping and
screenshots. It refuses to overwrite existing Hellfest/account fixtures and
cleans up only its own records. The full existing browser CI discovers this spec;
core CI explicitly runs the tier DB publication suite.

Local execution is **not green**: the matching Playwright Chromium was installed;
the real public detail, pending isolation, anonymous API denial and synthetic
registration ran, but the 1GiB-capped Next dev process either OOMed or restarted
at its configured heap threshold before the admin workflow could complete.
Webpack and reduced heaps/source maps did not finish the workflow. Do not lift
the workspace resource limit or claim mobile/authenticated review success.
Use the existing CI runner for the full browser/build gate and fix any actual
assertions it reports. No production app, cookies, migrations or data were used.
