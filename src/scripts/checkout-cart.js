#!/usr/bin/env node
const chalk = require('chalk');
const config = require('./config');
const { launchBrowser, login } = require('./lib/browser');
const { runParallelCheckout } = require('./lib/checkout');
const { saveSnapshot } = require('./lib/snapshot');

const NAVIGATION_TIMEOUT = 60_000;

async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Verify cart has items by loading /id/my-cart
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

async function main() {
  const args = process.argv.slice(2);
  const useBrowser = args.includes('--use-browser');
  const debugPort = 9222;

  console.log(chalk.yellow('\n  Logam Mulia - Cart Checkout (standalone)'));
  console.log(chalk.yellow('  ' + '='.repeat(40) + '\n'));

  const browserType = config.browserType;
  const isFirefox = browserType === 'firefox';

  if (useBrowser) {
    const browserName = isFirefox ? 'Firefox' : 'Chrome/Edge';
    const launchCmd = isFirefox
      ? `firefox.exe --remote-debugging-port=${debugPort}`
      : `chrome.exe --remote-debugging-port=${debugPort} --user-data-dir="C:\\tmp\\chrome-profile"`;
    console.log(chalk.gray(`  Mode: Connect to existing ${browserName}`));
    console.log(chalk.gray(`  Ensure ${browserName} is running with: ${launchCmd}\n`));
  }

  if (!useBrowser && (!config.credentials.email || !config.credentials.password)) {
    console.error(chalk.red('  Error: LM_EMAIL and LM_PASSWORD must be set in .env'));
    console.error(chalk.gray('  Or use --use-browser to connect to an existing logged-in browser.\n'));
    process.exit(1);
  }

  const browserLabel = isFirefox ? 'Firefox' : 'browser';
  console.log(chalk.cyan('  [1/3] ' + (useBrowser ? `Connecting to ${browserLabel}...` : 'Launching browser...')));
  const browser = await launchBrowser({ useExisting: useBrowser, debugPort, browserType });

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

    console.log(chalk.cyan('  [2/3] Verifying cart has items...'));
    await verifyCartHasItems(page);
    await saveSnapshot(page, 'cart-verify');
    console.log(chalk.green('  Cart has items. Proceeding to checkout.'));

    // Close all existing tabs — fresh tabs will be opened for checkout
    const allPages = await browser.pages();
    for (const p of allPages) {
      if (!p.isClosed()) await p.close().catch(() => {});
    }

    const rounds = 2;
    console.log(chalk.cyan(`  [3/3] Parallel checkout...`));

    const results = await runParallelCheckout(browser, config.raceTabs, rounds, { storeCode: config.storeCodes[0] });

    // Summary
    console.log(chalk.yellow('\n  ' + '='.repeat(40)));
    console.log(chalk.bold('  Checkout Results'));
    console.log(chalk.yellow('  ' + '='.repeat(40)));

    let successCount = 0;
    for (const r of results) {
      const status = r.success ? chalk.green('SUCCESS') : chalk.red('FAILED');
      const detail = r.success
        ? `${r.rounds || 1} round(s) in ${r.attempts} attempt(s)`
        : r.reason || 'unknown';
      console.log(`  Tab ${r.tabIndex + 1}: ${status} - ${detail}`);
      if (r.success) successCount++;
    }

    const totalCheckouts = successCount * rounds;
    console.log(chalk.bold(`\n  ${successCount}/${config.raceTabs} tabs completed (${totalCheckouts} total checkouts).`));
    if (successCount > 0) {
      console.log(chalk.green('\n  Checkout automation complete!\n'));
    } else {
      console.log(chalk.red('\n  No tabs completed. Check snapshots in results/ for debugging.\n'));
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
