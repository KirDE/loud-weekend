# Ticket producer acceptance matrix (#434)

Snapshot: **2026-11-18T00:49:48Z**. This is a review/work ledger, not live inventory,
production source configuration, or release acceptance.

- Catalogue denominator: **59** public current-edition festival paths.
- Source-specific proposals: **26**, across open, unmerged branches.
- Current parser heads: **25** previously verified by full Quality and clean Codex;
  **1** (I-Days #495) revalidating an additional ancillary-product fix.
- **33** paths still have no verified source-specific proposal.
- Production acceptance/merges/deployments performed by this agent: **0**.
  The maintainer has separately merged #479; observed main is
  `23b79c46d8c9ac2599b84b40b3ff0e8622587759`. This does not merge/deploy ticket foundation #480.

The JSON companion records exact PR heads, test paths, original transport
observation times, scoped publication evidence and remaining work **for every
source**. A homepage HTTP 200 does not prove ticket availability. A source/fixture
proposal does not prove canonical publication or production delivery.

## Acceptance / release sequence

1. Keep #434 open. Accept and deploy #480's model foundation first, preserving the
   explicit sellout notification mapping and regression. Its old fixed inline
   review thread has now been replied to with evidence and resolved.
2. Integrate the focused #482 producer rollout onto that accepted/deployed main;
   rerun full Quality and Codex on the exact integrated head. Do not merge into a
   feature branch and describe it as a production deployment.
3. Do the same for source follow-ups. Current structural parents are #482 for
   #483–#487, #489–#494 and #496; #487 for #488 and #495. Do not blindly rebase
   before the required parent is accepted/deployed or inflate diffs with duplicate
   shared changes.
4. #497 depends on #488 and verifies the secondary ticket publisher. Impericon's
   source-shaped product/announcement envelope → parser → durable evidence →
   publication/readback/replay/rollback succeeds in disposable PostgreSQL. I-Days
   publisher-boundary success and rejection tests pass there too, but its active
   collector is a sibling in #495.
5. #498 composes that I-Days collector with #497 and adds offline HTTP
   fetchSource → parser → evaluateCandidate → durable evidence → combined/stock-only
   publication → canonical readback/replay/rollback. Its latest head fixes the
   review's ancillary Ticketmaster finding. Full CI is still pending at this
   snapshot; the new head has a completed clean Codex review. Do not count #495 and
   #498 as two festivals or apply their identical parser changes twice.
6. For the other proposed sources, finish source-specific canonical success,
   stale/invalid-proof rollback and idempotent replay checks. Preserve artist and
   provider guards; do not equate generic publisher tests with coverage of each
   new producer.
7. Complete the remaining 33 audits/implementations, explicitly retaining access
   failures, unsupported/ambiguous stock and last-good status. Hellfest mixed
   ticket tiers require coordination with #446, not a fabricated global sellout.
8. Maintainer acceptance and production deployment remain separate gates.
   This agent has no merge/deploy instruction. Once parents are accepted and
   deployed, rebase focused follow-ups and rerun exact-head gates before acceptance.

## Evidence levels

- `fixture_review_quality_verified`: parser proposal, not end-to-end acceptance.
- `new_head_revalidating`: known fix is pushed; do not inherit old-head CI.
- `offline_adapter_publication_replay_verified` and
  `offline_adapter_publication_replay_rollback_verified`: narrowly scoped
  disposable-DB evidence, not live transport/deployment.
- `collector_publication_integration_ci_pending`: new integrated suite exists,
  but is not a passing acceptance claim until the exact run succeeds.
- `pending_source_to_publication_acceptance`: explicit missing evidence.

## Per-source summary

| Source | Parser proposal | Canonical acceptance | Remaining work / limitation |
| --- | --- | --- | --- |
| 2000trees | Not verified | pending source to publication acceptance | Readability exposes older news, not reviewed current admission controls. |
| Alcatraz Open Air | Not verified | pending source to publication acceptance | Official tickets page reachable, but extraction does not expose verified current admission controls. |
| Alpen Flair | [#485](https://github.com/KirDE/loud-weekend/pull/485) · `9d63be8` | pending source to publication acceptance | Complete source-specific canonical acceptance where not listed, integrate only after parent acceptance/deployment, and rerun exact-head gates. |
| Barcelona Rock Fest | [#486](https://github.com/KirDE/loud-weekend/pull/486) · `0096af2` | pending source to publication acceptance | Complete source-specific canonical acceptance where not listed, integrate only after parent acceptance/deployment, and rerun exact-head gates. |
| Bloodstock Open Air | Not verified | pending source to publication acceptance | Homepage marketing is not current purchase inventory. |
| Brutal Assault | [#482](https://github.com/KirDE/loud-weekend/pull/482) · `69d15f0` | pending source to publication acceptance | Complete source-specific canonical acceptance where not listed, integrate only after parent acceptance/deployment, and rerun exact-head gates. |
| Copenhell | [#491](https://github.com/KirDE/loud-weekend/pull/491) · `1aa9245` | pending source to publication acceptance | Complete source-specific canonical acceptance where not listed, integrate only after parent acceptance/deployment, and rerun exact-head gates. |
| Download Festival | [#482](https://github.com/KirDE/loud-weekend/pull/482) · `69d15f0` | pending source to publication acceptance | Complete source-specific canonical acceptance where not listed, integrate only after parent acceptance/deployment, and rerun exact-head gates. |
| Dynamo Metal Fest | [#496](https://github.com/KirDE/loud-weekend/pull/496) · `803bdef` | pending source to publication acceptance | Complete source-specific canonical acceptance where not listed, integrate only after parent acceptance/deployment, and rerun exact-head gates. |
| Eurockéennes de Belfort | Not verified | pending source to publication acceptance | Existing parser has a synthetic priced-card positive case, but checked-in real homepage fixture has no current stock cards. Current source inventory proof still required. |
| Firenze Rocks | Not verified | pending source to publication acceptance | Source-specific current admission/stock producer and real-source fixture audit remain incomplete. HTTP success or a ticket URL alone is not inventory proof. |
| Frequency Festival | [#490](https://github.com/KirDE/loud-weekend/pull/490) · `8a368ab` | pending source to publication acceptance | Complete source-specific canonical acceptance where not listed, integrate only after parent acceptance/deployment, and rerun exact-head gates. |
| Full Force | Not verified | pending source to publication acceptance | Source-specific current admission/stock producer and real-source fixture audit remain incomplete. HTTP success or a ticket URL alone is not inventory proof. |
| Full Rewind | [#487](https://github.com/KirDE/loud-weekend/pull/487) · `276f51d` | pending source to publication acceptance | Complete source-specific canonical acceptance where not listed, integrate only after parent acceptance/deployment, and rerun exact-head gates. |
| Graspop Metal Meeting | Not verified | pending source to publication acceptance | Ticket page retains a dated sale-opening announcement already in the past; that is not current inventory. |
| Greenfield Festival | Not verified | pending source to publication acceptance | Readable FAQ is not current inventory. |
| Heavy Week-End | Not verified | pending source to publication acceptance | Source-specific current admission/stock producer and real-source fixture audit remain incomplete. HTTP success or a ticket URL alone is not inventory proof. |
| Hellfest Open Air | Not verified | pending source to publication acceptance | Four-day pass sold out, future one-day sale and resale coexist. Do not flatten tier stock into global sold_out/not_on_sale; coordinate tier model #446. |
| Hurricane Festival | Not verified | pending source to publication acceptance | Current-year on-sale news/price is not yet verified against actual current admission purchase controls. |
| I-Days Milano | [#495](https://github.com/KirDE/loud-weekend/pull/495) · `51083b5` | collector publication integration ci pending | Complete source-specific canonical acceptance where not listed, integrate only after parent acceptance/deployment, and rerun exact-head gates. |
| Impericon Festival | [#488](https://github.com/KirDE/loud-weekend/pull/488) · `818dfdf` | offline adapter publication replay rollback verified | Complete source-specific canonical acceptance where not listed, integrate only after parent acceptance/deployment, and rerun exact-head gates. |
| Inferno Metal Festival | [#482](https://github.com/KirDE/loud-weekend/pull/482) · `69d15f0` | pending source to publication acceptance | Complete source-specific canonical acceptance where not listed, integrate only after parent acceptance/deployment, and rerun exact-head gates. |
| Jera On Air | Not verified | pending source to publication acceptance | Current shop link exists; actual stock schema/product scopes not yet audited. |
| Leeds Festival | [#482](https://github.com/KirDE/loud-weekend/pull/482) · `69d15f0` | pending source to publication acceptance | Complete source-specific canonical acceptance where not listed, integrate only after parent acceptance/deployment, and rerun exact-head gates. |
| Leyendas del Rock | [#492](https://github.com/KirDE/loud-weekend/pull/492) · `a67aa9c` | pending source to publication acceptance | Complete source-specific canonical acceptance where not listed, integrate only after parent acceptance/deployment, and rerun exact-head gates. |
| Mad Cool Festival | Not verified | pending source to publication acceptance | Source-specific current admission/stock producer and real-source fixture audit remain incomplete. HTTP success or a ticket URL alone is not inventory proof. |
| Masters of Rock | [#484](https://github.com/KirDE/loud-weekend/pull/484) · `d158421` | pending source to publication acceptance | Complete source-specific canonical acceptance where not listed, integrate only after parent acceptance/deployment, and rerun exact-head gates. |
| M'era Luna Festival | Not verified | pending source to publication acceptance | Initial official source timed out; no inventory conclusion. |
| Midgardsblot Festival | Not verified | pending source to publication acceptance | Initial official source HTTP 403; no inventory conclusion. |
| Motocultor Festival | Not verified | pending source to publication acceptance | Ticket navigation without validated admission stock. |
| Mystic Festival | [#483](https://github.com/KirDE/loud-weekend/pull/483) · `738741f` | pending source to publication acceptance | Complete source-specific canonical acceptance where not listed, integrate only after parent acceptance/deployment, and rerun exact-head gates. |
| Nova Rock | [#482](https://github.com/KirDE/loud-weekend/pull/482) · `69d15f0` | pending source to publication acceptance | Complete source-specific canonical acceptance where not listed, integrate only after parent acceptance/deployment, and rerun exact-head gates. |
| Paléo Festival | [#482](https://github.com/KirDE/loud-weekend/pull/482) · `69d15f0` | pending source to publication acceptance | Complete source-specific canonical acceptance where not listed, integrate only after parent acceptance/deployment, and rerun exact-head gates. |
| Pinkpop | Not verified | pending source to publication acceptance | Source-specific current admission/stock producer and real-source fixture audit remain incomplete. HTTP success or a ticket URL alone is not inventory proof. |
| Pistoia Blues Festival | Not verified | pending source to publication acceptance | Source-specific current admission/stock producer and real-source fixture audit remain incomplete. HTTP success or a ticket URL alone is not inventory proof. |
| Pol'and'Rock Festival | Not verified | pending source to publication acceptance | Source-specific current admission/stock producer and real-source fixture audit remain incomplete. HTTP success or a ticket URL alone is not inventory proof. |
| Provinssi | Not verified | pending source to publication acceptance | Prior sale prose and future current-edition ticket gateway do not establish live Paylogic inventory. |
| Reading Festival | [#482](https://github.com/KirDE/loud-weekend/pull/482) · `69d15f0` | pending source to publication acceptance | Complete source-specific canonical acceptance where not listed, integrate only after parent acceptance/deployment, and rerun exact-head gates. |
| Resurrection Fest | Not verified | pending source to publication acceptance | Source-specific current admission/stock producer and real-source fixture audit remain incomplete. HTTP success or a ticket URL alone is not inventory proof. |
| Roadburn Festival | Not verified | pending source to publication acceptance | Current-looking sale prose links stale/offsale ticket landing; no available/sold_out inference. |
| Rock am Ring | Not verified | pending source to publication acceptance | Source-specific current admission/stock producer and real-source fixture audit remain incomplete. HTTP success or a ticket URL alone is not inventory proof. |
| Rock en Seine | Not verified | pending source to publication acceptance | Source-specific current admission/stock producer and real-source fixture audit remain incomplete. HTTP success or a ticket URL alone is not inventory proof. |
| Rock for People | Not verified | pending source to publication acceptance | Partial capacity sold and tier changes coexist with on-sale copy; source-specific admission control/stock proof still needed. |
| Rock im Park | Not verified | pending source to publication acceptance | Source-specific current admission/stock producer and real-source fixture audit remain incomplete. HTTP success or a ticket URL alone is not inventory proof. |
| Rock Imperium Festival | [#493](https://github.com/KirDE/loud-weekend/pull/493) · `0b01507` | pending source to publication acceptance | Complete source-specific canonical acceptance where not listed, integrate only after parent acceptance/deployment, and rerun exact-head gates. |
| Rock in Roma | Not verified | pending source to publication acceptance | Initial official source timed out; no inventory conclusion. |
| Rock The Lakes | Not verified | pending source to publication acceptance | Initial official source timed out; no inventory conclusion. |
| Rock Werchter | [#482](https://github.com/KirDE/loud-weekend/pull/482) · `69d15f0` | pending source to publication acceptance | Complete source-specific canonical acceptance where not listed, integrate only after parent acceptance/deployment, and rerun exact-head gates. |
| Rockharz Open Air | [#482](https://github.com/KirDE/loud-weekend/pull/482) · `69d15f0` | pending source to publication acceptance | Complete source-specific canonical acceptance where not listed, integrate only after parent acceptance/deployment, and rerun exact-head gates. |
| Rockstadt Extreme Fest | [#494](https://github.com/KirDE/loud-weekend/pull/494) · `d28a8a0` | pending source to publication acceptance | Complete source-specific canonical acceptance where not listed, integrate only after parent acceptance/deployment, and rerun exact-head gates. |
| Roskilde Festival | Not verified | pending source to publication acceptance | Later official /billetter request returned HTTP 403 Cloudflare; initial homepage 200 did not verify inventory. |
| Southside Festival | Not verified | pending source to publication acceptance | Readability exposes search chrome without inventory; treat as incomplete extraction, not a healthy stock check. |
| Summer Breeze Open Air | [#482](https://github.com/KirDE/loud-weekend/pull/482) · `69d15f0` | pending source to publication acceptance | Complete source-specific canonical acceptance where not listed, integrate only after parent acceptance/deployment, and rerun exact-head gates. |
| Sweden Rock Festival | [#482](https://github.com/KirDE/loud-weekend/pull/482) · `69d15f0` | pending source to publication acceptance | Complete source-specific canonical acceptance where not listed, integrate only after parent acceptance/deployment, and rerun exact-head gates. |
| Tolminator | Not verified | pending source to publication acceptance | Source-specific current admission/stock producer and real-source fixture audit remain incomplete. HTTP success or a ticket URL alone is not inventory proof. |
| Tons of Rock | Not verified | pending source to publication acceptance | Source-specific current admission/stock producer and real-source fixture audit remain incomplete. HTTP success or a ticket URL alone is not inventory proof. |
| Tuska Festival | [#482](https://github.com/KirDE/loud-weekend/pull/482) · `69d15f0` | pending source to publication acceptance | Complete source-specific canonical acceptance where not listed, integrate only after parent acceptance/deployment, and rerun exact-head gates. |
| Vainstream Rockfest | Not verified | pending source to publication acceptance | Current regular products coexist with sold-out early-bird tiers. Raw product stock/control proof not yet audited; no global sellout inference. |
| Wacken Open Air | [#482](https://github.com/KirDE/loud-weekend/pull/482) · `69d15f0` | offline adapter publication replay verified | Complete source-specific canonical acceptance where not listed, integrate only after parent acceptance/deployment, and rerun exact-head gates. |

## Historical snapshots

[#482's original matrix](https://github.com/KirDE/loud-weekend/blob/69d15f0745c2f761f8a68986d3c457e30ffab662/docs/ingestion/ticket-status-coverage.json)
was explicitly 13/59. [#489](https://github.com/KirDE/loud-weekend/pull/489)
is an **18/59 snapshot at 2026-11-17T23:48:00Z**, not a live total: 13 initial
paths plus Mystic, Masters, Alpen, Barcelona and Full Rewind. Its 59 unique
source rows and stated 18/41 proposal/pending counts were checked against that
dated scope. Later proposals must not retroactively make that dated file a
production statement. This matrix supplements, rather than rewrites, that record.
