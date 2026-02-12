#!/usr/bin/env node
const chalk = require('chalk');
const config = require('./config');
const { launchBrowser, login } = require('./lib/browser');
const { processCheckoutPage } = require('./lib/checkout');
const { saveSnapshot } = require('./lib/snapshot');

const NAVIGATION_TIMEOUT = 60_000;

async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Dismiss any visible SweetAlert popup by clicking its confirm button
// ---------------------------------------------------------------------------
async function dismissSwal(page) {
  return page.evaluate(() => {
    const btn = document.querySelector('.swal-button--confirm, .swal-button');
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  });
}

// ---------------------------------------------------------------------------
// Verify cart has items by loading /id/my-cart
// ---------------------------------------------------------------------------
async function verifyCartHasItems(page) {
  const cartUrl = config.BASE_URL + '/id' + config.endpoints.myCart;
  console.log(chalk.gray('  Loading cart to verify items...'));

  await page.goto(cartUrl, { waitUntil: 'networkidle2', timeout: NAVIGATION_TIMEOUT });
  await wait(2000);

  const cartInfo = await page.evaluate(() => {
    const body = document.body.innerHTML;
    const isEmpty = body.includes('Keranjang Anda kosong') || body.includes('kosong');
    const hasItems = body.includes('cart-product') || body.includes('keranjang');
    return { hasItems, isEmpty, url: window.location.href };
  });

  if (cartInfo.isEmpty && !cartInfo.hasItems) {
    throw new Error('Cart is empty. Add items to cart first (run index.js or add manually).');
  }

  return cartInfo;
}

// ---------------------------------------------------------------------------
// Single tab checkout loop - retries forever until checkout succeeds
// Each tab loads /id/checkout, fills the form, and submits
// ---------------------------------------------------------------------------
async function tabCheckoutLoop(browser, tabIndex, totalTabs) {
  const tag = `[tab ${tabIndex + 1}/${totalTabs}]`;
  const page = await browser.newPage();
  const checkoutUrl = config.BASE_URL + '/id/checkout';
  let attempt = 0;

  while (true) {
    attempt++;
    const attemptTag = `${tag} attempt ${attempt}`;

    try {
      // 1. Load checkout page
      console.log(chalk.gray(`  ${attemptTag}: Loading /id/checkout...`));
      const response = await page.goto(checkoutUrl, {
        waitUntil: 'networkidle2',
        timeout: NAVIGATION_TIMEOUT,
      });

      const status = response ? response.status() : 0;

      if (status < 200 || status >= 300) {
        console.log(chalk.yellow(`  ${attemptTag}: Checkout page HTTP ${status}, retrying...`));
        await randomDelay();
        continue;
      }

      await wait(2000);
      await saveSnapshot(page, `checkout-tab${tabIndex + 1}-attempt${attempt}`);

      // 2. Check page has items and checkout form
      const pageState = await page.evaluate(() => {
        const hasItems = document.querySelectorAll('.cart-item').length > 0;
        const hasForm = document.querySelector('#checkout-form') !== null;
        const hasBtn = document.querySelector('#btnContinueOrder') !== null;
        const url = window.location.href;
        // Detect if redirected to cart (empty) or login
        const isCartPage = url.includes('/my-cart');
        const isLoginPage = url.includes('/login') || url.includes('/popup-login');
        return { hasItems, hasForm, hasBtn, url, isCartPage, isLoginPage };
      });

      if (pageState.isCartPage || pageState.isLoginPage) {
        console.log(chalk.yellow(`  ${attemptTag}: Redirected to ${pageState.url}, retrying...`));
        await randomDelay();
        continue;
      }

      if (!pageState.hasItems || !pageState.hasForm) {
        console.log(chalk.red(`  ${attemptTag}: No items on checkout page. Stopping this tab.`));
        await saveSnapshot(page, `error-tab${tabIndex + 1}-attempt${attempt}-empty`);
        await page.close().catch(() => {});
        return { tabIndex, success: false, reason: 'empty_checkout' };
      }

      if (!pageState.hasBtn) {
        console.log(chalk.yellow(`  ${attemptTag}: "Bayar Sekarang" button not found, retrying...`));
        await saveSnapshot(page, `error-tab${tabIndex + 1}-attempt${attempt}-no-btn`);
        await randomDelay();
        continue;
      }

      // 3. Select pickup at butik (click the pick-store radio)
      console.log(chalk.gray(`  ${attemptTag}: Selecting butik pickup...`));
      await page.evaluate(() => {
        const pickupRadio = document.querySelector('input[name="pickCourier"].pick-store');
        if (pickupRadio && !pickupRadio.checked) {
          pickupRadio.click();
        }
      });

      await wait(2000);

      // 4. Dismiss swal info popup that appears after selecting butik
      //    (shows butik location info — just needs OK click)
      await dismissSwal(page);
      await wait(1000);

      // 5. Check the "Saya setuju" checkbox
      console.log(chalk.gray(`  ${attemptTag}: Checking terms checkbox...`));
      await page.evaluate(() => {
        const checkbox = document.getElementById('confirmCheckout');
        if (checkbox && !checkbox.checked) {
          checkbox.checked = true;
        }
      });
      await wait(500);

      // 6. Click "Bayar Sekarang" and wait for form submission + navigation
      console.log(chalk.gray(`  ${attemptTag}: Clicking "Bayar Sekarang"...`));

      // Set up navigation listener BEFORE clicking (form submit causes navigation)
      const navPromise = page.waitForNavigation({
        waitUntil: 'networkidle2',
        timeout: NAVIGATION_TIMEOUT,
      }).catch(() => null);

      await page.evaluate(() => {
        document.getElementById('btnContinueOrder').click();
      });

      // Wait briefly for validation — check if swal error appeared instead of navigation
      await wait(1500);

      const hasSwalError = await page.evaluate(() => {
        const overlay = document.querySelector('.swal-overlay--show-modal');
        if (!overlay) return null;
        const title = document.querySelector('.swal-title');
        const text = document.querySelector('.swal-text');
        return {
          title: title ? title.textContent : '',
          text: text ? text.textContent : '',
        };
      });

      if (hasSwalError) {
        console.log(chalk.yellow(`  ${attemptTag}: SweetAlert: "${hasSwalError.title}" - ${hasSwalError.text}`));
        await saveSnapshot(page, `error-tab${tabIndex + 1}-attempt${attempt}-swal`);
        await dismissSwal(page);
        await randomDelay();
        continue;
      }

      // Wait for navigation to complete (form POST → result page)
      const navResponse = await navPromise;
      await wait(2000);

      const resultUrl = page.url();
      const navStatus = navResponse ? navResponse.status() : 0;
      console.log(chalk.gray(`  ${attemptTag}: Navigated to ${resultUrl} (HTTP ${navStatus || 'unknown'})`));

      if (navStatus && (navStatus < 200 || navStatus >= 300)) {
        console.log(chalk.yellow(`  ${attemptTag}: Result page HTTP ${navStatus}, retrying...`));
        await saveSnapshot(page, `error-tab${tabIndex + 1}-attempt${attempt}-http${navStatus}`);
        await randomDelay();
        continue;
      }

      await saveSnapshot(page, `result-tab${tabIndex + 1}-attempt${attempt}`);

      // 7. Process post-checkout page (tujuan transaksi popup, payment, confirmation)
      try {
        await processCheckoutPage(page);
        console.log(chalk.green(`  ${tag}: Checkout completed successfully!`));
        await saveSnapshot(page, `confirmation-tab${tabIndex + 1}`);
        await page.close().catch(() => {});
        return { tabIndex, success: true, attempts: attempt };
      } catch (err) {
        console.log(chalk.yellow(`  ${attemptTag}: Post-checkout failed: ${err.message}`));
        await saveSnapshot(page, `error-tab${tabIndex + 1}-attempt${attempt}-post`);
        await randomDelay();
        continue;
      }
    } catch (err) {
      console.log(chalk.yellow(`  ${attemptTag}: Error: ${err.message}`));
      await saveSnapshot(page, `error-tab${tabIndex + 1}-attempt${attempt}`).catch(() => {});
      await randomDelay();
      continue;
    }
  }
}

function randomDelay() {
  const ms = 1000 + Math.random() * 2000;
  return wait(ms);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const useBrowser = args.includes('--use-browser');
  const debugPort = 9222;
  const numTabs = config.raceTabs;

  console.log(chalk.yellow('\n  Logam Mulia - Cart Checkout'));
  console.log(chalk.yellow('  ' + '='.repeat(40) + '\n'));

  if (useBrowser) {
    console.log(chalk.gray('  Mode: Connect to existing browser'));
    console.log(chalk.gray(`  Ensure Chrome is running with: --remote-debugging-port=${debugPort}\n`));
  }

  if (!useBrowser && (!config.credentials.email || !config.credentials.password)) {
    console.error(chalk.red('  Error: LM_EMAIL and LM_PASSWORD must be set in .env'));
    console.error(chalk.gray('  Or use --use-browser to connect to an existing logged-in browser.\n'));
    process.exit(1);
  }

  // Step 1: Launch/connect browser + login
  console.log(chalk.cyan('  [1/3] ' + (useBrowser ? 'Connecting to browser...' : 'Launching browser...')));
  const browser = await launchBrowser({ useExisting: useBrowser, debugPort });

  let page;
  if (useBrowser) {
    const pages = await browser.pages();
    page = pages.find(p => p.url().includes('logammulia.com')) || pages[0];
    if (!page) page = await browser.newPage();
    console.log(chalk.gray('  Connected to page: ' + page.url()));
  } else {
    page = await browser.newPage();
  }

  try {
    console.log(chalk.cyan('  [2/3] ' + (useBrowser ? 'Checking login status...' : 'Logging in...')));
    page = await login(page, { manualLogin: useBrowser, browser, raceTabs: config.raceTabs });
    await saveSnapshot(page, 'login');

    // Verify cart has items
    console.log(chalk.cyan('  [2/3] Verifying cart has items...'));
    await verifyCartHasItems(page);
    await saveSnapshot(page, 'cart-verify');
    console.log(chalk.green('  Cart has items. Proceeding to checkout.'));

    // Close the verification page (we'll open fresh tabs)
    if (!useBrowser && !page.isClosed()) {
      await page.close().catch(() => {});
    }

    // Step 3: Open N tabs and run checkout loop on each
    console.log(chalk.cyan(`  [3/3] Opening ${numTabs} tabs for parallel checkout...`));
    console.log(chalk.gray(`  Each tab: /id/checkout → select pickup → agree T&C → Bayar Sekarang`));
    console.log(chalk.gray(`  Tabs retry indefinitely on failure. Script ends when all tabs complete.\n`));

    const tabPromises = [];
    for (let i = 0; i < numTabs; i++) {
      tabPromises.push(tabCheckoutLoop(browser, i, numTabs));
    }

    const results = await Promise.all(tabPromises);

    // Summary
    console.log(chalk.yellow('\n  ' + '='.repeat(40)));
    console.log(chalk.bold('  Checkout Results'));
    console.log(chalk.yellow('  ' + '='.repeat(40)));

    let successCount = 0;
    for (const r of results) {
      const status = r.success ? chalk.green('SUCCESS') : chalk.red('FAILED');
      const detail = r.success ? `in ${r.attempts} attempt(s)` : r.reason || 'unknown';
      console.log(`  Tab ${r.tabIndex + 1}: ${status} - ${detail}`);
      if (r.success) successCount++;
    }

    console.log(chalk.bold(`\n  ${successCount}/${numTabs} tabs completed checkout successfully.`));

    if (successCount > 0) {
      console.log(chalk.green('\n  Checkout automation complete!\n'));
    } else {
      console.log(chalk.red('\n  No tabs completed checkout. Check snapshots in results/ for debugging.\n'));
    }
  } catch (err) {
    console.error(chalk.red('\n  Error: ' + err.message));
    if (err.stack) {
      console.error(chalk.gray(err.stack.split('\n').slice(1, 4).join('\n')));
    }

    if (!config.headless) {
      console.log(chalk.yellow('\n  Browser left open for debugging. Press Ctrl+C to exit.\n'));
      await new Promise(() => {});
    }
  } finally {
    if (!useBrowser) {
      try { await browser.close(); } catch (e) {}
    } else {
      console.log(chalk.gray('\n  Left browser open (existing session).'));
    }
  }
}

main().catch(err => {
  console.error(chalk.red('Fatal: ' + err.message));
  process.exit(1);
});
