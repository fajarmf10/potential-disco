# Logam Mulia Stock Monitor

Checks gold stock availability across multiple Logam Mulia stores every 60 seconds and sends results to a Telegram channel.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure `.env`

Edit `.env` with your credentials, store codes, Telegram bot token, and debug port.

### 3. Launch Chrome with remote debugging

This script connects to an existing Chrome instance. You must launch Chrome with a dedicated profile and debug port **before** running the monitor.

```bash
chrome.exe --remote-debugging-port=9229 --user-data-dir="C:\tmp\chrome-profile-real"
```

- Port `9229` is configured in `.env` (`LM_DEBUG_PORT=9229`)
- The `--user-data-dir` must be a separate directory from your main Chrome profile (and from any other instance)
- Log in to https://logammulia.com manually in this Chrome window before starting the monitor

### 4. Run

```bash
npm run monitor
```

## How it works

1. Connects to Chrome on port 9229
2. Verifies you're logged in to logammulia.com
3. Every 60 seconds, cycles through configured stores:
   - Switches store via in-browser fetch POST
   - Loads the purchase page
   - Parses stock/price data from HTML and `purchase_array`
4. Prints a stock table to the console
5. Sends results to Telegram every cycle

## Files

| File | Purpose |
|---|---|
| `stock-monitor.js` | Main monitor loop, Telegram integration |
| `config.js` | Config parsing, variant/store definitions |
| `lib/browser.js` | Puppeteer connection, login, Cloudflare handling |
| `.env` | Credentials, store codes, Telegram config, debug port |

## .env reference

| Variable | Default | Purpose |
|---|---|---|
| `LM_EMAIL` | - | Login email |
| `LM_PASSWORD` | - | Login password |
| `LM_STORE_CODES` | `ASB1,ASB2` | Comma-separated store codes to check |
| `LM_DEBUG_PORT` | `9222` | Chrome remote debugging port |
| `LM_RACE_TABS` | `10` | Number of parallel tabs for page loading |
| `LM_HEADLESS` | `true` | Headless browser mode |
| `LM_TUJUAN_TRANSAKSI` | `Investasi` | Transaction purpose |
| `LM_TELEGRAM_BOT_TOKEN` | - | Telegram bot token |
| `LM_TELEGRAM_CHAT_ID` | - | Telegram channel chat ID |

## Store codes

```
ABDH  - Pulogadung Jakarta (Ekspedisi)
AGDP  - Graha Dipta Pulo Gadung
AJK2  - Gedung Antam
AJK4  - Setiabudi One
ABDG  - Bandung
ASMG  - Semarang
AJOG  - Yogyakarta
ASB1  - Surabaya Darmo
ASB2  - Surabaya Pakuwon
ADPS  - Denpasar Bali
ABPN  - Balikpapan
AMKS  - Makassar
AKNO  - Medan
APLG  - Palembang
APKU  - Pekanbaru
ABSD  - Serpong
BTR01 - Bintaro
BGR01 - Bogor
BKS01 - Bekasi
JKT05 - Juanda
JKT06 - Puri Indah
```
