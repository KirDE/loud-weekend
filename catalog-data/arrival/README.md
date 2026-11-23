# Organizer arrival guidance

The site reads approved guidance from the matching edition in PostgreSQL. No arrival facts are shipped
with the application. The public section is omitted when no matching rows are present.

Use `npm run arrival:import -- --festival=<slug> --edition=YYYY` to preview parsed organizer guidance.
Review the facts, source links, and edition, then apply with `--apply=<fingerprint>`. Applying re-fetches
the organizer sources and rejects incomplete, changed, or mismatched evidence. Approved observations
update only the included fact kinds. The collector supports Graspop and Wacken.
