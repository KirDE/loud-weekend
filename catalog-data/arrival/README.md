# Organizer arrival guidance

The site reads approved guidance from the matching edition in PostgreSQL. No arrival facts are shipped
with the application. The public section is omitted when no matching rows are present.

Use `npm run arrival:import -- --festival=<slug> --edition=YYYY` to preview parsed organizer guidance.
Review the facts, source links, and edition, then apply with `--apply=<fingerprint>`. Applying re-fetches
the organizer sources and rejects incomplete, changed, or mismatched evidence. Approved observations
update only the included fact kinds. The collector supports Graspop and Wacken.

For Graspop rail shuttles, also pass `--rail-shuttle`. It requires the organizer
to link the shuttle operator and both pages to agree about the stations. Only
inbound and Monday return rows from the requested edition count. It never
updates airport shuttles, venue guidance, ticket availability, prices or times.
