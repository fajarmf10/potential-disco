# Logam Mulia Gold Purchase Automation

Automates the gold purchase flow at logammulia.com with Cloudflare bypass, multi-store checking, and interactive cart builder.

---

## Setup

```bash
npm install
cp .env.example .env
# Edit .env with your credentials
```

---

## Usage

### List All Store Locations

```bash
npm run stores
```

Shows all 21 BELM store locations grouped by city with codes.

### Switch Store Location

```bash
npm run switch
# or with existing browser:
npm run switch -- --use-browser
```

Interactive utility to switch your account's store location. Lists all locations and lets you pick by number or code.

### Basic Flow (Auto-login)

```bash
npm start
```

Interactive flow:
1. Prompts for store selection (Surabaya Darmo or Pakuwon)
2. Auto-logs in via Puppeteer (bypasses Cloudflare)
3. Fetches prices and stock for selected store
4. Prompts for items to buy (enter gram weight, then quantity)
5. Adds to cart via API
6. Processes checkout via browser automation

---

### Connect to Existing Browser (Manual Login)

```bash
npm start -- --use-browser
```

This mode connects to a Chrome/Edge instance you've already opened and logged into.

**Steps:**

1. **Launch Chrome with remote debugging:**
   ```bash
   chrome.exe --remote-debugging-port=9222 --user-data-dir="C:\tmp\chrome-profile"
   ```

   (On macOS/Linux: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-port=9222 --user-data-dir="/tmp/chrome-profile"`)

2. **Log in manually:**
   - Open https://logammulia.com/id/purchase/gold in that Chrome window
   - Log in with your credentials
   - Solve Cloudflare challenge manually if prompted

3. **Run the script:**
   ```bash
   npm start -- --use-browser
   ```

   The script will connect to your browser session and take over from there.

**Benefits:**
- You handle Cloudflare yourself (more reliable)
- You can see everything happening in real-time
- No need to store credentials in .env (if you prefer manual login)

---

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `LM_EMAIL` | Logam Mulia account email | `user@example.com` |
| `LM_PASSWORD` | Account password | `MyP@ssw0rd` |
| `LM_STORE_CODES` | Store codes to check (comma-separated) | `ASB1,ASB2` |
| `LM_HEADLESS` | Run browser in headless mode (true/false) | `false` |
| `LM_TUJUAN_TRANSAKSI` | Transaction purpose (Investasi or Perdagangan) | `Investasi` |
| `LM_PAYMENT_METHOD` | Auto-select payment method (optional) | `transfer_va` |

---

## Store Codes

| Code | Location |
|------|----------|
| ASB1 | Surabaya Darmo |
| ASB2 | Surabaya Pakuwon |
| ABDH | Pulogadung Jakarta (Ekspedisi) |
| AJK2 | Gedung Antam |
| AJK4 | Setiabudi One |
| ABDG | Bandung |
| ASMG | Semarang |
| AJOG | Yogyakarta |
| ADPS | Denpasar Bali |
| ABPN | Balikpapan |
| AMKS | Makassar |
| AKNO | Medan |
| APLG | Palembang |
| APKU | Pekanbaru |
| ABSD | Serpong |
| BTR01 | Bintaro |
| BGR01 | Bogor |
| BKS01 | Bekasi |
| JKT05 | Juanda |
| JKT06 | Puri Indah |

---

## Available Gram Weights

0.5, 1, 2, 3, 5, 10, 25, 50, 100, 250, 500, 1000

---

## Architecture

- `index.js` - Main entry point, interactive prompts, orchestrates flow
- `config.js` - Configuration, variant definitions, store mappings
- `lib/browser.js` - Puppeteer setup, Cloudflare bypass, login automation
- `lib/api.js` - Axios client with cookie support, price/stock parsing, add-to-cart API
- `lib/checkout.js` - Checkout flow automation (cart verify, payment, confirmation)
- `lib/prompt.js` - Readline interface for interactive prompts

---

## Flow Diagram

```
1. Store Selection (user prompt)
   |
2. Browser Launch/Connect
   |
3. Login (auto via Puppeteer OR manual in existing browser)
   |
4. Switch to selected store via API
   |
5. Fetch prices and stock (parse HTML with cheerio)
   |
6. Interactive cart builder (user enters gram + qty)
   |
7. Add to cart via API (fast, no browser needed)
   |
8. Checkout via Puppeteer (cart verify, payment, confirmation)
   |
9. Done
```

---

## Troubleshooting

### "Could not connect to existing browser"
Make sure Chrome is running with `--remote-debugging-port=9222` before running with `--use-browser`.

### "Login failed"
Check your credentials in .env. If using `--use-browser`, make sure you logged in manually first.

### "Cloudflare challenge did not resolve"
The stealth plugin usually bypasses Cloudflare automatically. If it fails, use `--use-browser` and solve it manually.

### "Out of stock" warnings
The script will still attempt to add items to cart. The site may block the order at checkout.

---

## Notes

- The script uses `tough-cookie` to maintain session across axios and Puppeteer
- CSRF tokens are extracted from page HTML and included in all POST requests
- Stock status is determined by the `disabled` class and `no-stock` span in the HTML
- PPN (VAT) is displayed but NOT added to the total per PP 49/2022 regulation
