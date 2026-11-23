# Rock en Seine hiatus announcement parser

Parser-only change for #434. Generic edition lifecycle/display work is tracked separately in #523.

`observeRockEnSeineHiatus(html, observedAt, transport)` recognises the exact visible official announcement: a 2027 pause, announced return in 2028, and an alternative 2027 gathering only under consideration. Years are extracted from the visible announcement and must agree across the heading, pause and alternative-event caveat. It returns a source-specific proposal, not a `FestivalCandidate` or a published catalogue record.

The parser requires HTTP 200 from the exact official URL, a canonical observation timestamp, bounded HTML, the expected visible section and unambiguous announcement. Hidden/script-only, duplicate, contradictory, foreign-source and malformed input fail closed. Only a generated, minimized assertion is returned; unrelated page content is not retained.

No ticket availability/status, replacement dates, new edition, source health or roster is inferred. Nothing is registered in the production runner. No database, migration, review API, admin/UI, catalogue, calendar, SEO, collector or staging changes are included in this PR.

Fixture timestamp is historical, not a fresh live confirmation. Run the parser regressions with:

```sh
node --import tsx --test tests/rock-en-seine-hiatus.test.mjs
```
