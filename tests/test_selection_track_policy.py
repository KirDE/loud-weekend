import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'/'spotify_gmm_2026'))
import track_policy as policy
import selection_tracks as selection

class SelectionPolicyTest(unittest.TestCase):
    def test_selection_and_festival_use_the_same_pure_guard_functions(self):
        self.assertIs(selection.should_skip_track_for_artist,policy.should_skip_track_for_artist)
        self.assertIs(selection.canonical_track_key,policy.canonical_track_key)
        self.assertIs(selection.track_version_penalty,policy.track_version_penalty)
    def test_invalid_playback_schema_and_track_identity_fail_closed(self):
        row={'requestedName':'Example Artist','name':'Example Artist','slug':'example','spotifyId':'A'*22,
          'tracks':[{'id':'T'*22,'uri':'spotify:track:'+'T'*22,'name':'Song','duration_ms':180000,'artists':[{'id':'A'*22,'name':'Example Artist'}],'is_playable':'false'}]}
        with self.assertRaises(ValueError):
            selection.select_selection_tracks({'artists':[row]})
        row['tracks'][0]['is_playable']=False
        self.assertEqual(selection.select_selection_tracks({'artists':[row]})['unresolved'],['Example Artist'])
    def test_tribute_identity_is_not_an_ordinary_act(self):
        result=selection.select_selection_tracks({'artists':[{'requestedName':'Example Tribute','name':'Example Tribute','slug':'tribute','spotifyId':'A'*22,'tracks':[]}]})
        self.assertEqual(result,{'selected':[],'unresolved':['Example Tribute']})
