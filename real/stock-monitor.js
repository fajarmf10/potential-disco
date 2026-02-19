#!/usr/bin/env node
const chalk = require("chalk");
const axios = require("axios");
const config = require("./config");
const {
  launchBrowser,
  login,
  extractCurrentStore,
  extractCsrfToken,
  waitForCloudflare,
} = require("./lib/browser");

const NAVIGATION_TIMEOUT = 60_000;
const STORES = Object.entries(config.storeNames).map(([code, name]) => ({
  code,
  name,
}));
const PRIORITY_STORE_CODES = ["ASB1", "ASB2", "ABDH"];
const MAX_TRIES_PER_STORE = 2;
const CYCLE_INTERVAL_MS = 60_000; // 1 minute after last request
const MIN_REQUEST_GAP_MS = 200; // max 5 req/sec
let lastRequestTime = 0;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Throttle: ensure at least MIN_REQUEST_GAP_MS between requests (max 5 req/sec)
async function throttle() {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_REQUEST_GAP_MS) {
    await wait(MIN_REQUEST_GAP_MS - elapsed);
  }
  lastRequestTime = Date.now();
}

function ts() {
  return new Date().toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatPrice(n) {
  return "Rp " + Number(n).toLocaleString("id-ID");
}

// ---------------------------------------------------------------------------
// Telegram
// ---------------------------------------------------------------------------

const TG_ENABLED = !!(config.telegram.botToken && config.telegram.chatId);

async function sendTelegram(text) {
  if (!TG_ENABLED) {
    console.log(chalk.gray(`  [${ts()}] [telegram] Disabled (no token/chatId)`));
    return false;
  }
  const url = `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`;
  try {
    const res = await axios.post(url, {
      chat_id: config.telegram.chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
    console.log(chalk.green(`  [${ts()}] [telegram] Sent OK (message_id: ${res.data?.result?.message_id})`));
    return true;
  } catch (err) {
    const detail = err.response?.data?.description || err.message;
    console.log(chalk.yellow(`  [${ts()}] [telegram] Failed to send: ${detail}`));
    return false;
  }
}

const JIHYO_STOCK_GREETINGS = [
  "Annyeong~ Jihyo here with your gold update!",
  "Jihyo reporting in~ let's check on that gold!",
  "Hi ONCE! Jihyo's gold stock report is here~",
  "Yah~ Jihyo checked the stores for you!",
  "Your leader Jihyo is here with the update~!",
];

const JIHYO_STOCK_FOUND = [
  "Omo omo omo! There's stock available!! Go go go! 🏃‍♀️💨",
  "YAAAH! Stock is in!! Quick, grab it before it's gone~! ✨",
  "I found something~! Don't miss this, okay?! Fighting! 💪",
  "Daebak!! The gold is here! Move fast, I believe in you~! 🌟",
  "ONCE, listen!! Stock just appeared!! Palli palli~! 🚨",
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Fisher-Yates shuffle (in-place)
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildStoreTelegramMessage(store, variants, cycle) {
  const now = ts();
  const inStock = variants.filter((v) => v.inStock);
  const lines = [];

  lines.push(`💎 <b>${pick(JIHYO_STOCK_GREETINGS)}</b>`);
  lines.push(`<i>Cycle ${cycle} - ${now}</i>\n`);

  lines.push(
    `🟢 <b>${store.name}</b> (${store.code}) - ${inStock.length}/${variants.length} in stock`
  );

  for (const v of inStock) {
    const gram = config.getVariantById(v.id);
    const gramStr = gram ? gram.gram + "g" : v.name;
    const qtyStr = v.availableQty != null ? ` x${v.availableQty}` : "";
    lines.push(`    ✦ <b>${gramStr}</b> - ${formatPrice(v.price)}${qtyStr}`);
  }

  lines.push("");
  lines.push(pick(JIHYO_STOCK_FOUND));

  return lines.join("\n");
}

// Parse purchase_array from page script tags for quantity data
async function extractPurchaseArray(page) {
  return page.evaluate(() => {
    const scripts = document.querySelectorAll("script");
    for (const script of scripts) {
      const text = script.textContent || "";
      const match = text.match(/var\s+purchase_array\s*=\s*(\[[\s\S]*?\]);/);
      if (match) {
        try {
          return JSON.parse(match[1]);
        } catch (e) {
          /* ignore */
        }
      }
    }
    return null;
  });
}

// Parse stock and prices from the page HTML + purchase_array
async function parseStock(page) {
  const purchaseArray = await extractPurchaseArray(page);

  const variants = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll("form#purchase .ctr").forEach((el) => {
      const isDisabled = el.classList.contains("disabled");
      const nameEl = el.querySelector(".cart-product .ngc-text");
      const name = nameEl
        ? nameEl.childNodes[0]?.textContent?.trim() || ""
        : "";
      const noStock = el.querySelector(".no-stock") !== null;

      const idInput = el.querySelector('input[name="id_variant[]"]');
      const qtyInput = el.querySelector('input[name="qty[]"]');
      if (!idInput) return;

      results.push({
        id: parseInt(idInput.value, 10),
        name: name || "Variant " + idInput.value,
        price: parseFloat(qtyInput?.getAttribute("price")) || 0,
        inStock: !isDisabled && !noStock,
      });
    });
    return results;
  });

  // Merge quantity from purchase_array (matched by index order - both are the same 12 variants)
  if (purchaseArray && Array.isArray(purchaseArray)) {
    for (let i = 0; i < variants.length; i++) {
      const pa = purchaseArray[i];
      if (pa) {
        variants[i].availableQty = pa.quantity ?? null;
        if (!variants[i].price && pa.price) variants[i].price = pa.price;
      }
    }
  }

  return variants;
}

// Switch store location via browser fetch (no page navigation).
// Uses page.evaluate(fetch()) to stay within the browser's Cloudflare session.
// Returns: true if a switch request was made, false if already at the right store.
async function switchStore(page, storeCode, csrfToken) {
  const currentStore = await extractCurrentStore(page);
  if (currentStore === storeCode) return false; // already there

  console.log(
    chalk.gray(
      `  [${ts()}] Switching store: ${currentStore || "?"} -> ${storeCode}`
    )
  );

  await throttle();
  const result = await page.evaluate(
    async (baseUrl, code, token) => {
      try {
        const res = await fetch(baseUrl + "/do-change-location", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "X-CSRF-TOKEN": token,
          },
          body: `_token=${encodeURIComponent(token)}&location=${encodeURIComponent(code)}`,
          credentials: "same-origin",
          redirect: "follow",
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

  if (!result.ok) {
    console.log(
      chalk.yellow(
        `  [${ts()}] Store switch returned HTTP ${result.status}${result.error ? ": " + result.error : ""}`
      )
    );
  }

  await wait(500);
  return true; // counts as a request
}

// Check if the page is showing Cloudflare Always Online cached version
async function isCloudflareAlwaysOnline(page) {
  return page.evaluate(() => {
    return document.body?.innerText?.includes("Always Online") ||
      document.body?.innerText?.includes("currently offline") ||
      !!document.querySelector("#cf-always-online");
  });
}

// Load or reload the purchase page, return true if HTTP 2xx
async function loadPurchasePage(page) {
  await throttle();
  const response = await page.goto(
    config.BASE_URL + config.endpoints.purchasePage,
    {
      waitUntil: "networkidle2",
      timeout: NAVIGATION_TIMEOUT,
    }
  );
  const status = response ? response.status() : 0;
  return status >= 200 && status < 300;
}

function printStockTable(storeCode, storeName, variants) {
  const inStockCount = variants.filter((v) => v.inStock).length;
  const symbol = inStockCount > 0 ? chalk.green("*") : chalk.red("x");

  console.log(
    `  ${symbol} ${chalk.bold(storeName)} (${storeCode}) - ${inStockCount}/${
      variants.length
    } in stock`
  );
  console.log("  " + "-".repeat(72));
  console.log(
    "  " + "Gram".padEnd(8) + "Price".padEnd(20) + "Stock".padEnd(12) + "Qty"
  );
  console.log("  " + "-".repeat(72));

  for (const v of variants) {
    const gram = config.getVariantById(v.id);
    const gramStr = gram ? String(gram.gram) + "g" : "?";
    const stockStr = v.inStock
      ? chalk.green("In Stock")
      : chalk.red("No Stock");
    const qtyStr = v.availableQty != null ? String(v.availableQty) : "-";
    const priceStr = v.price > 0 ? formatPrice(v.price) : "-";

    console.log(
      "  " +
        gramStr.padEnd(8) +
        priceStr.padEnd(20) +
        stockStr.padEnd(21) + // extra for chalk codes
        qtyStr
    );
  }
  console.log("");
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

async function main() {
  console.log(chalk.bold("\n  Stock Monitor"));
  console.log(chalk.gray(`  Stores: ${STORES.map((s) => s.name).join(", ")}`));
  console.log(
    chalk.gray(
      `  Max ${MAX_TRIES_PER_STORE * STORES.length} requests per cycle, ${
        CYCLE_INTERVAL_MS / 1000
      }s between cycles`
    )
  );
  if (TG_ENABLED) {
    console.log(chalk.gray(`  Telegram: enabled (chat ${config.telegram.chatId})`));
  } else {
    console.log(chalk.gray("  Telegram: disabled (set LM_TELEGRAM_BOT_TOKEN and LM_TELEGRAM_CHAT_ID in .env)"));
  }
  console.log(chalk.gray("  Press Ctrl+C to stop\n"));

  // Connect to existing Chrome
  const browser = await launchBrowser({
    useExisting: true,
    browserType: "chrome",
  });
  const pages = await browser.pages();
  let page = pages.find((p) => p.url().includes("logammulia.com")) || pages[0];
  if (!page) page = await browser.newPage();

  // Login check
  console.log(chalk.gray(`  [${ts()}] Checking login status...`));
  page = await login(page, { manualLogin: true, browser, raceTabs: 1 });

  let cycle = 0;

  while (true) {
    cycle++;
    const cycleStart = Date.now();
    let totalRequests = 0;

    console.log(chalk.cyan(`\n  === Cycle ${cycle} at ${ts()} ===\n`));

    // Check for Cloudflare Always Online (site offline)
    if (await isCloudflareAlwaysOnline(page)) {
      console.log(
        chalk.yellow(
          `  [${ts()}] Site is offline (Cloudflare Always Online). Skipping cycle, will retry...`
        )
      );
      // Try to reload to see if it comes back
      await loadPurchasePage(page).catch(() => {});
      totalRequests++;
      if (await isCloudflareAlwaysOnline(page)) {
        console.log(
          chalk.yellow(
            `  [${ts()}] Still offline. Waiting for next cycle.`
          )
        );
        const nextAt = new Date(Date.now() + CYCLE_INTERVAL_MS);
        console.log(
          chalk.gray(
            `\n  [${ts()}] ${totalRequests} requests this cycle. Next check at ${nextAt.toLocaleTimeString(
              "id-ID",
              { hour: "2-digit", minute: "2-digit", second: "2-digit" }
            )}...`
          )
        );
        await wait(CYCLE_INTERVAL_MS);
        continue;
      }
      console.log(chalk.green(`  [${ts()}] Site is back online!`));
    }

    const allResults = [];

    // Priority stores first (Surabaya), then the rest shuffled
    const priority = STORES.filter((s) => PRIORITY_STORE_CODES.includes(s.code));
    const rest = shuffle([...STORES.filter((s) => !PRIORITY_STORE_CODES.includes(s.code))]);
    const orderedStores = [...priority, ...rest];
    console.log(
      chalk.gray(
        `  [${ts()}] Order: ${orderedStores.map((s) => s.code).join(" -> ")}`
      )
    );

    let siteOffline = false;

    for (const store of orderedStores) {
      if (siteOffline) break;
      let success = false;

      for (let attempt = 1; attempt <= MAX_TRIES_PER_STORE; attempt++) {
        try {
          // Step 1: Switch store if needed
          const currentStore = await extractCurrentStore(page);
          if (currentStore !== store.code) {
            // Need a CSRF token to switch. If we don't have one, load purchase page first.
            let csrfToken = await extractCsrfToken(page);
            if (!csrfToken) {
              console.log(
                chalk.yellow(`  [${ts()}] No CSRF token, loading purchase page first...`)
              );
              await loadPurchasePage(page);
              totalRequests++;
              csrfToken = await extractCsrfToken(page);
            }
            if (csrfToken) {
              await switchStore(page, store.code, csrfToken);
              totalRequests++;
            } else {
              console.log(
                chalk.yellow(`  [${ts()}] ${store.name}: Still no CSRF token after page load, skipping switch`)
              );
            }
          }

          // Step 2: Always load the purchase page explicitly.
          // This ensures we land on /purchase/gold regardless of whether
          // switchStore's redirect worked or not.
          const ok = await loadPurchasePage(page);
          totalRequests++;
          if (!ok) {
            console.log(
              chalk.yellow(
                `  [${ts()}] ${store.name}: HTTP error loading purchase page (attempt ${attempt}/${MAX_TRIES_PER_STORE})`
              )
            );
            await wait(2000);
            continue;
          }

          await waitForCloudflare(page);

          // Check if we got a Cloudflare Always Online cached page
          if (await isCloudflareAlwaysOnline(page)) {
            console.log(
              chalk.yellow(
                `  [${ts()}] ${store.name}: Site went offline (Cloudflare Always Online), aborting cycle`
              )
            );
            siteOffline = true;
            break;
          }

          // Verify we're on the purchase page
          const url = page.url();
          if (!url.includes("/purchase/gold")) {
            console.log(
              chalk.yellow(
                `  [${ts()}] ${store.name}: Not on purchase page (${url}), attempt ${attempt}`
              )
            );
            await wait(2000);
            continue;
          }

          // Verify store actually changed
          const nowStore = await extractCurrentStore(page);
          if (nowStore !== store.code) {
            console.log(
              chalk.yellow(
                `  [${ts()}] ${store.name}: Store is ${nowStore}, not ${store.code}, retrying...`
              )
            );
            await wait(1000);
            continue;
          }

          // Parse stock
          const variants = await parseStock(page);
          if (variants.length === 0) {
            console.log(
              chalk.yellow(
                `  [${ts()}] ${store.name}: No variants found, retrying...`
              )
            );
            await wait(2000);
            continue;
          }

          allResults.push({ store, variants });
          printStockTable(store.code, store.name, variants);
          success = true;
          break;
        } catch (err) {
          console.log(
            chalk.red(
              `  [${ts()}] ${store.name}: ${err.message} (attempt ${attempt}/${MAX_TRIES_PER_STORE})`
            )
          );
          await wait(2000);
        }
      }

      if (!success) {
        console.log(
          chalk.red(
            `  [${ts()}] ${store.name}: Failed after ${MAX_TRIES_PER_STORE} attempts\n`
          )
        );
      }
    }

    // Summary + per-store Telegram
    const testMode = config.telegram.testMode;
    const storesWithStock = allResults.filter(
      (r) => r.variants.some((v) => v.inStock)
    );

    if (testMode) {
      // Test mode: send message for every store
      console.log(chalk.cyan(`  [Test Mode] Sending alerts for all ${allResults.length} store(s)...`));
      for (const r of allResults) {
        const msg = buildStoreTelegramMessage(r.store, r.variants, cycle);
        console.log(
          chalk.gray(
            `  [${ts()}] [telegram] Sending ${r.store.name} (${r.variants.filter((v) => v.inStock).length} in stock)...`
          )
        );
        await sendTelegram(msg);
      }
    } else if (storesWithStock.length > 0) {
      // Normal mode: only send when stock found
      const totalInStock = storesWithStock.reduce(
        (sum, r) => sum + r.variants.filter((v) => v.inStock).length,
        0
      );
      console.log(
        chalk.green.bold(
          `  >> ${totalInStock} item(s) in stock across ${storesWithStock.length} store(s)!`
        )
      );

      for (const r of storesWithStock) {
        const msg = buildStoreTelegramMessage(r.store, r.variants, cycle);
        console.log(
          chalk.gray(
            `  [${ts()}] [telegram] Sending stock alert for ${r.store.name}...`
          )
        );
        await sendTelegram(msg);
      }
    } else {
      console.log(chalk.gray(`  >> No stock available at any store (no Telegram sent)`));
    }

    // Wait 1 full minute after the last request
    const nextAt = new Date(Date.now() + CYCLE_INTERVAL_MS);
    console.log(
      chalk.gray(
        `\n  [${ts()}] ${totalRequests} requests this cycle. Next check at ${nextAt.toLocaleTimeString(
          "id-ID",
          { hour: "2-digit", minute: "2-digit", second: "2-digit" }
        )}...`
      )
    );
    await wait(CYCLE_INTERVAL_MS);
  }
}

main().catch((err) => {
  console.error(chalk.red("\n  Fatal error: " + err.message));
  process.exit(1);
});
