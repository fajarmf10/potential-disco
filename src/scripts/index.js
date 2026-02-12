#!/usr/bin/env node
const chalk = require('chalk');
const config = require('./config');
const { ask, close: closePrompt } = require('./lib/prompt');
const { launchBrowser, login, raceLoadPage, extractCookies, extractCurrentStore, extractCsrfToken } = require('./lib/browser');
const LogamMuliaAPI = require('./lib/api');
const { syncCookiesToPage } = require('./lib/checkout');

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
  console.log('    D - Surabaya Darmo  (ASB1)');
  console.log('    P - Surabaya Pakuwon (ASB2)');
  console.log('');

  while (true) {
    const answer = (await ask('  Store (D/P): ')).toUpperCase();
    if (answer === 'D') return 'ASB1';
    if (answer === 'P') return 'ASB2';
    console.log(chalk.red('  Invalid choice. Enter D or P.'));
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

  if (useBrowser) {
    console.log(chalk.gray('  Mode: Connect to existing browser'));
    console.log(chalk.gray(`  Make sure Chrome/Edge is running with: chrome.exe --remote-debugging-port=${debugPort}\n`));
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
  console.log(chalk.cyan('\n  [1/5] ' + (useBrowser ? 'Connecting to browser...' : 'Launching browser...')));
  const browser = await launchBrowser({ useExisting: useBrowser, debugPort });

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

  try {
    console.log(chalk.cyan('  [2/5] ' + (useBrowser ? 'Checking login status...' : 'Logging in (with Cloudflare bypass)...')));
    page = await login(page, { manualLogin: useBrowser, browser, raceTabs: config.raceTabs });

    // Step 3: Navigate to purchase page to ensure we're on the right domain and have fresh tokens
    console.log(chalk.cyan(`  [3/5] Navigating to purchase page...`));
    const currentUrl = page.url();
    if (!currentUrl.includes('/purchase/gold')) {
      await page.goto(config.BASE_URL + config.endpoints.purchasePage, {
        waitUntil: 'networkidle2',
        timeout: 30_000,
      });
    }

    // Extract cookies and tokens AFTER navigating to the purchase page
    const cookies = await extractCookies(page);
    let csrfToken = await extractCsrfToken(page);

    console.log(chalk.gray(`  Extracted ${cookies.length} cookies, CSRF token: ${csrfToken ? 'yes' : 'no'}`));

    const api = new LogamMuliaAPI();
    await api.importCookies(cookies);
    if (csrfToken) api.setCsrfToken(csrfToken);

    // Step 4: Switch to selected store and fetch stock
    const currentStore = await extractCurrentStore(page);
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
      const otherStore = storeCode === 'ASB1' ? 'ASB2' : 'ASB1';
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

    // Refresh cookies/tokens from the winning tab right before API submit
    const latestCookies = await extractCookies(page);
    await api.importCookies(latestCookies);
    const latestToken = await extractCsrfToken(page);
    if (latestToken) {
      csrfToken = latestToken;
      api.setCsrfToken(latestToken);
    }

    // Step 7: Add to cart
    console.log(chalk.cyan('\n  [6/6] Adding items to cart...'));
    const cartResult = await api.addToCart(itemsWithPrices, taxParams);

    if (cartResult.success) {
      console.log(chalk.green('  Cart updated! (HTTP ' + cartResult.status + ')'));
      console.log(chalk.green('\n  Items added to cart successfully.'));
      console.log(chalk.cyan('  Run checkout-cart.js to proceed to checkout.\n'));
    } else {
      console.error(chalk.red('  Add-to-cart failed (HTTP ' + cartResult.status + ')'));
      console.log(chalk.yellow('  Attempting via browser fallback...'));

      await syncCookiesToPage(page, api);
      await page.goto(config.BASE_URL + config.endpoints.purchasePage, {
        waitUntil: 'networkidle2',
        timeout: 30_000,
      });

      for (const item of itemsWithPrices) {
        await page.evaluate((variantId, qty) => {
          const input = document.querySelector(`#qty${variantId}`);
          if (input) {
            input.value = qty;
            input.dispatchEvent(new Event('change'));
          }
        }, item.variantId, item.qty);
      }

      await page.evaluate(() => {
        document.querySelector('#purchase').submit();
      });

      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30_000 }).catch(() => {});
      console.log(chalk.green('  Cart submitted via browser.'));
      console.log(chalk.cyan('  Run checkout-cart.js to proceed to checkout.\n'));
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
    closePrompt();
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
