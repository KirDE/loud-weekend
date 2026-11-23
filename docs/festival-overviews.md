# Editorial festival overviews

Store reviewed import records in `catalog-data/overviews/`. Each record names
a canonical festival, edition, place and organizer host, and includes public
official source URLs, the review date, and concise original EN, DE and RU copy.
Verify all three translations against the organizer's published evidence for
that edition.

After deploying the schema migration, preview a reviewed JSON file against the
destination database:

```sh
npm run overviews:import -- --input=/path/to/reviewed-overview.json
```

Add `--apply` only to publish the reviewed record. The command refuses missing
or archived editions, inconsistent identity or non-organizer source URLs,
and cannot overwrite a newer review. Reapplying the same file updates the
same row, without touching catalogue freshness, dates, tickets, or lineups.
The public festival pages show only the matching database row. There is no
runtime seed or fallback to JSON. To withdraw copy, remove only the reviewed
overview row for the exact edition; the public panel is then omitted.

Do not treat stage descriptions as a timetable, ticket information as stock,
or a previous edition's description as evidence for a later edition. If the
edition, venue, or format changes, recheck the record rather than carrying its
copy forward.
