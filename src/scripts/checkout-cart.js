#!/usr/bin/env node
const chalk = require('chalk');
const config = require('./config');
const { launchBrowser, login } = require('./lib/browser');
const { processCheckoutPage, tryClickSelector } = require('./lib/checkout');
const { saveSnapshot } = require('./lib/snapshot');

const NAVIGATION_TIMEOUT = 60_000;

async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Verify cart has items on the given page
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
// ---------------------------------------------------------------------------
async function tabCheckoutLoop(browser, tabIndex, totalTabs) {
  const tag = `[tab ${tabIndex + 1}/${totalTabs}]`;
  const page = await browser.newPage();
  const cartUrl = config.BASE_URL + '/id' + config.endpoints.myCart;
  let attempt = 0;

  while (true) {
    attempt++;
    const attemptTag = `${tag} attempt ${attempt}`;

    try {
      // 1. Load cart page
      console.log(chalk.gray(`  ${attemptTag}: Loading cart...`));
      const response = await page.goto(cartUrl, {
        waitUntil: 'networkidle2',
        timeout: NAVIGATION_TIMEOUT,
      });

      const status = response ? response.status() : 0;

      if (status < 200 || status >= 300) {
        console.log(chalk.yellow(`  ${attemptTag}: Cart returned HTTP ${status}, retrying...`));
        await randomDelay();
        continue;
      }

      await wait(1000);
      await saveSnapshot(page, `cart-tab${tabIndex + 1}-attempt${attempt}`);

      // Check cart is not empty
      const isEmpty = await page.evaluate(() => {
        const body = document.body.innerHTML;
        return body.includes('Keranjang Anda kosong') || body.includes('kosong');
      });

      if (isEmpty) {
        console.log(chalk.red(`  ${attemptTag}: Cart is empty. Stopping this tab.`));
        await page.close().catch(() => {});
        return { tabIndex, success: false, reason: 'empty_cart' };
      }

      // 2. Find and click checkout button
      console.log(chalk.gray(`  ${attemptTag}: Looking for checkout button...`));

      const checkoutClicked = await tryClickSelector(page, [
        'a[href*="checkout"]',
        'button:has-text("Checkout")',
        '#btn-checkout',
        '.btn-checkout',
        'a.btn-green:has-text("Checkout")',
        'a:has-text("Proses")',
        'a:has-text("Lanjut")',
        'button:has-text("Proses")',
      ]);

      if (!checkoutClicked) {
        // Fallback: scan buttons for checkout-related text
        const fallbackClicked = await page.evaluate(() => {
          const buttons = document.querySelectorAll('.btn-green, .btn-primary, a.btn');
          for (const btn of buttons) {
            const text = btn.textContent.toLowerCase();
            if (text.includes('proses') || text.includes('checkout') || text.includes('lanjut') || text.includes('bayar')) {
              btn.click();
              return true;
            }
          }
          return false;
        });

        if (!fallbackClicked) {
          // Log all visible buttons for debugging
          const buttons = await page.evaluate(() => {
            const btns = document.querySelectorAll('button, a.btn, .btn-green, .btn-primary, input[type="submit"]');
            return Array.from(btns).map(b => ({
              tag: b.tagName,
              text: b.textContent.trim().substring(0, 60),
              href: b.href || '',
              classes: b.className,
            }));
          });
          console.log(chalk.yellow(`  ${attemptTag}: No checkout button found. Visible buttons:`));
          for (const b of buttons) {
            console.log(chalk.gray(`    <${b.tag}> "${b.text}" class="${b.classes}" href="${b.href}"`));
          }

          console.log(chalk.yellow(`  ${attemptTag}: Pausing for manual click (60s)...`));
          await saveSnapshot(page, `error-tab${tabIndex + 1}-attempt${attempt}-no-btn`);

          // Wait for URL to change (manual click)
          const startUrl = page.url();
          const manualStart = Date.now();
          let manualClicked = false;
          while (Date.now() - manualStart < 60_000) {
            await wait(2000);
            if (page.url() !== startUrl) {
              manualClicked = true;
              break;
            }
          }

          if (!manualClicked) {
            console.log(chalk.yellow(`  ${attemptTag}: Manual click timeout, retrying...`));
            await randomDelay();
            continue;
          }

          // Manual click happened, skip the waitForNavigation below
          await wait(2000);
          const manualStatus = await page.evaluate(() => {
            // Check if we ended up on a checkout-like page
            return { url: window.location.href };
          });
          console.log(chalk.gray(`  ${attemptTag}: Manual navigation to ${manualStatus.url}`));
          await saveSnapshot(page, `checkout-tab${tabIndex + 1}-attempt${attempt}`);

          // Process checkout page
          try {
            await processCheckoutPage(page);
            console.log(chalk.green(`  ${tag}: Checkout completed successfully!`));
            await saveSnapshot(page, `confirmation-tab${tabIndex + 1}`);
            await page.close().catch(() => {});
            return { tabIndex, success: true, attempts: attempt };
          } catch (err) {
            console.log(chalk.yellow(`  ${attemptTag}: Checkout processing failed: ${err.message}`));
            await saveSnapshot(page, `error-tab${tabIndex + 1}-attempt${attempt}-checkout`);
            await randomDelay();
            continue;
          }
        }
      }

      // 3. Wait for navigation after checkout click
      console.log(chalk.gray(`  ${attemptTag}: Checkout clicked, waiting for navigation...`));

      const navResponse = await page.waitForNavigation({
        waitUntil: 'networkidle2',
        timeout: NAVIGATION_TIMEOUT,
      }).catch(() => null);

      await wait(2000);

      const navStatus = navResponse ? navResponse.status() : 0;
      const currentUrl = page.url();
      console.log(chalk.gray(`  ${attemptTag}: Navigated to ${currentUrl} (HTTP ${navStatus || 'unknown'})`));

      // If we got a non-2xx on the checkout page, retry
      if (navStatus && (navStatus < 200 || navStatus >= 300)) {
        console.log(chalk.yellow(`  ${attemptTag}: Checkout page HTTP ${navStatus}, retrying...`));
        await saveSnapshot(page, `error-tab${tabIndex + 1}-attempt${attempt}-http${navStatus}`);
        await randomDelay();
        continue;
      }

      await saveSnapshot(page, `checkout-tab${tabIndex + 1}-attempt${attempt}`);

      // 4. Process checkout page (popups, payment, confirmation)
      try {
        await processCheckoutPage(page);
        console.log(chalk.green(`  ${tag}: Checkout completed successfully!`));
        await saveSnapshot(page, `confirmation-tab${tabIndex + 1}`);
        await page.close().catch(() => {});
        return { tabIndex, success: true, attempts: attempt };
      } catch (err) {
        console.log(chalk.yellow(`  ${attemptTag}: Checkout processing failed: ${err.message}`));
        await saveSnapshot(page, `error-tab${tabIndex + 1}-attempt${attempt}-checkout`);
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

    // Verify cart has items using the login page
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
    console.log(chalk.gray(`  Each tab will independently: load cart → click checkout → process order`));
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
