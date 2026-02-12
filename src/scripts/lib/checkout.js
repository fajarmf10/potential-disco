const config = require('../config');
const { saveSnapshot } = require('./snapshot');

const NAVIGATION_TIMEOUT = 60_000;

// Helper: wait for timeout
async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Dismiss any visible SweetAlert popup
async function dismissSwal(page) {
  return page.evaluate(() => {
    const btn = document.querySelector('.swal-button--confirm, .swal-button');
    if (btn) { btn.click(); return true; }
    return false;
  });
}

// Sync cookies from axios jar back into Puppeteer page
async function syncCookiesToPage(page, api) {
  const cookies = await api.exportCookies();
  if (cookies.length > 0) {
    await page.setCookie(...cookies);
  }
}

// Navigate to the cart page and verify items are there
async function verifyCart(page) {
  console.log('[checkout] Navigating to cart...');
  await page.goto(config.BASE_URL + config.endpoints.myCart, {
    waitUntil: 'networkidle2',
    timeout: NAVIGATION_TIMEOUT,
  });

  // Check if cart has items
  const cartInfo = await page.evaluate(() => {
    const body = document.body.innerHTML;
    const hasItems = body.includes('cart-product') || body.includes('keranjang');
    const isEmpty = body.includes('Keranjang Anda kosong') || body.includes('kosong');
    return { hasItems, isEmpty, url: window.location.href };
  });

  if (cartInfo.isEmpty) {
    throw new Error('Cart is empty - add-to-cart may have failed');
  }

  console.log('[checkout] Cart verified - items present');
  return cartInfo;
}

// Proceed through the checkout flow using Puppeteer
async function processCheckout(page) {
  console.log('[checkout] Starting checkout process...');

  // Look for and click the checkout/proceed button
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
    // Try finding any green/primary button on the cart page
    const fallback = await page.evaluate(() => {
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

    if (!fallback) {
      console.log('[checkout] Could not find checkout button. Pausing for manual intervention.');
      console.log('[checkout] Complete checkout manually in the browser window.');
      await waitForManualAction(page, 300_000); // Wait up to 5 minutes
      return;
    }
  }

  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: NAVIGATION_TIMEOUT }).catch(() => {});

  console.log('[checkout] On checkout page: ' + page.url());

  await processCheckoutPage(page);
}

// Process the checkout page after navigation (popups, payment, confirmation).
// Assumes the browser is already on the checkout page.
async function processCheckoutPage(page) {
  // Handle destination transaction popup if it appears
  await handleTransactionDestination(page);

  // Handle payment method selection
  await handlePaymentSelection(page);

  // Handle order confirmation
  await handleOrderConfirmation(page);
}

async function handleTransactionDestination(page) {
  // Check if the "tujuan transaksi" popup appears
  const hasPopup = await page.evaluate(() => {
    const swalContent = document.querySelector('.swal-content, .swal-modal');
    const fancybox = document.querySelector('.fancybox-content');
    if (swalContent) {
      const text = swalContent.textContent;
      return text.includes('tujuan transaksi') || text.includes('Tujuan');
    }
    if (fancybox) {
      const text = fancybox.textContent;
      return text.includes('tujuan transaksi') || text.includes('Tujuan');
    }
    return false;
  });

  if (hasPopup) {
    console.log('[checkout] Transaction destination popup detected');

    // Try to select the transaction purpose
    const purpose = config.tujuanTransaksi; // 'Investasi' or 'Perdagangan'
    const selected = await page.evaluate((purpose) => {
      // Look for radio buttons or select options
      const radios = document.querySelectorAll('input[type="radio"]');
      for (const radio of radios) {
        const label = radio.closest('label')?.textContent || '';
        if (label.includes(purpose)) {
          radio.click();
          return true;
        }
      }

      const options = document.querySelectorAll('select option');
      for (const opt of options) {
        if (opt.textContent.includes(purpose)) {
          opt.selected = true;
          opt.closest('select').dispatchEvent(new Event('change'));
          return true;
        }
      }
      return false;
    }, purpose);

    if (selected) {
      console.log(`[checkout] Selected transaction purpose: ${purpose}`);
      // Click submit/confirm button
      await tryClickSelector(page, [
        'button[type="submit"]',
        '.btn-green',
        'a.btn:has-text("Simpan")',
        'button:has-text("Simpan")',
        'button:has-text("OK")',
      ]);
    }
  }
}

async function handlePaymentSelection(page) {
  console.log('[checkout] Looking for payment method selection...');

  const paymentMethod = config.paymentMethod;

  if (!paymentMethod) {
    console.log('[checkout] No payment method configured. Pausing for manual selection.');
    console.log('[checkout] Select payment method in the browser window, then the script will continue.');
    // Wait until user proceeds past payment selection
    await waitForPageChange(page, 120_000);
    return;
  }

  // Try to select payment method
  const selected = await page.evaluate((method) => {
    // Look for payment method radio buttons or links
    const elements = document.querySelectorAll('input[type="radio"], a.payment-method, .payment-option');
    for (const el of elements) {
      const text = (el.textContent || el.value || '').toLowerCase();
      const parentText = el.closest('label, .payment-item, div')?.textContent?.toLowerCase() || '';

      if (text.includes(method) || parentText.includes(method)) {
        el.click();
        return true;
      }
    }
    return false;
  }, paymentMethod.toLowerCase());

  if (selected) {
    console.log(`[checkout] Selected payment method: ${paymentMethod}`);

    // Click proceed/confirm button
    await tryClickSelector(page, [
      'button[type="submit"]',
      '.btn-green',
      'a.btn-green',
      'button:has-text("Bayar")',
      'button:has-text("Proses")',
      'button:has-text("Konfirmasi")',
    ]);

    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: NAVIGATION_TIMEOUT }).catch(() => {});
  } else {
    console.log('[checkout] Could not auto-select payment method. Please select manually.');
    await waitForManualAction(page, 120_000);
  }
}

async function handleOrderConfirmation(page) {
  console.log('[checkout] Checking for order confirmation...');

  const pageContent = await page.evaluate(() => {
    return {
      url: window.location.href,
      hasConfirmation: document.body.textContent.includes('konfirmasi') ||
                       document.body.textContent.includes('Konfirmasi'),
      hasSuccess: document.body.textContent.includes('berhasil') ||
                  document.body.textContent.includes('Berhasil') ||
                  document.body.textContent.includes('Terima kasih'),
      hasOrderId: document.body.textContent.includes('No. Order') ||
                  document.body.textContent.includes('Order ID'),
      title: document.title,
    };
  });

  if (pageContent.hasSuccess) {
    console.log('[checkout] Order placed successfully!');
    console.log('[checkout] Page: ' + pageContent.url);

    // Try to extract order ID
    const orderId = await page.evaluate(() => {
      const text = document.body.textContent;
      const match = text.match(/(?:No\.?\s*Order|Order\s*ID)[:\s]*([A-Z0-9-]+)/i);
      return match ? match[1] : null;
    });

    if (orderId) {
      console.log('[checkout] Order ID: ' + orderId);
    }
    return;
  }

  if (pageContent.hasConfirmation) {
    // There is a confirmation step - click confirm
    console.log('[checkout] Confirmation page detected, confirming...');
    await tryClickSelector(page, [
      'button:has-text("Konfirmasi")',
      'button:has-text("Ya")',
      'button[type="submit"]',
      '.btn-green',
      '.swal-button--confirm',
    ]);

    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: NAVIGATION_TIMEOUT }).catch(() => {});

    // Check result
    const result = await page.evaluate(() => ({
      url: window.location.href,
      hasSuccess: document.body.textContent.includes('berhasil') || document.body.textContent.includes('Berhasil'),
    }));

    if (result.hasSuccess) {
      console.log('[checkout] Order confirmed successfully!');
    } else {
      console.log('[checkout] Checkout page: ' + result.url);
      console.log('[checkout] Check the browser window for the result.');
    }
    return;
  }

  console.log('[checkout] Current page: ' + pageContent.url);
  console.log('[checkout] Waiting for manual completion if needed...');
  await waitForManualAction(page, 300_000);
}

// Utility: try multiple selectors and click the first one found
async function tryClickSelector(page, selectors) {
  for (const sel of selectors) {
    try {
      // Handle :has-text pseudo selector manually
      if (sel.includes(':has-text(')) {
        const match = sel.match(/^(.+?):has-text\("(.+?)"\)$/);
        if (match) {
          const [, tag, text] = match;
          const clicked = await page.evaluate((tag, text) => {
            const elements = document.querySelectorAll(tag);
            for (const el of elements) {
              if (el.textContent.includes(text)) {
                el.click();
                return true;
              }
            }
            return false;
          }, tag, text);
          if (clicked) return true;
        }
        continue;
      }

      const el = await page.$(sel);
      if (el) {
        await el.click();
        return true;
      }
    } catch (e) {
      continue;
    }
  }
  return false;
}

// Wait for the page to change URL (user did something manually)
async function waitForPageChange(page, timeout) {
  const startUrl = page.url();
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    if (page.url() !== startUrl) return;
    await wait(2000);
  }
}

// Wait for manual user action with periodic status checks
async function waitForManualAction(page, timeout) {
  console.log('[checkout] Waiting for manual action in browser... (timeout: ' + Math.round(timeout / 1000) + 's)');
  const startTime = Date.now();
  const startUrl = page.url();

  while (Date.now() - startTime < timeout) {
    await wait(5000);

    // Check if page changed
    const currentUrl = page.url();
    if (currentUrl !== startUrl) {
      console.log('[checkout] Page changed to: ' + currentUrl);

      // Check for success indicators
      const hasSuccess = await page.evaluate(() => {
        return document.body.textContent.includes('berhasil') ||
               document.body.textContent.includes('Terima kasih');
      });

      if (hasSuccess) {
        console.log('[checkout] Order appears successful!');
        return;
      }
    }

    // Check if browser was closed
    try {
      await page.title();
    } catch (e) {
      console.log('[checkout] Browser closed.');
      return;
    }
  }

  console.log('[checkout] Manual action timeout reached.');
}

// ---------------------------------------------------------------------------
// Parallel checkout: N tabs each load /id/checkout and process independently
// ---------------------------------------------------------------------------

async function tabCheckoutLoop(browser, tabIndex, totalTabs, rounds, abortSignal) {
  const tag = `[tab ${tabIndex + 1}/${totalTabs}]`;
  const page = await browser.newPage();
  const checkoutUrl = config.BASE_URL + '/id/checkout';
  let attempt = 0;
  let completedRounds = 0;

  while (completedRounds < rounds) {
    if (abortSignal.aborted) {
      await page.close().catch(() => {});
      return { tabIndex, success: false, reason: 'aborted', rounds: completedRounds };
    }

    attempt++;
    const attemptTag = `${tag} round ${completedRounds + 1}/${rounds} attempt ${attempt}`;

    try {
      // 1. Load checkout page
      console.log(`  ${attemptTag}: Loading /id/checkout...`);
      const response = await page.goto(checkoutUrl, {
        waitUntil: 'networkidle2',
        timeout: NAVIGATION_TIMEOUT,
      });

      const status = response ? response.status() : 0;
      if (status < 200 || status >= 300) {
        console.log(`  ${attemptTag}: HTTP ${status}, retrying...`);
        continue;
      }

      await saveSnapshot(page, `checkout-tab${tabIndex + 1}-attempt${attempt}`);

      // 2. Check page has items and the checkout form
      const pageState = await page.evaluate(() => {
        const hasItems = document.querySelectorAll('.cart-item').length > 0;
        const hasForm = document.querySelector('#checkout-form') !== null;
        const hasBtn = document.querySelector('#btnContinueOrder') !== null;
        const url = window.location.href;
        const path = new URL(url).pathname;
        const isHomePage = path === '/id' || path === '/id/';
        const isCartPage = url.includes('/my-cart');
        const isLoginPage = url.includes('/login') || url.includes('/popup-login');
        return { hasItems, hasForm, hasBtn, url, isHomePage, isCartPage, isLoginPage };
      });

      if (pageState.isHomePage) {
        console.log(`  ${attemptTag}: Redirected to home — cart is empty, aborting all tabs...`);
        await saveSnapshot(page, `error-tab${tabIndex + 1}-attempt${attempt}-home-redirect`);
        abortSignal.aborted = true;
        await page.close().catch(() => {});
        return { tabIndex, success: false, reason: 'cart_empty', rounds: completedRounds };
      }

      if (pageState.isCartPage || pageState.isLoginPage) {
        console.log(`  ${attemptTag}: Redirected to ${pageState.url}, retrying...`);
        continue;
      }

      if (!pageState.hasItems || !pageState.hasForm) {
        console.log(`  ${attemptTag}: No items on checkout page, aborting all tabs...`);
        await saveSnapshot(page, `error-tab${tabIndex + 1}-attempt${attempt}-empty`);
        abortSignal.aborted = true;
        await page.close().catch(() => {});
        return { tabIndex, success: false, reason: 'cart_empty', rounds: completedRounds };
      }

      if (!pageState.hasBtn) {
        console.log(`  ${attemptTag}: "Bayar Sekarang" button not found, retrying...`);
        await saveSnapshot(page, `error-tab${tabIndex + 1}-attempt${attempt}-no-btn`);
        continue;
      }

      // 3. Select pickup at butik
      console.log(`  ${attemptTag}: Selecting butik pickup...`);
      await page.evaluate(() => {
        const radio = document.querySelector('input[name="pickCourier"].pick-store');
        if (radio && !radio.checked) radio.click();
      });

      // Dismiss swal info popup (butik location confirmation)
      await dismissSwal(page);

      // 4. Check the "Saya setuju" T&C checkbox
      console.log(`  ${attemptTag}: Checking T&C checkbox...`);
      await page.evaluate(() => {
        const cb = document.getElementById('confirmCheckout');
        if (cb && !cb.checked) cb.checked = true;
      });

      // 5. Click "Bayar Sekarang" and wait for form submission
      console.log(`  ${attemptTag}: Clicking "Bayar Sekarang"...`);

      const navPromise = page.waitForNavigation({
        waitUntil: 'networkidle2',
        timeout: NAVIGATION_TIMEOUT,
      }).catch(() => null);

      await page.evaluate(() => {
        document.getElementById('btnContinueOrder').click();
      });

      // Check for swal validation error (no navigation will happen)
      const swalError = await page.evaluate(() => {
        const overlay = document.querySelector('.swal-overlay--show-modal');
        if (!overlay) return null;
        const title = document.querySelector('.swal-title');
        const text = document.querySelector('.swal-text');
        return {
          title: title ? title.textContent : '',
          text: text ? text.textContent : '',
        };
      });

      if (swalError) {
        console.log(`  ${attemptTag}: SweetAlert: "${swalError.title}" - ${swalError.text}`);
        await saveSnapshot(page, `error-tab${tabIndex + 1}-attempt${attempt}-swal`);
        await dismissSwal(page);
        continue;
      }

      // Wait for form POST navigation
      const navResponse = await navPromise;

      const navStatus = navResponse ? navResponse.status() : 0;
      console.log(`  ${attemptTag}: Navigated to ${page.url()} (HTTP ${navStatus || 'unknown'})`);

      if (navStatus && (navStatus < 200 || navStatus >= 300)) {
        console.log(`  ${attemptTag}: Result page HTTP ${navStatus}, retrying...`);
        await saveSnapshot(page, `error-tab${tabIndex + 1}-attempt${attempt}-http${navStatus}`);
        continue;
      }

      await saveSnapshot(page, `result-tab${tabIndex + 1}-attempt${attempt}`);

      // 6. Handle post-checkout (tujuan transaksi, payment, confirmation)
      try {
        await processCheckoutPage(page);
        completedRounds++;
        console.log(`  ${tag}: Round ${completedRounds}/${rounds} completed successfully!`);
        await saveSnapshot(page, `confirmation-tab${tabIndex + 1}-round${completedRounds}`);

        if (completedRounds >= rounds) {
          await page.close().catch(() => {});
          return { tabIndex, success: true, attempts: attempt, rounds: completedRounds };
        }

        // More rounds to go — loop back to checkout page
        console.log(`  ${tag}: Starting next round...`);
        continue;
      } catch (err) {
        console.log(`  ${attemptTag}: Post-checkout failed: ${err.message}`);
        await saveSnapshot(page, `error-tab${tabIndex + 1}-attempt${attempt}-post`);
        continue;
      }
    } catch (err) {
      console.log(`  ${attemptTag}: Error: ${err.message}`);
      await saveSnapshot(page, `error-tab${tabIndex + 1}-attempt${attempt}`).catch(() => {});
      continue;
    }
  }
}

// Open N tabs and run checkout on all of them in parallel.
// Each tab processes `rounds` successful checkouts before finishing.
// Returns array of results. Every tab retries indefinitely until success or empty cart.
async function runParallelCheckout(browser, numTabs, rounds = 1) {
  const totalCheckouts = numTabs * rounds;
  console.log(`  Opening ${numTabs} tabs for parallel checkout (${rounds} round(s) each = ${totalCheckouts} total)...`);
  console.log(`  Each tab: /id/checkout → select pickup → agree T&C → Bayar Sekarang`);
  console.log(`  All tabs retry indefinitely on failure.\n`);

  const abortSignal = { aborted: false };
  const promises = [];
  for (let i = 0; i < numTabs; i++) {
    promises.push(tabCheckoutLoop(browser, i, numTabs, rounds, abortSignal));
  }
  return Promise.all(promises);
}

module.exports = {
  syncCookiesToPage,
  verifyCart,
  processCheckout,
  processCheckoutPage,
  tryClickSelector,
  runParallelCheckout,
};
