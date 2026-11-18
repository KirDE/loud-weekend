"""Read-only selection from hydrated provider metadata using shared festival rules."""
from __future__ import annotations
import re
from track_policy import (GLOBAL_EXCLUDES, looks_like_tribute, canonical_track_key,
    should_skip_track_for_artist, is_short_or_non_song, track_version_penalty, is_feat_track)
from spotify_repertoire import validate_profile, eligible_track

ID=re.compile(r'^[A-Za-z0-9]{22}$')

def select_selection_tracks(value):
    rows=value.get('artists') if isinstance(value,dict) else None
    if not isinstance(rows,list) or len(rows)>250:
        raise ValueError('Invalid bounded selection')
    selected,unresolved,seen_uris,seen_songs=[],[],set(),set()
    for row in rows:
        if not isinstance(row,dict) or not isinstance(row.get('requestedName'),str) or not isinstance(row.get('name'),str):
            raise ValueError('Invalid canonical selection artist')
        requested,name=row['requestedName'],row['name']
        tracks=row.get('tracks')
        if not isinstance(tracks,list) or len(tracks)>1500:
            raise ValueError('Invalid bounded track pool')
        profile=row.get('repertoire')
        identity=row.get('spotifyId')
        if profile is not None:
            validate_profile(profile)
            if row.get('slug') not in profile['artistSlugs']:
                raise ValueError('Mismatched repertoire binding')
        elif identity is not None and not ID.fullmatch(str(identity)):
            raise ValueError('Invalid reviewed artist identity')
        if name in GLOBAL_EXCLUDES or looks_like_tribute(name) or (profile is None and identity is None):
            unresolved.append(requested)
            continue
        eligible=[]
        for track in tracks:
            if not isinstance(track,dict) or not ID.fullmatch(str(track.get('id',''))) or track.get('uri')!='spotify:track:'+track['id'] or not isinstance(track.get('name'),str) or type(track.get('duration_ms')) is not int:
                raise ValueError('Invalid hydrated Spotify track')
            artists=track.get('artists')
            if not isinstance(artists,list) or not artists or any(not isinstance(a,dict) or not ID.fullmatch(str(a.get('id',''))) or not isinstance(a.get('name'),str) for a in artists):
                raise ValueError('Invalid hydrated track credits')
            if any(key in track and type(track[key]) is not bool for key in ('is_playable','is_local')):
                raise ValueError('Invalid track playback flags')
            if track.get('is_playable') is False or track.get('is_local') is True:
                continue
            if profile is not None:
                reviewed={a['id'] for a in profile['searchArtists']}
                if artists[0]['id'] not in reviewed or not eligible_track(profile,track) or is_short_or_non_song(track) or track_version_penalty(track)>=2:
                    continue
            elif artists[0]['id']!=identity or should_skip_track_for_artist(name,track,name):
                continue
            eligible.append(track)
        # Same ordinary fallback priorities as the festival planner, after the
        # exact canonical-ID / reviewed-repertoire eligibility gate.
        eligible.sort(key=lambda t:(is_feat_track(t),track_version_penalty(t),-t.get('popularity',0),t['name'],t['id']))
        chosen=next((t for t in eligible if t['uri'] not in seen_uris and canonical_track_key(t['name']) not in seen_songs),None)
        if chosen is None:
            unresolved.append(requested)
            continue
        seen_uris.add(chosen['uri']);seen_songs.add(canonical_track_key(chosen['name']))
        selected.append({'artist':requested,'uri':chosen['uri']})
    return {'selected':selected,'unresolved':unresolved}
