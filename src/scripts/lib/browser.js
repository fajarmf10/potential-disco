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

async function login(page, options = {}) {
  const { skipIfLoggedIn = true, manualLogin = false } = options;

  // Navigate to the purchase page first (triggers CF challenge if needed)
  const currentUrl = page.url();
  if (!currentUrl.includes('/purchase/gold')) {
    await page.goto(config.BASE_URL + config.endpoints.purchasePage, {
      waitUntil: 'networkidle2',
      timeout: NAVIGATION_TIMEOUT,
    });
  }

  await waitForCloudflare(page);

  // Check if already logged in (look for "Hi, " in the page)
  const isLoggedIn = await page.evaluate(() => {
    const userText = document.querySelector('.user-toggle .text');
    return userText && userText.textContent.trim().startsWith('Hi,');
  });

  if (isLoggedIn) {
    console.log('[browser] Already logged in');
    return;
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
        return;
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
  // The popup-login form typically has email + password fields
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
        return;
      }
    }
    throw new Error('Login failed - check your credentials');
  }

  console.log('[browser] Login successful');
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
  extractCookies,
  extractCsrfToken,
};
