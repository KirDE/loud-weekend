from __future__ import annotations

import json
import re
import time
import unicodedata
from pathlib import Path

from festival_playlists import (
    canonical_track_key,
    is_feat_track,
    should_skip_track_for_artist,
    simplify_name,
    token_overlap,
    track_version_penalty,
)

SEARCH_CACHE_VERSION = 'ytm-transfer-v2'
YOUTUBE_VERSION_HINTS = {
    'club',
    'demo',
    'dub',
    'english',
    'medieval techno',
    'mix',
    'rework',
    'sample',
}
DATA_API_REASON_PATTERN = re.compile(r'[^a-z0-9]+')


class YouTubeDataApiError(RuntimeError):
    def __init__(self, status_code: int, reason: str = 'unknown'):
        normalized_reason = DATA_API_REASON_PATTERN.sub('_', str(reason).casefold()).strip('_') or 'unknown'
        self.status_code = status_code
        self.reason = normalized_reason
        super().__init__(f'YouTube Data API failure: status={status_code} reason={normalized_reason}')


def raise_youtube_data_api_error(response, data: dict) -> None:
    error = data.get('error', {}) if isinstance(data, dict) else {}
    details = error.get('errors', []) if isinstance(error, dict) else []
    reason = details[0].get('reason') if details and isinstance(details[0], dict) else 'unknown'
    raise YouTubeDataApiError(response.status_code, reason)


def parse_report_tracks(report: dict) -> list[dict]:
    tracks = []
    seen = set()
    for entry in report.get('report', []):
        lineup_artist = entry.get('artist') or entry.get('query_artist') or ''
        query_artist = entry.get('query_artist') or lineup_artist
        for label in entry.get('tracks', []):
            if ' - ' not in label:
                continue
            artist, title = label.split(' - ', 1)
            key = (simplify_name(artist), canonical_track_key(title))
            if key in seen:
                continue
            seen.add(key)
            tracks.append({
                'lineup_artist': lineup_artist,
                'query_artist': query_artist,
                'artist': artist,
                'title': title,
                'label': label,
            })
    return tracks


def youtube_candidate_to_track(candidate: dict) -> dict:
    return {
        'name': candidate.get('title') or '',
        'artists': [{'name': artist.get('name') or ''} for artist in candidate.get('artists', [])],
        'duration_ms': int(candidate.get('duration_seconds') or 0) * 1000,
    }


def version_hint_text(text: str) -> str:
    lowered = unicodedata.normalize('NFKD', text.lower()).encode('ascii', 'ignore').decode('ascii')
    lowered = re.sub(r'[^a-z0-9]+', ' ', lowered)
    return ' '.join(lowered.split())


def youtube_version_penalty(query_title: str, candidate_title: str) -> int:
    query_key = version_hint_text(query_title)
    title_key = version_hint_text(candidate_title)
    return sum(1 for hint in YOUTUBE_VERSION_HINTS if hint in title_key and hint not in query_key)


def youtube_candidate_score(query: dict, candidate: dict) -> tuple | None:
    video_id = candidate.get('videoId')
    if not video_id:
        return None

    track = youtube_candidate_to_track(candidate)
    skip_reason = should_skip_track_for_artist(query['query_artist'], track, query['lineup_artist'])
    if skip_reason:
        return None
    if youtube_version_penalty(query['title'], candidate.get('title') or '') > 0:
        return None

    artist_names = [artist['name'] for artist in track.get('artists', []) if artist.get('name')]
    artist_score = max(token_overlap(query['artist'], artist) for artist in artist_names) if artist_names else 0.0
    if simplify_name(query['artist']) in [simplify_name(artist) for artist in artist_names]:
        artist_score += 1.0

    target_key = canonical_track_key(query['title'])
    title_key = canonical_track_key(candidate.get('title') or '')
    title_score = 1.0 if title_key == target_key else token_overlap(query['title'], candidate.get('title') or '')
    if title_score < 0.45:
        return None

    return (
        artist_score,
        title_score,
        candidate.get('resultType') == 'song',
        not is_feat_track(track),
        -track_version_penalty(track),
        int(candidate.get('duration_seconds') or 0),
    )


def load_json(path: Path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding='utf-8'))


def save_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')


def load_ytmusic():
    from ytmusicapi import YTMusic

    # Search is a public YouTube Music operation. The OAuth token used for
    # playlist writes is intentionally scoped to the YouTube Data API and can
    # be rejected by YouTube Music's private search endpoint. Keep discovery
    # unauthenticated and use the protected OAuth files only in the explicit
    # Data API write/read-back helpers below.
    return YTMusic()


def youtube_data_api_headers(credentials_path: Path, oauth_path: Path) -> dict[str, str]:
    from ytmusicapi.auth.oauth.credentials import OAuthCredentials

    credentials = load_json(credentials_path, {})
    token_path = Path(oauth_path)
    token = load_json(token_path, {})
    if token.get('expires_at', 0) - int(time.time()) < 60:
        oauth_credentials = OAuthCredentials(credentials['client_id'], credentials['client_secret'])
        fresh = oauth_credentials.refresh_token(token['refresh_token'])
        token.update({
            'access_token': fresh['access_token'],
            'expires_at': int(time.time()) + fresh['expires_in'],
            'expires_in': fresh['expires_in'],
        })
        save_json(token_path, token)
        token_path.chmod(0o600)
    return {
        'Authorization': f"Bearer {token['access_token']}",
        'Accept': 'application/json',
    }


def classify_search_exception(exc: Exception) -> str:
    response = getattr(exc, 'response', None)
    status_code = getattr(response, 'status_code', None)
    normalized = str(exc).casefold()
    if status_code == 429 or 'quota' in normalized or 'rate limit' in normalized:
        return 'quota'
    if status_code in (401, 403) or any(marker in normalized for marker in ('auth', 'unauthorized', 'invalid_grant', 'access token')):
        return 'authentication'
    return 'provider'


def search_youtube_track(ytmusic, query: dict, cache: dict, *, pause_seconds: float = 0.0, stats: dict | None = None) -> dict | None:
    stats = stats if stats is not None else {}
    stats['queries'] = stats.get('queries', 0) + 1
    cache_key = f"{SEARCH_CACHE_VERSION}:{query['artist']} - {query['title']}"
    cached = cache.get(cache_key)
    if cached is not None:
        stats['cache_hits'] = stats.get('cache_hits', 0) + 1
        return cached or None

    results = []
    for search_filter in ('songs', 'videos'):
        try:
            results.extend(ytmusic.search(f"{query['artist']} {query['title']}", filter=search_filter, limit=10))
        except Exception as exc:
            category = classify_search_exception(exc)
            key = f'{category}_errors'
            stats[key] = stats.get(key, 0) + 1
            continue
        if results:
            break
    if not results:
        stats['empty_results'] = stats.get('empty_results', 0) + 1
        return None

    best = None
    best_score = None
    seen_video_ids = set()
    for candidate in results:
        video_id = candidate.get('videoId')
        if not video_id or video_id in seen_video_ids:
            continue
        seen_video_ids.add(video_id)
        score = youtube_candidate_score(query, candidate)
        if score is None:
            continue
        if best_score is None or score > best_score:
            best_score = score
            best = candidate

    cache[cache_key] = best or {}
    if best is None:
        stats['rejected_results'] = stats.get('rejected_results', 0) + 1
    else:
        stats['matched'] = stats.get('matched', 0) + 1
    if pause_seconds:
        time.sleep(pause_seconds)
    return best
