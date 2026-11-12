import importlib.util
import io
import json
import pathlib
import unittest
from unittest.mock import patch

path = pathlib.Path(__file__).resolve().parents[1] / 'lib/ingestion/adapters/roskilde-fetch.py'
spec = importlib.util.spec_from_file_location('roskilde_fetch', path)
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class RoskildeFetchTests(unittest.TestCase):
    def test_only_official_bounded_paths(self):
        for path in ['/', '/program', '/nyheder', '/nyheder/rf27-first-wave', '/billetter']:
            self.assertTrue(helper.allowed(helper.ORIGIN + path))
        for url in ['http://www.roskilde-festival.dk/', 'https://example.test/',
                    'https://www.roskilde-festival.dk.evil.test/',
                    'https://user:pass@www.roskilde-festival.dk/',
                    helper.ORIGIN + '/program?q=evil', helper.ORIGIN + '/program#fragment',
                    helper.ORIGIN + '/admin', helper.ORIGIN + '/nyheder/../../admin']:
            self.assertFalse(helper.allowed(url), url)

    def test_rotated_home_uses_linked_index_and_keeps_five_document_cap(self):
        fetched = []
        def document(path, opener):
            fetched.append(path)
            html = '<a href="/nyheder">News</a>' if path == '/' else ''.join('<a href="/nyheder/rf27-wave-%d">Wave</a>' % i for i in range(9))
            return {'url': helper.ORIGIN + path, 'html': html}
        with patch.object(helper, 'document', document), patch.object(helper.sys, 'argv', ['helper', '2027']), patch('sys.stdout', new_callable=io.StringIO) as output:
            helper.main()
            data = json.loads(output.getvalue())
        self.assertEqual(fetched, ['/', '/program', '/nyheder', '/nyheder/rf27-wave-0', '/nyheder/rf27-wave-1'])
        self.assertEqual(len(data['documents']), 5)

    def test_unlinked_or_foreign_index_is_not_fetched(self):
        fetched = []
        def document(path, opener):
            fetched.append(path)
            return {'url': helper.ORIGIN + path, 'html': '<a href="https://example.test/nyheder">News</a>'}
        with patch.object(helper, 'document', document), patch.object(helper.sys, 'argv', ['helper', '2027']), patch('sys.stdout', new_callable=io.StringIO):
            helper.main()
        self.assertEqual(fetched, ['/', '/program'])

    def test_home_articles_precede_index_discoveries(self):
        for count in [1, 2]:
            with self.subTest(home_articles=count):
                fetched = []
                home_paths = ['/nyheder/rf27-home-%d' % i for i in range(count)]
                def document(path, opener):
                    fetched.append(path)
                    html = '<a href="/nyheder">News</a>' + ''.join('<a href="%s">Lineup</a>' % p for p in home_paths) if path == '/' else '<a href="/nyheder/rf27-other-1">Other</a><a href="/nyheder/rf27-other-2">Other</a>'
                    return {'url': helper.ORIGIN + path, 'html': html}
                with patch.object(helper, 'document', document), patch.object(helper.sys, 'argv', ['helper', '2027']), patch('sys.stdout', new_callable=io.StringIO):
                    helper.main()
                self.assertEqual(fetched, ['/', '/program', '/nyheder'] + (home_paths + ['/nyheder/rf27-other-1'])[:2])

    def test_optional_index_errors_retain_homepage_path(self):
        import urllib.error
        for error in [TimeoutError('index timeout'), urllib.error.HTTPError(helper.ORIGIN+'/nyheder', 404, 'Not found', {}, None), urllib.error.HTTPError(helper.ORIGIN+'/nyheder', 503, 'Unavailable', {}, None)]:
            with self.subTest(error=type(error).__name__):
                fetched = []
                def document(path, opener):
                    fetched.append(path)
                    if path == '/nyheder':
                        raise error
                    return {'url': helper.ORIGIN + path, 'html': '<a href="/nyheder">News</a><a href="/nyheder/rf27-home-lineup">Lineup</a>'}
                with patch.object(helper, 'document', document), patch.object(helper.sys, 'argv', ['helper', '2027']), patch('sys.stdout', new_callable=io.StringIO) as output:
                    helper.main()
                    result = json.loads(output.getvalue())
                self.assertEqual(fetched, ['/', '/program', '/nyheder', '/nyheder/rf27-home-lineup'])
                self.assertEqual(len(result['documents']), 3)

    def test_index_failure_without_home_articles_stays_a_transport_failure(self):
        def document(path, opener):
            if path == '/nyheder':
                raise TimeoutError('index required')
            return {'url': helper.ORIGIN + path, 'html': '<a href="/nyheder">News</a>'}
        with patch.object(helper, 'document', document), patch.object(helper.sys, 'argv', ['helper', '2027']), patch('sys.stdout', new_callable=io.StringIO):
            with self.assertRaises(TimeoutError):
                helper.main()

    def test_foreign_redirect_rejected_before_follow(self):
        with self.assertRaises(ValueError):
            helper.SameOriginRedirect().redirect_request(None, None, 302, '', {}, 'https://example.test/')

    def test_browser_ua_and_byte_limit_used(self):
        class Response(io.BytesIO):
            url = helper.ORIGIN + '/'
            headers = {'Content-Type': 'text/html; charset=utf-8'}
        class Opener:
            def open(self, req, timeout):
                self.req, self.timeout = req, timeout
                return Response(b'<h1>Official</h1>')
        opener = Opener()
        self.assertEqual(helper.document('/', opener)['html'], '<h1>Official</h1>')
        self.assertIn('Chrome/142', opener.req.get_header('User-agent'))
        self.assertEqual(opener.timeout, 15)
        with patch.object(helper, 'MAX_BYTES', 3):
            with self.assertRaises(ValueError):
                helper.document('/', opener)

    def test_discovery_only_home_linked_current_year_with_cap(self):
        fetched = []
        def document(path, opener):
            fetched.append(path)
            return {'url': helper.ORIGIN + path, 'html': ''.join('<a href="/nyheder/rf27-wave-%d">Wave</a>' % i for i in range(10)) + '<a href="/nyheder/rf26-old">Old</a><a href="https://example.test/nyheder/rf27-evil">No</a>'}
        with patch.object(helper, 'document', document), patch.object(helper.sys, 'argv', ['helper', '2027']), patch('sys.stdout', new_callable=io.StringIO) as output:
            helper.main()
            data = json.loads(output.getvalue())
        self.assertEqual(len(data['documents']), 5)
        self.assertEqual(fetched, ['/', '/program', '/nyheder/rf27-wave-0', '/nyheder/rf27-wave-1', '/nyheder/rf27-wave-2'])
