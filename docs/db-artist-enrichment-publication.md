# Artist enrichment publication

Enrichment evidence, provider cache, work progress and publication receipts live
in OperationalState. Each invocation validates the current checkpoint rather than
converting historical formats. Imported provenance is retained as
`importedEvidence: {hash, evidence}` and is validated before publication; it never
authorizes a provider identity or bypasses review on its own.

A leased publisher verifies canonical names, bounded provider searches, cross-
provider identity evidence and policy before updating profiles. Homonyms and
incomplete searches stay in review. Result/cache/provenance hashes invalidate a
previous receipt when evidence changes. Resuming work retains completed profiles
and unfinished reviews rather than starting a new batch.

Bounds:1000 profile/review entries,10MB serialized evidence, bounded object depth
and string length; credential-bearing evidence is refused without being echoed.
Tests cover current identity resolution, evidence integrity, lease fencing,
idempotent publication and restart behavior. Schema-history data normalization is
not a runtime compatibility layer or recurring transition test.
