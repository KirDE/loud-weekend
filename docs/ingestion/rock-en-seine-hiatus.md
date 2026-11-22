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
or production coverage. Remaining prerequisite: reviewed additive edition-lifecycle
model, durable evidence binding and audited approval, public EN/DE/RU presentation,
canonical read/replay/rollback and full exact-head CI/review. Do not create fictive
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

`readPendingRockEnSeineHiatus` is an INTERNAL reviewer read, not an authenticated
HTTP endpoint or public catalogue projection. It always returns `pending`;
`eligibleForReview` becomes false outside24h/60s-future bounds. No approval is
inferred, including from the absence of evidence. Neither service modifies
FestivalEdition fields, stock/source health, publications, notifications or
provider jobs, nor creates2028 editions. All synthetic SQL tests run only on an
own isolated disposable database; no production migration was applied.

Remaining: audited exact-revision reviewer decisions and authenticated endpoint,
explicit edition lifecycle semantics and approved-only public EN/DE/RU read/UI,
bounded native collector/invocation, replay/rollback and browser checks, focused
PR/full Quality/exact-head Codex review. Pending snapshots alone do not complete
the source and must never be presented as a cancellation/stock publication.
