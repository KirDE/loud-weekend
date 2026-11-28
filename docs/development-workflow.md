# Product-focused development

Use this guide with [AGENTS.md](../AGENTS.md), not as a replacement for its data-origin, privacy,
provider or release rules. Exact local commands and CI coverage live in [Code quality](code-quality.md).
The [runtime ownership guide](runtime-ownership.md) owns worker and deployment boundaries.

## Define the outcome before adding a feature

For a new capability, setting or dependency, answer these questions in the issue or PR.
Bug fixes and documentation-only edits do not need a new feature proposal.

1. **Who benefits?** Name the festival-goer, editor/operator or developer and the task that gets easier.
2. **Does it preserve trust?** Explain how official-source provenance, edition identity, private user data
   and the existing publication/provider boundaries remain intact. Unknown facts must remain unknown.
3. **What does first use look like?** Describe the ordinary user's steps, secure defaults and failure state.
   A new implementation detail is not another control unless it helps that person make a meaningful choice.
4. **What is the lasting cost?** Consider dependencies, settings, background work, maintenance and documentation.
   Prefer existing mechanisms when they meet the outcome; explain why a new abstraction is needed.
5. **Who else notices?** Identify existing routes, translations, APIs, stored documents, workers and deployments
   affected by the change, and any compatibility or migration work it requires.

Use the README for product purpose and the relevant guide for the subsystem contract.
Treat dated status reports as historical evidence, not a current list of festivals or deployed capabilities.
If a requirement conflicts with an existing safety boundary, explain the conflict instead of bypassing it.

## Shape the existing system

Trace the full affected path and its consumers before choosing a patch. For example, an importer fix is not
just a parser change: inspect the candidate, validation/publication boundary, canonical readback and UI.
A provider fix also needs reconciliation and retry behavior; do not trigger real writes to demonstrate it.

Read each touched file and function as a whole. Remove obsolete branches, merge repeated explanations and
reuse the authoritative rule instead of appending a competing one. Keep unrelated cleanup out of the PR.
If a broader refactor would help but is not necessary for the requested fix, describe it separately with its cost.

Keep input validation and limits at the boundary before decoding, allocating or publishing untrusted data.
Use the existing subsystem's limits, caches and transports. Do not add unbounded work or change what an
existing quota or permission governs without documenting the distinct contract.

## Prove behavior, not the implementation shape

- A behavioral fix includes a regression check that fails with the unfixed implementation and passes with the fix.
  Keep that evidence in the PR; an always-green test does not prove the defect was fixed.
- Prefer observable results through the supported API or user flow. A source-text assertion alone cannot prove
  runtime behavior, though source-based checks remain useful for static invariants and release contracts.
- Never weaken assertions, skip a failing scenario or loosen a quality/security gate merely to get green.
  First establish whether the implementation, fixture, expectation or execution environment is wrong.
- For browser changes, check the affected English, German and Russian flows, keyboard/focus behavior and narrow
  and wide layouts. Check existing themes where the change affects them; do not invent a theme requirement.
- Wait for observable readiness and settled layout before clicking or measuring. Prefer conditions over fixed
  sleeps; use a fixed wait only when the elapsed interval itself is the behavior under test, and explain why.
- Bound and clean up test-owned processes, servers, temporary files and disposable databases, including on failure.
  Reuse the suite's existing helpers. Never clean another task's resources or use a shared/production database.
- Choose checks proportional to the change. A documentation-only edit needs accurate links and commands, not
  a new runtime test that merely asserts the guidance's wording. The repository's required CI still applies.

[AGENTS.md](../AGENTS.md#code-checks-and-release-gate) defines the exact-head CI, Codex Review and live-release gates.
A passing focused check is not evidence that an unexecuted full suite or production acceptance passed.

## Keep documentation useful

Update the one page that owns the behavior. Rewrite the affected section into the current state rather than
adding an update paragraph next to stale instructions. Link from overview pages instead of copying the detail.
Keep historical rollout evidence separate from normative instructions and label its date and verified scope.

Write for the reader's task: what to do first, short steps next, operational details afterward.
Keep implementation terms out of user-facing text unless they help the user decide what to do.
Run changed commands or examples as written in an isolated environment; say explicitly when they were not run.
Preserve published URLs and anchors with a redirect or compatible anchor when reorganizing material.
Update changed public UI copy in all supported languages; explain API or stored-document compatibility changes.

## Review the whole result

Use the PR template's **Whole-change check** to name the files and flows read end to end, what was reshaped,
and any remaining duplication or complexity. Say what was moved or removed and where its responsibility went.
If no restructuring is needed, explain why; do not create unrelated churn to fill the section.

Independent review must come from a reviewer who did not write the change. For substantial features, check
three perspectives in proportion to the scope: the festival-goer completing the task, the editor/operator
running it safely, and the developer maintaining or integrating it. These are review perspectives, not a
requirement to spawn extra agents or use an unavailable tool.

For access, sharing or export changes, also test attempts by an unauthorized caller and check errors, logs,
metadata and offline caches for disclosure. A useful UI is not complete if it weakens the access boundary.
Record known limits honestly; do not claim a security review or production acceptance that did not happen.

## Exact-edition navigation

Exact festival-edition links use `components/CatalogLink.tsx` for a full document navigation.
This preserves the server-owned canonical/alternate/social metadata when leaving another catalogue page;
client transitions in the pinned Next.js runtime can retain the previous document's canonical alongside
that of the exact edition. Other links keep Next navigation. The trade-off is a document request for
edition entry, not a second SEO implementation or client-side metadata deletion. Persisted local planner
choices survive navigation; page-local transient UI resets normally. Keep the actual keyboard navigation,
unique exact canonical and cross-season planner persistence checks in the browser suite.
