# E2E Flow — Purchase to Checkout

Full end-to-end flow across both scripts: `index.js` (purchase + add to cart) then `checkout-cart.js` (checkout).

## Usage

```bash
# Step 1: Purchase flow — select store, pick items, add to cart
node index.js                    # auto-login
node index.js --use-browser      # connect to existing Chrome

# Step 2: Checkout flow — process checkout on N parallel tabs
node checkout-cart.js            # auto-login
node checkout-cart.js --use-browser
```

## Environment Variables

| Variable | Default | Used by | Description |
|---|---|---|---|
| `LM_EMAIL` | — | both | Login email (not needed with `--use-browser`) |
| `LM_PASSWORD` | — | both | Login password (not needed with `--use-browser`) |
| `LM_RACE_TABS` | `10` | both | Number of parallel tabs |
| `LM_STORE_CODES` | `ASB1,ASB2` | index.js | Available store codes |
| `LM_TUJUAN_TRANSAKSI` | `Investasi` | checkout-cart.js | Transaction purpose popup (`Investasi` / `Perdagangan`) |
| `LM_PAYMENT_METHOD` | — | checkout-cart.js | Auto-select payment (empty = manual) |
| `LM_HEADLESS` | `true` | both | Show browser window (`false` to see it) |
| `LM_DEBUG_PORT` | `9222` | both | Chrome remote debugging port |

---

## Phase 1: `index.js` — Purchase + Add to Cart

### Prompt: Select Store

```
┌──────────────────────────────────────────┐
│  Interactive prompt (before browser)     │
│                                          │
│  "Select store: D (Darmo) / P (Pakuwon)"│
│  User types D or P                       │
│  → storeCode = ASB1 or ASB2             │
└──────────────────────────────────────────┘
```

### [1/5] Launch Browser

```
┌──────────────────────────────────────────┐
│  --use-browser?                          │
│  ├─ YES → puppeteer.connect() to Chrome  │
│  │        on port 9222 (tries 9222-9225) │
│  │        Find tab with logammulia.com   │
│  │        or use first open tab          │
│  │                                       │
│  └─ NO  → puppeteer.launch() new Chrome  │
│           headless (or headed if         │
│           LM_HEADLESS=false)             │
│           stealth plugin loaded          │
└──────────────────────────────────────────┘
```

### [2/5] Login (with Cloudflare Bypass)

```
┌──────────────────────────────────────────────────────────┐
│  --use-browser?                                          │
│  ├─ YES (manual login)                                   │
│  │   Navigate to /id/purchase/gold                       │
│  │   (uses raceLoadPage if raceTabs > 1:                 │
│  │    N tabs race, first HTTP 2xx wins, others closed)   │
│  │   Wait for Cloudflare challenge to resolve            │
│  │   Check if already logged in (look for "Hi, ..." )   │
│  │   ├─ Logged in → continue                            │
│  │   └─ Not logged in → poll every 2s for up to 5min    │
│  │      waiting for user to log in manually              │
│  │                                                       │
│  └─ NO (auto-login)                                      │
│      Navigate to /id/purchase/gold                       │
│      (uses raceLoadPage if raceTabs > 1)                 │
│      Wait for Cloudflare (title "Just a moment..." etc)  │
│      Wait for Turnstile iframe to resolve                │
│      Check if already logged in                          │
│      ├─ Logged in → continue                            │
│      └─ Not logged in:                                   │
│         Click a[data-src="/popup-login"]                 │
│         Wait for fancybox popup with login form          │
│         Find email input (input[name="email"] etc)       │
│         Find password input                              │
│         Type email (50ms per char)                       │
│         Type password (50ms per char)                    │
│         Click submit button (or press Enter)             │
│         Wait for navigation                              │
│         Verify logged in (check for "Hi, ..." or         │
│           "KELUAR" / "logout" text)                      │
│         ├─ Success → continue                           │
│         └─ Fail → throw "Login failed"                  │
└──────────────────────────────────────────────────────────┘
```

### [3/5] Navigate to Purchase Page + Extract Tokens

```
┌──────────────────────────────────────────────────────────┐
│  If not already on /purchase/gold:                       │
│    page.goto(/id/purchase/gold, networkidle2)            │
│                                                          │
│  Extract from page:                                      │
│    cookies ← page.cookies() (all browser cookies)        │
│    csrfToken ← meta[name="_token"] or input[name="_token"]│
│                                                          │
│  Initialize API client (LogamMuliaAPI):                  │
│    api.importCookies(cookies)                            │
│      → copies Puppeteer cookies into axios cookie jar    │
│      → extracts XSRF-TOKEN cookie for X-XSRF-TOKEN hdr  │
│    api.setCsrfToken(csrfToken)                           │
└──────────────────────────────────────────────────────────┘
```

### [4/5] Switch Store Location

```
┌──────────────────────────────────────────────────────────┐
│  Extract current_storage from page inline JS             │
│                                                          │
│  Already at correct store?                               │
│  ├─ YES → skip                                          │
│  └─ NO:                                                  │
│     --use-browser?                                       │
│     ├─ YES → Fill #geoloc-change-location form in page   │
│     │        Set input[name="location"] = storeCode      │
│     │        Set input[name="_token"] = csrfToken         │
│     │        form.submit()                               │
│     │        Wait for navigation                         │
│     │        Re-extract CSRF token from reloaded page    │
│     │                                                    │
│     └─ NO  → api.changeLocation(storeCode)               │
│              POST /do-change-location                    │
│              body: _token + location                     │
│              headers: X-XSRF-TOKEN                       │
│              Update CSRF/XSRF from response              │
└──────────────────────────────────────────────────────────┘
```

### [5/5] Fetch Prices & Stock

```
┌──────────────────────────────────────────────────────────┐
│  api.fetchPricesAndStock(page)                           │
│                                                          │
│  --use-browser?                                          │
│  ├─ YES → html = page.content() (use live Puppeteer DOM) │
│  └─ NO  → html = axios.GET /id/purchase/gold             │
│                                                          │
│  Parse with cheerio:                                     │
│    Extract CSRF token (meta / input)                     │
│    Extract tax params from hidden inputs:                │
│      #tax_type, #tax_rate_npwp, #tax_rate_non_npwp       │
│      #tax_number, #ppn_rate, #dpp_rate, #hemat_brankas   │
│    Parse variant rows (form#purchase .ctr):              │
│      id ← input[name="id_variant[]"]                     │
│      price ← qty input's price attribute                 │
│      weight ← qty input's weight attribute               │
│      inStock ← !.disabled && !.no-stock                  │
│                                                          │
│  Print price table:                                      │
│    Gram | Variant Name | Price | Stock (green/red)        │
│                                                          │
│  All out of stock?                                       │
│  ├─ YES → Offer to switch to other store (ASB1↔ASB2)    │
│  │        Re-fetch prices if user says yes               │
│  │        Still all out of stock → EXIT                  │
│  └─ NO  → continue                                      │
└──────────────────────────────────────────────────────────┘
```

### Race Tabs (background) + User Picks Cart Items (parallel)

```
┌──────────────────────────────────────────────────────────┐
│  These run IN PARALLEL:                                  │
│                                                          │
│  Background (if raceTabs > 1):                           │
│    raceLoadPage(browser, /id/purchase/gold, N)           │
│    N tabs race to load purchase page                     │
│    Each tab retries on non-2xx (1-3s random delay)       │
│    First tab to get HTTP 2xx wins                        │
│    Other tabs closed                                     │
│    → fastPurchasePagePromise (resolves to winning page)  │
│                                                          │
│  Foreground (interactive):                               │
│    promptCartItems(variants)                             │
│    Loop:                                                 │
│      "Gram (or Enter to finish):" → user types gram      │
│      Validate gram (0.5,1,2,3,5,10,25,50,100,250,500,1000) │
│      Show stock warning if out of stock                  │
│      Show price                                          │
│      "Qty:" → user types quantity                        │
│      Deduplicate (same gram → add qty)                   │
│    Until user presses Enter with empty gram               │
│    → cartItems = [{ variantId, qty }, ...]               │
│                                                          │
│  After user finishes:                                    │
│    Await fastPurchasePagePromise (if it was started)     │
│    Use race winner as active page                        │
│    Close old page                                        │
│                                                          │
│  No items selected? → EXIT                              │
└──────────────────────────────────────────────────────────┘
```

### Cart Summary + Confirmation

```
┌──────────────────────────────────────────────────────────┐
│  Attach live prices to selected items:                   │
│    itemsWithPrices = cartItems + variant.price + name    │
│                                                          │
│  Print cart summary table:                               │
│    Item Name | xQty | Subtotal                           │
│    ──────────────────────────                            │
│    Total                                                 │
│                                                          │
│  "Proceed to add to cart? (y/n)"                         │
│  ├─ n → EXIT                                            │
│  └─ y → continue                                        │
│                                                          │
│  Close readline (done with stdin)                        │
│  Refresh cookies + CSRF from winning tab                 │
└──────────────────────────────────────────────────────────┘
```

### [6/6] Add Items to Cart

```
┌──────────────────────────────────────────────────────────┐
│  api.addToCart(itemsWithPrices, taxParams)                │
│                                                          │
│  POST /add-to-cart-multiple                              │
│  FormData body:                                          │
│    _token = csrfToken                                    │
│    id_variant[] = ALL 12 variant IDs (site expects all)  │
│    qty[] = quantity for each (0 for unselected)          │
│    grand_total = sum of (price × qty)                    │
│    tax_type, tax_rate_npwp, tax_rate_non_npwp            │
│    tax_number, ppn_rate, dpp_rate, hemat_brankas          │
│    current_url = BASE_URL + /id/purchase/gold            │
│  Headers:                                                │
│    Origin, Referer, X-XSRF-TOKEN                         │
│                                                          │
│  Response:                                               │
│  ├─ HTTP 2xx (success):                                  │
│  │   Open N cart tabs via openUrlInMultipleTabs:          │
│  │     All N tabs load /id/my-cart                        │
│  │     Each retries until HTTP 2xx (1-3s between retries)│
│  │     Wait until ALL tabs loaded                        │
│  │                                                       │
│  │   >>> SCRIPT HANGS HERE <<<                           │
│  │   "Cart tabs are open. Press Ctrl+C when done."       │
│  │   await new Promise(() => {})   ← never resolves     │
│  │   Browser stays open with N cart tabs                 │
│  │   User does Ctrl+C → runs checkout-cart.js next       │
│  │                                                       │
│  ├─ HTTP 302 (redirect, also treated as success):        │
│  │   Same as above                                       │
│  │                                                       │
│  └─ HTTP 4xx/5xx (failure):                              │
│      Browser fallback:                                   │
│        Sync cookies to Puppeteer page                    │
│        Navigate to /id/purchase/gold                     │
│        Fill qty inputs via page.evaluate                 │
│          (#qty{variantId}.value = qty)                   │
│        Submit form (#purchase.submit())                  │
│        Wait for navigation                               │
│        (continues to checkout below — but only           │
│         reachable via this failure path)                 │
└──────────────────────────────────────────────────────────┘
```

---

## Phase 2: `checkout-cart.js` — Checkout

Run after `index.js` has added items and you've pressed Ctrl+C.

### [1/3] Launch Browser + Login

```
┌──────────────────────────────────────────────────────────┐
│  Same as index.js [1/5] + [2/5]:                         │
│                                                          │
│  --use-browser?                                          │
│  ├─ YES → Connect to existing Chrome (port 9222)         │
│  │        Find logammulia tab                            │
│  │        Check login / wait for manual login            │
│  └─ NO  → Launch new Puppeteer + stealth                 │
│           Race N tabs to /id/purchase/gold                │
│           Auto-fill credentials + submit                 │
│           Verify login                                   │
│                                                          │
│  Save snapshot: login.html                               │
└──────────────────────────────────────────────────────────┘
```

### [2/3] Verify Cart Has Items

```
┌──────────────────────────────────────────────────────────┐
│  Navigate to /id/my-cart (networkidle2, 60s timeout)     │
│  Wait 2s for page to settle                              │
│                                                          │
│  Check page HTML:                                        │
│  ├─ "Keranjang Anda kosong" or "kosong"                  │
│  │   AND no "cart-product" / "keranjang"                 │
│  │   → ABORT: "Cart is empty"                            │
│  │                                                       │
│  └─ Has cart content → continue                          │
│                                                          │
│  Save snapshot: cart-verify.html                          │
│  Close verification page (fresh tabs will be opened)     │
└──────────────────────────────────────────────────────────┘
```

### [3/3] Parallel Checkout — N Independent Tabs

Opens `LM_RACE_TABS` browser tabs. Each tab runs `tabCheckoutLoop()` **independently and in parallel**. This is NOT a race — every tab tries to complete the full checkout.

```
┌───────────────────────────────────────────────────────────────┐
│  Promise.all([ tab1, tab2, tab3, ... tabN ])                  │
│  Script ends when ALL tabs return (success or empty_cart)      │
│                                                               │
│  Each tab runs independently:                                 │
│                                                               │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  LOOP (retry forever until success or empty cart):        │  │
│  │                                                           │  │
│  │  ① Load /id/my-cart                                       │  │
│  │     page.goto(cartUrl, networkidle2, 60s)                 │  │
│  │     ├─ HTTP non-2xx → random 1-3s delay → RETRY ①        │  │
│  │     └─ HTTP 2xx → continue                                │  │
│  │     Wait 1s, save snapshot: cart-tabN-attemptM.html       │  │
│  │                                                           │  │
│  │  ② Check cart not empty                                   │  │
│  │     page.evaluate: look for "Keranjang Anda kosong"       │  │
│  │     ├─ Empty → close tab, return { success: false,        │  │
│  │     │          reason: "empty_cart" }                      │  │
│  │     └─ Has items → continue                               │  │
│  │                                                           │  │
│  │  ③ Find & click checkout button                           │  │
│  │     tryClickSelector with 8 selectors in order:           │  │
│  │       a[href*="checkout"]                                 │  │
│  │       button:has-text("Checkout")                         │  │
│  │       #btn-checkout                                       │  │
│  │       .btn-checkout                                       │  │
│  │       a.btn-green:has-text("Checkout")                    │  │
│  │       a:has-text("Proses")                                │  │
│  │       a:has-text("Lanjut")                                │  │
│  │       button:has-text("Proses")                           │  │
│  │                                                           │  │
│  │     (:has-text is handled manually — querySelectorAll     │  │
│  │      + textContent.includes match)                        │  │
│  │                                                           │  │
│  │     None matched? Fallback scan:                          │  │
│  │       querySelectorAll(".btn-green, .btn-primary, a.btn") │  │
│  │       Click first with text: proses/checkout/lanjut/bayar │  │
│  │                                                           │  │
│  │     Still nothing? Debug + manual pause:                  │  │
│  │       Log all visible buttons (tag, text, class, href)    │  │
│  │       Save snapshot: error-tabN-attemptM-no-btn.html      │  │
│  │       Wait 60s for user to click manually                 │  │
│  │       ├─ URL changed → continue to ⑤                     │  │
│  │       └─ Timeout → random 1-3s delay → RETRY ①           │  │
│  │                                                           │  │
│  │  ④ Wait for navigation after click                        │  │
│  │     page.waitForNavigation(networkidle2, 60s)             │  │
│  │     Wait 2s settle time                                   │  │
│  │     ├─ HTTP non-2xx → save error snapshot → RETRY ①       │  │
│  │     └─ HTTP 2xx → continue                                │  │
│  │     Save snapshot: checkout-tabN-attemptM.html            │  │
│  │                                                           │  │
│  │  ⑤ processCheckoutPage(page) — 3 sub-steps:              │  │
│  │     │                                                     │  │
│  │     ├─ 5a. handleTransactionDestination                   │  │
│  │     │   Check for swal-content/swal-modal/fancybox-content│  │
│  │     │   containing "tujuan transaksi" or "Tujuan"         │  │
│  │     │   ├─ No popup → skip                                │  │
│  │     │   └─ Popup found:                                   │  │
│  │     │      Look for radio buttons inside labels           │  │
│  │     │      Click one matching config.tujuanTransaksi      │  │
│  │     │      (or select dropdown option if no radios)       │  │
│  │     │      Click submit: button[type="submit"], .btn-green│  │
│  │     │        a.btn:has-text("Simpan"),                    │  │
│  │     │        button:has-text("Simpan"/"OK")               │  │
│  │     │      Wait 2s                                        │  │
│  │     │                                                     │  │
│  │     ├─ 5b. handlePaymentSelection                        │  │
│  │     │   Wait 2s                                           │  │
│  │     │   LM_PAYMENT_METHOD set?                            │  │
│  │     │   ├─ NO → "Pausing for manual selection"            │  │
│  │     │   │       waitForPageChange(120s)                   │  │
│  │     │   │       (polls URL every 2s, returns when changed)│  │
│  │     │   └─ YES:                                           │  │
│  │     │      Scan input[type="radio"], a.payment-method,    │  │
│  │     │        .payment-option                              │  │
│  │     │      Match text/parentText against method           │  │
│  │     │      ├─ Found → click, wait 1s                      │  │
│  │     │      │   Click proceed: button[type="submit"],      │  │
│  │     │      │     .btn-green, a.btn-green,                 │  │
│  │     │      │     button:has-text(Bayar/Proses/Konfirmasi) │  │
│  │     │      │   waitForNavigation(networkidle2)            │  │
│  │     │      └─ Not found → "Please select manually"        │  │
│  │     │           waitForManualAction(120s)                 │  │
│  │     │           (polls URL + checks page.title every 5s)  │  │
│  │     │                                                     │  │
│  │     └─ 5c. handleOrderConfirmation                       │  │
│  │         Wait 2s, evaluate page:                           │  │
│  │           url, hasConfirmation, hasSuccess, hasOrderId    │  │
│  │                                                           │  │
│  │         ├─ hasSuccess ("berhasil"/"Terima kasih"):        │  │
│  │         │   "Order placed successfully!"                  │  │
│  │         │   Extract Order ID via regex:                   │  │
│  │         │     /No\.?\s*Order|Order\s*ID[:\s]*([A-Z0-9-]+)/│  │
│  │         │   Print Order ID if found → DONE                │  │
│  │         │                                                 │  │
│  │         ├─ hasConfirmation ("konfirmasi"):                │  │
│  │         │   Click confirm:                                │  │
│  │         │     button:has-text("Konfirmasi"/"Ya"),          │  │
│  │         │     button[type="submit"], .btn-green,           │  │
│  │         │     .swal-button--confirm                        │  │
│  │         │   Wait 3s + waitForNavigation                   │  │
│  │         │   Check for "berhasil" → print result → DONE    │  │
│  │         │                                                 │  │
│  │         └─ Neither:                                       │  │
│  │             "Waiting for manual completion..."            │  │
│  │             waitForManualAction(300s)                     │  │
│  │             (polls URL every 5s, checks for "berhasil"    │  │
│  │              or "Terima kasih" on URL change) → DONE      │  │
│  │                                                           │  │
│  │     processCheckoutPage result:                           │  │
│  │     ├─ Success → save confirmation-tabN.html              │  │
│  │     │            close tab                                │  │
│  │     │            return { success: true, attempts }       │  │
│  │     └─ Error (throw) → save error snapshot                │  │
│  │                        random 1-3s delay → RETRY ①        │  │
│  │                                                           │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                               │
│  After Promise.all resolves — print results:                  │
│                                                               │
│    Tab 1: SUCCESS - in 3 attempt(s)                           │
│    Tab 2: SUCCESS - in 1 attempt(s)                           │
│    Tab 3: FAILED  - empty_cart                                │
│    ...                                                        │
│    5/10 tabs completed checkout successfully.                 │
└───────────────────────────────────────────────────────────────┘
```

---

## Full Timeline

```
index.js                                   checkout-cart.js
────────────────────────────────────────   ─────────────────────────────────────

Prompt: Select store (D/P)

[1/5] Launch browser
      (Puppeteer launch or connect)

[2/5] Login
      (race N tabs → Cloudflare bypass
       → auto-fill credentials or
       wait for manual login)

[3/5] Navigate to purchase page
      Extract cookies + CSRF token
      Initialize API client
      (cookie jar + XSRF header)

[4/5] Switch store location
      (API POST or browser form submit)

[5/5] Fetch prices & stock
      (cheerio parse purchase page HTML)
      Print price table
      Handle out-of-stock → offer switch

      ┌─ PARALLEL ─────────────┐
      │ Background:             │
      │   Race N tabs to load   │
      │   purchase page         │
      │                         │
      │ Foreground:             │
      │   User enters gram+qty  │
      │   (interactive prompts) │
      └─────────────────────────┘

      Print cart summary
      "Proceed to add to cart? (y/n)"
      Refresh cookies + CSRF

[6/6] Add to cart
      POST /add-to-cart-multiple
      (all 12 variants, selected qtys)

      ├─ 2xx: Open N cart tabs
      │  (all retry until 2xx)
      │
      │  >>> HANGS HERE <<<
      │  "Press Ctrl+C when done"          [1/3] Launch browser + login
      │  User presses Ctrl+C                     (same as index.js [1/5]+[2/5])
      │
      └─ 4xx/5xx: Browser fallback         [2/3] Verify cart has items
         Fill form + submit                      Load /id/my-cart
         (continues to checkout                  Check not empty
          only via this path)                    Save snapshot

                                            [3/3] Parallel checkout (N tabs)
                                                  Each tab independently:
                                                  ① Load cart
                                                  ② Verify not empty
                                                  ③ Click checkout button
                                                  ④ Wait for navigation
                                                  ⑤ processCheckoutPage:
                                                     a. Transaction popup
                                                     b. Payment selection
                                                     c. Order confirmation
                                                  Retry ① on any failure
                                                  Return on success

                                                  Print results summary
                                                  "X/N tabs completed"
```

---

## HTML Snapshots

Both scripts save page HTML to `results/{unix_timestamp}/` for debugging.

```
results/1738000000/
  login.html                              # after login
  cart-verify.html                         # cart verification
  cart-tab1-attempt1.html                  # tab 1 loaded cart
  cart-tab2-attempt1.html                  # tab 2 loaded cart
  checkout-tab1-attempt1.html              # tab 1 after checkout click
  confirmation-tab1.html                   # tab 1 success page
  error-tab3-attempt1-http503.html         # tab 3 got 503
  error-tab5-attempt2-no-btn.html          # tab 5 couldn't find button
  error-tab5-attempt2-checkout.html        # tab 5 checkout processing failed
```

Use snapshots to discover actual HTML structure (e.g., the checkout button markup) and debug failures.
