#!/usr/bin/env python3
"""
Download JS and CSS assets referenced by src/cart/index.html.

Defaults:
- HTML file: src/cart/index.html
- Output directory: src/cart/
- Allowed origins: logammulia.com, fonts.googleapis.com
"""

import argparse
import os
import re
import shutil
import ssl
import subprocess
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse, urlunparse
from urllib.request import Request, urlopen

BASE_URL = "https://logammulia.com"
HTML_PATH = Path(__file__).resolve().parent.parent / "src" / "cart" / "index.html"
OUTPUT_DIR = Path(__file__).resolve().parent.parent / "src" / "cart"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

LINK_RE = re.compile(
    r'(<link\b[^>]*\bhref\s*=\s*["\']([^"\']+)["\'][^>]*>)',
    re.IGNORECASE,
)
SCRIPT_RE = re.compile(
    r'(<script\b[^>]*\bsrc\s*=\s*["\']([^"\']+)["\'][^>]*>)',
    re.IGNORECASE,
)

ALLOWED_ORIGINS = (
    "logammulia.com",
    "fonts.googleapis.com",
)


def resolve_url(raw_url: str, base_url: str) -> str:
    """Resolves raw URL from HTML to absolute URL."""
    raw_url = raw_url.strip()
    if raw_url.startswith("//"):
        return f"https:{raw_url}"
    return urljoin(base_url.rstrip("/") + "/", raw_url)


def normalize_url(url: str) -> str:
    """Normalizes URL for stable deduplication while preserving query string."""
    parsed = urlparse(url)
    return urlunparse((parsed.scheme, parsed.netloc, parsed.path, "", parsed.query, ""))


def is_allowed_origin(url: str) -> bool:
    """Checks if URL host is allowed."""
    host = urlparse(url).netloc.lower().split(":")[0]
    return any(host == origin or host.endswith("." + origin) for origin in ALLOWED_ORIGINS)


def is_css_asset(url: str) -> bool:
    """Checks whether URL points to a CSS asset."""
    parsed = urlparse(url)
    path = parsed.path.lower()
    host = parsed.netloc.lower()
    if path.endswith(".css"):
        return True
    return "fonts.googleapis.com" in host


def is_js_asset(url: str) -> bool:
    """Checks whether URL points to a JS asset."""
    return urlparse(url).path.lower().endswith(".js")


def to_local_path(asset_url: str, asset_type: str) -> Path:
    """Maps remote asset URL to local relative path under OUTPUT_DIR."""
    parsed = urlparse(asset_url)
    path = parsed.path.strip("/")

    if asset_type == "css" and "fonts.googleapis.com" in parsed.netloc.lower():
        return Path("css/fonts_google.css")

    if not path:
        fallback = "asset.css" if asset_type == "css" else "asset.js"
        path = f"{asset_type}/{fallback}"

    return Path(path)


def collect_assets(html: str, base_url: str) -> list[tuple[str, str, str]]:
    """
    Collects CSS/JS assets from HTML.
    Returns list of tuples: (original_url, absolute_url, asset_type).
    """
    seen: set[str] = set()
    assets: list[tuple[str, str, str]] = []

    for tag, raw_url in LINK_RE.findall(html):
        _ = tag  # Tag kept for possible future filtering.
        abs_url = resolve_url(raw_url, base_url)
        if not is_allowed_origin(abs_url):
            continue
        if not is_css_asset(abs_url):
            continue
        norm = normalize_url(abs_url)
        if norm in seen:
            continue
        seen.add(norm)
        assets.append((raw_url, abs_url, "css"))

    for tag, raw_url in SCRIPT_RE.findall(html):
        _ = tag
        abs_url = resolve_url(raw_url, base_url)
        if not is_allowed_origin(abs_url):
            continue
        if not is_js_asset(abs_url):
            continue
        norm = normalize_url(abs_url)
        if norm in seen:
            continue
        seen.add(norm)
        assets.append((raw_url, abs_url, "js"))

    return assets


def download_with_curl(url: str, dest: Path) -> bool:
    """Downloads URL via curl; returns True on success."""
    if shutil.which("curl") is None:
        return False

    cmd = [
        "curl",
        "--fail",
        "--location",
        "--silent",
        "--show-error",
        "--compressed",
        "--user-agent",
        USER_AGENT,
        "--output",
        str(dest),
        url,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode == 0:
        return True

    if dest.exists():
        try:
            dest.unlink()
        except OSError:
            pass

    err = (result.stderr or "").strip()
    if err:
        print(f"  ! curl failed: {err}")
    return False


def download_file(url: str, dest: Path) -> bool:
    """Downloads URL to destination path; returns True on success."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = Request(
        url,
        headers={"User-Agent": USER_AGENT},
    )
    try:
        with urlopen(req, timeout=30, context=ssl.create_default_context()) as response:
            dest.write_bytes(response.read())
        return True
    except (HTTPError, URLError, OSError) as exc:
        print(f"  ! urllib failed: {exc}")
        print("  ! Retrying with curl...")
        if download_with_curl(url, dest):
            return True
        print("  ! Failed.")
        return False


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Download JS and CSS assets referenced by src/cart/index.html"
    )
    parser.add_argument(
        "--html",
        type=Path,
        default=HTML_PATH,
        help=f"Path to cart index.html (default: {HTML_PATH})",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=OUTPUT_DIR,
        help=f"Base output directory (default: {OUTPUT_DIR})",
    )
    parser.add_argument(
        "--base-url",
        default=BASE_URL,
        help=f"Base URL for relative paths (default: {BASE_URL})",
    )
    parser.add_argument(
        "--rewrite",
        action="store_true",
        help="Rewrite HTML references to local relative paths",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be downloaded without writing files",
    )
    args = parser.parse_args()

    if not args.html.is_file():
        print(f"Error: HTML file not found: {args.html}")
        return 1

    html = args.html.read_text(encoding="utf-8", errors="replace")
    assets = collect_assets(html, args.base_url)
    if not assets:
        print("No JS/CSS assets found.")
        return 0

    print(f"Found {len(assets)} JS/CSS asset(s).\n")

    output_dir = args.out.resolve()
    html_dir = args.html.resolve().parent
    replacements: list[tuple[str, str]] = []

    for original_url, absolute_url, asset_type in assets:
        rel_path = to_local_path(absolute_url, asset_type)
        dest = output_dir / rel_path
        local_ref = Path(os.path.relpath(dest, start=html_dir)).as_posix()

        print(f"  {absolute_url}")
        print(f"    -> {dest}")
        if args.dry_run:
            replacements.append((original_url, local_ref))
            continue

        if download_file(absolute_url, dest):
            replacements.append((original_url, local_ref))
        print()

    if args.rewrite and replacements:
        rewritten = html
        for original_url, local_ref in replacements:
            rewritten = rewritten.replace(original_url, local_ref)
        args.html.write_text(rewritten, encoding="utf-8")
        print(f"Rewrote HTML references in: {args.html}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
