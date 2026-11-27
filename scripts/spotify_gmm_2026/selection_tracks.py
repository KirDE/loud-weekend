"""Read-only selection from hydrated provider metadata using shared festival rules."""

from __future__ import annotations
import re
from track_policy import (
    validate_track_policy,
    looks_like_tribute,
    canonical_track_key,
    should_skip_track_for_artist,
    is_short_or_non_song,
    track_version_penalty,
    is_feat_track,
)
from spotify_repertoire import validate_profile, eligible_track

ID = re.compile(r"^[A-Za-z0-9]{22}$")
TRACKS_PER_ARTIST = {"quick": 1, "preview": 4, "deep": 8}


def select_selection_tracks(value):
    rows = value.get("artists") if isinstance(value, dict) else None
    if not isinstance(rows, list) or len(rows) > 250:
        raise ValueError("Invalid bounded selection")
    depth = value.get("depth", "quick")
    if not isinstance(depth, str) or depth not in TRACKS_PER_ARTIST:
        raise ValueError("Invalid playlist depth")
    ranked_artists = []
    for row in rows:
        if (
            not isinstance(row, dict)
            or not isinstance(row.get("requestedName"), str)
            or not isinstance(row.get("name"), str)
        ):
            raise ValueError("Invalid canonical selection artist")
        requested, name = row["requestedName"], row["name"]
        tracks = row.get("tracks")
        if not isinstance(tracks, list) or len(tracks) > 1500:
            raise ValueError("Invalid bounded track pool")
        profile = row.get("repertoire")
        identity = row.get("spotifyId")
        if profile is not None:
            validate_profile(profile)
            if row.get("slug") not in profile["artistSlugs"]:
                raise ValueError("Mismatched repertoire binding")
        elif identity is not None and not ID.fullmatch(str(identity)):
            raise ValueError("Invalid reviewed artist identity")
        policy = validate_track_policy(row.get("trackPolicy"))
        if (
            policy.get("excluded")
            or looks_like_tribute(
                name, reviewed_identity=(
                    bool(policy.get("reviewedOriginal")) or profile is not None or identity is not None
                )
            )
            or (profile is None and identity is None)
        ):
            ranked_artists.append((requested, []))
            continue
        eligible = []
        for track in tracks:
            if (
                not isinstance(track, dict)
                or not ID.fullmatch(str(track.get("id", "")))
                or track.get("uri") != "spotify:track:" + track["id"]
                or not isinstance(track.get("name"), str)
                or type(track.get("duration_ms")) is not int
            ):
                raise ValueError("Invalid hydrated Spotify track")
            artists = track.get("artists")
            if (
                not isinstance(artists, list)
                or not artists
                or any(
                    not isinstance(a, dict)
                    or not ID.fullmatch(str(a.get("id", "")))
                    or not isinstance(a.get("name"), str)
                    for a in artists
                )
            ):
                raise ValueError("Invalid hydrated track credits")
            if any(
                key in track and type(track[key]) is not bool for key in ("is_playable", "is_local")
            ):
                raise ValueError("Invalid track playback flags")
            if track.get("is_playable") is False or track.get("is_local") is True:
                continue
            if profile is not None:
                reviewed = {a["id"] for a in profile["searchArtists"]}
                if (
                    artists[0]["id"] not in reviewed
                    or not eligible_track(profile, track)
                    or is_short_or_non_song(track)
                    or track_version_penalty(track) >= 2
                    or should_skip_track_for_artist(
                        name, track, verified_primary_artist_id=artists[0]["id"],
                        track_policy=policy or None
                    )
                ):
                    continue
            elif artists[0]["id"] != identity or should_skip_track_for_artist(
                name, track, name, verified_primary_artist_id=identity, track_policy=policy or None
            ):
                continue
            eligible.append(track)
        # Same ordinary fallback priorities as the festival planner, after the
        # exact canonical-ID / reviewed-repertoire eligibility gate.
        eligible.sort(
            key=lambda t: (
                is_feat_track(t),
                track_version_penalty(t),
                -t.get("popularity", 0),
                t["name"],
                t["id"],
            )
        )
        ranked_artists.append((requested, eligible))

    selected, seen_uris, seen_songs = [], set(), set()
    represented = set()
    # Fill each artist's first slot before adding depth. Later rounds therefore
    # cannot take another artist's only eligible version of a shared song.
    for _ in range(TRACKS_PER_ARTIST[depth]):
        for index, (requested, tracks) in enumerate(ranked_artists):
            for track in tracks:
                song = canonical_track_key(track["name"])
                if track["uri"] in seen_uris or song in seen_songs:
                    continue
                seen_uris.add(track["uri"])
                seen_songs.add(song)
                represented.add(index)
                selected.append({"artist": requested, "uri": track["uri"]})
                break
    unresolved = [
        requested for index, (requested, _) in enumerate(ranked_artists)
        if index not in represented
    ]
    return {"selected": selected, "unresolved": unresolved}
