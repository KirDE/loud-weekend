# Heavy Week-End reviewed visual billing

The 2027 official Slash card shortens its title/H1 to `SLASH` while its primary
logo explicitly credits `SLASH FEAT. MYLES KENNEDY AND THE CONSPIRATORS`.
This is the same composite act already reviewed in the catalogue.

Evidence verified on 2026-11-17:
- Card: https://www.heavyweekend.live/line-up/slash
- Logo: https://cdn.prod.website-files.com/6adcd5c463377230851d43a0/6aede9451ed7244daeb0d1b4_band-SLASH.png
- Image SHA-256: `1247a61e292d2dbaa0641d077d42016f68d359173e382259ab71e5c51418a0b8`
- Fixture: `tests/fixtures/official-markup/heavy-slash-logo.png` (13,453 bytes).

The adapter records one reviewed visual identity, not a festival bill. It does
not interpret the biography, image filename, pixels, or OCR at runtime. Each
fetch re-downloads the fixed HTTPS asset with redirects rejected and a 256 KB
body limit. The parser independently requires the current edition, consistent
title/H1, primary logo element, exact asset URL and verified bytes digest.
Changed/missing evidence or a new edition retains review instead of emitting a
standalone Slash or silently reusing an old approval. The excerpt retains the
asset URL and digest for audit. Revalidation requires inspecting the new
current official visual and reviewing an explicit registry update.

Other and future artist cards remain dynamic. New artists retain ordinary
provider review, announcements are additive, and absent names never remove
reviewed catalogue entries. No catalogue/provider writes are performed by this
adapter. Historical release vocabulary is intentionally irrelevant to billing.
