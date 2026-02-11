# checkout-cart.js — E2E Flow

Standalone script that checks out items already in the cart using N parallel tabs.

## Prerequisites

- Items already added to cart (via `index.js` or manually)
- `.env` configured with `LM_EMAIL` / `LM_PASSWORD` (or use `--use-browser`)

## Usage

```bash
# Auto-login mode
node src/scripts/checkout-cart.js

# Connect to existing logged-in browser
node src/scripts/checkout-cart.js --use-browser
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `LM_RACE_TABS` | `10` | Number of parallel checkout tabs |
| `LM_EMAIL` | — | Login email (not needed with `--use-browser`) |
| `LM_PASSWORD` | — | Login password (not needed with `--use-browser`) |
| `LM_TUJUAN_TRANSAKSI` | `Investasi` | Transaction purpose (`Investasi` or `Perdagangan`) |
| `LM_PAYMENT_METHOD` | — | Auto-select payment method (empty = manual) |
| `LM_HEADLESS` | `true` | Run browser headless (`false` to see the browser) |
| `LM_DEBUG_PORT` | `9222` | Chrome remote debugging port (for `--use-browser`) |

## Step-by-Step Flow

### [1/3] Launch Browser + Login

```
┌─────────────────────────────────────────┐
│  --use-browser?                         │
│  ├─ YES → Connect to Chrome on port     │
│  │        9222 (or LM_DEBUG_PORT)       │
│  │        Find existing logammulia tab  │
│  │        Wait for manual login if      │
│  │        not already logged in         │
│  │                                      │
│  └─ NO  → Launch new Puppeteer browser  │
│           Race N tabs to load purchase  │
│           page (Cloudflare bypass)      │
│           Auto-fill email + password    │
│           Submit login form             │
│                                         │
│  Save snapshot: login.html              │
└─────────────────────────────────────────┘
```

### [2/3] Verify Cart Has Items

```
┌─────────────────────────────────────────┐
│  Navigate to /id/my-cart                │
│  Wait for page load (networkidle2)      │
│                                         │
│  Check page content:                    │
│  ├─ Contains "Keranjang Anda kosong"    │
│  │   → ABORT: "Cart is empty"           │
│  │                                      │
│  └─ Contains cart items                 │
│      → Continue                         │
│                                         │
│  Save snapshot: cart-verify.html        │
│  Close verification page                │
└─────────────────────────────────────────┘
```

### [3/3] Parallel Checkout (N Tabs)

Opens `LM_RACE_TABS` tabs. Each tab runs the checkout loop **independently and in parallel**. All N tabs attempt to complete checkout — this is not a race (one winner), every tab tries to succeed.

```
┌─────────────────────────────────────────────────────────────┐
│  Promise.all([ tab1, tab2, tab3, ... tabN ])                │
│                                                             │
│  Each tab runs tabCheckoutLoop() independently:             │
│                                                             │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  LOOP (retry forever until success):                   │  │
│  │                                                        │  │
│  │  ① Load /id/my-cart                                    │  │
│  │     ├─ HTTP non-2xx → wait 1-3s random → RETRY ①      │  │
│  │     └─ HTTP 2xx → continue                             │  │
│  │     Save snapshot: cart-tabN-attemptM.html             │  │
│  │                                                        │  │
│  │  ② Check cart not empty                                │  │
│  │     ├─ Empty → STOP this tab (return failed)           │  │
│  │     └─ Has items → continue                            │  │
│  │                                                        │  │
│  │  ③ Find & click checkout button                        │  │
│  │     Try selectors in order:                            │  │
│  │       1. a[href*="checkout"]                           │  │
│  │       2. button with text "Checkout"                   │  │
│  │       3. #btn-checkout                                 │  │
│  │       4. .btn-checkout                                 │  │
│  │       5. a.btn-green with text "Checkout"              │  │
│  │       6. a with text "Proses"                          │  │
│  │       7. a with text "Lanjut"                          │  │
│  │       8. button with text "Proses"                     │  │
│  │                                                        │  │
│  │     If none match → fallback scan:                     │  │
│  │       .btn-green, .btn-primary, a.btn                  │  │
│  │       containing: proses/checkout/lanjut/bayar         │  │
│  │                                                        │  │
│  │     If still no match:                                 │  │
│  │       Log all visible buttons (for debugging)          │  │
│  │       Save snapshot: error-tabN-attemptM-no-btn.html   │  │
│  │       Pause 60s for manual click                       │  │
│  │       ├─ URL changes → continue with checkout flow     │  │
│  │       └─ Timeout → wait 1-3s → RETRY ①                │  │
│  │                                                        │  │
│  │  ④ Wait for navigation after checkout click            │  │
│  │     ├─ HTTP non-2xx → wait 1-3s random → RETRY ①      │  │
│  │     └─ HTTP 2xx → continue                             │  │
│  │     Save snapshot: checkout-tabN-attemptM.html         │  │
│  │                                                        │  │
│  │  ⑤ Process checkout page (processCheckoutPage)         │  │
│  │     │                                                  │  │
│  │     ├─ 5a. Handle "Tujuan Transaksi" popup             │  │
│  │     │   Check for swal/fancybox popup                  │  │
│  │     │   Select Investasi/Perdagangan (from config)     │  │
│  │     │   Click submit/Simpan/OK                         │  │
│  │     │                                                  │  │
│  │     ├─ 5b. Handle payment method selection             │  │
│  │     │   If LM_PAYMENT_METHOD set:                      │  │
│  │     │     Auto-select matching radio/option             │  │
│  │     │     Click Bayar/Proses/Konfirmasi                │  │
│  │     │   If not set:                                    │  │
│  │     │     Pause for manual selection (120s)            │  │
│  │     │                                                  │  │
│  │     └─ 5c. Handle order confirmation                   │  │
│  │         ├─ "berhasil" / "Terima kasih" detected        │  │
│  │         │   → Extract Order ID → SUCCESS               │  │
│  │         ├─ "konfirmasi" page detected                  │  │
│  │         │   → Click confirm → check result             │  │
│  │         └─ Neither → pause for manual (300s)           │  │
│  │                                                        │  │
│  │     ├─ Success → save confirmation-tabN.html → DONE   │  │
│  │     └─ Error → save error snapshot → RETRY ①           │  │
│  │                                                        │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                             │
│  Script waits for ALL tabs to finish (Promise.all)          │
└─────────────────────────────────────────────────────────────┘
```

## Output

### Console

```
  Tab 1/10: attempt 3: Loading cart...
  Tab 1/10: attempt 3: Checkout clicked, waiting for navigation...
  Tab 1/10: Checkout completed successfully!
  Tab 3/10: attempt 1: Cart returned HTTP 503, retrying...
  ...

  ========================================
  Checkout Results
  ========================================
  Tab 1: SUCCESS - in 3 attempt(s)
  Tab 2: SUCCESS - in 1 attempt(s)
  Tab 3: SUCCESS - in 7 attempt(s)
  ...

  8/10 tabs completed checkout successfully.
```

### HTML Snapshots

Saved to `src/scripts/results/{unix_timestamp}/`:

```
results/
  1738000000/
    login.html
    cart-verify.html
    cart-tab1-attempt1.html
    cart-tab2-attempt1.html
    checkout-tab1-attempt1.html
    confirmation-tab1.html
    error-tab3-attempt1-http503.html
    error-tab5-attempt2-no-btn.html
    error-tab5-attempt2-checkout.html
    ...
```

Use these to discover the actual HTML structure (e.g., checkout button markup) and debug failures.

## Relationship to index.js

```
index.js                          checkout-cart.js
────────                          ────────────────
[1] Launch browser                [1] Launch browser
[2] Login                         [2] Login + verify cart
[3] Navigate to purchase page
[4] Switch store location
[5] Fetch prices & stock
    Race tabs (background)
    User enters cart items
[6] Add items to cart via API
    Open N cart tabs
    >>> HANGS HERE <<<            [3] N tabs checkout in parallel
    (unreachable checkout code)       Each tab: cart → checkout → confirm
                                      All tabs run independently
                                      Script ends when all done
```

Run `index.js` first to add items, then run `checkout-cart.js` to complete the purchase.
