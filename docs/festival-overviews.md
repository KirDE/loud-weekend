# Editorial festival overviews

The overview adapters extract edition-specific facts from the Alcatraz stages page,
Hellfest's edition announcement and Wacken's event terms. Only recognized facts
become localized EN, DE and RU copy; missing or ambiguous evidence does not
create or update an overview.

A configured, enabled manual-review source must match the adapter URL and the
current catalogue edition. The normal due importer collects the official
document under its source lease and persists a review-only candidate with the
document digest, edition, extraction time and reviewed copy. This change does
not register or enable production sources.

Follow the [protected import conflict workflow](import-conflict-agent.md). Claim
the exact case and verify the stored organizer evidence before submitting an
`apply` decision with `overview` set to its `candidate.overviewFingerprint`.
Do not include replacement facts, source changes or separate evidence in that
decision. A newer candidate or changed catalogue snapshot requires a new review.
The overview write, publication, candidate disposition and append-only audit are
atomic. Replaying the same approval returns its existing receipt.

The public panel reads only the exact edition's matching PostgreSQL overview.
A failed collection does not delete an existing review. Publishing an overview
does not update dates, lineups, tickets or provider jobs.
