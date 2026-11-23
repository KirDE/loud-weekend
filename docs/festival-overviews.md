# Editorial festival overviews

The overview adapters extract edition-specific facts from the Alcatraz stages page,
Hellfest's edition announcement and Wacken's event terms. They turn only the
recognized facts into concise EN, DE and RU copy. Missing or ambiguous evidence
does not create or update an overview.

After the schema migration, preview the organizer observation against the target database:

```sh
npm run overviews:import -- --festival=<slug> --edition=<year>
```

Review the edition, evidence URLs and localized copy. Add
`--apply=<preview fingerprint>` only to publish that reviewed observation.
Apply fetches the official page again and refuses changed facts. Persistence also
rejects missing or archived editions, mismatched identity, non-organizer source
URLs and older review dates. Reapplying the same observation updates only the
dedicated overview row, not catalogue freshness, dates, tickets or lineups.

The public panel reads only the matching PostgreSQL overview. If an already
reviewed overview is no longer valid, withdraw its exact edition row through
the approved maintenance path; a failed fetch does not delete reviewed data.

Each applied change stores the approved observation, source URLs, document digest,
observation time, fingerprint and applying OS account in the append-only admin
audit. The audit and overview update share a transaction. Preview and same-day
no-op replay write neither row.
