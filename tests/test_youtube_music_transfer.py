import os
import sys
import unittest
from pathlib import Path
from unittest import mock

os.environ.setdefault('SETLIST_API_KEY', 'test')
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'spotify_gmm_2026'))

import youtube_music_transfer as transfer


class YouTubeMusicTransferTest(unittest.TestCase):

    def test_data_api_error_exposes_only_status_and_provider_reason(self):
        response = mock.Mock(status_code=403)

        with self.assertRaisesRegex(
            transfer.YouTubeDataApiError,
            r'^YouTube Data API failure: status=403 reason=playlistitemsnotaccessible$',
        ):
            transfer.raise_youtube_data_api_error(response, {
                'error': {
                    'message': 'provider-private-message',
                    'errors': [{'reason': 'playlistItemsNotAccessible'}],
                },
            })

    def test_search_client_does_not_receive_playlist_oauth(self):
        unauthenticated_client = mock.Mock()
        ytmusic_module = mock.Mock()
        ytmusic_module.YTMusic.return_value = unauthenticated_client

        with mock.patch.dict(sys.modules, {'ytmusicapi': ytmusic_module}):
            result = transfer.load_ytmusic()

        self.assertIs(result, unauthenticated_client)
        ytmusic_module.YTMusic.assert_called_once_with()

    def test_search_errors_are_counted_without_caching_provider_text(self):
        query = {
            'artist': 'Example Artist',
            'query_artist': 'Example Artist',
            'lineup_artist': 'Example Artist',
            'title': 'Example Song',
        }
        response = mock.Mock(status_code=401)
        error = RuntimeError('provider-private-text')
        error.response = response
        ytmusic = mock.Mock()
        ytmusic.search.side_effect = error
        cache = {}
        stats = {}

        result = transfer.search_youtube_track(ytmusic, query, cache, stats=stats)

        self.assertIsNone(result)
        self.assertEqual(cache, {})
        self.assertEqual(stats['authentication_errors'], 2)
        self.assertEqual(stats['empty_results'], 1)

    def test_parse_report_tracks_deduplicates_artist_title_pairs(self):
        report = {
            'report': [
                {
                    'artist': 'Example Artist',
                    'query_artist': 'Example Artist',
                    'tracks': ['Example Artist - Song - 2024 Remaster', 'Example Artist - Song'],
                }
            ]
        }

        tracks = transfer.parse_report_tracks(report)

        self.assertEqual(len(tracks), 1)
        self.assertEqual(tracks[0]['title'], 'Song - 2024 Remaster')

    def test_candidate_score_accepts_clean_song_match(self):
        query = {
            'artist': 'Example Artist',
            'query_artist': 'Example Artist',
            'lineup_artist': 'Example Artist',
            'title': 'Clean Song',
        }
        candidate = {
            'title': 'Clean Song',
            'videoId': 'video-id',
            'resultType': 'song',
            'duration_seconds': 180,
            'artists': [{'name': 'Example Artist'}],
        }

        self.assertIsNotNone(transfer.youtube_candidate_score(query, candidate))

    def test_candidate_score_rejects_live_version(self):
        query = {
            'artist': 'Example Artist',
            'query_artist': 'Example Artist',
            'lineup_artist': 'Example Artist',
            'title': 'Clean Song',
        }
        candidate = {
            'title': 'Clean Song - Live at Wacken',
            'videoId': 'video-id',
            'resultType': 'song',
            'duration_seconds': 180,
            'artists': [{'name': 'Example Artist'}],
        }

        self.assertIsNone(transfer.youtube_candidate_score(query, candidate))

    def test_candidate_score_rejects_youtube_specific_bad_version(self):
        query = {
            'artist': 'Example Artist',
            'query_artist': 'Example Artist',
            'lineup_artist': 'Example Artist',
            'title': 'Clean Song',
        }
        candidate = {
            'title': 'Clean Song (Club Version)',
            'videoId': 'video-id',
            'resultType': 'song',
            'duration_seconds': 180,
            'artists': [{'name': 'Example Artist'}],
        }

        self.assertIsNone(transfer.youtube_candidate_score(query, candidate))

    def test_candidate_score_accepts_version_when_source_requested_it(self):
        query = {
            'artist': 'Example Artist',
            'query_artist': 'Example Artist',
            'lineup_artist': 'Example Artist',
            'title': 'Clean Song (Club Version)',
        }
        candidate = {
            'title': 'Clean Song (Club Version)',
            'videoId': 'video-id',
            'resultType': 'song',
            'duration_seconds': 180,
            'artists': [{'name': 'Example Artist'}],
        }

        self.assertIsNotNone(transfer.youtube_candidate_score(query, candidate))










def subprocess_result(returncode: int, stdout: str, stderr: str):
    return mock.Mock(returncode=returncode, stdout=stdout, stderr=stderr)


if __name__ == '__main__':
    unittest.main()
