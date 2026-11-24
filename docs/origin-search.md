# City and postal-code origin search

The trip origin picker searches a site-local PostgreSQL gazetteer. It does
not request the device's location or send the input to a geocoding provider.
A search is sent to the site only when submitted; it is not added to a
share URL. Selecting a result saves the public location centroid with
discovery preferences. Calculated distances are straight-line.

Use country-level place and postal extracts from
[GeoNames](https://www.geonames.org/export/), licensed CC BY 4.0. Download and
extract official files separately; do not commit the archives. Use only
published city/postal centroids, not personal addresses. Preview validation:

```sh
node scripts/import-origin-gazetteer.mjs --country=DE --places=DE.txt --postal=DE-postal.txt
```

On an approved catalogue deployment, apply the additive migration first,
then append `--apply` with the intended DATABASE_URL. A country refresh
replaces its previous generation atomically; malformed or empty input
rolls back. Repeat for supported countries and verify at least a city,
a small town, a postal code, a non-match, and local request privacy for
each deployment. Some postal codes are unavailable or approximate in
the public GeoNames data. The five existing origins work without an import.
