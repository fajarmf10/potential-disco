const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const config = require('./config');

puppeteer.use(StealthPlugin());

const NAVIGATION_TIMEOUT = 60_000;
const CF_WAIT_TIMEOUT = 30_000;
const PROFILES_DIR = path.join(__dirname, '..', 'profiles');

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// * Shared browser cache for 'context' mode — one browser per storeCode
const sharedBrowsers = new Map();

/**
 * Launch (or reuse) a headless Chrome with a dedicated profile directory.
 * Returns { browser, page } where page is a fresh tab inside the profile's context.
 *
 * In 'context' mode: one Chrome process per store, two browser contexts.
 * In 'separate' mode: one Chrome process per profile (storeCode-A / storeCode-B).
 */
async function launchProfile(storeCode, profileId) {
  const profileDir = path.join(PROFILES_DIR, `${storeCode}-${profileId}`);

  if (config.profileMode === 'context') {
    return launchContextProfile(storeCode);
  }
  return launchSeparateProfile(profileDir);
}

async function launchSeparateProfile(profileDir) {
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--window-size=1024,768',
    `--user-data-dir=${profileDir}`,
    ...config.browserArgs,
  ];

  const browser = await puppeteer.launch({
    headless: config.headless,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
    args,
    defaultViewport: { width: 1024, height: 768 },
  });

  const page = await browser.newPage();
  return { browser, page };
}

async function launchContextProfile(storeCode) {
  let browser = sharedBrowsers.get(storeCode);

  if (!browser || !browser.isConnected()) {
    const sharedDir = path.join(PROFILES_DIR, `${storeCode}-shared`);
    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1024,768',
      `--user-data-dir=${sharedDir}`,
      ...config.browserArgs,
    ];

    browser = await puppeteer.launch({
      headless: config.headless,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
      args,
      defaultViewport: { width: 1024, height: 768 },
    });
    sharedBrowsers.set(storeCode, browser);
  }

  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  return { browser, page, context };
}

async function waitForCloudflare(page) {
  const startTime = Date.now();
  while (Date.now() - startTime < CF_WAIT_TIMEOUT) {
    const title = await page.title();
    const url = page.url();

    if (
      title.includes('Just a moment') ||
      title.includes('Attention Required') ||
      title.includes('Checking your browser') ||
      url.includes('/cdn-cgi/challenge-platform')
    ) {
      await wait(2000);
      continue;
    }

    const turnstile = await page.$('iframe[src*="challenges.cloudflare.com"]');
    if (turnstile) {
      await wait(3000);
      continue;
    }

    return true;
  }
  throw new Error('Cloudflare challenge did not resolve within timeout');
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

async function extractCurrentStore(page) {
  return page.evaluate(() => {
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const text = script.textContent || '';
      const match = text.match(/current_storage\s*=\s*['"](\w+)['"]/);
      if (match) return match[1];
    }
    const locationInput = document.querySelector('#geoloc-change-location input[name="location"]');
    if (locationInput && locationInput.value) return locationInput.value;
    const selected = document.querySelector('select[name="location"] option[selected]');
    if (selected && selected.value) return selected.value;
    return null;
  });
}

async function extractCsrfToken(page) {
  return page.evaluate(() => {
    const meta = document.querySelector('meta[name="_token"]');
    if (meta) return meta.getAttribute('content');
    const input = document.querySelector('input[name="_token"]');
    if (input) return input.value;
    return null;
  });
}

async function switchStore(page, storeCode, csrfToken) {
  const result = await page.evaluate(
    async (baseUrl, code, token) => {
      try {
        const res = await fetch(baseUrl + '/do-change-location', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-CSRF-TOKEN': token,
          },
          body: `_token=${encodeURIComponent(token)}&location=${encodeURIComponent(code)}`,
          credentials: 'same-origin',
          redirect: 'follow',
        });
        return { ok: res.ok, status: res.status };
      } catch (err) {
        return { ok: false, status: 0, error: err.message };
      }
    },
    config.BASE_URL,
    storeCode,
    csrfToken
  );
  return result;
}

/**
 * One-time setup: load purchase page, bypass CF, switch to desired store if needed.
 * Called once per profile on first launch.
 */
async function setupStore(page, storeCode) {
  const url = config.BASE_URL + config.endpoints.purchasePage;

  const response = await page.goto(url, {
    waitUntil: 'networkidle2',
    timeout: NAVIGATION_TIMEOUT,
  });

  const status = response ? response.status() : 0;
  if (status < 200 || status >= 300) {
    throw new Error(`Setup failed: HTTP ${status} loading purchase page`);
  }

  await waitForCloudflare(page);

  const currentStore = await extractCurrentStore(page);
  if (currentStore !== storeCode) {
    const csrfToken = await extractCsrfToken(page);
    if (!csrfToken) {
      throw new Error(`Setup failed: no CSRF token on purchase page`);
    }

    const result = await switchStore(page, storeCode, csrfToken);
    if (!result.ok) {
      throw new Error(`Setup failed: store switch returned HTTP ${result.status}`);
    }

    await wait(500);

    // Reload to confirm the store switch took effect
    const reloadRes = await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: NAVIGATION_TIMEOUT,
    });
    const reloadStatus = reloadRes ? reloadRes.status() : 0;
    if (reloadStatus < 200 || reloadStatus >= 300) {
      throw new Error(`Setup failed: HTTP ${reloadStatus} on post-switch reload`);
    }
    await waitForCloudflare(page);
  }

  const verified = await extractCurrentStore(page);
  if (verified !== storeCode) {
    throw new Error(`Setup failed: store is ${verified}, expected ${storeCode}`);
  }
}

function getSharedBrowsers() {
  return sharedBrowsers;
}

module.exports = {
  launchProfile,
  waitForCloudflare,
  isCloudflareAlwaysOnline,
  extractCurrentStore,
  extractCsrfToken,
  switchStore,
  setupStore,
  getSharedBrowsers,
  NAVIGATION_TIMEOUT,
};
