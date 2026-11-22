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

| Festival | Rollout state | Fixture-verified ticket states |
| --- | --- | --- |
| 2000trees | pending_audit | Not yet audited |
| Alcatraz Open Air | pending_audit | Not yet audited |
| Alpen Flair | pending_audit | Not yet audited |
| Barcelona Rock Fest | pending_audit | Not yet audited |
| Bloodstock Open Air | pending_audit | Not yet audited |
| Brutal Assault | updated_fixture_verified | available, sold_out, unavailable |
| Copenhell | pending_audit | Not yet audited |
| Download Festival | updated_fixture_verified | available |
| Dynamo Metal Fest | pending_audit | Not yet audited |
| Eurockéennes de Belfort | pending_audit | Not yet audited |
| Firenze Rocks | pending_audit | Not yet audited |
| Frequency Festival | pending_audit | Not yet audited |
| Full Force | pending_audit | Not yet audited |
| Full Rewind | pending_audit | Not yet audited |
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
| Masters of Rock | pending_audit | Not yet audited |
| M'era Luna Festival | pending_audit | Not yet audited |
| Midgardsblot Festival | pending_audit | Not yet audited |
| Motocultor Festival | pending_audit | Not yet audited |
| Mystic Festival | pending_audit | Not yet audited |
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
