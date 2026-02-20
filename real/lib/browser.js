const puppeteer = require('puppeteer-extra');
const puppeteerCore = require('puppeteer-core');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const config = require('../config');

puppeteer.use(StealthPlugin());

const NAVIGATION_TIMEOUT = 60_000;
const CF_WAIT_TIMEOUT = 30_000;

// Helper: wait for timeout (backwards compat with older Puppeteer)
async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

async function isCloudflareAlwaysOnline(page) {
  try {
    return await page.evaluate(() => {
      const bodyText = document.body?.innerText || '';
      return (
        bodyText.includes('Always Online') ||
        bodyText.includes('currently offline') ||
        !!document.querySelector('#cf-always-online')
      );
    });
  } catch {
    return false;
  }
}

async function launchBrowser(options = {}) {
  const { useExisting = false, debugPort = null, browserType = config.browserType } = options;
  const isFirefox = browserType === 'firefox';

  if (useExisting) {
    const port = debugPort || parseInt(process.env.LM_DEBUG_PORT || '9222', 10);
    const browserName = isFirefox ? 'Firefox' : 'Chrome/Edge';

    console.log(`[browser] Connecting to existing ${browserName} at localhost:${port}...`);

    if (isFirefox) {
      return connectToFirefox(port);
    }

    return connectToChrome(port);
  }

  if (isFirefox) {
    console.log('[browser] Firefox is only supported with --use-browser (connect to existing instance).');
    console.log('[browser] Falling back to Chrome for new browser launch.');
  }

  // Launch a new Chrome instance (stealth plugin is Chrome-only)
  const browser = await puppeteer.launch({
    headless: config.headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1366,768',
    ],
    defaultViewport: { width: 1366, height: 768 },
  });
  return browser;
}

const axios = require('axios');

// Fetch Chrome's WebSocket URL from /json/version endpoint
async function fetchWsUrl(port) {
  const res = await axios.get(`http://localhost:${port}/json/version`, { timeout: 5_000 });
  return res.data?.webSocketDebuggerUrl || null;
}

async function connectToChrome(port) {
  const portsToTry = [port, 9222, 9223, 9224, 9225].filter((p, i, arr) => arr.indexOf(p) === i);

  for (const p of portsToTry) {
    if (p !== port) {
      console.log(`[browser] Port ${port} unavailable, trying ${p}...`);
    }
    try {
      const wsUrl = await fetchWsUrl(p);
      if (!wsUrl) continue;
      console.log(`[browser] Found Chrome on port ${p}, connecting via WebSocket...`);
      const browser = await puppeteer.connect({
        browserWSEndpoint: wsUrl,
        defaultViewport: null,
      });
      console.log(`[browser] Connected to Chrome on port ${p}`);
      return browser;
    } catch (e) {
      // Continue to next port
    }
  }

  throw new Error(
    `Could not connect to Chrome on ports ${portsToTry.join(', ')}.\n\n` +
    `Make sure Chrome/Edge is running with:\n` +
    `  chrome.exe --remote-debugging-port=9222 --user-data-dir="C:\\tmp\\chrome-profile"\n\n` +
    `Or set the port via environment variable:\n` +
    `  set LM_DEBUG_PORT=9222\n`
  );
}

async function connectToFirefox(port) {
  // Firefox: use puppeteer-core directly (no stealth plugin needed for existing browser).
  // Try browserURL first (Firefox exposes /json/version on recent versions),
  // then fall back to direct WebSocket endpoint.
  try {
    const browser = await puppeteerCore.connect({
      browserURL: `http://localhost:${port}`,
      defaultViewport: null,
    });
    console.log(`[browser] Connected to Firefox on port ${port}`);
    return browser;
  } catch (firstErr) {
    // Fallback: try direct WebSocket connection
    try {
      console.log(`[browser] HTTP endpoint failed, trying WebSocket...`);
      const browser = await puppeteerCore.connect({
        browserWSEndpoint: `ws://localhost:${port}`,
        defaultViewport: null,
      });
      console.log(`[browser] Connected to Firefox on port ${port} (WebSocket)`);
      return browser;
    } catch (wsErr) {
      throw new Error(
        `Could not connect to Firefox on port ${port}.\n\n` +
        `Make sure Firefox is running with:\n` +
        `  firefox.exe --remote-debugging-port=${port}\n\n` +
        `Or set the port via environment variable:\n` +
        `  set LM_DEBUG_PORT=${port}\n\n` +
        `HTTP error: ${firstErr.message}\n` +
        `WebSocket error: ${wsErr.message}`
      );
    }
  }
}

async function waitForCloudflare(page) {
  // Cloudflare challenge typically shows a "Verifying you are human" or
  // "Just a moment..." page. We wait until the page URL no longer contains
  // challenge indicators and the body has real content.
  const startTime = Date.now();
  while (Date.now() - startTime < CF_WAIT_TIMEOUT) {
    const title = await page.title();
    const url = page.url();

    // Cloudflare challenge pages have specific titles
    if (
      title.includes('Just a moment') ||
      title.includes('Attention Required') ||
      title.includes('Checking your browser') ||
      url.includes('/cdn-cgi/challenge-platform')
    ) {
      await wait(2000);
      continue;
    }

    // Check if there is a Turnstile iframe - if so, wait for it to resolve
    const turnstile = await page.$('iframe[src*="challenges.cloudflare.com"]');
    if (turnstile) {
      await wait(3000);
      continue;
    }

    // Page loaded past Cloudflare
    return true;
  }

  throw new Error('Cloudflare challenge did not resolve within timeout');
}

// Race multiple tabs to load a URL - each tab retries forever until one gets HTTP 2xx.
// Use options.logAttempts=false when this runs alongside interactive prompts.
async function raceLoadPage(browser, url, numTabs = 10, options = {}) {
  const {
    logAttempts = true,
    retryDelayMinMs = 1000,
    retryDelayMaxMs = 3000,
    onRateLimit = null,
  } = options;
  const safeTabs = Math.max(1, parseInt(numTabs, 10) || 1);

  console.log(`[browser] Racing ${safeTabs} tabs to load page...`);

  const pages = [];
  for (let i = 0; i < safeTabs; i++) {
    pages.push(await browser.newPage());
  }

  let resolved = false;

  // Shared rate-limit state across all tabs
  const rl = { cooldownUntil: 0, shouldRestart: false, prompted: false };

  async function attemptTab(p, tabIndex) {
    let attempt = 0;
    while (!resolved && !rl.shouldRestart) {
      // Wait for any active rate-limit cooldown
      if (rl.cooldownUntil > Date.now()) {
        if (tabIndex === 0) {
          const remaining = Math.ceil((rl.cooldownUntil - Date.now()) / 1000);
          console.log(`[browser] Tab ${tabIndex + 1}: Waiting ${remaining}s for rate limit cooldown, resuming at ${formatTime(rl.cooldownUntil)}`);
        }
        while (rl.cooldownUntil > Date.now() && !resolved && !rl.shouldRestart) {
          await wait(1000);
        }
        if (rl.shouldRestart) return null;
      }

      attempt++;
      try {
        const response = await p.goto(url, {
          waitUntil: 'networkidle2',
          timeout: NAVIGATION_TIMEOUT,
        });

        const status = response ? response.status() : 0;

        if (status >= 200 && status < 300 && !resolved) {
          return { page: p, status, tabIndex };
        }

        if (resolved) return null;

        if (status === 429) {
          // Only one tab sets the cooldown
          if (rl.cooldownUntil <= Date.now()) {
            const retryAfter = response.headers()['retry-after'];
            const cooldownSec = retryAfter ? parseInt(retryAfter, 10) || 60 : 60;
            const resumeAt = Date.now() + cooldownSec * 1000;
            console.log(`[browser] Rate limited (429). All tabs pausing for ${cooldownSec}s, resuming at ${formatTime(resumeAt)} (Retry-After: ${retryAfter || 'none, defaulting 60s'})`);
            rl.cooldownUntil = resumeAt;

            // Ask user if they want to restart (once, non-blocking for other tabs)
            if (onRateLimit && !rl.prompted) {
              rl.prompted = true;
              onRateLimit(cooldownSec, formatTime(resumeAt)).then(action => {
                if (action === 'restart') {
                  rl.shouldRestart = true;
                  rl.cooldownUntil = 0;
                }
              }).catch(() => {});
            }
          }
          continue;
        }

        if (logAttempts) {
          console.log(`[browser] Tab ${tabIndex + 1}/${safeTabs}: HTTP ${status} (attempt ${attempt}), retrying...`);
        }
      } catch (err) {
        if (resolved) return null;
        if (logAttempts) {
          console.log(`[browser] Tab ${tabIndex + 1}/${safeTabs}: ${err.message} (attempt ${attempt}), retrying...`);
        }
      }

      // Stagger retries with jitter
      const minDelay = Math.max(0, retryDelayMinMs);
      const maxDelay = Math.max(minDelay, retryDelayMaxMs);
      await wait(minDelay + Math.random() * (maxDelay - minDelay));
    }
    return null;
  }

  return new Promise((resolve, reject) => {
    for (let i = 0; i < pages.length; i++) {
      attemptTab(pages[i], i).then(result => {
        if (rl.shouldRestart && !resolved) {
          resolved = true;
          for (const p of pages) p.close().catch(() => {});
          reject(new Error('RATE_LIMITED_RESTART'));
          return;
        }
        if (result && !resolved) {
          resolved = true;
          console.log(`[browser] Tab ${result.tabIndex + 1}/${safeTabs} won with HTTP ${result.status}`);
          for (const p of pages) {
            if (p !== result.page) p.close().catch(() => {});
          }
          resolve(result.page);
        }
      });
    }
  });
}

// Open the same URL in multiple tabs and keep retrying each tab until all get HTTP 2xx.
async function openUrlInMultipleTabs(browser, url, numTabs = 10, options = {}) {
  const {
    waitUntil = 'networkidle2',
    timeout = NAVIGATION_TIMEOUT,
    logEachTab = true,
    retryDelayMinMs = 1000,
    retryDelayMaxMs = 3000,
    onRateLimit = null,
  } = options;
  const safeTabs = Math.max(1, parseInt(numTabs, 10) || 1);

  console.log(`[browser] Opening ${safeTabs} tabs and waiting until all load with HTTP 2xx...`);

  const pages = [];
  for (let i = 0; i < safeTabs; i++) {
    pages.push(await browser.newPage());
  }

  // Shared rate-limit state across all tabs
  const rl = { cooldownUntil: 0, shouldRestart: false, prompted: false };

  const results = await Promise.all(pages.map(async (p, idx) => {
    let attempt = 0;
    while (!rl.shouldRestart) {
      // Wait for any active rate-limit cooldown
      if (rl.cooldownUntil > Date.now()) {
        if (idx === 0) {
          const remaining = Math.ceil((rl.cooldownUntil - Date.now()) / 1000);
          console.log(`[browser] Cart tab ${idx + 1}: Waiting ${remaining}s for rate limit cooldown, resuming at ${formatTime(rl.cooldownUntil)}`);
        }
        while (rl.cooldownUntil > Date.now() && !rl.shouldRestart) {
          await wait(1000);
        }
        if (rl.shouldRestart) return { page: p, tabIndex: idx, status: 429, ok: false, attempts: attempt, rateLimited: true };
      }

      attempt++;
      try {
        const response = await p.goto(url, { waitUntil, timeout });
        const status = response ? response.status() : 0;
        if (status >= 200 && status < 300) {
          if (logEachTab) {
            console.log(`[browser] Cart tab ${idx + 1}/${safeTabs}: HTTP ${status} (loaded on attempt ${attempt})`);
          }
          return { page: p, tabIndex: idx, status, ok: true, attempts: attempt };
        }

        if (status === 429) {
          if (rl.cooldownUntil <= Date.now()) {
            const retryAfter = response.headers()['retry-after'];
            const cooldownSec = retryAfter ? parseInt(retryAfter, 10) || 60 : 60;
            const resumeAt = Date.now() + cooldownSec * 1000;
            console.log(`[browser] Rate limited (429). All tabs pausing for ${cooldownSec}s, resuming at ${formatTime(resumeAt)} (Retry-After: ${retryAfter || 'none, defaulting 60s'})`);
            rl.cooldownUntil = resumeAt;

            if (onRateLimit && !rl.prompted) {
              rl.prompted = true;
              onRateLimit(cooldownSec, formatTime(resumeAt)).then(action => {
                if (action === 'restart') {
                  rl.shouldRestart = true;
                  rl.cooldownUntil = 0;
                }
              }).catch(() => {});
            }
          }
          continue;
        }

        if (logEachTab) {
          console.log(`[browser] Cart tab ${idx + 1}/${safeTabs}: HTTP ${status} (attempt ${attempt}), retrying...`);
        }
      } catch (err) {
        if (logEachTab) {
          console.log(`[browser] Cart tab ${idx + 1}/${safeTabs}: ${err.message} (attempt ${attempt}), retrying...`);
        }
      }

      const minDelay = Math.max(0, retryDelayMinMs);
      const maxDelay = Math.max(minDelay, retryDelayMaxMs);
      await wait(minDelay + Math.random() * (maxDelay - minDelay));
    }
    return { page: p, tabIndex: idx, status: 429, ok: false, attempts: attempt, rateLimited: true };
  }));

  console.log(`[browser] All ${safeTabs} tabs loaded with HTTP 2xx.`);

  return {
    pages,
    results,
    firstOk: results.find(r => r.ok) || null,
  };
}

// Retry loading a URL on a single page forever until HTTP 2xx.
// Handles 429 with Retry-After header and optional onRateLimit callback.
async function retryLoadPage(page, url, options = {}) {
  const { onRateLimit = null } = options;
  let attempt = 0;
  let shouldRestart = false;

  while (true) {
    attempt++;
    try {
      const response = await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: NAVIGATION_TIMEOUT,
      });

      const status = response ? response.status() : 0;
      if (status >= 200 && status < 300) {
        return page;
      }

      if (status === 429) {
        const retryAfter = response.headers()['retry-after'];
        const cooldownSec = retryAfter ? parseInt(retryAfter, 10) || 60 : 60;
        const resumeAt = Date.now() + cooldownSec * 1000;
        console.log(`[browser] Rate limited (429). Pausing for ${cooldownSec}s, resuming at ${formatTime(resumeAt)} (Retry-After: ${retryAfter || 'none, defaulting 60s'})`);

        if (onRateLimit) {
          // Ask user in parallel with cooldown wait
          const userChoice = onRateLimit(cooldownSec, formatTime(resumeAt));
          userChoice.then(action => {
            if (action === 'restart') shouldRestart = true;
          }).catch(() => {});
        }

        // Wait for cooldown
        while (Date.now() < resumeAt && !shouldRestart) {
          await wait(1000);
        }
        if (shouldRestart) {
          throw new Error('RATE_LIMITED_RESTART');
        }
        continue;
      }

      const delay = Math.min(attempt * 2000, 10_000);
      console.log(`[browser] Got HTTP ${status}, retrying in ${delay / 1000}s (attempt ${attempt})...`);
      await wait(delay);
    } catch (err) {
      if (err.message === 'RATE_LIMITED_RESTART') throw err;
      const delay = Math.min(attempt * 2000, 10_000);
      console.log(`[browser] ${err.message}, retrying in ${delay / 1000}s (attempt ${attempt})...`);
      await wait(delay);
    }
  }
}

async function login(page, options = {}) {
  const { skipIfLoggedIn = true, manualLogin = false, browser = null, raceTabs = 1, onRateLimit = null } = options;

  // Navigate to the purchase page first (triggers CF challenge if needed)
  const currentUrl = page.url();
  const needsNavigation = !currentUrl.includes('/purchase/gold');

  // Even if URL looks right, check if the page is actually loaded (not a CF block page)
  let pageIsBlocked = false;
  if (!needsNavigation) {
    pageIsBlocked = await page.evaluate(() => {
      const title = document.title || '';
      const body = document.body ? document.body.textContent : '';
      return title.includes('Attention Required') ||
             body.includes('you have been blocked') ||
             body.includes('enable cookies') ||
             body.includes('Cloudflare Ray ID') ||
             body.includes('Always Online') ||
             body.includes('currently offline') ||
             !!document.querySelector('#cf-always-online');
    });
    if (pageIsBlocked) {
      console.log('[browser] Page is showing a Cloudflare block/cached page. Reloading...');
    }
  }

  if (needsNavigation || pageIsBlocked) {
    const url = config.BASE_URL + config.endpoints.purchasePage;

    if (browser && raceTabs > 1 && !pageIsBlocked) {
      // Race multiple tabs for faster loading (skip racing if blocked - would just spam 429s)
      try {
        const winningPage = await raceLoadPage(browser, url, raceTabs, options);
        // Close the original page unless we're in manual login mode (user's tab)
        if (winningPage !== page && !manualLogin) {
          page.close().catch(() => {});
        }
        page = winningPage;
      } catch (err) {
        if (err.message === 'RATE_LIMITED_RESTART') throw err;
        console.log(`[browser] Race failed: ${err.message}`);
        console.log('[browser] Falling back to single-tab retry...');
        page = await retryLoadPage(page, url, options);
      }
    } else {
      // Single tab with retry (also handles 429 with onRateLimit callback)
      page = await retryLoadPage(page, url, options);
    }
  }

  await waitForCloudflare(page);

  // Check if already logged in (look for "Hi, " in the page)
  const isLoggedIn = await page.evaluate(() => {
    const userText = document.querySelector('.user-toggle .text');
    return userText && userText.textContent.trim().startsWith('Hi,');
  });

  if (isLoggedIn) {
    console.log('[browser] Already logged in');
    return page;
  }

  if (manualLogin) {
    const siteOffline = await isCloudflareAlwaysOnline(page);
    if (siteOffline) {
      console.log('[browser] Site is offline (Cloudflare Always Online). Waiting for recovery...');
    } else {
      console.log('[browser] Manual login mode: please log in via the browser window');
    }
    console.log('[browser] Waiting for login to complete (checking for user menu)...');

    const startTime = Date.now();
    const timeout = 300_000; // 5 minutes
    let wasOffline = siteOffline;
    while (Date.now() - startTime < timeout) {
      await wait(2000);

      // If page shows Cloudflare Always Online, reload to check if site recovered
      if (await isCloudflareAlwaysOnline(page)) {
        wasOffline = true;
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        console.log(`[browser] Site still offline (Always Online), reloading... [${elapsed}s elapsed]`);
        await wait(8000);
        try {
          const url = config.BASE_URL + config.endpoints.purchasePage;
          await page.goto(url, { waitUntil: 'networkidle2', timeout: NAVIGATION_TIMEOUT });
          await waitForCloudflare(page);
        } catch (e) {
          console.log(`[browser] Reload error: ${e.message}`);
        }
        continue;
      }

      // Site just came back from Always Online
      if (wasOffline) {
        console.log('[browser] Site is back online! Checking login...');
        wasOffline = false;
      }

      const nowLoggedIn = await page.evaluate(() => {
        const userText = document.querySelector('.user-toggle .text');
        return userText && userText.textContent.trim().startsWith('Hi,');
      });
      if (nowLoggedIn) {
        console.log('[browser] Login detected!');
        return page;
      }
    }
    throw new Error('Manual login timeout - user did not log in within 5 minutes');
  }

  // Auto-login flow
  const { email, password } = config.credentials;
  if (!email || !password) {
    throw new Error('LM_EMAIL and LM_PASSWORD must be set in .env for auto-login');
  }

  // Click the login link to open the popup
  console.log('[browser] Opening login popup...');
  await page.evaluate(() => {
    const loginLink = document.querySelector('a[data-src="/popup-login"]');
    if (loginLink) loginLink.click();
  });

  // Wait for the login form to appear in the fancybox popup
  await page.waitForSelector('.fancybox-content input[name="email"], .fancybox-content input[name="username"], #popup-login input[type="email"], input[name="email"]', {
    timeout: 10_000,
  }).catch(() => {
    // Fallback: try clicking the link directly
  });

  // Small delay for the popup animation
  await wait(1500);

  // Find and fill the login form
  const emailSelector = await findInputSelector(page, ['input[name="email"]', 'input[type="email"]', '#email']);
  const passwordSelector = await findInputSelector(page, ['input[name="password"]', 'input[type="password"]', '#password']);

  if (!emailSelector || !passwordSelector) {
    throw new Error('Could not find login form fields. The popup may not have loaded.');
  }

  console.log('[browser] Filling login credentials...');
  await page.click(emailSelector, { clickCount: 3 });
  await page.type(emailSelector, email, { delay: 50 });

  await page.click(passwordSelector, { clickCount: 3 });
  await page.type(passwordSelector, password, { delay: 50 });

  // Submit the form
  const submitBtn = await findInputSelector(page, [
    'button[type="submit"]',
    'input[type="submit"]',
    '.fancybox-content button',
    '#popup-login button',
  ]);

  if (submitBtn) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: NAVIGATION_TIMEOUT }).catch(() => {}),
      page.click(submitBtn),
    ]);
  } else {
    // Try pressing Enter
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: NAVIGATION_TIMEOUT }).catch(() => {}),
      page.keyboard.press('Enter'),
    ]);
  }

  await wait(2000);

  // Verify login succeeded
  const loggedIn = await page.evaluate(() => {
    const userText = document.querySelector('.user-toggle .text');
    return userText && userText.textContent.trim().startsWith('Hi,');
  });

  if (!loggedIn) {
    // Check if we were redirected to the purchase page (which means login succeeded)
    if (page.url().includes('/purchase/gold') || page.url().includes('/id')) {
      const checkAgain = await page.evaluate(() => {
        return document.body.innerHTML.includes('KELUAR') || document.body.innerHTML.includes('logout');
      });
      if (checkAgain) {
        console.log('[browser] Login successful (detected via logout link)');
        return page;
      }
    }
    throw new Error('Login failed - check your credentials');
  }

  console.log('[browser] Login successful');
  return page;
}

async function findInputSelector(page, selectors) {
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el) return sel;
  }
  return null;
}

async function extractCookies(page) {
  const cookies = await page.cookies();
  return cookies;
}

async function extractCurrentStore(page) {
  const store = await page.evaluate(() => {
    // 1. Look for var current_storage = 'XXXX' in script tags
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const text = script.textContent || '';
      const match = text.match(/current_storage\s*=\s*['"](\w+)['"]/);
      if (match) return match[1];
    }
    // 2. Fallback: check the geoloc form's location input value
    const locationInput = document.querySelector('#geoloc-change-location input[name="location"]');
    if (locationInput && locationInput.value) return locationInput.value;
    // 3. Fallback: check for a selected option in any location dropdown
    const selected = document.querySelector('select[name="location"] option[selected]');
    if (selected && selected.value) return selected.value;
    return null;
  });
  return store;
}

async function extractCsrfToken(page) {
  const token = await page.evaluate(() => {
    const meta = document.querySelector('meta[name="_token"]');
    if (meta) return meta.getAttribute('content');
    const input = document.querySelector('input[name="_token"]');
    if (input) return input.value;
    return null;
  });
  return token;
}

// Clear logammulia.com cookies, cache, local/session storage for a fresh start
async function clearBrowserState(page) {
  console.log('[browser] Clearing logammulia.com cookies, storage, and cache...');

  // Delete only logammulia.com cookies (not all browser cookies)
  try {
    const cookies = await page.cookies('https://logammulia.com', 'https://www.logammulia.com');
    if (cookies.length > 0) {
      await page.deleteCookie(...cookies);
      console.log(`[browser] Deleted ${cookies.length} logammulia.com cookies`);
    }
  } catch (e) {
    // Fallback: clear cookies via document.cookie (works on any browser)
    console.log('[browser] page.cookies() not available, clearing via document.cookie');
    await page.evaluate(() => {
      document.cookie.split(';').forEach(c => {
        const name = c.split('=')[0].trim();
        if (!name) return;
        const paths = ['/', '/id', '/id/purchase'];
        const domains = ['', 'logammulia.com', '.logammulia.com', 'www.logammulia.com'];
        for (const p of paths) {
          for (const d of domains) {
            const domainPart = d ? `;domain=${d}` : '';
            document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=${p}${domainPart}`;
          }
        }
      });
    });
  }

  // Clear site cache via CDP (Chrome only - will silently fail on Firefox)
  try {
    const client = await page.target().createCDPSession();
    await client.send('Network.clearBrowserCache');
    await client.detach();
  } catch (e) {
    // Non-fatal - CDP not available on Firefox
  }

  // Clear localStorage and sessionStorage (already origin-scoped to current page)
  await page.evaluate(() => {
    try { localStorage.clear(); } catch (e) {}
    try { sessionStorage.clear(); } catch (e) {}
  });
  console.log('[browser] logammulia.com state cleared');
}

module.exports = {
  launchBrowser,
  waitForCloudflare,
  isCloudflareAlwaysOnline,
  login,
  raceLoadPage,
  openUrlInMultipleTabs,
  retryLoadPage,
  extractCookies,
  extractCurrentStore,
  extractCsrfToken,
  clearBrowserState,
};
