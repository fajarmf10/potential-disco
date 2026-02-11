# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Gold purchase automation for logammulia.com. Node.js scripts use Puppeteer (with stealth plugin for Cloudflare bypass) and Axios for browser automation and API calls. Python utility scripts handle offline asset downloading.

## Commands

All commands run from `src/scripts/`:

```bash
npm start                    # Full interactive flow (login → prices → cart → checkout)
npm run prices               # Fetch prices only (node index.js --prices-only)
npm run cart                 # Cart operations only (node index.js --cart-only)
npm run switch               # Interactive store switcher
npm run stores               # List all store locations

node checkout-cart.js        # Standalone checkout (items already in cart)
node checkout-cart.js --use-browser   # Connect to existing Chrome session

npm install                  # Install dependencies (run once)
```

No test framework or linter is configured.

## Architecture

### Entry Points (`src/scripts/`)

- **`index.js`** — Main interactive flow: login → select store → fetch prices/stock → user picks items → add to cart via API → open cart tabs. Stops before checkout (line 440 hangs intentionally).
- **`checkout-cart.js`** — Standalone checkout script. Assumes cart has items. Opens N parallel tabs that each independently run the full checkout loop (cart → click checkout → handle popups/payment/confirmation). All tabs retry forever on failure.
- **`switch-store.js`** — Utility to change account store location.

### Core Libraries (`src/scripts/lib/`)

- **`browser.js`** — Puppeteer lifecycle: launch/connect, Cloudflare challenge waiting, login automation (auto-fill or manual), cookie/CSRF extraction, multi-tab racing (`raceLoadPage` — first 2XX wins, others closed), `openUrlInMultipleTabs` (all tabs retry until 2XX).
- **`api.js`** — Axios HTTP client with cookie jar. Handles: store location change, price/stock fetching (HTML parsing via cheerio), add-to-cart POST. Syncs cookies bidirectionally with Puppeteer pages.
- **`checkout.js`** — Checkout flow: cart verification, checkout button click (tries 8 selectors + fallback scan), transaction destination popup, payment method selection, order confirmation. Exports `processCheckoutPage` (post-navigation flow) and `tryClickSelector` for reuse.
- **`prompt.js`** — Readline wrapper for interactive CLI prompts.
- **`snapshot.js`** — Saves `page.content()` to `results/{timestamp}/{label}.html` for debugging.
- **`config.js`** — Centralized config: variant definitions (gram↔ID mapping), store codes/names, endpoints, env var parsing.

### Key Patterns

**Two authentication modes:** Auto-login (credentials in `.env`) or `--use-browser` (connect to existing Chrome on port 9222 via remote debugging).

**Cookie sync between Puppeteer and Axios:** Puppeteer manages the browser session. Cookies are extracted from the page, imported into Axios's cookie jar for API calls, then synced back before the next browser step. CSRF tokens are re-extracted after every navigation.

**Multi-tab racing:** Multiple browser tabs load the same URL in parallel. For `raceLoadPage`, the first tab to get HTTP 2XX wins and others are closed. For `openUrlInMultipleTabs`, all tabs retry independently until every tab succeeds. Random 1-3s delays between retries to avoid hammering.

**Checkout button discovery:** Uses an ordered list of CSS selectors, then a fallback scan of `.btn-green`/`.btn-primary`/`a.btn` for checkout-related text, then pauses for manual click if nothing matches (logging all visible buttons for debugging).

### Data Flow

```
index.js: Login → Purchase page → Extract cookies/CSRF → API calls (prices, add-to-cart)
                                                            ↕ cookie sync
checkout-cart.js: Login → Verify cart → N tabs × (load cart → checkout → payment → confirm)
```

### Configuration (`src/scripts/.env`)

Copy `.env.example` to `.env`. Key variables:

| Variable | Default | Purpose |
|---|---|---|
| `LM_EMAIL` / `LM_PASSWORD` | — | Auto-login credentials |
| `LM_RACE_TABS` | `10` | Number of parallel tabs |
| `LM_HEADLESS` | `true` | Show browser window |
| `LM_TUJUAN_TRANSAKSI` | `Investasi` | Transaction purpose popup |
| `LM_PAYMENT_METHOD` | — | Auto-select payment (empty = manual) |
| `LM_STORE_CODES` | `ASB1,ASB2` | Store codes to use |

### Python Scripts (`scripts/`)

Standalone utilities (no npm deps): `download_html_assets.py` and `download_cart_assets.py` cache page HTML/CSS/JS locally. `add_to_cart.py` does cart operations without a browser (requires manual cookie/CSRF input).

### Snapshot Debugging

Both `index.js` and `checkout-cart.js` save page HTML at key steps to `src/scripts/results/{timestamp}/`. This directory is gitignored. Snapshots help discover actual HTML structure and debug failures post-mortem.
