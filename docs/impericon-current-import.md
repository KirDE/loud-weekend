# Impericon current-edition announcements

The active source is the official evergreen `https://www.impericon.com/pages/festival`,
not an immutable old news article. The existing daily source scheduler remains
responsible for checks; no OpenClaw queue watcher is required.

The fetcher follows the page's bounded current-edition News cards (maximum eight)
and retains the complete home/article documents in a typed envelope. It accepts
only official `www.impericon.com` festival/magazine article routes with the configured
edition year. A blog-alias redirect may change only `festival`/`magazine`, never the
article identity or origin. Broken, unbounded or missing listings fail closed.

The parser checks complete HTML, canonical identity, edition-specific article
headings and actual article bodies. Linked, explicitly billed headliners and
structured band-wave captions are extracted without a fixed list of acts or a
fixed dated-post slug. Biography labels are distinguished from song/album titles;
navigation, merch cards and author favourites are excluded. Pure ticket updates
supply no artist claims. A new unsupported announcement becomes reviewable rather
than silently returning unchanged. Discovery has no assumption that the current
headliner is the last announcement.

Dates come from the page's edition-specific weekend-ticket title and must be valid
and consistent; genuine changes go through the existing date-review policy. No ticket
availability is inferred from dated prose. Articles are partial, additive announcements:
rotation of older posts cannot erase already saved artists, and a billing promotion
of an existing support act requires reviewed reclassification.

Verified Impericon lineup publications use the normal transactional playlist-refresh
queue. The publisher still requires matching edition, source, additive scope and
persisted official field evidence before committing catalogue or queue changes.
Replays remain idempotent and do not create another job. A subsequent unchanged check makes no publication or agent
call. existing exact-article parsing remains available for old bindings until activation;
it is not the ongoing discovery mechanism.

## Current ticket inventory (#434)

After the existing home/news/article fetch, discover at most four visible current-edition standard weekend ticket products. Bind their exact dated, price-stage title to an enabled same-origin product control. Read the matching public Shopify Ajax `.js` endpoint with redirect rejection, bounded body and explicit JSON/JavaScript content type. This is source data; scripts are never executed.

Require the exact discovered title/handle/URL, festival vendor/type and a single ordinary purchasable variant with coherent inventory booleans, positive price and supported quantity rule. Any verified current weekend tier available means `available`. Closed tiers, contradictory inventory, missing products or changed schemas require review; a tier alone cannot prove whole-event `sold_out`. Active fetch envelopes always carry inventory observations; legacy stored artist-only envelopes retain their historical behavior without making a new ticket claim.

Current product selection follows the live edition's linked stage/year, not a frozen Tier 2 slug. Existing artist/edition/date/publisher gates stay in place. Full Rewind's preceding ticket-supplement PR is a code dependency, not a deployment requirement on OpenClaw.

The integrated PR includes the canonical secondary-ticket publication boundary from #497. The mocked fetch producer is covered through durable evidence, canonical readback/replay and stale/archived rollback in `tests/impericon-ticket-publication.e2e.test.ts`; mixed artist/ticket and proof-tampering cases remain in `tests/impericon-current.e2e.test.ts`. This is code acceptance evidence, not a claim of live catalogue publication.
