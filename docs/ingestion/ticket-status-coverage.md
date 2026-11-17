# Festival ticket-status rollout (#434)

This is a **work-in-progress** source-by-source rollout, dependent on #480's
status model. It does not close #434. The public current-edition catalogue had
59 festivals when enumerated on 2026-11-17; README's older count of 50 is not the
audit denominator. This is not a dump of private production source configuration.

`ticket-status-coverage.json` records every festival, the public official/ticket
URL, one-shot HTTP observation, implemented status semantics and fixture tests.
A successful HTTP response is **not** evidence of available tickets. An updated
fixture path is not a claim of production acceptance or support for every
possible future ticket page layout.

## Current verified changes

- Existing producers: keep explicit full-pass sellouts separate from ambiguous
  unavailability, and future sale announcements separate from sellouts. Preserve
  their edition, official-source and product-variant gates.
- Wacken: fetch its official current ticket overview in addition to the source
  homepage; inspect the standard Louder festival-pass card, not sold-out loyalty
  offers or the historical footer. Fetch failures, identity drift, missing cards
  and contradictory evidence retain review/last-good data.
- Download: fetch current official ticket page alongside home/artist documents;
  inspect regular camping and arena admission, ignore sold-out accessories, and
  abstain rather than infer a whole-event sellout from some sold-out products.
- Generic JSON-LD: positive offers outrank sold-out tiers; only a complete set of
  explicit SoldOut offers establishes sellout. OutOfStock remains ambiguous.

## Remaining work

Every pending row still needs its actual producer/source path reviewed and
source-specific fixtures; the table is deliberately not green by default.
Known examples: Provinssi's current metadata says on sale but its purchase
link leads to Paylogic `/offsale`; that gateway alone cannot establish current
inventory. Hellfest distinguishes sold-out full passes from a future day-pass
sale, so product scope must not be flattened carelessly. Several sources have
transport failures, recorded as errors rather than a successful empty result.

No production configuration, publication, accounts or provider jobs are changed
by this PR. Local integration tests use only a guarded disposable database.

## Reviewed follow-up proposals (unmerged)

As of 2026-11-17 23:48 UTC: **18/59 fixture-verified proposals; 41 remain**.
The original 13 paths live in #482. Five further source audits have completed
Codex review with no findings and full Quality CI on the exact linked head.
They are **separate open PRs**, not code included by this documentation change,
not merged, not deployed, and not proof of production acceptance.

| Festival | Proposal | Verified head | Quality run |
| --- | --- | --- | --- |
| Mystic Festival | [#483](https://github.com/KirDE/loud-weekend/pull/483) | `738741fd14d2059f9d360c1c45e959d3d2ab9194` | [success](https://github.com/KirDE/loud-weekend/actions/runs/44198126325) |
| Masters of Rock | [#484](https://github.com/KirDE/loud-weekend/pull/484) | `d15842192e98ce5e733c2aa5f1b39b3719160ccd` | [success](https://github.com/KirDE/loud-weekend/actions/runs/44198835440) |
| Alpen Flair | [#485](https://github.com/KirDE/loud-weekend/pull/485) | `9d63be8f6e9d5df82c62d2390b4219acd4e5a777` | [success](https://github.com/KirDE/loud-weekend/actions/runs/44200969884) |
| Barcelona Rock Fest | [#486](https://github.com/KirDE/loud-weekend/pull/486) | `0096af2d95891722f37ec5ea0456936dc48844c1` | [success](https://github.com/KirDE/loud-weekend/actions/runs/44201108254) |
| Full Rewind | [#487](https://github.com/KirDE/loud-weekend/pull/487) | `276f51d68922a2d45090916aacfc7f65bd1fb924` | [success](https://github.com/KirDE/loud-weekend/actions/runs/44201716124) |

Full Rewind adds a genuinely new producer: official Shopify standard-weekend
product and variant availability, cross-checked with verified festival dates.
A false inventory flag is ambiguous `unavailable`, not a whole-event sellout.
Alpen Flair's real line-break review finding was fixed before counting #485.

[#488 Impericon](https://github.com/KirDE/loud-weekend/pull/488) is a further
new live weekend-tier inventory proposal, currently **not counted** while its
review and CI are pending. It is stacked on #487; other audits above depend on #482.

Fresh source obstacles remain explicit: Roskilde /billetter returned HTTP 403;
Alcatraz /en/tickets returned HTTP 200 but readable extraction did not expose
admission inventory controls. Neither result means tickets are unavailable,
sold out, or successfully checked. Their rows remain pending.

`verified_in_followup_pr` records linked, tested **unmerged** code; it is distinct
from `updated_fixture_verified` paths in the original #482 branch. Neither state
means deployed/accepted in production. The existing HTTP observations are
one-shot transport observations, not proof for the listed status semantics.

| Festival | Rollout state | Fixture-verified ticket states |
| --- | --- | --- |
| 2000trees | pending_audit | Not yet audited |
| Alcatraz Open Air | pending_audit | Not yet audited |
| Alpen Flair | verified_in_followup_pr | available |
| Barcelona Rock Fest | verified_in_followup_pr | available |
| Bloodstock Open Air | pending_audit | Not yet audited |
| Brutal Assault | updated_fixture_verified | available, sold_out, unavailable |
| Copenhell | pending_audit | Not yet audited |
| Download Festival | updated_fixture_verified | available |
| Dynamo Metal Fest | pending_audit | Not yet audited |
| Eurockéennes de Belfort | pending_audit | Not yet audited |
| Firenze Rocks | pending_audit | Not yet audited |
| Frequency Festival | pending_audit | Not yet audited |
| Full Force | pending_audit | Not yet audited |
| Full Rewind | verified_in_followup_pr | available, unavailable |
| Graspop Metal Meeting | pending_audit | Not yet audited |
| Greenfield Festival | pending_audit | Not yet audited |
| Heavy Week-End | pending_audit | Not yet audited |
| Hellfest Open Air | pending_audit | Not yet audited |
| Hurricane Festival | pending_audit | Not yet audited |
| I-Days Milano | pending_audit | Not yet audited |
| Impericon Festival | pending_audit | Not yet audited |
| Inferno Metal Festival | updated_fixture_verified | available, sold_out |
| Jera On Air | pending_audit | Not yet audited |
| Leeds Festival | updated_fixture_verified | available, sold_out |
| Leyendas del Rock | pending_audit | Not yet audited |
| Mad Cool Festival | pending_audit | Not yet audited |
| Masters of Rock | verified_in_followup_pr | available |
| M'era Luna Festival | pending_audit | Not yet audited |
| Midgardsblot Festival | pending_audit | Not yet audited |
| Motocultor Festival | pending_audit | Not yet audited |
| Mystic Festival | verified_in_followup_pr | available |
| Nova Rock | updated_fixture_verified | available, sold_out |
| Paléo Festival | updated_fixture_verified | not_on_sale |
| Pinkpop | pending_audit | Not yet audited |
| Pistoia Blues Festival | pending_audit | Not yet audited |
| Pol'and'Rock Festival | pending_audit | Not yet audited |
| Provinssi | pending_audit | Not yet audited |
| Reading Festival | updated_fixture_verified | available, sold_out |
| Resurrection Fest | pending_audit | Not yet audited |
| Roadburn Festival | pending_audit | Not yet audited |
| Rock am Ring | pending_audit | Not yet audited |
| Rock en Seine | pending_audit | Not yet audited |
| Rock for People | pending_audit | Not yet audited |
| Rock im Park | pending_audit | Not yet audited |
| Rock Imperium Festival | pending_audit | Not yet audited |
| Rock in Roma | pending_audit | Not yet audited |
| Rock The Lakes | pending_audit | Not yet audited |
| Rock Werchter | updated_fixture_verified | not_on_sale |
| Rockharz Open Air | updated_fixture_verified | sold_out |
| Rockstadt Extreme Fest | pending_audit | Not yet audited |
| Roskilde Festival | pending_audit | Not yet audited |
| Southside Festival | pending_audit | Not yet audited |
| Summer Breeze Open Air | updated_fixture_verified | available, sold_out |
| Sweden Rock Festival | updated_fixture_verified | not_on_sale, available, sold_out |
| Tolminator | pending_audit | Not yet audited |
| Tons of Rock | pending_audit | Not yet audited |
| Tuska Festival | updated_fixture_verified | available, sold_out |
| Vainstream Rockfest | pending_audit | Not yet audited |
| Wacken Open Air | updated_fixture_verified | available, sold_out |
