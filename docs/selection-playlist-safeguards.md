# Verified user-selection playlists (#423)

The request still supplies selected display labels for compatibility, but those
labels are resolved against canonical Artist names/aliases. Multiple canonical
matches stay unresolved. A LINKED flag alone is insufficient: the existing
verifiedSpotifyArtistId requires a unique provider identity and agreeing verified
Spotify link. Explicit reviewed repertoire bindings are loaded through the same
database validator used by the festival engine; invalid bindings fail closed.

There is no Spotify search-by-display-name fallback. Ordinary candidates come
from the pinned artist's top tracks and must credit that exact ID as primary.
Composite live acts additionally use their reviewed participant top tracks and
reviewed album tracklists, hydrate full track credits, and apply the existing
eligible_track anchor/release/collaboration policy with a reviewed primary ID.
Unrelated solo/other-project repertoires are not fallback identities.

track_policy.py contains the existing pure festival name, primary/family,
duration, version and canonical-song safeguards. festival_playlists imports the
same functions rather than maintaining a copied Node policy. The selection RPC
imports only pure modules, accepts hydrated public track metadata via stdin and
returns one eligible URI per deduplicated canonical act. It performs no network,
provider writes, cache/report files or live setlist.fm lookup. Ordinary selection
uses eligible top tracks; it does not claim fresh setlist enrichment. Composite
release scoping and global URI/canonical-song dedup are shared safeguards, not an
identity merge.

The existing bounded JSON IPC (PLAYLIST_PYTHON, default python3) is reused. No
tokens are sent to Python; Spotify reads and final playlist writes stay in the
authenticated request using the user's token. Discovery/validation finishes
before a playlist is created. Missing/ambiguous identities stay in unresolved;
zero eligible tracks, provider/schema or policy failure creates no empty
playlist. The saved local selection/export fallback is unchanged.

Verification uses synthetic provider responses plus real policy RPC, disposable
PostgreSQL identity/link/binding tests, existing festival filter/repertoire tests
and the full Quality workflow. The new data test is .mjs to match repository
conventions and is automatically picked up by test:data; the prior .ts test file
is replaced, not run twice. The canonical DB suite is explicitly included in the
existing test:catalog-db command. No new workflow/runtime service is introduced.
