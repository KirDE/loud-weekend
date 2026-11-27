import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("FESTIVAL_WORKER_STDIO", "1")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "spotify_gmm_2026"))

import festival_playlists as playlists


class ArtistSearchTest(unittest.TestCase):
    def setUp(self):
        self.cache = patch.dict(playlists.ARTIST_SEARCH_CACHE, {}, clear=True)
        self.cache.start()
        self.addCleanup(self.cache.stop)

    def test_fielded_search_recovers_exact_act_hidden_by_partial_name(self):
        partial = {"id": "other", "name": "Ember"}
        exact = {"id": "intended", "name": "Ember Is"}
        with patch.object(playlists, "spotify_get", side_effect=[
            {"artists": {"items": [partial]}},
            {"artists": {"items": [partial, exact]}},
        ]) as get:
            self.assertEqual(playlists.spotify_search_artist("Ember Is"), exact)
            self.assertEqual(playlists.spotify_search_artist("Ember Is"), exact)
        self.assertEqual(get.call_count, 2)
        self.assertEqual(get.call_args_list[1].args[1], {
            "q": 'artist:"Ember Is"', "type": "artist", "limit": 10,
        })

    def test_existing_exact_credit_does_not_trigger_second_search(self):
        exact = {"id": "intended", "name": "THE EMBER"}
        with patch.object(playlists, "spotify_get", return_value={
            "artists": {"items": [{"id": "other", "name": "Ember"}, exact]},
        }) as get:
            self.assertEqual(playlists.spotify_search_artist("The Ember"), exact)
        get.assert_called_once()

    def test_bounded_search_caches_no_match_without_accepting_containment(self):
        with patch.object(playlists, "spotify_get", return_value={
            "artists": {"items": [{"id": "other", "name": "Ember Radio"}]},
        }) as get:
            self.assertIsNone(playlists.spotify_search_artist("Ember"))
            self.assertIsNone(playlists.spotify_search_artist("Ember"))
        self.assertEqual(get.call_count, 2)

    def test_fielded_query_escapes_quotes_and_backslashes(self):
        name = 'Ember "Is" \\ Live'
        with patch.object(playlists, "spotify_get", return_value={"artists": {"items": []}}) as get:
            self.assertIsNone(playlists.spotify_search_artist(name))
        self.assertEqual(get.call_args_list[1].args[1]["q"], 'artist:"Ember \\"Is\\" \\\\ Live"')

    def test_exact_credit_outranks_equally_simplified_punctuation(self):
        partial = {"id": "other", "name": "Ember North"}
        exact = {"id": "intended", "name": "Ember-North"}
        with patch.object(playlists, "spotify_get", side_effect=[
            {"artists": {"items": [partial]}}, {"artists": {"items": [exact]}},
        ]):
            self.assertEqual(playlists.spotify_search_artist("Ember-North"), exact)


if __name__ == "__main__":
    unittest.main()
