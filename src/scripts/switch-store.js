#!/usr/bin/env node
const chalk = require("chalk");
const config = require("./config");
const { ask, close: closePrompt } = require("./lib/prompt");
const {
  launchBrowser,
  login,
  extractCookies,
  extractCurrentStore,
  extractCsrfToken,
} = require("./lib/browser");
const LogamMuliaAPI = require("./lib/api");

// All store locations
const STORES = [
  { code: "ABDH", name: "Pulogadung Jakarta (Ekspedisi)", city: "Jakarta" },
  { code: "AGDP", name: "Graha Dipta Pulo Gadung", city: "Jakarta" },
  { code: "AJK2", name: "Gedung Antam", city: "Jakarta" },
  { code: "AJK4", name: "Setiabudi One", city: "Jakarta" },
  { code: "ABSD", name: "Serpong", city: "Jakarta" },
  { code: "BTR01", name: "Bintaro", city: "Jakarta" },
  { code: "BGR01", name: "Bogor", city: "Jakarta" },
  { code: "BKS01", name: "Bekasi", city: "Jakarta" },
  { code: "JKT05", name: "Juanda", city: "Jakarta" },
  { code: "JKT06", name: "Puri Indah", city: "Jakarta" },
  { code: "ABDG", name: "Bandung", city: "Bandung" },
  { code: "ASMG", name: "Semarang", city: "Semarang" },
  { code: "AJOG", name: "Yogyakarta", city: "Yogyakarta" },
  { code: "ASB1", name: "Surabaya Darmo", city: "Surabaya" },
  { code: "ASB2", name: "Surabaya Pakuwon", city: "Surabaya" },
  { code: "ADPS", name: "Denpasar Bali", city: "Bali" },
  { code: "ABPN", name: "Balikpapan", city: "Balikpapan" },
  { code: "AMKS", name: "Makassar", city: "Makassar" },
  { code: "AKNO", name: "Medan", city: "Medan" },
  { code: "APLG", name: "Palembang", city: "Palembang" },
  { code: "APKU", name: "Pekanbaru", city: "Pekanbaru" },
];

function groupByCity(stores) {
  const groups = {};
  for (const store of stores) {
    if (!groups[store.city]) {
      groups[store.city] = [];
    }
    groups[store.city].push(store);
  }
  return groups;
}

function printStoreList(stores) {
  console.log("");
  console.log(chalk.bold("  Available Store Locations"));
  console.log("  " + "-".repeat(70));
  console.log("  " + "No".padEnd(5) + "Code".padEnd(8) + "Location".padEnd(57));
  console.log("  " + "-".repeat(70));

  const grouped = groupByCity(stores);
  let index = 1;

  for (const [city, cityStores] of Object.entries(grouped)) {
    console.log(chalk.cyan(`\n  ${city}:`));
    for (const store of cityStores) {
      console.log(
        "  " +
          String(index).padEnd(5) +
          chalk.yellow(store.code.padEnd(8)) +
          store.name
      );
      index++;
    }
  }

  console.log("  " + "-".repeat(70));
  console.log("");
}

async function promptStoreSelection() {
  printStoreList(STORES);

  while (true) {
    const answer = await ask("  Enter store number or code: ");
    const trimmed = answer.trim().toUpperCase();

    // Try as number first
    const num = parseInt(trimmed, 10);
    if (!isNaN(num) && num >= 1 && num <= STORES.length) {
      return STORES[num - 1];
    }

    // Try as code
    const byCode = STORES.find((s) => s.code === trimmed);
    if (byCode) {
      return byCode;
    }

    console.log(chalk.red("  Invalid selection. Try again.\n"));
  }
}

async function main() {
  const args = process.argv.slice(2);
  const useBrowser = args.includes("--use-browser");
  const listOnly = args.includes("--list");

  console.log(chalk.yellow("\n  Logam Mulia - Store Location Switcher"));
  console.log(chalk.yellow("  " + "=".repeat(40) + "\n"));

  if (listOnly) {
    printStoreList(STORES);
    console.log(chalk.gray("  To switch stores, run: node switch-store.js\n"));
    return;
  }

  if (useBrowser) {
    console.log(chalk.gray("  Mode: Connect to existing browser\n"));
  }

  // Validate credentials only if not using manual login
  if (
    !useBrowser &&
    (!config.credentials.email || !config.credentials.password)
  ) {
    console.error(
      chalk.red("  Error: LM_EMAIL and LM_PASSWORD must be set in .env")
    );
    console.error(
      chalk.gray(
        "  Or use --use-browser to connect to an existing logged-in browser.\n"
      )
    );
    process.exit(1);
  }

  // Select store
  const selectedStore = await promptStoreSelection();
  console.log(
    chalk.green(`\n  Selected: ${selectedStore.name} (${selectedStore.code})\n`)
  );

  // Confirm
  const confirm = await ask("  Proceed to switch location? (y/n): ");
  if (confirm.toLowerCase() !== "y" && confirm.toLowerCase() !== "yes") {
    console.log(chalk.yellow("  Cancelled.\n"));
    closePrompt();
    return;
  }

  closePrompt();

  // Launch or connect to browser
  console.log(chalk.cyan("  Launching browser..."));
  const browser = await launchBrowser({
    useExisting: useBrowser,
    debugPort: 9222,
  });

  let page;
  if (useBrowser) {
    const pages = await browser.pages();
    page = pages.find((p) => p.url().includes("logammulia.com")) || pages[0];
    if (!page) page = await browser.newPage();
  } else {
    page = await browser.newPage();
  }

  try {
    console.log(chalk.cyan("  Logging in..."));
    page = await login(page, {
      manualLogin: useBrowser,
      browser,
      raceTabs: config.raceTabs,
    });

    // Navigate to purchase page
    const currentUrl = page.url();
    if (!currentUrl.includes("/purchase/gold")) {
      await page.goto(config.BASE_URL + config.endpoints.purchasePage, {
        waitUntil: "networkidle2",
        timeout: 30_000,
      });
    }

    // Extract tokens
    const cookies = await extractCookies(page);
    const csrfToken = await extractCsrfToken(page);

    // Check if already at the selected store
    const currentStore = await extractCurrentStore(page);
    if (currentStore && currentStore === selectedStore.code) {
      console.log(
        chalk.green(
          `\n  Already at ${selectedStore.name} (${selectedStore.code}), no switch needed.`
        )
      );
      if (!useBrowser) {
        await browser.close();
      }
      return;
    }

    if (currentStore) {
      console.log(chalk.gray(`  Current store: ${currentStore}`));
    }
    console.log(chalk.cyan(`  Switching to ${selectedStore.name}...`));

    if (useBrowser) {
      // Use Puppeteer form submission
      await page.evaluate(
        (storeCode, token) => {
          const form = document.querySelector("#geoloc-change-location");
          if (form) {
            const locationInput = form.querySelector('input[name="location"]');
            const tokenInput = form.querySelector('input[name="_token"]');
            if (locationInput && tokenInput) {
              locationInput.value = storeCode;
              tokenInput.value = token;
              form.submit();
            }
          }
        },
        selectedStore.code,
        csrfToken
      );

      await page
        .waitForNavigation({ waitUntil: "networkidle2", timeout: 30_000 })
        .catch(() => {});
    } else {
      // Use API
      const api = new LogamMuliaAPI();
      await api.importCookies(cookies);
      if (csrfToken) api.setCsrfToken(csrfToken);
      await api.changeLocation(selectedStore.code);

      // Wait to avoid rate limiting
      await new Promise((r) => setTimeout(r, 12_000));

      // Reload page to reflect change
      await page.reload({ waitUntil: "networkidle2" });
    }

    console.log(
      chalk.green(`\n  Successfully switched to ${selectedStore.name}!`)
    );
    console.log(chalk.gray("  Page URL: " + page.url()));

    if (!useBrowser) {
      console.log(chalk.gray("\n  Browser will stay open for 10 seconds...\n"));
      await new Promise((r) => setTimeout(r, 10_000));
      await browser.close();
    } else {
      console.log(chalk.gray("\n  Left browser open (existing session).\n"));
    }
  } catch (err) {
    console.error(chalk.red("\n  Error: " + err.message));
    if (err.stack) {
      console.error(chalk.gray(err.stack.split("\n").slice(1, 3).join("\n")));
    }
    if (!useBrowser) {
      try {
        await browser.close();
      } catch (e) {}
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(chalk.red("Fatal: " + err.message));
  process.exit(1);
});
