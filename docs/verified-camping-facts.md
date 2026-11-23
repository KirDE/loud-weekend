# Organizer camping guidance

The site reads reviewed camping guidance from the matching festival edition in PostgreSQL. It does not
use shipped guidance or copy it across years.

Run `npm run camping:import -- --festival=<slug> --edition=YYYY` to fetch and preview the parsed
organizer guidance. Review the facts, source and edition. Apply by repeating the command with
`--apply=<fingerprint>`. Apply re-fetches the page and rejects changed, incomplete or mismatched
evidence. The collector supports Alcatraz and Wacken camping and Graspop accessibility.
