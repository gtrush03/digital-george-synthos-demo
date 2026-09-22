#!/usr/bin/env python3
"""Bounded, offline structural validation. Reads artifacts; writes only JSON stdout."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
from urllib.parse import urlsplit, urlunsplit

DEFAULT_REQUIRED = ["Opportunity room.md", "Proof of work.md", "Outreach draft.md", "receipt.json"]
MAX_FILES = 100
MAX_FILE_BYTES = 1_000_000
MAX_TOTAL_BYTES = 10_000_000
URL_PATTERN = re.compile(r'https?://[^\s<>"\x27`\\]+')
DRAFT_PATTERN = re.compile(r"\b(?:unsent|not[ -]sent|draft[ -]only)\b", re.I)


def reject_nonfinite(value):
    raise ValueError("non-finite JSON number")


def reject_duplicate_keys(pairs):
    obj = {}
    for key, value in pairs:
        if key in obj:
            raise ValueError("duplicate JSON key")
        obj[key] = value
    return obj


def safe_url(value):
    """Expose source identity, never embedded credentials, query values or fragments."""
    value = value.rstrip(".,;:!?)]}")
    try:
        parts = urlsplit(value)
        if parts.scheme not in ("http", "https") or not parts.hostname:
            return None
        host = parts.hostname.lower()
        if ":" in host:
            host = "[" + host + "]"
        netloc = host + ((":" + str(parts.port)) if parts.port else "")
        clean = urlunsplit((parts.scheme.lower(), netloc, parts.path or "/", "", ""))
        return {"url": clean, "sensitive_components_omitted": bool(parts.username or parts.password or parts.query or parts.fragment)}
    except ValueError:
        return None


def validate(root, required, expected_urls, require_unsent):
    errors = []
    files = []
    citations = {}
    marker_files = []
    checked_bytes = 0
    candidates = []
    if root.is_symlink() or not root.is_dir():
        errors.append({"check": "input_directory", "reason": "Input must be an existing directory, not a symlink."})
    else:
        for current, directories, names in os.walk(root, followlinks=False):
            directories.sort()
            names.sort()
            for name in list(directories):
                path = Path(current) / name
                if path.is_symlink():
                    errors.append({"check": "no_symlinks", "path": str(path.relative_to(root))})
                    directories.remove(name)
            for name in names:
                path = Path(current) / name
                if path.is_symlink():
                    errors.append({"check": "no_symlinks", "path": str(path.relative_to(root))})
                elif path.suffix.lower() in (".md", ".json"):
                    candidates.append(path)
            if len(candidates) > MAX_FILES:
                errors.append({"check": "file_limit", "maximum": MAX_FILES})
                break
    for path in candidates[:MAX_FILES]:
        relative = path.relative_to(root).as_posix()
        entry = {"path": relative}
        files.append(entry)
        try:
            # The staged directory is mounted read-only. O_NOFOLLOW also rejects
            # replacing a leaf with a symlink between directory scan and read.
            descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(descriptor, "rb") as stream:
                metadata = os.fstat(stream.fileno())
                if not stat.S_ISREG(metadata.st_mode):
                    raise ValueError("not a regular file")
                if metadata.st_size > MAX_FILE_BYTES:
                    raise ValueError("file exceeds byte limit")
                if metadata.st_size > MAX_TOTAL_BYTES - checked_bytes:
                    raise ValueError("total byte limit exceeded")
                raw = stream.read(min(MAX_FILE_BYTES, MAX_TOTAL_BYTES - checked_bytes) + 1)
            if len(raw) > MAX_FILE_BYTES:
                raise ValueError("file exceeds byte limit")
            checked_bytes += len(raw)
            if checked_bytes > MAX_TOTAL_BYTES:
                raise ValueError("total byte limit exceeded")
            entry.update(bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest())
            text = raw.decode("utf-8", errors="strict")
            if not text.strip():
                raise ValueError("empty artifact")
            entry["nonempty_utf8"] = True
            if path.suffix.lower() == ".json":
                json.loads(text, parse_constant=reject_nonfinite, object_pairs_hook=reject_duplicate_keys)
                entry["json_parse"] = "passed"
            urls = []
            for match in URL_PATTERN.finditer(text):
                url = safe_url(match.group(0))
                if url:
                    key = url["url"]
                    if key not in urls:
                        urls.append(key)
                    prior = citations.setdefault(key, {**url, "files": []})
                    prior["sensitive_components_omitted"] |= url["sensitive_components_omitted"]
                    if relative not in prior["files"]:
                        prior["files"].append(relative)
            entry["citation_urls"] = sorted(urls)
            # This only detects an explicit declaration, not delivery history.
            if ("outreach" in path.name.lower() or "draft" in path.name.lower()) and DRAFT_PATTERN.search(text):
                marker_files.append(relative)
        except (OSError, ValueError, UnicodeError, RecursionError) as exc:
            # Do not print artifact contents or parser excerpts (may contain secrets).
            reason = "invalid JSON" if isinstance(exc, json.JSONDecodeError) else ("excessive JSON nesting" if isinstance(exc, RecursionError) else str(exc))
            errors.append({"check": "read_and_parse", "path": relative, "reason": reason})
            entry["validation"] = "failed"
    available = {entry["path"] for entry in files if entry.get("nonempty_utf8")}
    missing = [name for name in required if name not in available]
    if missing:
        errors.append({"check": "required_outputs", "missing": missing})
    if not files:
        errors.append({"check": "artifacts_present", "reason": "No .md or .json artifacts found."})
    normalized_expected = [safe_url(url) for url in expected_urls]
    invalid_expected = [index for index, value in enumerate(normalized_expected) if not value]
    if invalid_expected:
        errors.append({"check": "expected_url_input", "invalid_indexes": invalid_expected})
    missing_urls = [value["url"] for value in normalized_expected if value and value["url"] not in citations]
    if missing_urls:
        errors.append({"check": "required_citations", "missing": missing_urls})
    if require_unsent and not marker_files:
        errors.append({"check": "unsent_declaration", "reason": "No explicit unsent/not sent/draft-only marker in an outreach or draft filename."})
    return {
        "schema": "synthos.artifact-validation/1",
        "validator_version": "1.0.0",
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "status": "passed" if not errors else "failed",
        "validation_kind": "offline_structural_checks",
        "boundaries": ["No network requests or model calls.", "Does not verify factual truth, source freshness, citation support, rights or message delivery.", "Draft markers are declarations only.", "URL credentials, query strings and fragments are omitted from the receipt."],
        "limits": {"files": MAX_FILES, "bytes_per_file": MAX_FILE_BYTES, "total_bytes": MAX_TOTAL_BYTES},
        "file_count": len(files),
        "checked_bytes": checked_bytes,
        "required_outputs": required,
        "files": files,
        "citations": sorted(citations.values(), key=lambda value: value["url"]),
        "unsent_declaration": {"found": bool(marker_files), "files": marker_files, "required": require_unsent},
        "errors": errors,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--require", action="append", help="Required relative output path; repeat to replace defaults.")
    parser.add_argument("--expect-url", action="append", default=[], help="Required citation URL; compared without query/fragment.")
    parser.add_argument("--require-unsent-marker", action="store_true")
    args = parser.parse_args()
    required = args.require if args.require is not None else DEFAULT_REQUIRED
    if any(Path(name).is_absolute() or ".." in Path(name).parts for name in required):
        parser.error("Required paths must stay inside the staged directory.")
    receipt = validate(args.directory, required, args.expect_url, args.require_unsent_marker)
    print(json.dumps(receipt, indent=2, ensure_ascii=False))
    return 0 if receipt["status"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(main())
