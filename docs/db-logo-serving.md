# Database logo serving

`/logos/[filename]` validates the filename and serves the reviewed LogoAsset row
and stored bytes. It enforces MIME/size bounds and returns a byte-derived ETag.
A missing logo returns404 and a database failure returns503. The UI renders
initials without trying a static file, so outages do not resurrect stale assets.
Publication and logo provenance remain distinct from retrieval. Keep current
route, ETag, fallback-initials and database validation tests in the release suite.
