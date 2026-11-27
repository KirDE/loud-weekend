"""Shared pure artist/track safeguards for festival and user-selection playlists."""

from __future__ import annotations
import re
from collections import Counter
import unicodedata
from html import unescape

KEYWORDS_EXCLUDE = ["dj ", " karaoke", " tribute", " cover band", " aftershow", " party set"]

TRIBUTE_NAME_HINTS = {"again", "not", "attack"}

MIN_TRACK_MS = 90_000
NON_SONG_TITLE_HINTS = {"intro", "outro", "interlude", "overture"}
BAD_VERSION_DESCRIPTOR_HINTS = {
    "karaoke",
    "orchestral",
    "piano",
    "unplugged",
}
FEATURE_CLAUSE_RE = re.compile(r"(?:[-(\[]\s*)?\b(feat|featuring|ft)\b.*$", re.I)

def validate_track_policy(value):
    if value is None:
        return {}
    fields = {"schemaVersion", "excluded", "reviewedOriginal", "blockedPrimaryNames", "blockedVersionHints"}
    if not isinstance(value, dict) or set(value) - {"strictPrimary"} != fields:
        raise ValueError("Invalid track policy")
    if type(value["schemaVersion"]) is not int or value["schemaVersion"] != 1:
        raise ValueError("Invalid track policy version")
    if any(type(value[k]) is not bool for k in ("excluded", "reviewedOriginal")):
        raise ValueError("Invalid track policy flags")
    if "strictPrimary" in value and type(value["strictPrimary"]) is not bool:
        raise ValueError("Invalid strict primary policy")
    for field in ("blockedPrimaryNames", "blockedVersionHints"):
        values = value[field]
        if not isinstance(values, list) or len(values) > 100 or any(
            not isinstance(v, str) or not v.strip() or len(v) > 200 for v in values
        ):
            raise ValueError("Invalid track policy restrictions")
    return value


def clean_name(text: str) -> str:
    text = unescape(text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = " ".join(text.split())
    text = re.sub(r"^(first time\s+)", "", text, flags=re.I)
    text = re.sub(r"\s+Multiple Performances.*$", "", text, flags=re.I)
    text = re.sub(r"\s+(Thursday|Friday|Saturday|Sunday|Monday)\s+•.*$", "", text, flags=re.I)
    return text.strip(" •-")


def simplify_name(name: str) -> str:
    lowered = name.lower()
    lowered = unescape(lowered)
    lowered = lowered.translate(
        str.maketrans({"ø": "o", "æ": "ae", "œ": "oe", "å": "a", "ö": "o", "ä": "a", "ü": "u"})
    )
    lowered = unicodedata.normalize("NFKD", lowered).encode("ascii", "ignore").decode("ascii")
    lowered = lowered.replace("&", " and ")
    lowered = re.sub(r"\([^)]*\)", " ", lowered)
    lowered = re.sub(r"\[[^\]]*\]", " ", lowered)
    lowered = re.sub(r"[^a-z0-9]+", " ", lowered)
    lowered = re.sub(
        r"\b(the|a|an|of|and|feat|featuring|with|official|band)\b", " ", lowered
    )
    return " ".join(lowered.split())


def token_overlap(a: str, b: str) -> float:
    sa = set(simplify_name(a).split())
    sb = set(simplify_name(b).split())
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / max(len(sa), len(sb))


def setlist_lookup_name(name: str) -> str:
    return FEATURE_CLAUSE_RE.sub("", name).strip() or name


def looks_like_tribute(name: str, *, reviewed_identity: bool = False) -> bool:
    lowered = name.lower()
    if any(
        keyword in (" " + lowered if reviewed_identity else lowered) for keyword in KEYWORDS_EXCLUDE
    ):
        return True
    # Canonical reviewed identity outranks ambiguous name hints. Explicit
    # tribute/cover/karaoke/DJ labels and curated exclusions remain separate.
    if reviewed_identity:
        return False
    tokens = set(simplify_name(name).split())
    return len(tokens) <= 3 and bool(tokens & TRIBUTE_NAME_HINTS)


def canonical_track_key(name: str) -> str:
    name = FEATURE_CLAUSE_RE.sub("", name).strip()
    name = re.sub(r"\s*(?:[-(\[]\s*)?(?:\d{4}\s+)?remaster(?:ed)?\s*[)\]]?$", "", name, flags=re.I)
    simplified = simplify_name(name)
    if simplified:
        return simplified

    lowered = unicodedata.normalize("NFKC", name.lower())
    lowered = re.sub(r"[^\w]+", " ", lowered, flags=re.UNICODE)
    return " ".join(lowered.split())


def is_feat_track(track: dict) -> bool:
    title = (track.get("name") or "").lower()
    return any(token in title for token in [" feat.", " featuring ", " ft. ", "(feat", "[feat"])


def is_short_or_non_song(track: dict) -> bool:
    duration = track.get("duration_ms") or 0
    if duration < MIN_TRACK_MS:
        return True
    title = (track.get("name") or "").lower()
    return any(
        re.search(rf"(^|[\s(:\[-]){re.escape(hint)}($|[\s:)\]-])", title)
        for hint in NON_SONG_TITLE_HINTS
    )


def track_version_penalty(track: dict) -> int:
    title = (track.get("name") or "").lower()
    penalty = 0
    if re.search(r"(\(|\[|-)\s*live\b|\blive\s+(at|from|in|on)\b", title):
        penalty += 2
    if re.search(r"\b(remix|acoustic|instrumental|cover)\b", title):
        penalty += 2
    if re.search(r"(\(|\[|-)\s*(radio\s+)?edit\b", title):
        penalty += 2
    if re.search(r"(\(|\[|-)\s*(radio|extended|reworked)\s+version\b", title):
        penalty += 2
    if "version" in title and any(hint in title for hint in BAD_VERSION_DESCRIPTOR_HINTS):
        penalty += 2
    return penalty


def accepted_credit_key(name: str) -> str:
    # Match the global ownership fence: punctuation and word order stay significant.
    return unicodedata.normalize("NFKC", name).strip().lower()


def identity_words(name: str) -> tuple[str, ...]:
    normalized = unicodedata.normalize("NFKC", unescape(name)).casefold().replace("&", " and ")
    return tuple(re.findall(r"[^\W_]+", normalized))


def identity_tokens(name: str) -> Counter:
    return Counter(identity_words(name))


def primary_artist_matches_query(query_artist: str, track: dict) -> bool:
    primary_artist = track["artists"][0]["name"] if track.get("artists") else ""
    query_base = setlist_lookup_name(query_artist)
    query_tokens = simplify_name(query_base).split()
    primary_tokens = simplify_name(primary_artist).split()
    if len(query_tokens) == 1 and len(primary_tokens) > 1 and query_tokens[0] != primary_tokens[0]:
        return False
    # Containment in another artist name is not identity evidence.
    # Resolve reviewed aliases through query_base before applying this guard.
    query_identity = identity_tokens(query_base)
    primary_identity = identity_tokens(primary_artist)
    if query_identity < primary_identity or primary_identity < query_identity:
        return False
    overlap = token_overlap(query_base, primary_artist)
    if len(query_tokens) > 1 and len(primary_tokens) > 1 and overlap <= 0.5:
        return False
    return overlap >= 0.45


def should_skip_track_for_artist(
    query_artist: str,
    track: dict,
    lineup_artist: str | None = None,
    *,
    verified_primary_artist_id: str | None = None,
    accepted_primary_names: tuple[str, ...] = (),
    track_policy: dict | None = None,
) -> str | None:
    policy = validate_track_policy(track_policy)
    if policy.get("excluded"):
        return "excluded_artist"
    title = (track.get("name") or "").lower()
    primary_artist = track["artists"][0]["name"] if track.get("artists") else ""
    if accepted_credit_key(primary_artist) in {
        accepted_credit_key(name) for name in policy.get("blockedPrimaryNames", [])
    }:
        return "primary_artist_mismatch"
    if "version" in title and any(h.casefold() in title for h in policy.get("blockedVersionHints", [])):
        return "bad_version"
    # Only an exact canonical/accepted alias credit selects an alternate policy query.
    # This is not fuzzy alias containment and never overrides a verified provider ID.
    for accepted in accepted_primary_names:
        if accepted_credit_key(accepted) == accepted_credit_key(primary_artist):
            query_artist = accepted
            break
    if is_short_or_non_song(track):
        return "too_short_or_non_song"
    # An exact reviewed primary ID is identity evidence. Fuzzy display-name
    # tokens (especially non-Latin names and stop words) must not override it.
    if verified_primary_artist_id is not None:
        primary_id = track["artists"][0].get("id") if track.get("artists") else None
        if not verified_primary_artist_id or primary_id != verified_primary_artist_id:
            return "primary_artist_mismatch"
    else:
        if policy.get("strictPrimary") and accepted_credit_key(primary_artist) != accepted_credit_key(query_artist):
            return "strict_primary_artist_required"
        if not primary_artist_matches_query(query_artist, track):
            return "primary_artist_mismatch"
    if track_version_penalty(track) >= 2:
        return "bad_version"
    if 'from "' in title or "from (" in title:
        return "soundtrack_style_version"
    return None


def setlist_track_sort_key(item: tuple[int, int, str, dict]) -> tuple:
    popularity, play_count, song, track = item
    return (-play_count, -popularity, is_feat_track(track), song.lower())
