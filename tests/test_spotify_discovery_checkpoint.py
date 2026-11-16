import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/spotify_gmm_2026'))
os.environ['FESTIVAL_WORKER_STDIO'] = '1'
os.environ['FESTIVAL_REPORT_ONLY'] = '1'
import festival_playlists as p

class DiscoveryCheckpointTests(unittest.TestCase):
    def test_chunks_equal_full_plan_including_cross_artist_dedup_and_sort(self):
        festival = p.Festival(key='test', display_name='Test', playlist_name='Test 2027', description='', lineup_fn=lambda: (['Alpha', 'Beta', 'Gamma'], ['Beta']))
        clock = [0]; calls = []
        def followers(name, *args):
            calls.append(('followers', name)); clock[0] += 10
            return {'Alpha': 300, 'Beta': 200, 'Gamma': 100}[name]
        def tracks(name, *args, **kwargs):
            calls.append(('tracks', name)); clock[0] += 10
            return None, [{'uri': 'spotify:track:' + name, 'name': 'Shared Song', 'artists': [{'name': name}], 'duration_ms': 180000}, {'uri': 'spotify:track:unique' + name, 'name': 'Unique ' + name, 'artists': [{'name': name}], 'duration_ms': 180000}]
        with patch.object(p, 'REPORT_ONLY', True), patch.object(p, 'get_followers', side_effect=followers), patch.object(p, 'search_artist_mbid', return_value=None), patch.object(p, 'spotify_top_tracks', side_effect=tracks), patch('time.monotonic', side_effect=lambda: clock[0]), patch.dict(os.environ, {'FESTIVAL_ARTISTS': '', 'FESTIVAL_FAST_SORT': ''}):
            full = p.build_playlist(festival, '', persist_report=False)
            calls.clear(); checkpoint = None
            for _ in range(10):
                result = p.build_playlist(festival, '', persist_report=False, discovery_checkpoint=checkpoint, discovery_budget=9)
                if 'discoveryCheckpoint' not in result: break
                checkpoint = result['discoveryCheckpoint']
            else: self.fail('Discovery did not converge')
            self.assertEqual(result, full)
            self.assertEqual([c for c in calls if c[0]=='followers'], [('followers', a) for a in ['Alpha','Beta','Gamma']])
            self.assertEqual([c for c in calls if c[0]=='tracks'], [('tracks', a) for a in ['Beta','Alpha','Gamma']])
            self.assertEqual(len(result['track_uris']), 4)

    def test_checkpoint_not_allowed_in_writable_or_persisted_mode(self):
        with self.assertRaises(ValueError): p.build_playlist(None, '', discovery_budget=1)
