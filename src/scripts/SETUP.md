# Setup Guide

## 1. Prerequisites

**macOS:**

```bash
brew install node
```

**Windows:**

Download and install Node.js from https://nodejs.org (LTS).

**Both platforms:**

```bash
cd src/scripts
npm install
```

## 2. Configure `.env`

```bash
cp .env.example .env
```

Edit `.env`:

```
LM_EMAIL=your@email.com
LM_PASSWORD=yourpassword
LM_RACE_TABS=10
LM_HEADLESS=false
LM_TUJUAN_TRANSAKSI=Investasi
LM_PAYMENT_METHOD=
```

Not needed if using `--use-browser` mode (credentials come from the existing Chrome session).

---

## 3. Launch Chrome with Remote Debugger

Close Chrome completely before relaunching with the debug flag.

### macOS

Quit Chrome (`Cmd+Q`), then:

```bash
# Dedicated profile (recommended — isolated from your main Chrome)
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/chrome-lm-profile"
```

#### Using an existing macOS Chrome profile

Profiles live at `~/Library/Application Support/Google/Chrome/`. Folders are named `Default`, `Profile 1`, `Profile 2`, etc.

Find which folder maps to which profile name:

```bash
for d in ~/Library/Application\ Support/Google/Chrome/Profile*/; do
  name=$(python3 -c "import json; print(json.load(open('$d/Preferences'))['profile']['name'])" 2>/dev/null)
  echo "$(basename "$d") → $name"
done
```

Launch with that profile:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/Library/Application Support/Google/Chrome" \
  --profile-directory="Profile 1"
```

#### Optional: Shell alias

Add to `~/.zshrc`:

```bash
alias chrome-debug='/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir="$HOME/chrome-lm-profile"'
```

Then `source ~/.zshrc` and run `chrome-debug`.

---

### Windows

Close Chrome from the system tray (right-click tray icon > Exit), then open **Command Prompt** or **PowerShell**:

**Command Prompt:**

```cmd
:: Dedicated profile (recommended)
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%USERPROFILE%\chrome-lm-profile"
```

**PowerShell:**

```powershell
# Dedicated profile (recommended)
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="$env:USERPROFILE\chrome-lm-profile"
```

This creates a separate Chrome profile at `%USERPROFILE%\chrome-lm-profile`. Cookies, login session, and extensions are isolated there and persist across restarts.

#### Using an existing Windows Chrome profile

Profiles live at `%LOCALAPPDATA%\Google\Chrome\User Data\`. Folders are named `Default`, `Profile 1`, `Profile 2`, etc.

Find which folder maps to which profile name (PowerShell):

```powershell
Get-ChildItem "$env:LOCALAPPDATA\Google\Chrome\User Data\Profile*" | ForEach-Object {
  $prefs = Get-Content "$($_.FullName)\Preferences" | ConvertFrom-Json
  "$($_.Name) → $($prefs.profile.name)"
}
```

Launch with that profile:

**Command Prompt:**

```cmd
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%LOCALAPPDATA%\Google\Chrome\User Data" --profile-directory="Profile 1"
```

**PowerShell:**

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="$env:LOCALAPPDATA\Google\Chrome\User Data" --profile-directory="Profile 1"
```

#### Optional: Desktop shortcut

1. Right-click Desktop > New > Shortcut
2. Target: `"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%USERPROFILE%\chrome-lm-profile"`
3. Name it `Chrome Debug`

---

## 4. Verify the debugger is exposed

In a separate terminal:

**macOS:**

```bash
curl -s http://localhost:9222/json/version | python3 -m json.tool
```

**Windows (PowerShell):**

```powershell
Invoke-RestMethod http://localhost:9222/json/version | ConvertTo-Json
```

You should see a JSON response containing `webSocketDebuggerUrl`. If you get "Connection refused", Chrome isn't running with the debug port or something else is using port 9222.

## 5. Log in to logammulia.com

In the Chrome window that opened, navigate to https://logammulia.com and log in manually. The script will reuse this session.

## 6. Run the script

In a separate terminal:

```bash
cd src/scripts

# Connect to your running Chrome (uses your logged-in session)
node index.js --use-browser

# Or auto-login mode (launches its own Chrome, needs LM_EMAIL + LM_PASSWORD in .env)
node index.js
```

### Standalone checkout (if cart already has items)

```bash
node checkout-cart.js --use-browser
```

---

## Troubleshooting

### "Cannot connect to browser"

- Make sure Chrome was fully closed before relaunching with `--remote-debugging-port`
- Check nothing else is using port 9222:
  - macOS: `lsof -i :9222`
  - Windows: `netstat -ano | findstr :9222`
- Try a different port: `--remote-debugging-port=9223` and set `LM_DEBUG_PORT=9223` in `.env`

### "LM_EMAIL and LM_PASSWORD must be set"

You're running without `--use-browser` but haven't set credentials in `.env`. Either:
- Add credentials to `src/scripts/.env`
- Or use `--use-browser` to connect to an existing logged-in Chrome

### Chrome opens but looks empty / wrong profile

`--user-data-dir` creates a fresh profile. If you want your existing bookmarks and logins, use the `--profile-directory` approach pointing to your real Chrome user data directory.

### Chrome path not found (Windows)

If Chrome is installed elsewhere, check:
- `C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`
- Or find it: `where chrome` in Command Prompt
