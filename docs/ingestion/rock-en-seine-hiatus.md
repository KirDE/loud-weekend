# Rock en Seine: 2027 hiatus (review-only prerequisite)

Official homepage https://www.rockenseine.com/ observed via ordinary native GET200
at 2026-11-22T18:56:40Z explicitly pauses the festival in2027 and announces return
in2028. Its archived2026 HTML title must not override the current visible notice.
A different2027 gathering is merely under consideration, not a confirmed festival.

Existing catalogue status/completeness describes lineup confirmation, not edition
lifecycle. Ticket status cannot honestly encode a paused edition as sold_out,
not_on_sale, sales_ended or unavailable. Reuse the existing Cheerio parser for a
strict, deliberately separate lifecycle review proposal. This is NOT a normal
FestivalCandidate: no ticketStatus, ticket URL, dates, lineup or publication fields.
Return year is a notice assertion, not creation of a2028 catalogue edition.

Exact native route/status, one visible scoped notice, exact pause/return/caveat
wording and canonical observation time are required. Missing/ambiguous/hidden or
changed notice and access/schema errors fail closed. Fixture retains only the
heading and two public policy paragraphs; output uses a fixed minimized excerpt.

Not registered in the runner, public catalogue, publisher, source health or CLI.
No production writes. No cancellation notifications. No claim of completed source
or production coverage. Implemented locally: durable evidence, audited decisions, protected reviewer queue
and approved-only read service. Remaining: catalogue integration and EN/DE/RU
presentation, collector/CLI, browser and full exact-head CI/review. Do not create fictive
2027 festival dates or transfer2028 dates; preserve blocked/unrelated stock health.

## Durable pending staging (local prerequisite)

`stageRockEnSeineHiatus` re-extracts a supplied bounded official response; it does
not accept caller-built lifecycle assertions. The additive
`EditionLifecycleProposalSnapshot` table binds the existing current Rock en Seine
2027 edition, exact requested/final route, HTTP200, normalized observation time,
parser version and strict minimized proposal to a SHA256 revision. No raw HTML,
cookies or session/contact data is stored. No new fetcher/runner/CLI is registered.
The caller must supply the real response time; historical HTML must not be
restamped as a new observation. Actual live access was not refreshed by DB tests.

An edition row lock serializes even empty-history observations and concurrent
replays. The same observation is idempotent; newer evidence appends, older input
fails. Observation freshness is rechecked after lock acquisition. Corruption in
the latest record fails both pending read and subsequent staging, with no older
healthy fallback. Current edition/source drift fails closed. This is an
application append-only service, not a database immutability/access-control claim.

`readPendingRockEnSeineHiatus` is an internal reviewer service, now exposed only
through an authenticated reviewer GET (not a public catalogue projection). It returns `pending` until an exact-revision audited decision exists;
`eligibleForReview` is false for decided evidence or outside24h/60s-future bounds.
No approval is inferred, including from the absence of evidence. Neither service modifies
FestivalEdition fields, stock/source health, publications, notifications or
provider jobs, nor creates2028 editions. All synthetic SQL tests run only on an
own isolated disposable database; no production migration was applied.

Remaining after the reviewer queue below:
explicit edition lifecycle semantics and approved-only public EN/DE/RU read/UI,
bounded native collector/invocation, replay/rollback and browser checks, focused
PR/full Quality/exact-head Codex review. Pending snapshots alone do not complete
the source and must never be presented as a cancellation/stock publication.

## Internal audited decision prerequisite

`decideRockEnSeineHiatus` is an internal service, NOT an HTTP endpoint or public
publication. Its HTTP caller must authenticate a session, validate origin and
pass the session actor only. No body-supplied actor may be forwarded. Within one
transaction the service rechecks persisted ADMIN/EDITOR role and ADMIN_EMAILS
allowlist under a shared user-row lock, locks the edition, validates source/target
and persisted proof, then requires the exact snapshot SHA256 and latest fresh
observation. Superseded, expired, wrong-hash or already-conflicting decisions fail.
Same-actor same-decision replay is idempotent but still requires current authority.

An additive decision table stores approve/reject, exact revision, actor and linked
existing immutable AdminAuditEntry. The decision and audit commit atomically.
Reviewer readback/replay validates the audit's actor/action/target/source/time/hash
and edition against the snapshot; corruption fails closed. Decision service is
append-only, not a claim of database-level decision immutability. The existing
audit cannot be updated/deleted; audit actors must be retained. A newer pending
or rejected snapshot does not inherit an earlier approval. An internal approved
state is NOT a published hiatus and still does not change edition dates, tickets,
health, providers or notifications, nor create2028 editions.

Tests include concurrent replay, rejected conflicting decisions, revoked role and
allowlist, wrong revision, expiry/supersession, persisted proof/decision tampering,
and an actual disposable-DB trigger fault proving rollback of the audit when the
decision insert fails. The synthetic audit actor is retained (demoted to USER)
because deleting immutable audit history to clean tests would be incorrect.
Still pending after the reviewer queue below: explicit approved-only
public lifecycle semantics/read/UI, native bounded collector/CLI, browser and PR gates.


## Protected reviewer HTTP boundary

- GET `/api/admin/edition-lifecycle/editions/[id]` returns the latest validated
  snapshot/revision and audited review state to `currentAdmin()` only. Missing
  evidence is 404; invalid persisted evidence is 409, never healthy empty state.
- POST `/api/admin/edition-lifecycle/snapshots/[id]` first validates the exact
  trusted origin, then the current session's EDITOR/ADMIN role and configured
  ADMIN_EMAILS allowlist. Only `decision` and `expectedContentHash` are accepted;
  actor identity comes exclusively from the session. The locked service rechecks
  authority at write time, including on replay.
- JSON body is bounded to 4096 actual bytes and a shared five-second stream
  deadline, with fatal UTF8 validation. Missing/foreign origins, extra fields,
  body-supplied actors, bad hashes, malformed JSON and incomplete/oversized bodies
  cannot reach the decision service. Conflicts produce 409, no DB diagnostics.
- Responses (including errors) use `private, no-store`. Successful POST exposes
  only snapshot ID and decision, not the internal actor or audit record.

Tests execute the actual Next handler modules in-process, injecting only session
and database/service boundaries. A disposable-DB regression runs actual handlers,
real currentAdmin with an injected session reader, real decision/audit/readback,
repeat decisions and a role-revocation race. Separate tests cover anonymous reads,
allowlist denial, malformed/erroring/stalled streams, UTF8 and lying Content-Length.
These are not a network login, browser, mobile or production-access verification.
HTTP approval is still only a review decision: no public lifecycle, canonical
stock/dates/health update, notifications, or automatic 2028 edition creation.


## Reviewer queue (local prerequisite)

The authenticated `/admin` review section now receives canonical current-2027
Rock en Seine edition IDs from the protected server page, not guessed slugs or
browser input. `LifecycleReviewQueue` loads only the existing protected endpoint
on an explicit click. EN/DE/RU show the 2027 pause, announced 2028 return and
unconfirmed alternative event, source URL, observation time, minimized evidence,
exact revision and audited decision state. This does not create a 2028 edition.

Only fresh pending server-eligible revisions offer approve/reject. The POST sends
only the decision and exact content hash; identity remains session-only. It then
reloads the authoritative reviewer state. Conflict, denied access, malformed data,
uncertain decision or failed reread clears actions and evidence until explicit
reload. One in-flight operation per mounted target and a shared 10-second client
deadline prevent duplicate clicks; the locked server remains authoritative on
expiry, supersession and role revocation. Domain schema is shared with storage,
not a browser import of the database service.

Eleven actual component/client tests cover localized review, approval/rejection,
exact request body, duplicate decisions, ineligibility, expiry, read errors and
actual AdminConsole mounting. These are not browser/mobile layout verification.
Current approval copy explicitly states that catalogue presentation is not yet
connected. Public approved-only lifecycle, ticket/SEO handling, bounded native
collector/CLI and full PR/CI/review/browser gates remain unfinished.

## Approved-only public projection (not yet wired to catalogue)

`readApprovedRockEnSeineHiatus` reads a consistent RepeatableRead snapshot and
returns only editionYear, lifecycle, announcedReturnYear, alternativeEvent,
sourceUrl, observedAt and approvedAt. No evidence excerpt, internal IDs, revision,
review state, actor or audit details cross this boundary. `null` means no approved
notice, not proof of an active edition. No dates or ticket enum are rewritten.

It validates the latest observation/decision as well as the latest approved proof
and its immutable audit. The approval query also selects immutable approval audit
identity: changing the decision to reject cannot silently hide an existing approval
and revive an older notice. Corrupt selected evidence throws, never healthy empty
or an older fallback. Pending/rejected revisions receive no inherited approval;
the last explicitly approved notice remains available with its ORIGINAL source
and approval times. A lifecycle announcement is a historical fact, not inventory:
24h freshness is required for staging/new decisions, not erasure of an approved
notice. A newer approved announcement would replace it; no automatic reactivation.

Actual disposable-DB tests cover unknown/pending, exact minimized approved output,
historical approved read without restamping, newer pending/rejected isolation,
source/edition drift, corrupt latest and approved evidence, and decision/hash
mutation beneath a pending revision. The reader performs no writes. This service
is deliberately not called by DatabaseCatalogRepository or a public route until
all detail/cards/comparison/filter/SEO/CTA consumers respect the separate lifecycle.
Current UI therefore remains unchanged; this is not browser/public delivery proof.

## Consumer prerequisite: ticket actions and SEO (not yet catalogue-wired)

`Festival.editionLifecycle` is an optional approved-only notice, independent of
raw canonical ticket/date fields. Shared `editionOnHiatus` validates its strict
public schema and exact festival/year/source binding, rejecting malformed or
transferred notices. Missing notice remains unknown lifecycle, not a new active
status. The database catalogue still does NOT attach this field.

The shared ticket presentation gives a hiatus its own EN/DE/RU label, with no
purchase link, regardless of any old ticket enum/URL. The available-ticket filter
therefore excludes it. Both the actual detail ticket block and comparison cell
use this presentation; the latter no longer treats every URL as available stock.
MusicEvent generation returns null for a paused edition, and both default and
localized detail routes omit its JSON-LD entirely. No scheduled/cancelled event,
old inventory or 2028 replacement is inferred. Raw dates/statuses are untouched.

21 targeted tests cover all seven ticket states with/without links across three
languages in actual detail/comparison renders, strict target/schema failures,
absence semantics, SEO suppression and prior ticket/SEO regressions. This is
server-rendered component proof, NOT browser/mobile proof. Date cards, calendar,
planning exports and descriptive lifecycle notices still need integration before
attaching approved lifecycle data to the actual catalogue.
