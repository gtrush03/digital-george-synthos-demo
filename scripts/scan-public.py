#!/usr/bin/env python3
"""Pattern scan of tracked public files; emits locations, never candidate secrets."""
from pathlib import Path
import re
import subprocess

root = Path(__file__).resolve().parents[1]
paths = subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode().split('\0')
patterns = {
    'private home path': re.compile(r'/Users/[A-Za-z0-9]'),
    'private overlay address': re.compile(r'\b100\.(?:6[4-9]|[789][0-9]|1[01][0-9]|12[0-7])\.\d+\.\d+\b'),
    'secret key block': re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
    'provider credential': re.compile(r'\b(?:sk-[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16})\b'),
    'account email': re.compile(r'\b[A-Za-z0-9._%+-]+@(?!example\.(?:com|org|net)\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b'),
}
issues=[]
for name in filter(None, paths):
    path=root/name
    if any(part in {'node_modules','runtime','receipts','.venv','__pycache__'} for part in path.relative_to(root).parts) or path.name in {'.env','credentials.json','auth.json'}:
        issues.append((name,'excluded private file'));continue
    try: text=path.read_text()
    except UnicodeDecodeError: continue
    for label, pattern in patterns.items():
        if pattern.search(text): issues.append((name,label))
for name,label in issues: print(f'{name}: {label}')
if issues: raise SystemExit(1)
print(f'Public pattern scan passed for {len(list(filter(None, paths)))} tracked files. Reviewed allowlist remains the primary boundary.')
