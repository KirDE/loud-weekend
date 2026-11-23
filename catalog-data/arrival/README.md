# Reviewed festival arrival guidance

The database is the public application's only source for arrival guidance. These
JSON files are reviewed import inputs, not runtime assets or fallback content.
Each fact records the exact edition, organizer source, review date and localized
text. An optional supporting source can record an operator's edition-specific
evidence alongside the organizer's link.

Apply the schema migration before importing. On a disposable database, preview
with `npm run arrival:import -- --input=<reviewed.json>`. Repeat with `--apply`
to write the reviewed rows. Import any additional files separately. Imports
update only the included fact kinds, preserve newer reviews and reject archived
editions or an organizer/country mismatch. They do not create editions or change
other catalogue fields. The UI omits the section when there are no matching rows.
