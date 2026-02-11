const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const config = require('../config');

puppeteer.use(StealthPlugin());

const NAVIGATION_TIMEOUT = 60_000;
const CF_WAIT_TIMEOUT = 30_000;

// Helper: wait for timeout (backwards compat with older Puppeteer)
async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function launchBrowser(options = {}) {
  const { useExisting = false, debugPort = null } = options;

  if (useExisting) {
    // Try to connect to an existing Chrome/Edge instance
    let port = debugPort || parseInt(process.env.LM_DEBUG_PORT || '9222', 10);

    console.log(`[browser] Connecting to existing browser at localhost:${port}...`);

    // Try the specified port
    try {
      const browser = await puppeteer.connect({
        browserURL: `http://localhost:${port}`,
        defaultViewport: null,
      });
      console.log(`[browser] Connected to browser on port ${port}`);
      return browser;
    } catch (err) {
      // If default port fails, try common alternatives
      const alternatePorts = [9222, 9223, 9224, 9225];
      for (const altPort of alternatePorts) {
        if (altPort === port) continue; // Skip the one we already tried

        try {
          console.log(`[browser] Port ${port} unavailable, trying ${altPort}...`);
          const browser = await puppeteer.connect({
            browserURL: `http://localhost:${altPort}`,
            defaultViewport: null,
          });
          console.log(`[browser] Connected to browser on port ${altPort}`);
          return browser;
        } catch (e) {
          // Continue to next port
        }
      }

      throw new Error(
        `Could not connect to any browser on ports 9222-9225.\n\n` +
        `Make sure Chrome/Edge is running with:\n` +
        `  chrome.exe --remote-debugging-port=9222 --user-data-dir="C:\\tmp\\chrome-profile"\n\n` +
        `Or set the port via environment variable:\n` +
        `  set LM_DEBUG_PORT=9222\n\n` +
        `Error: ${err.message}`
      );
    }
  }

  // Launch a new browser instance
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
  } = options;
  const safeTabs = Math.max(1, parseInt(numTabs, 10) || 1);

  console.log(`[browser] Racing ${safeTabs} tabs to load page...`);

  const pages = [];
  for (let i = 0; i < safeTabs; i++) {
    pages.push(await browser.newPage());
  }

  let resolved = false;

  async function attemptTab(p, tabIndex) {
    let attempt = 0;
    while (!resolved) {
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
        if (logAttempts) {
          console.log(`[browser] Tab ${tabIndex + 1}/${safeTabs}: HTTP ${status} (attempt ${attempt}), retrying...`);
        }
      } catch (err) {
        if (resolved) return null;
        if (logAttempts) {
          console.log(`[browser] Tab ${tabIndex + 1}/${safeTabs}: ${err.message} (attempt ${attempt}), retrying...`);
        }
      }

      // Stagger retries: 1-3s random delay per tab to avoid hammering
      const minDelay = Math.max(0, retryDelayMinMs);
      const maxDelay = Math.max(minDelay, retryDelayMaxMs);
      await wait(minDelay + Math.random() * (maxDelay - minDelay));
    }
    return null;
  }

  return new Promise((resolve) => {
    for (let i = 0; i < pages.length; i++) {
      attemptTab(pages[i], i).then(result => {
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
  } = options;
  const safeTabs = Math.max(1, parseInt(numTabs, 10) || 1);

  console.log(`[browser] Opening ${safeTabs} tabs and waiting until all load with HTTP 2xx...`);

  const pages = [];
  for (let i = 0; i < safeTabs; i++) {
    pages.push(await browser.newPage());
  }

  const results = await Promise.all(pages.map(async (p, idx) => {
    let attempt = 0;
    while (true) {
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
  }));

  console.log(`[browser] All ${safeTabs} tabs loaded with HTTP 2xx.`);

  return {
    pages,
    results,
    firstOk: results.find(r => r.ok) || null,
  };
}

// Retry loading a URL on a single page forever until HTTP 200
async function retryLoadPage(page, url) {
  let attempt = 0;
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

      const delay = Math.min(attempt * 2000, 10_000);
      console.log(`[browser] Got HTTP ${status}, retrying in ${delay / 1000}s (attempt ${attempt})...`);
      await wait(delay);
    } catch (err) {
      const delay = Math.min(attempt * 2000, 10_000);
      console.log(`[browser] ${err.message}, retrying in ${delay / 1000}s (attempt ${attempt})...`);
      await wait(delay);
    }
  }
}

async function login(page, options = {}) {
  const { skipIfLoggedIn = true, manualLogin = false, browser = null, raceTabs = 1 } = options;

  // Navigate to the purchase page first (triggers CF challenge if needed)
  const currentUrl = page.url();
  if (!currentUrl.includes('/purchase/gold')) {
    const url = config.BASE_URL + config.endpoints.purchasePage;

    if (browser && raceTabs > 1) {
      // Race multiple tabs for faster loading
      try {
        const winningPage = await raceLoadPage(browser, url, raceTabs);
        // Close the original page unless we're in manual login mode (user's tab)
        if (winningPage !== page && !manualLogin) {
          page.close().catch(() => {});
        }
        page = winningPage;
      } catch (err) {
        console.log(`[browser] Race failed: ${err.message}`);
        console.log('[browser] Falling back to single-tab retry...');
        page = await retryLoadPage(page, url);
      }
    } else {
      // Single tab with retry
      page = await retryLoadPage(page, url);
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
    console.log('[browser] Manual login mode: please log in via the browser window');
    console.log('[browser] Waiting for login to complete (checking for user menu)...');

    // Poll for login completion
    const startTime = Date.now();
    const timeout = 300_000; // 5 minutes
    while (Date.now() - startTime < timeout) {
      await wait(2000);
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
    // Look for var current_storage = 'XXXX' in script tags
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const text = script.textContent || '';
      const match = text.match(/current_storage\s*=\s*['"](\w+)['"]/);
      if (match) return match[1];
    }
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

module.exports = {
  launchBrowser,
  waitForCloudflare,
  login,
  raceLoadPage,
  openUrlInMultipleTabs,
  retryLoadPage,
  extractCookies,
  extractCurrentStore,
  extractCsrfToken,
};
