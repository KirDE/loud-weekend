# Code quality gates

Use the Node version in `.node-version` and the pinned Python 3.13 runtime dependencies in `requirements.txt`.
Install JavaScript dependencies with `npm ci`, then run:

```sh
npm run lint
node --test tests/line-length.test.mjs
npm run typecheck
npm run test:data
python3.13 -m unittest discover -s tests
npm run build
```

The Quality workflow runs a dedicated required-to-pass lint job for pushes and pull requests, in addition to
its existing database, browser, runtime/archive and build checks. Do not treat missing runs as author defects;
investigate the trigger/token/event and repair or rerun the same PR without bypassing current-head checks.

- `lint:js`: oxlint correctness checks; warnings fail the gate.
- `lint:css` (also available as `csslint`): Stylelint with the standard modern-CSS rules. The obsolete `csslint`
  package cannot parse this application's custom properties; it is deliberately not used.
- `lint:format`: Prettier check is part of required `npm run lint`, with the same JS/JSX/MJS/CJS/TS/TSX/MTS/CTS/CSS
  coverage as `npm run format`; formatting drift fails CI.
- `lint:lines`: every maintained JS/TS/TSX/CSS/Python/shell/workflow/Prisma source line is at most 120 characters.
  Extensionless deployment executables are included. Tabs count as four columns, and Unicode code points count
  once. Both tracked and new untracked source files are checked. There is no legacy baseline or changed-lines gate.
- `npm run format`: Prettier with a 100-column target leaves room for the strict 120-character limit. Python was
  formatted with Ruff at 100 columns; ordinary formatter targets are not substitutes for the hard lint check.

Immutable applied SQL migration history is not rewritten: doing so would invalidate deployment checksums.
Lockfiles, external/vendor payloads and isolated source-data formats are not maintained application source.
Executable fixtures (including Python provider mocks) are maintained source and are checked.
New schema migrations must remain structural and new source must satisfy the same quality rules.

Intentional late CSS cascade overrides have narrowly scoped duplicate-selector and descending-specificity
annotations that identify the earlier selector. Selector/declaration ordering is preserved; the rules remain
enabled for new code. Oxlint correctness defaults remain enabled; Map iteration snapshots have an exact-line
exception because deleting and reinserting keys during live iteration would revisit the inserted entries. C0-control rejection
regexes have local, documented oxlint annotations. Do not add blanket suppressions or exclude production folders.
Source-based tests parse CSS declarations in their media-query context and normalize escaped shell continuations;
formatting must not change the safety contract or weaken test assertions.

`AGENTS.md` contains the repository-wide data-origin, publication, provider, privacy and review/release contract.
A clean lint result does not prove data provenance, behavior, current-head Codex Review or live deployment.
