#!/usr/bin/env bash
set -euo pipefail

input="${1:?usage: check-python-release.sh RELEASE.tar.gz|APP_DIRECTORY}"
python="${PLAYLIST_PYTHON:-python3.13}"
"$python" -c 'import sys; assert sys.version_info[:2] == (3, 13), "Python 3.13 required"'
if [[ -d "$input" ]]; then
  app="$(cd "$input" && pwd)"
else
  stage="$(mktemp -d)"
  trap 'rm -rf "$stage"' EXIT
  tar -xzf "$input" -C "$stage"
  app="$stage/app"
fi
test -d "$app/.python"
PYTHONDONTWRITEBYTECODE=1 FESTIVAL_WORKER_STDIO=1 PYTHONPATH="$app/.python:$app/scripts/spotify_gmm_2026" "$python" - "$app" <<'PY'
import importlib.metadata as metadata
import json
import pathlib
import py_compile
import sys
import tempfile

app = pathlib.Path(sys.argv[1])
pins = dict(line.split("==", 1) for line in (app / "requirements.txt").read_text().splitlines()
            if line and not line.startswith("#"))
for name, version in pins.items():
    distribution = metadata.distribution(name)
    assert pathlib.Path(distribution.locate_file("")).resolve() == (app / ".python").resolve(), name
    assert distribution.version == version, name
    print(name, distribution.version)

import requests
from ytmusicapi import YTMusic
from ytmusicapi.auth.oauth.credentials import OAuthCredentials
from youtube_music_transfer import load_ytmusic, youtube_data_api_headers

assert callable(load_ytmusic) and callable(youtube_data_api_headers)
assert callable(YTMusic) and callable(OAuthCredentials)
with tempfile.TemporaryDirectory() as directory:
    credentials = pathlib.Path(directory) / "credentials.json"
    token = pathlib.Path(directory) / "token.json"
    token.write_text(json.dumps({"access_token": "test-only", "expires_at": 4102444800}))
    assert youtube_data_api_headers(credentials, token)["Authorization"] == "Bearer test-only"
with tempfile.TemporaryDirectory() as directory:
    for path in (app / "scripts" / "spotify_gmm_2026").glob("*.py"):
        py_compile.compile(str(path), cfile=str(pathlib.Path(directory) / (path.name + "c")), doraise=True)
print("Python 3.13 artifact imports and playlist script syntax OK")
PY
