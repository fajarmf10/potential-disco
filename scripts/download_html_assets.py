#!/usr/bin/env python3
"""
Downloads JS, CSS, and other static assets referenced by src/index.html
from logammulia.com (and optionally Google Fonts) into the correct local
directories (src/css, src/js, etc.) so the page can be used offline or
with local assets.
"""

import argparse
import re
import ssl
import sys
from pathlib import Path
from urllib.parse import urlparse, urlunparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

# * Configuration
BASE_URL = "https://logammulia.com"
HTML_PATH = Path(__file__).resolve().parent.parent / "src" / "index.html"
OUTPUT_DIR = Path(__file__).resolve().parent.parent / "src"

# * Asset types we care about (from index.html): stylesheets, scripts, manifest, icons
LINK_RE = re.compile(
    r'<link[^>]+href\s*=\s*["\'](https?://[^"\']+)["\']',
    re.IGNORECASE,
)
SCRIPT_RE = re.compile(
    r'<script[^>]+src\s*=\s*["\'](https?://[^"\']+)["\']',
    re.IGNORECASE,
)

# Only download from these origins (skip analytics, GTM, Hotjar, etc.)
ALLOWED_ORIGINS = (
    "logammulia.com",
    "fonts.googleapis.com",
    "fonts.gstatic.com",
)


def normalize_url(url: str) -> str:
    """Strips query string and fragment for consistent filenames."""
    parsed = urlparse(url)
    clean = urlunparse((parsed.scheme, parsed.netloc, parsed.path, "", "", ""))
    return clean.rstrip("/") or "/"


def url_to_local_path(original_url: str, normalized_url: str) -> Path:
    """
    Maps a full URL to a relative path under OUTPUT_DIR.
    E.g. https://logammulia.com/css/style.min.css -> css/style.min.css
    original_url: used to detect query string (e.g. Google Fonts).
    normalized_url: used for path (query already stripped).
    """
    parsed = urlparse(normalized_url)
    path = parsed.path.strip("/") or "index"
    has_query = bool(urlparse(original_url).query)
    if path in ("", "css") and has_query:
        path = "css/fonts_google.css"
    return Path(path)


def collect_asset_urls(html: str) -> list[tuple[str, str]]:
    """
    Returns list of (url, normalized_url) for link href and script src
    that match ALLOWED_ORIGINS.
    """
    seen = set()
    out = []
    for pattern in (LINK_RE, SCRIPT_RE):
        for m in pattern.finditer(html):
            url = m.group(1).strip()
            norm = normalize_url(url)
            if norm in seen:
                continue
            if not any(origin in url for origin in ALLOWED_ORIGINS):
                continue
            seen.add(norm)
            out.append((url, norm))
    return out


def download_file(url: str, dest: Path) -> bool:
    """Downloads url to dest; creates parent dirs. Returns True on success."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"})
    try:
        ctx = ssl.create_default_context()
        with urlopen(req, timeout=30, context=ctx) as r:
            dest.write_bytes(r.read())
        return True
    except (HTTPError, URLError, OSError) as e:
        print(f"  ! Failed: {e}")
        return False


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Download JS, CSS, and other assets referenced by src/index.html"
    )
    parser.add_argument(
        "--html",
        type=Path,
        default=HTML_PATH,
        help=f"Path to index.html (default: {HTML_PATH})",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=OUTPUT_DIR,
        help=f"Base directory for downloaded files (default: {OUTPUT_DIR})",
    )
    parser.add_argument(
        "--rewrite",
        action="store_true",
        help="Rewrite index.html to use local paths for downloaded assets",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Only print what would be downloaded",
    )
    args = parser.parse_args()

    if not args.html.is_file():
        print(f"Error: HTML file not found: {args.html}")
        return 1

    html = args.html.read_text(encoding="utf-8", errors="replace")
    assets = collect_asset_urls(html)
    if not assets:
        print("No downloadable assets found in HTML.")
        return 0

    print(f"Found {len(assets)} asset(s) to download.\n")
    base_dir = args.out.resolve()
    replacements = []  # (old_url, norm_url, local_path_str) for --rewrite

    for url, norm_url in assets:
        rel = url_to_local_path(url, norm_url)
        dest = base_dir / rel
        local_path_str = str(rel.as_posix())
        print(f"  {url}")
        print(f"    -> {dest}")
        if args.dry_run:
            replacements.append((url, norm_url, local_path_str))
            continue
        if download_file(url, dest):
            replacements.append((url, norm_url, local_path_str))
        print()

    if args.rewrite and replacements:
        new_html = html
        for old_url, norm_url, local_path in replacements:
            new_html = new_html.replace(old_url, local_path)
            if norm_url != old_url and norm_url in new_html:
                new_html = new_html.replace(norm_url, local_path)
        args.html.write_text(new_html, encoding="utf-8")
        print("Updated index.html to use local paths.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
