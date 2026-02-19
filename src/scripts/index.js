#!/usr/bin/env node
const chalk = require('chalk');
const config = require('./config');
const { ask, close: closePrompt } = require('./lib/prompt');
const { launchBrowser, login, raceLoadPage, retryLoadPage, extractCookies, extractCurrentStore, extractCsrfToken, clearBrowserState } = require('./lib/browser');
const LogamMuliaAPI = require('./lib/api');
const { runParallelCheckout } = require('./lib/checkout');
const { saveSnapshot } = require('./lib/snapshot');

const NAVIGATION_TIMEOUT = 60_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPrice(n) {
  return 'Rp ' + Number(n).toLocaleString('id-ID');
}

function printPriceTable(storeCode, variants) {
  const storeName = config.getStoreName(storeCode);
  const inStockCount = variants.filter(v => v.inStock).length;

  console.log('');
  console.log(chalk.bold(`  ${storeName} (${storeCode}) - ${inStockCount}/${variants.length} in stock`));
  console.log('  ' + '-'.repeat(68));
  console.log(
    '  ' +
    'Gram'.padEnd(8) +
    'Variant'.padEnd(26) +
    'Price'.padStart(18) +
    '  Stock'
  );
  console.log('  ' + '-'.repeat(68));

  for (const v of variants) {
    const ref = config.getVariantById(v.id);
    const gram = ref ? String(ref.gram) : '?';
    const stock = v.inStock
      ? chalk.green('Available')
      : chalk.red('Out of stock');
    const price = formatPrice(v.price);
    console.log(
      '  ' +
      gram.padEnd(8) +
      v.name.padEnd(26) +
      price.padStart(18) +
      '  ' + stock
    );
  }
  console.log('  ' + '-'.repeat(68));
  console.log('');
}

function printCartSummary(items, variants) {
  console.log(chalk.bold('\n  Cart Summary'));
  console.log('  ' + '-'.repeat(50));

  let total = 0;
  for (const item of items) {
    const variant = variants.find(v => v.id === item.variantId);
    const name = variant ? variant.name : `Variant ${item.variantId}`;
    const price = variant ? variant.price : 0;
    const subtotal = price * item.qty;
    total += subtotal;

    console.log(
      '  ' +
      name.padEnd(28) +
      ('x' + item.qty).padStart(4) +
      formatPrice(subtotal).padStart(18)
    );
  }

  console.log('  ' + '-'.repeat(50));
  console.log('  ' + 'Total'.padEnd(32) + formatPrice(total).padStart(18));
  console.log('');

  return total;
}

// ---------------------------------------------------------------------------
// Interactive prompts
// ---------------------------------------------------------------------------

async function promptStore() {
  console.log(chalk.bold('\n  Select store:'));
  console.log('    D - Surabaya Darmo     (ASB1)');
  console.log('    P - Surabaya Pakuwon   (ASB2)');
  console.log('    G - Pulogadung Jakarta (ABDH)');
  console.log('');

  while (true) {
    const answer = (await ask('  Store (D/P/G): ')).toUpperCase();
    if (answer === 'D') return 'ASB1';
    if (answer === 'P') return 'ASB2';
    if (answer === 'G') return 'ABDH';
    console.log(chalk.red('  Invalid choice. Enter D, P, or G.'));
  }
}

async function promptCartItems(variants) {
  const grams = config.GRAM_OPTIONS; // [0.5, 1, 2, 3, 5, 10, 25, 50, 100, 250, 500, 1000]
  const items = [];

  console.log(chalk.bold('  Add items to cart'));
  console.log(chalk.gray('  Enter gram weight, then quantity. Empty gram to finish.\n'));
  console.log(chalk.gray('  Available: ' + grams.join(', ') + '\n'));

  while (true) {
    const gramStr = await ask('  Gram (or Enter to finish): ');
    if (!gramStr) break;

    const gram = parseFloat(gramStr);
    const ref = config.getVariantByGram(gram);

    if (!ref) {
      console.log(chalk.red('  Invalid gram. Choose from: ' + grams.join(', ')));
      continue;
    }

    // Show stock status for this variant
    const liveVariant = variants.find(v => v.id === ref.id);
    if (liveVariant && !liveVariant.inStock) {
      console.log(chalk.yellow(`  Warning: ${ref.name} is out of stock at this store.`));
    }
    if (liveVariant) {
      console.log(chalk.gray(`  Price: ${formatPrice(liveVariant.price)}`));
    }

    const qtyStr = await ask('  Qty: ');
    const qty = parseInt(qtyStr, 10);

    if (!qty || qty <= 0) {
      console.log(chalk.gray('  Skipped.'));
      continue;
    }

    // Check if this gram is already in the list - update qty
    const existing = items.find(i => i.variantId === ref.id);
    if (existing) {
      existing.qty += qty;
      console.log(chalk.green(`  Updated: ${ref.name} - now x${existing.qty}`));
    } else {
      items.push({ variantId: ref.id, qty });
      console.log(chalk.green(`  Added: ${ref.name} x${qty}`));
    }
    console.log('');
  }

  return items;
}

async function promptConfirm(message) {
  const answer = (await ask(`  ${message} (y/n): `)).toLowerCase();
  return answer === 'y' || answer === 'yes';
}

// ---------------------------------------------------------------------------
// Main flow
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const useBrowser = args.includes('--use-browser');
  const debugPort = 9222; // Default Chrome remote debugging port

  console.log(chalk.yellow('\n  Logam Mulia - Gold Purchase Automation'));
  console.log(chalk.yellow('  ' + '='.repeat(40) + '\n'));

  const browserType = config.browserType;
  const isFirefox = browserType === 'firefox';

  if (useBrowser) {
    const browserName = isFirefox ? 'Firefox' : 'Chrome/Edge';
    const launchCmd = isFirefox
      ? `firefox.exe --remote-debugging-port=${debugPort}`
      : `chrome.exe --remote-debugging-port=${debugPort} --user-data-dir="C:\\tmp\\chrome-profile"`;
    console.log(chalk.gray(`  Mode: Connect to existing ${browserName}`));
    console.log(chalk.gray(`  Make sure ${browserName} is running with: ${launchCmd}\n`));
  }

  // Validate credentials only if not using manual login
  if (!useBrowser && (!config.credentials.email || !config.credentials.password)) {
    console.error(chalk.red('  Error: LM_EMAIL and LM_PASSWORD must be set in .env'));
    console.error(chalk.gray('  Copy .env.example to .env and fill in your credentials.\n'));
    console.error(chalk.gray('  Or use --use-browser to connect to an existing logged-in browser.\n'));
    process.exit(1);
  }

  // Step 1: Ask user which store
  let storeCode = await promptStore();
  let storeName = config.getStoreName(storeCode);
  console.log(chalk.green(`\n  Selected: ${storeName} (${storeCode})`));

  // Step 2: Launch or connect to browser
  const browserLabel = isFirefox ? 'Firefox' : 'browser';
  console.log(chalk.cyan('\n  [1/5] ' + (useBrowser ? `Connecting to ${browserLabel}...` : 'Launching browser...')));
  const browser = await launchBrowser({ useExisting: useBrowser, debugPort, browserType });

  let page;
  if (useBrowser) {
    // Get the active page from existing browser
    const pages = await browser.pages();
    page = pages.find(p => p.url().includes('logammulia.com')) || pages[0];
    if (!page) {
      page = await browser.newPage();
    }
    console.log(chalk.gray('  Connected to page: ' + page.url()));
  } else {
    page = await browser.newPage();
  }

  // Rate limit callback - asks user if they want to restart or wait
  const onRateLimit = async (cooldownSec, resumeTime) => {
    console.log(chalk.yellow(`\n  Rate limited by Cloudflare (429). Auto-resuming at ${resumeTime} (${cooldownSec}s).`));
    console.log(chalk.gray('  Waiting will auto-retry. Restarting clears site data and re-logins.'));
    const answer = await ask(`  Wait and retry, or restart? (w = wait, r = restart): `);
    return answer.toLowerCase() === 'r' ? 'restart' : 'wait';
  };

  // Session loop: allows restarting from login on rate-limit restart
  let sessionRestart = true;
  while (sessionRestart) {
  sessionRestart = false;
  try {
    console.log(chalk.cyan('  [2/5] ' + (useBrowser ? 'Checking login status...' : 'Logging in (with Cloudflare bypass)...')));
    page = await login(page, { manualLogin: useBrowser, browser, raceTabs: config.raceTabs, onRateLimit });
    await saveSnapshot(page, 'after-login');

    // Step 3: Navigate to purchase page to ensure we're on the right domain and have fresh tokens
    console.log(chalk.cyan(`  [3/5] Navigating to purchase page...`));
    const currentUrl = page.url();
    if (!currentUrl.includes('/purchase/gold')) {
      await retryLoadPage(page, config.BASE_URL + config.endpoints.purchasePage, { onRateLimit });
    }

    await saveSnapshot(page, 'purchase-page');

    // Extract cookies and tokens AFTER navigating to the purchase page
    const cookies = await extractCookies(page);
    let csrfToken = await extractCsrfToken(page);

    console.log(chalk.gray(`  Extracted ${cookies.length} cookies, CSRF token: ${csrfToken ? 'yes' : 'no'}`));

    const api = new LogamMuliaAPI();
    await api.importCookies(cookies);
    if (csrfToken) api.setCsrfToken(csrfToken);

    // Step 4: Switch to selected store and fetch stock
    const currentStore = await extractCurrentStore(page);
    console.log(chalk.gray(`  Detected store: ${currentStore || '(unknown)'}, wanted: ${storeCode}`));
    if (currentStore && currentStore === storeCode) {
      console.log(chalk.green(`  [4/5] Already at ${storeName} (${storeCode}), skipping location change`));
    } else {
      console.log(chalk.cyan(`  [4/5] Switching to ${storeName}...`));
      if (currentStore) {
        console.log(chalk.gray(`  Current store: ${currentStore}`));
      }
      if (useBrowser) {
        // When using existing browser, change location via Puppeteer form submission
        await page.evaluate((storeCode, token) => {
          const form = document.querySelector('#geoloc-change-location');
          if (form) {
            const locationInput = form.querySelector('input[name="location"]');
            const tokenInput = form.querySelector('input[name="_token"]');
            if (locationInput && tokenInput) {
              locationInput.value = storeCode;
              tokenInput.value = token;
              form.submit();
            }
          }
        }, storeCode, csrfToken);

        // Wait for navigation after location change
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30_000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 2000));

        // Re-extract CSRF token after page reload
        const newToken = await extractCsrfToken(page);
        if (newToken) {
          csrfToken = newToken;
          api.setCsrfToken(newToken);
        }
        await saveSnapshot(page, 'after-store-switch');
      } else {
        // Normal mode: use API
        await api.changeLocation(storeCode);
      }
    }

    console.log(chalk.cyan(`  [5/5] Fetching prices and stock...`));
    let { variants, taxParams } = await api.fetchPricesAndStock(useBrowser ? page : null);
    printPriceTable(storeCode, variants);

    // Check if everything is out of stock
    const inStockCount = variants.filter(v => v.inStock).length;
    if (inStockCount === 0) {
      console.log(chalk.red('\n  All items are out of stock at ' + storeName + '.'));

      // Offer to switch stores
      const allStores = ['ASB1', 'ASB2', 'ABDH'];
      const otherStores = allStores.filter(s => s !== storeCode);
      const otherStore = otherStores[0];
      const otherStoreName = config.getStoreName(otherStore);

      const shouldSwitch = await promptConfirm(`Switch to ${otherStoreName} instead?`);

      if (shouldSwitch) {
        console.log(chalk.cyan(`\n  Switching to ${otherStoreName}...`));

        // Switch and re-fetch
        if (useBrowser) {
          await page.evaluate((newStoreCode, token) => {
            const form = document.querySelector('#geoloc-change-location');
            if (form) {
              const locationInput = form.querySelector('input[name="location"]');
              const tokenInput = form.querySelector('input[name="_token"]');
              if (locationInput && tokenInput) {
                locationInput.value = newStoreCode;
                tokenInput.value = token;
                form.submit();
              }
            }
          }, otherStore, csrfToken);

          await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30_000 }).catch(() => {});
          await new Promise(r => setTimeout(r, 2000));

          const newToken = await extractCsrfToken(page);
          if (newToken) {
            csrfToken = newToken;
            api.setCsrfToken(newToken);
          }
        } else {
          await api.changeLocation(otherStore);
        }

        // Re-fetch prices
        const result = await api.fetchPricesAndStock(useBrowser ? page : null);
        variants = result.variants;
        taxParams = result.taxParams;
        printPriceTable(otherStore, result.variants);

        // Update for later use
        storeCode = otherStore;
        storeName = otherStoreName;

        // Check again
        const newInStockCount = result.variants.filter(v => v.inStock).length;
        if (newInStockCount === 0) {
          console.log(chalk.red('\n  All items are also out of stock at ' + otherStoreName + '.'));
          console.log(chalk.yellow('  Nothing to buy. Exiting.\n'));
          closePrompt();
          if (!useBrowser) await browser.close();
          return;
        }
      } else {
        console.log(chalk.yellow('\n  Cancelled. Exiting.\n'));
        closePrompt();
        if (!useBrowser) await browser.close();
        return;
      }
    }

    // Step 6: Start racing tabs and ask user what to buy in parallel
    const purchaseUrl = config.BASE_URL + config.endpoints.purchasePage;
    let fastPurchasePagePromise = null;
    if (config.raceTabs > 1) {
      console.log(chalk.cyan(`\n  Spinning ${config.raceTabs} tabs to wait for the first loaded purchase page...`));
      console.log(chalk.gray('  You can enter gram + qty while tabs are loading.\n'));
      fastPurchasePagePromise = raceLoadPage(browser, purchaseUrl, config.raceTabs, {
        logAttempts: false,
        onRateLimit,
      });
    }

    const cartItems = await promptCartItems(variants);

    if (fastPurchasePagePromise) {
      try {
        const raceWinner = await fastPurchasePagePromise;
        if (raceWinner && raceWinner !== page) {
          // Free resources from the previous working tab after race winner is ready.
          if (!useBrowser && !page.isClosed()) {
            await page.close().catch(() => {});
          }
          page = raceWinner;
          console.log(chalk.gray('  Fastest tab selected. Other racing tabs were closed.'));
        }
      } catch (err) {
        if (err.message === 'RATE_LIMITED_RESTART') {
          throw err; // Propagate to outer restart handler
        }
        console.log(chalk.yellow(`  Tab race failed, using current tab: ${err.message}`));
      }
    }

    if (cartItems.length === 0) {
      console.log(chalk.yellow('\n  No items selected. Exiting.'));
      closePrompt();
      if (!useBrowser) await browser.close();
      return;
    }

    // Attach prices from live data
    const itemsWithPrices = [];
    for (const item of cartItems) {
      const variant = variants.find(v => v.id === item.variantId);
      const ref = config.getVariantById(item.variantId);
      itemsWithPrices.push({
        ...item,
        price: variant ? variant.price : 0,
        name: ref ? ref.name : `Variant ${item.variantId}`,
      });
    }

    printCartSummary(itemsWithPrices, variants);

    const confirmed = await promptConfirm('Proceed to add to cart?');
    if (!confirmed) {
      console.log(chalk.yellow('\n  Cancelled.'));
      closePrompt();
      if (!useBrowser) await browser.close();
      return;
    }

    closePrompt(); // Done with stdin - release it before checkout

    // Refresh cookies/tokens from the winning tab right before first add-to-cart
    const latestCookies = await extractCookies(page);
    await api.importCookies(latestCookies);
    const latestToken = await extractCsrfToken(page);
    if (latestToken) {
      csrfToken = latestToken;
      api.setCsrfToken(latestToken);
    }

    // -----------------------------------------------------------------------
    // Main loop: add-to-cart → N tabs checkout → repeat until Ctrl+C
    // -----------------------------------------------------------------------
    const rounds = 2;
    let cycle = 0;

    while (true) {
      cycle++;

      // activePage is the page we'll use for browser-based add-to-cart
      let activePage = page;

      if (cycle > 1) {
        // Refresh session tokens via a new page
        console.log(chalk.yellow(`\n  --- Cycle ${cycle}: refreshing session ---`));
        activePage = await browser.newPage();
        try {
          await activePage.goto(config.BASE_URL + config.endpoints.purchasePage, {
            waitUntil: 'networkidle2',
            timeout: NAVIGATION_TIMEOUT,
          });
          const freshCookies = await extractCookies(activePage);
          await api.importCookies(freshCookies);
          const freshToken = await extractCsrfToken(activePage);
          if (freshToken) {
            csrfToken = freshToken;
            api.setCsrfToken(freshToken);
          }
        } catch (err) {
          console.log(chalk.red(`  Token refresh failed: ${err.message}, retrying cycle...`));
          await activePage.close().catch(() => {});
          continue;
        }
        // Don't close activePage yet - we may need it for browser-based add-to-cart
        if (!useBrowser) {
          await activePage.close().catch(() => {});
        }
      }

      // Add to cart
      console.log(chalk.cyan(`\n  [cycle ${cycle}] Adding items to cart...`));
      let cartResult;
      if (useBrowser) {
        cartResult = await api.addToCartViaBrowser(activePage, itemsWithPrices, taxParams);
      } else {
        cartResult = await api.addToCart(itemsWithPrices, taxParams);
      }

      if (!cartResult.success) {
        console.log(chalk.red(`  Add-to-cart failed (HTTP ${cartResult.status}), retrying...`));
        continue;
      }
      console.log(chalk.green('  Cart updated! (HTTP ' + cartResult.status + ')'));

      // Close ALL existing tabs — fresh tabs will be opened for checkout
      const allPages = await browser.pages();
      for (const p of allPages) {
        if (!p.isClosed()) await p.close().catch(() => {});
      }

      // N tabs checkout
      console.log(chalk.cyan(`  [cycle ${cycle}] Parallel checkout (${config.raceTabs} tabs x ${rounds} rounds)...`));
      const results = await runParallelCheckout(browser, config.raceTabs, rounds, { onRateLimit, storeCode });

      // Check if user chose to restart due to rate limiting
      const wantsRestart = results.some(r => r.reason === 'rate_limited_restart');
      if (wantsRestart) {
        throw new Error('RATE_LIMITED_RESTART');
      }

      // Summary
      console.log(chalk.yellow('\n  ' + '='.repeat(40)));
      console.log(chalk.bold(`  Cycle ${cycle} Results`));
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

      const cartEmpty = results.some(r => r.reason === 'cart_empty');
      if (cartEmpty) {
        console.log(chalk.yellow('  Cart emptied — re-adding items and retrying...'));
      } else if (successCount > 0) {
        console.log(chalk.green('  Cycle complete. Starting next cycle...'));
      } else {
        console.log(chalk.red('  No tabs completed. Retrying...'));
      }
    } // while(true) — Ctrl+C to stop
  } catch (err) {
    if (err.message === 'RATE_LIMITED_RESTART') {
      const currentBrowserName = isFirefox ? 'Firefox' : 'Chrome';
      console.log(chalk.yellow('\n  Cloudflare ban is server-side - clearing cookies alone may not help.'));
      console.log(chalk.yellow(`  The ban is tied to this ${currentBrowserName} instance's TLS fingerprint.`));
      console.log(chalk.yellow('  Options:'));
      console.log(chalk.yellow('    1) Clear site data and retry (works if ban has expired)'));
      console.log(chalk.yellow(`    2) Exit so you can restart ${currentBrowserName} with a fresh session`));
      if (!isFirefox) {
        console.log(chalk.yellow('    Tip: Set LM_BROWSER=firefox in .env to use Firefox (different TLS fingerprint)'));
      }
      console.log('');

      const answer = await ask('  Choose (1 = clear and retry, 2 = exit): ');

      if (answer === '2') {
        console.log(chalk.gray(`\n  Exiting. Restart ${currentBrowserName} and re-run the script.\n`));
        break; // Exit session loop, cleanup below
      }

      // Option 1: clear and retry
      console.log(chalk.cyan('  Clearing logammulia.com site data...'));

      const allPages = await browser.pages();
      let cleanupPage = allPages.find(p => !p.isClosed());
      if (!cleanupPage) cleanupPage = await browser.newPage();
      for (const p of allPages) {
        if (p !== cleanupPage && !p.isClosed()) await p.close().catch(() => {});
      }

      await clearBrowserState(cleanupPage);
      page = cleanupPage;

      console.log(chalk.green('  Site data cleared. Retrying login...\n'));
      sessionRestart = true;
      continue;
    }

    console.error(chalk.red('\n  Error: ' + err.message));
    if (err.stack) {
      console.error(chalk.gray(err.stack.split('\n').slice(1, 4).join('\n')));
    }

    if (!config.headless) {
      console.log(chalk.yellow('\n  Browser left open for debugging. Press Ctrl+C to exit.\n'));
      await new Promise(() => {});
    }
  }
  } // end session loop

  closePrompt();
  if (!useBrowser) {
    try { await browser.close(); } catch (e) {}
  } else {
    console.log(chalk.gray('\n  Left browser open (existing session).'));
  }
}

main().catch(err => {
  console.error(chalk.red('Fatal: ' + err.message));
  process.exit(1);
});
