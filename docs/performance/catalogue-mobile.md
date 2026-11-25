# Mobile catalogue benchmark

The catalogue still searches and filters the entire result set. Rendering the first 48 cards and progressively revealing further matches bounds initial document size and avoids reconciling hundreds of cards on each search keystroke.

## Reproduce locally

1. Use the pinned Node version and a freshly migrated, loopback-only PostgreSQL database named `loud_weekend_475_mobile_test`. Run `node --import tsx tests/support/seed-large-catalogue.mjs` against that database. This adds 550 synthetic festivals, 1,650 synthetic editions and 3,500 synthetic artist profiles after the migrations' single initial festival.
2. Build the baseline (`8958015`) and this branch independently with `next build --webpack`. Copy `.next/static` and `public` into the corresponding standalone server outputs (under `.next/standalone/.next/static` and `.next/standalone/public`). Start both servers on different loopback ports against the same fixture. Use a disposable auth secret, no analytics endpoint and no production provider configuration.
3. With the repository's Playwright Chromium installed, run `node scripts/benchmark-mobile-catalogue.mjs http://127.0.0.1:3280 http://127.0.0.1:3281`. Use the baseline URL first. The benchmark alternates three cold-browser runs per build at 390×844, 4× CPU slowdown, 150 ms latency and 1.6 Mbit/s down. Third-party requests and service workers are disabled.

## Observed medians

| Measure                          |  Baseline | Candidate |
| -------------------------------- | --------: | --------: |
| Initially rendered cards         |       551 |        48 |
| LCP                              |  1,244 ms |    780 ms |
| CLS                              |         0 |         0 |
| TTFB                             |    363 ms |    390 ms |
| Compressed navigation HTML       |  48,800 B |  32,860 B |
| Compressed requested JavaScript  | 155,755 B | 162,484 B |
| Type query to one matching card  |  5,558 ms |  1,080 ms |
| Longest recorded lab interaction |    920 ms |    152 ms |

The candidate includes the catalogue projection change. These are local lab measurements, not Lighthouse scores or field INP. The typing measurement includes Playwright input and final DOM observation; the interaction measurement is the maximum observed Event Timing duration for this specific journey. The benchmark also checks `private, no-store`, full-catalogue search and document overflow. The browser suite separately verifies opening the next results, keyboard focus and comparison preservation.
