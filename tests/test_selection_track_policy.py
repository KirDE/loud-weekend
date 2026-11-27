import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "spotify_gmm_2026"))
import track_policy as policy
import selection_tracks as selection


class SelectionPolicyTest(unittest.TestCase):
    def test_selection_and_festival_use_the_same_pure_guard_functions(self):
        self.assertIs(selection.should_skip_track_for_artist, policy.should_skip_track_for_artist)
        self.assertIs(selection.canonical_track_key, policy.canonical_track_key)
        self.assertIs(selection.track_version_penalty, policy.track_version_penalty)

    def test_invalid_playback_schema_and_track_identity_fail_closed(self):
        row = {
            "requestedName": "Example Artist",
            "name": "Example Artist",
            "slug": "example",
            "spotifyId": "A" * 22,
            "tracks": [
                {
                    "id": "T" * 22,
                    "uri": "spotify:track:" + "T" * 22,
                    "name": "Song",
                    "duration_ms": 180000,
                    "artists": [{"id": "A" * 22, "name": "Example Artist"}],
                    "is_playable": "false",
                }
            ],
        }
        with self.assertRaises(ValueError):
            selection.select_selection_tracks({"artists": [row]})
        row["tracks"][0]["is_playable"] = False
        self.assertEqual(
            selection.select_selection_tracks({"artists": [row]})["unresolved"], ["Example Artist"]
        )

    def test_tribute_identity_is_not_an_ordinary_act(self):
        result = selection.select_selection_tracks(
            {
                "artists": [
                    {
                        "requestedName": "Example Tribute",
                        "name": "Example Tribute",
                        "slug": "tribute",
                        "spotifyId": "A" * 22,
                        "tracks": [],
                    }
                ]
            }
        )
        self.assertEqual(result, {"selected": [], "unresolved": ["Example Tribute"]})

    def test_verified_primary_id_does_not_require_ascii_or_fuzzy_name_agreement(self):
        for name in ("Молчат Дома", "The The", "東京", "Reviewed Canonical Name"):
            row = {
                "requestedName": name,
                "name": name,
                "slug": "synthetic",
                "spotifyId": "A" * 22,
                "tracks": [
                    {
                        "id": "T" * 22,
                        "uri": "spotify:track:" + "T" * 22,
                        "name": "Studio song",
                        "duration_ms": 180000,
                        "artists": [{"id": "A" * 22, "name": "Provider display alias"}],
                    }
                ],
            }
            with self.subTest(name=name):
                self.assertEqual(
                    selection.select_selection_tracks({"artists": [row]}),
                    {
                        "selected": [{"artist": name, "uri": "spotify:track:" + "T" * 22}],
                        "unresolved": [],
                    },
                )
                for change in (
                    {"duration_ms": 20000},
                    {"name": "Studio song - Live"},
                    {"name": 'Studio song (From "Movie")'},
                    {"artists": [{"id": "B" * 22, "name": name}, {"id": "A" * 22, "name": name}]},
                ):
                    invalid = {**row, "tracks": [{**row["tracks"][0], **change}]}
                    self.assertEqual(
                        selection.select_selection_tracks({"artists": [invalid]})["unresolved"],
                        [name],
                    )

    def test_reviewed_original_identity_outweighs_ambiguous_tribute_hints(self):
        for name in (
            "Attack Attack!",
            "Sex Pistols",
            "Ozzy Osbourne",
            "Massive Attack",
            "Original Again",
            "Not Nothing",
        ):
            row = {
                "requestedName": name,
                "name": name,
                "slug": "synthetic-original",
                "spotifyId": "A" * 22,
                "tracks": [
                    {
                        "id": "T" * 22,
                        "uri": "spotify:track:" + "T" * 22,
                        "name": "Studio song",
                        "duration_ms": 180000,
                        "artists": [{"id": "A" * 22, "name": name}],
                    }
                ],
            }
            with self.subTest(name=name):
                self.assertEqual(
                    selection.select_selection_tracks({"artists": [row]})["selected"],
                    [{"artist": name, "uri": "spotify:track:" + "T" * 22}],
                )
                for change in (
                    {"duration_ms": 20000},
                    {"name": "Studio song - Live"},
                    {"artists": [{"id": "B" * 22, "name": name}]},
                ):
                    self.assertEqual(
                        selection.select_selection_tracks(
                            {"artists": [{**row, "tracks": [{**row["tracks"][0], **change}]}]}
                        )["unresolved"],
                        [name],
                    )

    def test_reviewed_identity_never_overrides_explicit_tribute_or_curated_exclusions(self):
        for name in (
            "Ultimate Ozzy",
            "ultimate ozzy",
            "Korn Again",
            "KORN AGAIN",
            "Example Tribute",
            "Tribute to Example",
            "Cover Band Example",
            "Example Karaoke",
            "DJ Example",
        ):
            row = {
                "requestedName": name,
                "name": name,
                "slug": "synthetic-tribute",
                "spotifyId": "A" * 22,
                "tracks": [
                    {
                        "id": "T" * 22,
                        "uri": "spotify:track:" + "T" * 22,
                        "name": "Studio song",
                        "duration_ms": 180000,
                        "artists": [{"id": "A" * 22, "name": name}],
                    }
                ],
            }
            if name.casefold() in {"ultimate ozzy", "korn again"}:
                row["trackPolicy"] = {
                    "schemaVersion": 1, "excluded": True, "reviewedOriginal": False,
                    "blockedPrimaryNames": [], "blockedVersionHints": [],
                }
            with self.subTest(name=name):
                self.assertEqual(
                    selection.select_selection_tracks({"artists": [row]}),
                    {"selected": [], "unresolved": [name]},
                )
        self.assertTrue(policy.looks_like_tribute("Original Again"))
        self.assertFalse(policy.looks_like_tribute("Original Again", reviewed_identity=True))
