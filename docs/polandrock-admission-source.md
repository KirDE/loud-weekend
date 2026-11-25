# Pol’and’Rock: independent admission-only observation

Depends on the explicit `free` domain/DB/UI model in PR #515. Does not migrate or configure any production source.

Reviewed endpoint: `https://newsroom.polandrockfestival.pl/` (ordinary anonymous GET). This is a separate admission source, **not** a transport fallback for `https://polandrockfestival.pl/`: homepage HTTP403 remains failure, and lineup freshness remains independently unresolved when that fetch fails.

An explicitly configured `polandrock` / `html_fallback` source at the exact newsroom root reads only the visible `div.pr-boiler-plate` paragraphs. It requires the festival-level “Festiwal jest darmowy i niebiletowany.” policy and exactly one future-tense current-edition date sentence. Archived edition dates coexist in the same paragraph; they do not become current dates. A new year is parsed dynamically but must match the configured edition. Missing/ambiguous policy, paid-policy contradictions, impossible dates, hidden/script-only content, changed markup and identity redirects fail closed. No inferred prices, inventory, lineup, completeness or camping/VIP purchase URL.

The canonical publisher binds source identity, edition, normalized candidate, timestamps and durable field/value evidence. Missing/tampered evidence or source changes reject atomically; stale ticket changes roll back. Existing artist fields are omitted, never cleared; no playlist/provider work is requested. Free admission retains the model’s truthful official-info CTA and emits no paid-ticket sale notification.

Live receipt on 22-Nov-2026: one GET, HTTP200, explicit free/unticketed admission for edition33, 29–31July2027, no warnings. This is proposed source support, not deployed/accepted coverage. Enabling an additional source must preserve the existing roster source rather than replacing it.

Tests: minimal contact-free markup fixture, guarded extraction/transport tests, and catalog publication DB chain including public readback, no-op/replay, missing/source/time/value/edition/source-stripping drift, and stale-write rollback.
