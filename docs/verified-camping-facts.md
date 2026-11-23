# Organizer camping guidance

The site reads reviewed camping guidance from the matching festival edition in PostgreSQL. It does not
use shipped guidance or copy it across years.

Run `npm run camping:import -- --festival=<slug> --edition=YYYY` to fetch and preview the parsed
organizer guidance. Review the facts, source and edition. Apply by repeating the command with
`--apply=<fingerprint> --actor=<label>`. Apply re-fetches the page and rejects changed, incomplete or mismatched
evidence. The collector supports Alcatraz and Wacken camping and Graspop accessibility.

The apply transaction records the reviewer label, exact edition, approved facts, source links, document digest,
preview fingerprint, and observation time in the append-only audit. An identical replay does not add an audit entry.
