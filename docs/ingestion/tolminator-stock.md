# Tolminator ordinary-admission stock: local observer checkpoint

`observeTolminatorStock` is a pure, **unregistered** stock observer. It is not a
production source, scheduled collector or automatic publication path. An explicit manual audit command is available below. Existing source
configuration is unchanged. No migration or production writes are involved.

## Reviewed evidence

The ordinary Slovenian product linked from the seller listing is fixed to
`TOLMINATOR_PRODUCT` (2027, product 1235366). The earlier public response captured
2026-11-22 at 17:01 UTC contained one Event/AggregateOffer/Offer with literal
`In stock`, a valid sale window, visible ordinary festival admission identity,
210 EUR price and an active buy control. The minimized fixture retains only
those structural fields, no contacts, account data or tokens. The parser also
passes against that complete cached response, not just the minimized fixture.

A subsequent ordinary product GET returned **HTTP 403**. That is an access error,
not fresh availability, healthy-empty inventory or a successful refresh. No
challenge bypass or basket request was attempted. Fixture/cached parsing is not
live verification. This historical failure remains in the audit; the new successful observation below does not rewrite it.

## Guards and deliberate limits

- Exact product route, edition, Event identity, schema, one ordinary Offer,
  matching price/currency, scheduled event and current sale window required.
- Inventory must explicitly say `In stock`; price and CTA alone never suffice.
- Visible identity, price and enabled control corroborate metadata. Hidden
  ancestors, ambiguous metadata and visible sellout conflicts fail closed.
- No sellout is inferred when this one tier is absent, expired or sold out.
- `EventScheduled` is the observed compact enum; its schema.org URL equivalent
  is also recognized. Other values are rejected.
- Basket action URL is compared as inert text ONLY; never followed or returned
  as the user-facing tickets destination. Return the ordinary product page.
- Seller Event ends July 31, whereas festival ABC says August 1. Vendor dates
  are used only as a strict product identity and NEVER returned as festival
  dates. No price/fee or lineup change is returned either.
- Changed future product, tariff or layout needs review, not broad fallback.

## Bounded read-only transport (unregistered)

`collectTolminatorStock` reuses the bounded public-document pattern from the
Hellfest collector, with the same existing Fetch/stream/AbortController APIs.
It performs only one exact product GET, no retries, redirects or credentials.
The 20-second maximum deadline covers headers and the streamed body, including
transports that ignore abort. The decompressed stream is capped at 2 MB, decoded
as strict UTF-8, and requires status 200, exact final URL, HTML MIME and a
compatible charset. Other statuses (including 403) throw an explicit HTTP error;
challenge/changed-schema pages fail the stock observer, never healthy-empty.
Cancellation is attempted without waiting on an uncooperative stream.

Only minimized stock/source/edition/time evidence is returned after full parsing;
no raw HTML, cookies, dates, prices or basket destination escapes. This function
has NO DB, scheduler, source health or catalog mutation, and is not registered
with the runner. Existing last-good data therefore remains untouched on failure.
Its tests inject synthetic responses, including current test-only sale windows;
they are NOT fresh seller verification. A later bounded verification after concrete integration work succeeded as documented below; no UA change, bypass or basket request was used.

## Ticket-only candidate and durable proof (local, unregistered)

`collectTolminatorCandidate` invokes the bounded collector and emits only source,
2027 edition, transport observation time, available status, product destination
and two minimized field proofs. No dates, price, artists or other updates escape.
The existing ingestion tables and canonical publisher are reused, not new storage.
Publication requires matching caller/stored candidate, exact successful attempt,
recent observation, only ticket changes and matching durable field value, source,
time, excerpt and hash. Durable identity also activates the guard, preventing
caller source/slug removal from evading it. JSONB object-key ordering is irrelevant.

The synthetic DB scenario exercises actual mocked GET → candidate → existing
persistence → publisher → public catalog, evidence IDs, replay, source/value/time/
hash tampering, forbidden seller dates, stale updates and no provider jobs. The
festival's official July 28–August 1 range and roster are preserved. These are
synthetic observations, NOT a new live success; the last real HTTP 403 is unresolved.

## Remaining before source completion

Neither producer is registered or invoked in production. Repository health is now
isolated by the exact reviewed requested URL (also on failed attempts with no
candidate). Stock attempts neither create nor update slug-wide primary health.
The default latest-result, extraction-time and consecutive-failure queries exclude
this independent route; an explicit requested URL reads its own success/failure
history. Attempt predecessors and candidate supersession cannot cross these scopes.
Full run/candidate/diff audit history still includes both. Existing per-source import
events, admin queue and lease views already match exact source URLs and stay unchanged.
No schema, migration or new state table is needed. Synthetic DB regressions cover
interleaved stock/roster success, failure and recovery in both directions, plus a
stock-only festival without primary health. This does not register a live producer.

## Explicit operator invocation (no automatic publication)

`node --import tsx scripts/collect-tolminator-stock.ts` is a DB-free preview.
It performs exactly one reviewed GET and prints only the minimized candidate.
`--record-attempt EXACT_COMMIT` explicitly requires DATABASE_URL and the matching
current Tolminator 2027 canonical target. It writes only the existing run,
attempt, candidate and evidence audit rows, evaluating against that target. It
never invokes the publisher, modifies production source configuration, hydrates
the legacy slug-file runner or starts a scheduler. Existing source-specific
import-event behavior is unchanged; no source is registered by this command.

Collection failures record a FAILED attempt (403 remains HTTP 403), without a
candidate, last-good overwrite or primary-health mutation. Only bounded safe
error categories escape; arbitrary transport exception messages are not stored
or printed. DB errors propagate, never trigger a fabricated second attempt.
The summary queries extraction time/failure streak using the exact product URL.
Invalid arguments or an absent/mismatched target fail before any public request.

On 2026-11-22 at 17:44:29.916 UTC the DB-free command made a new ordinary public
GET which passed the exact status/URL/MIME/schema guards: ordinary 2027 admission
explicitly In stock, two field proofs, zero warnings. No DB, basket, account,
reservation, source configuration or production write occurred. Availability
is time-bound; prior 403s are not relabelled or erased. Seller dates remain excluded.

Synthetic DB coverage exercises real invocation → evidence/attempt audit,
403 and arbitrary network failure, independent counters and preserved last-good
extraction/canonical catalog/primary health, and rejection of invalid target or
commit before network/run creation. Fixtures use actual transport timestamps,
not artificial future attempt times that would poison later health queries.

Focused PR exact-head full CI/Codex gates are still required. No accepted/deployed
coverage or healthy primary roster is claimed.
