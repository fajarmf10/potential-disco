# Quick Start

## Option 1: Auto-login (easiest)

```bash
# 1. Install
npm install

# 2. Set credentials
cp .env.example .env
# Edit .env: fill in LM_EMAIL and LM_PASSWORD

# 3. Run
npm start

# Interactive flow:
# - Select store (D or P)
# - Enter gram weights and quantities
# - Confirm and checkout
```

---

## Option 2: Use existing browser (recommended for Cloudflare issues)

```bash
# 1. Close all Chrome windows

# 2. Launch Chrome with remote debugging enabled
chrome.exe --remote-debugging-port=9222 --user-data-dir="C:\tmp\chrome-profile"

# 3. Log in manually
# - Open https://logammulia.com/id/purchase/gold
# - Log in with your account
# - Leave browser open

# 4. Run script (in a new terminal)
npm start -- --use-browser

# The script connects to your browser and automates from there
```

**Can't close Chrome?** Launch a separate instance on a different port:

```bash
chrome.exe --remote-debugging-port=9223 --user-data-dir="C:\tmp\chrome-auto"
# Then: set LM_DEBUG_PORT=9223 && npm start -- --use-browser
```

Or set the port in `.env`:
```
LM_DEBUG_PORT=9223
```

**Why use this?**
- You handle Cloudflare yourself (100% reliable)
- See everything in real-time
- No credentials in .env needed (log in manually)

---

## Interactive Flow

```
Select store:
  D - Surabaya Darmo  (ASB1)
  P - Surabaya Pakuwon (ASB2)

Store (D/P): D

[Script fetches prices and shows stock table]

Add items to cart
Enter gram weight, then quantity. Empty gram to finish.
Available: 0.5, 1, 2, 3, 5, 10, 25, 50, 100, 250, 500, 1000

Gram (or Enter to finish): 2
Price: Rp 5,790,000
Qty: 5
Added: Emas Batangan - 2 gr x5

Gram (or Enter to finish): 5
Price: Rp 14,415,000
Qty: 2
Added: Emas Batangan - 5 gr x2

Gram (or Enter to finish): [Enter]

[Shows cart summary]
Proceed to add to cart? (y/n): y

[Adds to cart and processes checkout]
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Could not connect to existing browser" | Make sure Chrome is running with `--remote-debugging-port=9222` |
| "Login failed - check your credentials" | Verify email/password in .env |
| "Cloudflare challenge did not resolve" | Use `--use-browser` and solve manually |
| Items out of stock | Script warns but continues - may fail at checkout |
| `page.waitForTimeout is not a function` | Update to latest code (fixed) |
