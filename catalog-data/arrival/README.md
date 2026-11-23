# Reviewed festival arrival guidance

The arrival adapter extracts guidance only for explicitly registered, edition-bound
organizer URLs using the `manual_review` strategy. The database-due ingestion
worker holds the source lease, and stages the normalized arrival observation and
per-document evidence as an ingestion candidate. This change does not activate
or populate any production sources.

Review the pending case through the protected importer API. Claim the current
case, then resolve it with `action: "apply"` and `arrival` set to the candidate's
`arrivalFingerprint`. Supply a review reason. The server uses the persisted
facts and evidence, not caller-supplied text or URLs, and commits the edition
projection, candidate disposition and append-only audit together. There is no
direct-write import command.
