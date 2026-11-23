# Reviewed camping and accessibility

Camping facts are stored in PostgreSQL per exact festival edition and field. Public pages show only imported facts matching the catalogue's edition, city, country and HTTPS organizer identity. Unsupported fields are omitted, and dates are date-only values. They are not stock, pricing or whole-site accessibility claims.

## Review and import

Place organizer-reviewed inputs in `catalog-data/camping/`. The source must explicitly support the edition and every supplied fact; provide EN, DE and RU text, or an ISO date for earliest campsite arrival. Preserve the source URL and the date it was checked.

After the schema migration is applied, preview with `npm run camping:import -- --input=<path>`. An authorized import uses the same command with `--apply`. The command requires an explicit database connection, refuses archived editions and older reviews, and updates only the named fields in one transaction. Without an import the section stays hidden. Inputs are not loaded by the web application.
