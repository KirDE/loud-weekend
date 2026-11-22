# Отображение фестиваля на паузе — #523

Extracted from #522 at Kirill’s request. This is the preserved implementation for separate architectural review, NOT a ready/accepted design. Depends on the parser-only #522. General model/storage/review/catalogue/UI changes and parser-to-model integration belong here.

The following source-specific integration notes are retained as historical implementation context, not generic hardcoded UI requirements. Generic layers must work for a different festival/edition without brand/year/source branches. No merge/deploy or production writes.

---

# Rock en Seine: reviewed 2027 hiatus

The official homepage https://www.rockenseine.com/ explicitly pauses the festival
in 2027 and announces a return in 2028. A different 2027 gathering is only under
consideration, not confirmed. Neither return year nor alternative creates an
edition, date, ticket offer or cancellation notification.

## Explicit collection

```
node --import tsx scripts/collect-rock-en-seine-hiatus.ts
node --import tsx scripts/collect-rock-en-seine-hiatus.ts --stage EDITION_ID
```

Preview is database-free. The explicit staging mode appends pending evidence only;
it cannot approve. No runner/source configuration or automatic production writes
are added. One anonymous GET to the exact homepage, redirect rejection, HTTP200,
HTML UTF8, shared 20-second deadline and 2MB actual-byte bound are required.
No cookies, legal/contact text or raw HTML are stored or printed. Staging
re-extracts the memory-only response using the strict visible notice parser;
historical evidence must never be restamped as a new live observation.

## Durable proof and review

An additive snapshot table binds the existing current Rock en Seine 2027 edition,
requested/final route, status, observation time, parser version and minimized
proposal with SHA256. Edition locking serializes append/replay, rejects stale
observations and validates persisted proof. This is an application append-only
service, not a database-level immutability claim.

The authenticated admin review queue (EN/DE/RU) shows source, original observation,
evidence, exact revision and decision. GET/POST use existing session, role,
allowlist and origin guards, private/no-store responses, bounded strict request
bodies and minimal results. Actor identity comes only from the session. The
transaction rechecks role/allowlist under lock, requires the exact latest fresh
revision and writes decision plus immutable audit atomically. Revocation,
supersession, expiry or uncertain responses cannot produce optimistic approval.

## Catalogue and consumers

The main database catalogue and independent offline schedule compose approved
proof validation with their data reads in RepeatableRead snapshots. Only current
editions receive the eight-field public notice: festivalSlug, editionYear, lifecycle,
announcedReturnYear, alternativeEvent, sourceUrl, observedAt and approvedAt.
No reviewer, internal ID, hash, raw HTML or audit details enter the public notice.
Archive snapshots retain captured facts. Raw dates, ticket enums, lineup arrays,
source health, preferences, publications and provider jobs are not overwritten.

Absent/pending/rejected evidence alone never means an active or paused event.
A newer pending/rejected revision does not inherit approval or erase the last
approved historical notice; original source and audit times are preserved.
Freshness is required for new staging/decisions, not automatic reactivation after
24 hours. Corrupt latest or approved proof fails closed, never old healthy data.

Approved hiatus suppresses purchase links, available-ticket/month/announced
filters, advertised roster/artist appearances, old scheduled dates, calendar
exports and MusicEvent JSON-LD. EN/DE/RU display a distinct pause and official
source/observation notice. Saved preferences remain; archives remain unchanged.
The offline scheduled-event list excludes paused editions; an all-paused list is
healthy empty, whereas absent DB rows/corrupt proof return 503 without validators.
Previously cached offline data may remain outdated; no fresh-check claim is made.

## Verification

Observer/transport adversarial tests; actual HTTP handlers and real disposable DB
staging/replay/review/audit rollback, pending/rejected isolation, corruption and
main/offline projection tests; actual component renders across EN/DE/RU. Browser
test `tests/e2e/rock-en-seine-hiatus.spec.mjs` exercises authenticated review through
public desktop/mobile rendering, source/time, ticket/SEO suppression and offline
exclusion. Synthetic DBs only. No deployment, production migration or approval is
performed by these tests. PR gates report exact-head outcomes separately.


## Boundary correction after architectural review

Source-specific identity, parser version, years, minimized excerpt and proof
validation belong to the adapter, selected by the ingestion source allowlist.
Storage/review routes, admin target discovery, domain schemas, catalogue/offline
readers and consumer UI contain no brand branches. Admin targets are current
editions with actual stored proposals, not an invented list of eligible brands.
The public notice binds its own slug, edition year and official source URL;
consumers compare those against the target, rather than knowing one festival.
Return year and alternative-event information can be unknown (null); UI never
invents these from the existence of a pause. These changes correct boundaries,
not permission to deploy or an architectural acceptance based on green CI.
