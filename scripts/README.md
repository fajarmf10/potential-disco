# Scripts

## download_checkout_assets.py

Downloads only JS and CSS assets for checkout pages into `src/checkout/` by default.
Works with both:
- `src/checkout/checkout.txt`
- `src/checkout/Checkout _ Logam Mulia _ Gold, Silver and Precious Metal Trading Company.html`

If Python TLS handshake fails on some hosts, it automatically retries with `curl`.

**No extra dependencies** (uses Python standard library only).

### Usage

```bash
# List what would be downloaded
python download_checkout_assets.py --dry-run

# Download JS/CSS assets into src/checkout/
python download_checkout_assets.py

# Download and rewrite checkout HTML to local relative paths
python download_checkout_assets.py --rewrite
```

### Options

| Option       | Description |
|-------------|-------------|
| `--html`    | Path to checkout HTML file |
| `--out`     | Base output directory (default: `src/checkout/`) |
| `--base-url`| Base URL for resolving relative links (default: `https://www.logammulia.com`) |
| `--rewrite` | Rewrite asset links in the HTML to local relative paths |
| `--dry-run` | Print targets without downloading |

---

## download_cart_assets.py

Downloads only JS and CSS assets referenced by `src/cart/index.html` into local folders (default base: `src/cart/`).
If Python TLS handshake fails on some hosts, it automatically retries with `curl`.

**No extra dependencies** (uses Python standard library only).

### Usage

```bash
# List what would be downloaded from src/cart/index.html
python download_cart_assets.py --dry-run

# Download JS/CSS assets
python download_cart_assets.py

# Download and rewrite src/cart/index.html to local relative paths
python download_cart_assets.py --rewrite
```

### Options

| Option       | Description |
|-------------|-------------|
| `--html`    | Path to cart HTML (default: `src/cart/index.html`) |
| `--out`     | Base output directory (default: `src/cart/`) |
| `--base-url`| Base URL for resolving relative links (default: `https://logammulia.com`) |
| `--rewrite` | Rewrite asset links in the HTML to local relative paths |
| `--dry-run` | Print targets without downloading |

---

## download_html_assets.py

Downloads JS, CSS, and other static assets referenced by `src/index.html` (from logammulia.com and Google Fonts) into `src/css`, `src/js`, etc., so the page can be used with local assets.

**No extra dependencies** (uses Python standard library only).

### Usage

```bash
# List what would be downloaded (dry run)
python download_html_assets.py --dry-run

# Download all assets into src/
python download_html_assets.py

# Download and rewrite index.html to use local paths
python download_html_assets.py --rewrite
```

### Options

| Option       | Description |
|-------------|-------------|
| `--html`    | Path to index.html (default: `src/index.html`) |
| `--out`     | Base directory for downloaded files (default: `src/`) |
| `--rewrite` | Update index.html so link/script tags point to local files |
| `--dry-run` | Only print URLs and destination paths, do not download |

### Output layout

- `src/css/style.min.css`, `src/css/add-on.min.css`, `src/css/fonts_google.css`
- `src/js/*.js`, `src/js/manifest.json`
- `src/favicon.png`, `src/apple-touch-icon.png`

Requires network access to `logammulia.com` and `fonts.googleapis.com`.

---

## add_to_cart.py — Add-to-cart automation

Script to add Emas Batangan variants to cart at logammulia.com by calling `add-to-cart-multiple`.

## Setup

```bash
pip install requests
```

## Usage

```bash
python add_to_cart.py
```

Or with a pre-set CSRF token (so you are not prompted):

```bash
set LOGAMMULIA_TOKEN=your_token_here
python add_to_cart.py
```

## CSRF token (`_token`)

The site uses a session CSRF token. You must use a valid `_token` from the same browser session where you are logged in (if login is required).

1. Open https://logammulia.com/id/purchase/gold in your browser.
2. View page source (Ctrl+U).
3. Search for `_token` and copy the value from:
   - `<meta name="_token" content="...">`, or
   - `<input type="hidden" name="_token" value="...">`

Paste it when the script asks, or set `LOGAMMULIA_TOKEN` to that value.

**Note:** The token may expire when the session expires. If the request fails (e.g. 419 or redirect to login), get a fresh token from the page.

## Flow

1. Script shows all 12 variants (0.5 gr – 1000 gr) with numbers and IDs.
2. You enter a variant (by number 1–12 or by ID) and then the quantity.
3. Repeat until done; press Enter with no input to finish.
4. Script shows a summary and asks for confirmation.
5. It POSTs to `https://logammulia.com/add-to-cart-multiple` with `id_variant[]` and `qty[]`.

## Manual changes

- **Cookies / login:** The script does not send cookies. If the site requires login to add to cart, you may need to copy cookies from your browser into the script (e.g. a `Cookie` header) or use a browser automation tool that shares the same session.
