#!/usr/bin/env python3
"""Store Cognee Cloud credentials locally without putting them in shell history."""
from pathlib import Path
from urllib.parse import urlsplit
import getpass
import json
import os

directory = Path.home() / '.config' / 'synthos-brains'
path = directory / 'credentials.json'
if path.is_symlink():
    raise SystemExit('Refusing a symlinked credential file.')
data = json.loads(path.read_text()) if path.exists() else {}
url = input('Cognee Cloud instance/API URL from your account: ').strip().rstrip('/')
parsed = urlsplit(url)
if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
    raise SystemExit('Use an HTTPS instance URL without credentials or a query string.')
key = getpass.getpass('Cognee Cloud API key (hidden): ').strip()
if not key:
    raise SystemExit('No key entered; nothing changed.')
data.update(cogneeUrl=url, cogneeApiKey=key)
directory.mkdir(parents=True, exist_ok=True, mode=0o700)
os.chmod(directory, 0o700)
staging = directory / ('credentials-' + str(os.getpid()) + '.json')
fd = os.open(staging, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as handle:
    json.dump(data, handle)
    handle.write('\n')
os.replace(staging, path)
print('Saved private Cognee configuration. No key was printed. Run npm run doctor.')
