# Reviewed Spotify repertoire profiles

A festival billing is not necessarily one Spotify artist identity. A profile
preserves the single catalogue act and its five-track budget while using one or more
reviewed Spotify entities to find the correct collaborative repertoire.

This is deliberately separate from `ArtistIdentity` and artist aliases. It
neither merges the participants' identities nor sums their audience metrics.

## Durable configuration

Profiles live in the existing database `OperationalState` namespace:

- `spotify-repertoire-profile:<key>` stores a versioned, validated profile.
- `spotify-repertoire-binding:<artist-slug>` binds an existing catalogue act to
  that profile, with payload `{ "profileKey": "<key>" }`.
- `spotify-repertoire-audit:<key>` records the configuration hash and evidence.

`scripts/configure-spotify-repertoire.ts` reads one profile from stdin. Without
`--apply` it validates and previews only; `--apply` creates the profile, bindings
and audit atomically. Identical replay is idempotent; conflicting profiles or
bindings and unknown catalogue acts are rejected. An existing configuration is
not silently overwritten. Revision/rebinding requires separately reviewed
migration rather than an in-place widening of an active policy.

Fields: `schemaVersion: 1`, `key`, `artistSlugs`, `setlistArtist`,
`searchArtists: [{id, name}]`, `anchorArtistIds`, `collaborationArtistIds`,
`albumIds`, and public HTTPS `sourceUrls`. All IDs are pinned 22-character Spotify
IDs; artist/album memberships must be checked from actual release credits.

## Eligibility and selection

Every selected track must credit an anchor ID, and either belong to a reviewed
album ID or also credit a reviewed collaborator ID. Therefore old studio
releases credited only to Slash can be admitted by album, while a joint release
may have two or three credits. Solo Myles Kennedy, a different same-name artist,
unrelated Slash projects and original Guns N' Roses/Alter Bridge recordings do
not become eligible merely because a participant is in the profile.

The planner reads reviewed album tracklists and participant top tracks, hydrates
full Spotify track credits, then prioritizes recent setlist titles within this
pool. Missing titles are searched using the reviewed participant names, never a
fuzzy match of the entire billing string. Remaining slots use the eligible pool,
preferring studio versions and popularity. Short, poor-version and unavailable
tracks are rejected. One shared five-track budget and the existing global URI
and song deduplication remain. Reports contain the profile key and selected
track/credit/release IDs; follower counts are not synthesized.

The DB worker and canonical exporter transport profiles to the same Python
planner. Invalid or missing bound profiles fail closed. Provider errors do not
fall back to the participants' unrestricted solo catalogs.

## Existing durable plans

Profiles are read only when discovering a new plan. Already staged plans,
unknown provider operations, creation markers and playlist bindings are never
reset or replayed by configuring a profile. Configuration itself does not enqueue
jobs or call Spotify/YouTube write endpoints. New discovery uses the profile;
replanning existing work remains a separately reconciled operation.

## Single-artist disambiguation

An empty collaboration list requires exactly one reviewed search artist and one anchor.
Use this for an ambiguous billing only after official-source artist-ID evidence
and authenticated release credits establish the intended artist and album IDs.
The existing audited stdin configuration flow remains mandatory. This is a
selection policy, not a canonical identity pin, alias, or MusicBrainz relation.
Every admitted track still needs an anchor credit AND a reviewed album ID;
unreviewed releases and same-name artists remain ineligible. Nonempty album and
anchor lists remain required for both single and collaborative profiles.
No profile configuration rewrites frozen plans or triggers a provider write.
Existing work needs a separately authorized, lease/edition/binding-fenced refresh.

## Edition-scoped disambiguation

When official evidence identifies an act only for one festival edition, pass
`--festival <slug> --year <year>` (together) to the same stdin configuration CLI.
It requires a current edition and announced lineup membership for every act.
The immutable profile format is unchanged; the binding is stored separately in
`spotify-repertoire-edition-binding:<festival-slug>:<year>:<artist-slug>` and its
audit in `spotify-repertoire-edition-audit:<festival-slug>:<year>:<profile-key>`.
Preview, atomic append-only apply, conflict rejection and no-provider-write
behavior remain unchanged. No global binding or catalogue identity is created.

The DB worker and canonical exporter pass the explicit festival/year. Its
edition binding overrides a global binding only for that exact context. Other
festivals, years and context-free personal selections continue to use their
previous global policy (or no profile). Invalid/missing bound profiles still
fail closed, including a broken edition override over a valid global profile.
Already frozen plans, checkpoints and provider intents are not changed.

## DB-owned track restrictions (migration/release gate)

Artist-specific exclusions, original-act exemptions, primary-credit blocks and
version descriptors are data, not constants in the Python policy. They resolve
through the same canonical artist/alias and edition context as the existing
identity and repertoire transport. They do not establish identity equivalence.

`configure-artist-track-policy.ts` accepts a bounded stdin submission with
`slug`, `policy`, optional `edition: {festivalSlug, editionYear}`, `actorLabel`,
`evidence`, and public HTTPS `sourceUrls`. Policy fields are `schemaVersion: 1`,
`excluded`, `reviewedOriginal`, `blockedPrimaryNames`, `blockedVersionHints`,
and optional `strictPrimary` (require an exact accepted name without a provider pin).
Default mode previews; `--apply` creates an immutable OperationalState policy
and AdminAuditEntry in one serializable transaction. Conflicting replay rejects;
identical replay has no writes. Scoped publication requires current announced
membership. No catalogue identities, aliases, plans or provider state are changed.

Keys are `spotify-track-policy:<artist-slug>` and
`spotify-track-policy-edition:<festival-slug>:<year>:<artist-slug>`. Exact scoped
policies override global policy only in that context; malformed overrides fail
closed rather than falling back. Missing policy contains no artist-specific
facts. Explicit tribute/DJ/karaoke labels remain generic exclusions; reviewed
original status bypasses only vague name hints, not explicit labels/exclusion.

Related projects are NOT aliases or unrestricted name-based live fallbacks.
Use existing evidence/release-bounded repertoire profiles for reviewed tracks.
Legacy named lists are not automatically trustworthy seed data. Before releasing
the removal, inventory each legacy behavior, verify provenance and publish only
reviewed policies/relations through the audited flow. Unknown relations remain
unknown. Do not activate this migration merely because tests/CI pass: verified
legacy-data disposition, current-head review, deployment and installed transport
checks are still required. Existing frozen plans and accepted playlists are not
regenerated by this migration.
