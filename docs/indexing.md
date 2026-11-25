# Sitemap and indexing checks

`npm run test:routes` runs a production-build smoke test against the seeded
database. After an approved release, run `node scripts/check-indexing.mjs`
from an installed checkout to check the public site without credentials. It
checks the default robots group and sitemap reference, XML structure, unique
canonical URLs in supported public route classes, non-future modification
dates, and reciprocal EN/DE/RU
alternatives. It checks Googlebot and Bingbot access to every URL in the
sitemap against the fetched robots.txt rules, but requests HTML only for a
bounded sample. The HTML request uses Next.js's non-streaming metadata mode
and checks that canonical and hreflang links are in the document head. A
redirect, error document or incomplete response is a
failed check, not evidence that indexing is healthy. Update the checker when
intentionally adding a new sitemap route class.

`lastmod` comes from published changes to fields shown on the corresponding
page, or the persisted edition snapshot shown on an edition dossier. Directory
and artist-appearance dates reflect their currently displayed records and
relevant fields only. The edition ledger does not identify removed directory
members, individual lineup additions/removals, or all artist-only changes:
those events are not reconstructed from observation times, imports, or generic
database timestamps. Pages without supporting modification evidence omit
`lastmod`. Source checks and the time a sitemap was generated are not updates.

## Search engine checks (verified property owner)

1. Run the HTTP check before using a webmaster console. If it fails after an
   approved release, compare with the previous release and fix or roll back the
   sitemap/metadata change before asking search engines to recrawl.
2. In [Google Search Console](https://support.google.com/webmasters/answer/7451001),
   choose the verified property and inspect the sitemap's status and discovered
   URL count. Use [URL Inspection](https://support.google.com/webmasters/answer/9012289)
   on one festival and artist per locale and one archived edition. Compare the
   declared and Google-selected canonical, the last crawl and indexing state.
3. In Bing Webmaster Tools, check the submitted sitemap's status and use
   [URL Inspection](https://www.bing.com/webmasters/help/url-inspection-55a30305)
   for the same sample. Compare the indexed result with the live test.
4. Track release and crawl dates, sitemap status, and unexpected changes in
   discovered and indexed counts. Investigate persistent drops, wrong
   canonicals, failed crawls and blocked URLs rather than treating a newly
   published URL's initial indexing delay as an incident.

The HTTP check does not assert that a search engine has indexed any page.
Credentials are needed only in the consoles, not in the app or CI.
