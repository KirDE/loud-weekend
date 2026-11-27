"""DB policy input is authoritative only after validation; never a name resolver."""
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "spotify_gmm_2026"))
import track_policy as policy


def restriction(**kwargs):
    return {
        "schemaVersion": 1, "excluded": False, "reviewedOriginal": False,
        "blockedPrimaryNames": [], "blockedVersionHints": [], **kwargs,
    }


class DatabaseTrackPolicyTest(unittest.TestCase):
    def test_restrictions_apply_even_with_verified_provider_id(self):
        track = {
            "name": "Song - Guest Version", "duration_ms": 180000,
            "artists": [{"id": "a" * 22, "name": "Artist"}],
        }
        for item, reason in (
            (restriction(excluded=True), "excluded_artist"),
            (restriction(blockedPrimaryNames=["ARTIST"]), "primary_artist_mismatch"),
            (restriction(blockedVersionHints=["Guest"]), "bad_version"),
        ):
            self.assertEqual(policy.should_skip_track_for_artist(
                "Artist", track, verified_primary_artist_id="a" * 22, track_policy=item
            ), reason)
        self.assertIsNone(policy.should_skip_track_for_artist(
            "Artist", track, verified_primary_artist_id="a" * 22
        ))

    def test_malformed_policies_fail_closed(self):
        for value in ({}, restriction(schemaVersion=True), restriction(excluded="false"),
                      restriction(blockedPrimaryNames="Artist"), restriction(extra=True)):
            with self.subTest(value=value), self.assertRaises(ValueError):
                policy.validate_track_policy(value)

    def test_ambiguous_name_hints_need_data_not_a_named_code_exception(self):
        self.assertTrue(policy.looks_like_tribute("Original Attack"))
        self.assertFalse(policy.looks_like_tribute("Original Attack", reviewed_identity=True))
        self.assertTrue(policy.looks_like_tribute("Original Attack Tribute", reviewed_identity=True))

    def test_strict_fallback_does_not_merge_related_artists_or_override_verified_ids(self):
        track = {"name": "Song", "duration_ms": 180000,
                 "artists": [{"id": "a" * 22, "name": "Another Artist"}]}
        strict = restriction(strictPrimary=True)
        self.assertEqual(policy.should_skip_track_for_artist(
            "Example Artist", track, track_policy=strict
        ), "strict_primary_artist_required")
        self.assertIsNone(policy.should_skip_track_for_artist(
            "Example Artist", track, verified_primary_artist_id="a" * 22, track_policy=strict
        ))
        self.assertIsNone(policy.should_skip_track_for_artist(
            "Example Artist", track, accepted_primary_names=("Another Artist",), track_policy=strict
        ))
