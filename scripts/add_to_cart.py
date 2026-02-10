#!/usr/bin/env python3
"""
Interactive script to add Emas Batangan variants to cart at logammulia.com.
Prompts for variant selection and quantities, then POSTs to add-to-cart-multiple.
"""

import os
import sys
from typing import List, Tuple

try:
    import requests
except ImportError:
    print("Missing dependency: run  pip install requests")
    sys.exit(1)

# * Configuration - adjust as needed
BASE_URL = "https://logammulia.com"
ADD_TO_CART_URL = f"{BASE_URL}/add-to-cart-multiple"
# Get _token from page source (meta name="_token" or form input name="_token"). Expires per session.
DEFAULT_TOKEN = os.environ.get("LOGAMMULIA_TOKEN", "YOUR_CSRF_TOKEN_HERE")

# * Variant list: (id, display name)
VARIANTS = [
    (11, "Emas Batangan - 0.5 gr"),
    (12, "Emas Batangan - 1 gr"),
    (13, "Emas Batangan - 2 gr"),
    (15, "Emas Batangan - 3 gr"),
    (17, "Emas Batangan - 5 gr"),
    (18, "Emas Batangan - 10 gr"),
    (19, "Emas Batangan - 25 gr"),
    (20, "Emas Batangan - 50 gr"),
    (38, "Emas Batangan - 100 gr"),
    (57, "Emas Batangan - 250 gr"),
    (58, "Emas Batangan - 500 gr"),
    (59, "Emas Batangan - 1000 gr"),
]


def print_variants() -> None:
    """Prints numbered list of variants."""
    print("\nAvailable variants:")
    print("-" * 40)
    for i, (vid, name) in enumerate(VARIANTS, start=1):
        print(f"  {i:2}. [{vid}] {name}")
    print("-" * 40)


def parse_quantity(s: str) -> int:
    """Parses user input to a non-negative integer."""
    s = (s or "").strip()
    if not s:
        return 0
    try:
        n = int(s)
        return max(0, n)
    except ValueError:
        return 0


def prompt_selections() -> List[Tuple[int, int]]:
    """
    Prompts user for which variants and how many. Returns list of (variant_id, qty).
    """
    selections: List[Tuple[int, int]] = []
    print_variants()

    while True:
        choice = input("\nEnter variant number (1–12) or variant ID, or press Enter when done: ").strip()
        if not choice:
            break

        variant_id = None
        try:
            num = int(choice)
            if 1 <= num <= len(VARIANTS):
                variant_id = VARIANTS[num - 1][0]
            else:
                # Treat as raw variant ID
                for vid, _ in VARIANTS:
                    if vid == num:
                        variant_id = vid
                        break
        except ValueError:
            pass

        if variant_id is None:
            print("Invalid option. Use 1–12 or a variant ID from the list.")
            continue

        qty_str = input("Quantity (0 to skip): ").strip()
        qty = parse_quantity(qty_str)
        if qty > 0:
            selections.append((variant_id, qty))
            print(f"  Added: variant {variant_id}, qty {qty}")

    return selections


def build_form_data(selections: List[Tuple[int, int]], token: str) -> dict:
    """Builds form payload for add-to-cart-multiple."""
    id_variants = [str(vid) for vid, qty in selections]
    qtys = [str(qty) for vid, qty in selections]
    return {
        "_token": token,
        "id_variant[]": id_variants,
        "qty[]": qtys,
        "current_url": f"{BASE_URL}/id/purchase/gold",
    }


def submit_cart(selections: List[Tuple[int, int]], token: str) -> bool:
    """POSTs to add-to-cart-multiple. Returns True on success."""
    if not selections:
        print("No items selected. Exiting.")
        return False

    data = build_form_data(selections, token)
    # List of (key, value) so id_variant[] and qty[] are sent as repeated keys
    payload: List[Tuple[str, str]] = [
        ("_token", data["_token"]),
        ("current_url", data["current_url"]),
    ]
    for v in data["id_variant[]"]:
        payload.append(("id_variant[]", v))
    for q in data["qty[]"]:
        payload.append(("qty[]", q))
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Origin": BASE_URL,
        "Referer": f"{BASE_URL}/id/purchase/gold",
    }

    print("\nSubmitting to add-to-cart-multiple...")
    try:
        r = requests.post(
            ADD_TO_CART_URL,
            data=payload,
            headers=headers,
            timeout=30,
            allow_redirects=True,
        )
        r.raise_for_status()
        print(f"Response status: {r.status_code}")
        if r.history:
            print(f"Redirected to: {r.url}")
        return True
    except requests.RequestException as e:
        print(f"Request failed: {e}")
        return False


def main() -> None:
    token = DEFAULT_TOKEN
    if token == "YOUR_CSRF_TOKEN_HERE":
        token = input(
            "Paste _token from the purchase page (view source, search for _token): "
        ).strip()
        if not token:
            print("No token provided. Exiting.")
            sys.exit(1)

    print("Add to cart – logammulia.com")
    selections = prompt_selections()
    if not selections:
        print("No items to add. Exiting.")
        sys.exit(0)

    print("\nSummary:")
    for vid, qty in selections:
        name = next((n for (i, n) in VARIANTS if i == vid), str(vid))
        print(f"  {name}: qty {qty}")

    confirm = input("\nProceed with this order? [y/N]: ").strip().lower()
    if confirm != "y" and confirm != "yes":
        print("Cancelled.")
        sys.exit(0)

    ok = submit_cart(selections, token)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
