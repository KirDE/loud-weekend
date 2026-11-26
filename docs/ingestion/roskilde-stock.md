# Roskilde ordinary stock (unregistered)

Official 2027 ticket information links the ordinary Tickster gateway
`https://ticket.roskilde-festival.dk/da/vgkw6td2h3rrfkv/products`.
The separate Smart Ticket gateway is not equivalent. The public shop currently
requires ephemeral anonymous session initialization before its products GET;
partial initialization, errors and session-expiry pages are not stock results.
No selection, cart, account or order request is needed or allowed.

The implementation combines a strict DOM observer using existing Cheerio, a
bounded native GET session collector, durable publication guards, and separate
source-health queries (see below). It is NOT registered in the production fetch
runner. The observer itself does not issue requests or write to any database;
parsing a historical response does not prove a fresh refresh. Cookies remain
in memory, exact-origin scoped and absent from evidence/logs/fixtures.

The minimized fixture is public product DOM observed 2026-11-22 18:03:19 UTC;
scripts, state, exact identifiers, links and action attributes were removed by
local deterministic projection. Quantity names are surrogates. An enabled
Standard (15+) selector with positive choices in the unique **Partout** group,
whose visible description binds Roskilde 2027 and June26–July3, proves ordinary
full-pass availability. Child, donation, companion and day variants never
substitute for it. Number of choices is NOT an inventory count. Price and link
alone are not proof. Sold-out child and Wednesday variants are deliberately
retained to test scope. A disabled/absent/sold-out full-pass Standard throws;
it NEVER claims the entire festival sold out because day passes are independent.

The observer validates exact source/edition/response identity and visible
structural bindings. Duplicates, hidden/disabled controls, conflicts, changed
edition/date descriptions or malformed quantities fail closed, with no partial
candidate. Its only fields are `ticketStatus=available` and the ordinary
`ticketsUrl`, with minimized source/time/scope evidence; no seller date/price,
artist, health or provider mutation. Independent health isolation is enforced by the shared repository; explicit audit-only invocation is available below.

Pending: focused PR, full exact-head Quality and
Codex review. Do not count Roskilde complete from local tests or a historical fixture.

## Native read-only session transport (not registered)

`collectRoskildeStock` in `roskilde-stock-transport.ts` initializes only the exact
reviewed public shop root, optionally follows one exact `selectproductgroup`
redirect, validates that initialization, then GETs the exact ordinary products
URL. No selections, POSTs, cart/account/order routes or alternate-sale fallback.
A fresh in-memory `tough-cookie` jar (pinned maintained library, not hand-rolled
cookie parsing) follows standard domain/path/expiry rules. Cookies are never
returned, persisted or logged, and are removed on exit. No caller headers or
source URL overrides. The optional fetch injection is for deterministic tests.

The entire chain, including streamed response bodies, shares a maximum 20-second
deadline. Each response is bounded to 2 MB and must be HTTP200 HTML/UTF-8 at the
exact requested URL; only the single reviewed initialization redirect is allowed.
Invalid UTF-8, unexpected schema, access errors and partial/session-expired pages
fail closed with a fixed sanitized error (no private server content). No retries
or last-good refresh on failure. The returned minimized candidate has only the
ordinary full-pass status and reviewed purchase URL; other variants remain
independent. It is **not** durable publication proof or a production registration.

Tests inject public synthetic session cookies only. Actual live validation is a
separate timestamped observation, not a restamping of the cached fixture. Durable
transport provenance, DB replay/rollback/public-read integration and PR gates
remain prerequisites for completion.

## Durable publication guard (not invoked in production)

The existing ingestion attempt/candidate/evidence/diff storage and canonical
publisher are reused; no new schema, external service or storage is introduced.
The stock route now requires exact persisted requested/final URL and HTTP200,
matching normalized candidate, edition 2027, available status, purchase URL,
observation time and two field/value/excerpt/SHA256 proofs. Only ticket status
and ticket URL changes are allowed. Observation must be within 24 hours (at
most 60 seconds in the future) and match the attempt completion time. Durable
route identity triggers the guard even if a caller strips both slug and URL.
The guard is route-scoped, not festival-wide: primary date/artist observations
are not forced through ticket-only checks.

Synthetic disposable-DB tests exercise the real native collector using exact
HTTP fixtures, policy, persistence, canonical publication/public reader and
idempotent replay. Missing, changed or stale evidence, HTTP/route/normalized
candidate drift and unsupported seller dates reject without catalog/publication/
provider-job mutations. A competing canonical update also rolls back. Dates,
artists and existing provider queues remain untouched by valid stock changes.
No cookies, HTML or private session fields are stored. This is NOT a new live
observation; the previous timestamped live check remains separate.

## Independent ticket health and lineage

The exact reviewed products route is isolated in the shared ingestion repository.
It never creates or refreshes the primary festival source-state cache. Default
latest-result, last-successful-extraction and consecutive-failure queries exclude
this independent route; an explicit requested URL returns its separate history.
Attempt predecessors and candidate supersession also stay in their own scope.
Scope comes from the actual requested route, including failed requests without
candidates, not mutable candidate values. Primary recovery cannot clear a stock
failure and stock success cannot clear a roster failure. Interleaved disposable
DB regressions cover these cases and ticket-only histories with no primary cache.
This focused reuse does not import or register the unmerged Tolminator source.

**Still unregistered:** focused PR, full CI and exact-head review remain pending.
Do not count Roskilde complete yet.

## Explicit operator invocation (no auto-publication)

`node --import tsx scripts/collect-roskilde-stock.ts` performs a DB-free preview,
even when DATABASE_URL is present. Output is only the minimized candidate;
no cookies, HTML, server errors or private session values are printed.

The explicit `--record-attempt EXACT_COMMIT` option requires DATABASE_URL and
an existing canonical Roskilde 2027 target with its reviewed official homepage.
It records a MANUAL ingestion run, attempt, candidate and two durable proofs;
it does **not** call the canonical publisher or register a production source.
It reports only the independent stock attempt/health metadata. A partial chain
failure has no fabricated HTTP200/final URL or candidate. Transport errors are
sanitized; because a multi-GET chain can fail at any step, its generic failure
has no invented HTTP status. Failed attempts preserve last-good extraction and
primary source health. DB write failures propagate, never becoming a second
fabricated collection attempt. Existing policy/publication review applies to
any later canonical publication; this invocation never auto-publishes.

Tests use actual invocation→native collector (synthetic HTTP)→policy→DB audit,
success/failure/recovery, no-publication/provider/primary-health mutations,
pre-network edition/identity checks, and CLI validation plus a mocked DB-free
preview with intentionally invalid DATABASE_URL. Production DBs are never used.

The reviewed edition identity, shop route key and required Danish copy live
in `lib/ingestion/adapters/roskilde-stock.ts`. This is trusted, versioned source
configuration, not a response from the remote shop. Keeping it as data allows
the read-only preview to remain DB-free. The transport and publisher bind
to the same exact product route and edition; a later edition requires new
reviewed source evidence, not an automatic rollover.
