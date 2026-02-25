const chalk = require('chalk');
const config = require('./config');
const { launchProfile, setupStore, waitForCloudflare, isCloudflareAlwaysOnline, NAVIGATION_TIMEOUT } = require('./browser');
const { parseStock } = require('./parser');
const { getStoreData, setStoreData, hasDataChanged, hasStockDecreased } = require('./redis-client');
const { buildStockMessage, formatPrice } = require('./telegram');

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function ts() {
  return new Date().toLocaleTimeString('id-ID', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

class StoreWorker {
  constructor(store, redisClient, telegramSender) {
    this.store = store;
    this.redis = redisClient;
    this.telegram = telegramSender;
    this.running = false;
    this.profiles = [];
    this.tag = chalk.cyan(`[${store.code}]`);
  }

  log(msg) {
    console.log(`  ${this.tag} [${ts()}] ${msg}`);
  }

  async start() {
    this.running = true;
    this.log(`Starting worker for ${chalk.bold(this.store.name)} (${this.store.code})`);

    // Launch 2 profiles
    const profileIds = ['A', 'B'];
    const launchResults = await Promise.allSettled(
      profileIds.map(async id => {
        this.log(`Launching profile ${id}...`);
        const { browser, page, context } = await launchProfile(this.store.code, id);
        this.log(`Profile ${id}: setting up store...`);
        await setupStore(page, this.store.code);
        this.log(`Profile ${id}: ready (store verified: ${this.store.code})`);
        return { id, browser, page, context };
      })
    );

    for (const result of launchResults) {
      if (result.status === 'fulfilled') {
        this.profiles.push(result.value);
      } else {
        this.log(chalk.red(`Failed to launch profile: ${result.reason.message}`));
      }
    }

    if (this.profiles.length === 0) {
      this.log(chalk.red('No profiles launched successfully, worker stopping'));
      return;
    }

    this.log(
      chalk.green(`${this.profiles.length}/2 profiles ready. Starting monitoring loop.`)
    );

    await this.runLoop();
  }

  async runLoop() {
    while (this.running) {
      const windowStart = this.nextWindowBoundary();
      const sleepMs = windowStart - Date.now();

      if (sleepMs > 0) {
        this.log(chalk.gray(`Sleeping ${(sleepMs / 1000).toFixed(1)}s until next window`));
        await wait(sleepMs);
      }

      if (!this.running) break;

      // Fire all profiles simultaneously
      const results = await Promise.allSettled(
        this.profiles.map(p => this.fetchAndProcess(p))
      );

      for (const r of results) {
        if (r.status === 'rejected') {
          this.log(chalk.red(`Profile error: ${r.reason.message}`));
        }
      }
    }
  }

  nextWindowBoundary() {
    const now = Date.now();
    const cycle = config.cycleMs;
    return Math.ceil(now / cycle) * cycle;
  }

  async fetchAndProcess(profile) {
    const label = `${this.store.code}-${profile.id}`;
    const deadline = Date.now() + config.retryDeadlineMs;
    const purchaseUrl = config.BASE_URL + config.endpoints.purchasePage;

    while (Date.now() < deadline) {
      if (!this.running) return;

      try {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;

        const response = await profile.page.goto(purchaseUrl, {
          waitUntil: 'networkidle2',
          timeout: Math.min(remaining, NAVIGATION_TIMEOUT),
        });

        const status = response ? response.status() : 0;
        if (status < 200 || status >= 300) {
          this.log(chalk.yellow(`[${label}] HTTP ${status}, retrying in ${config.retryDelayMs / 1000}s...`));
          await wait(config.retryDelayMs);
          continue;
        }

        await waitForCloudflare(profile.page);

        if (await isCloudflareAlwaysOnline(profile.page)) {
          this.log(chalk.yellow(`[${label}] Site offline (CF Always Online), retrying...`));
          await wait(config.retryDelayMs);
          continue;
        }

        const variants = await parseStock(profile.page);
        if (variants.length === 0) {
          this.log(chalk.yellow(`[${label}] No variants parsed, retrying...`));
          await wait(config.retryDelayMs);
          continue;
        }

        // Got data — process it
        await this.processData(label, variants);
        return;

      } catch (err) {
        if (err.message.includes('Target closed') || err.message.includes('Session closed')) {
          this.log(chalk.red(`[${label}] Browser crashed, attempting relaunch...`));
          await this.relaunchProfile(profile);
        } else {
          this.log(chalk.yellow(`[${label}] ${err.message}, retrying...`));
        }
        await wait(config.retryDelayMs);
      }
    }

    this.log(chalk.gray(`[${label}] Deadline exceeded, skipping to next window`));
  }

  async processData(label, variants) {
    const inStockCount = variants.filter(v => v.inStock).length;
    const symbol = inStockCount > 0 ? chalk.green('●') : chalk.red('○');
    this.log(
      `${symbol} [${label}] ${inStockCount}/${variants.length} in stock` +
      (inStockCount > 0
        ? ' — ' + variants.filter(v => v.inStock).map(v => {
            const g = config.getVariantById(v.id);
            return (g ? g.gram + 'g' : v.name) + (v.availableQty != null ? ` x${v.availableQty}` : '');
          }).join(', ')
        : '')
    );

    const newData = {
      storeCode: this.store.code,
      storeName: this.store.name,
      fetchedAt: new Date().toISOString(),
      variants,
    };

    let shouldUpdateRedis = false;
    let shouldNotify = false;

    try {
      const existing = await getStoreData(this.redis, this.store.code);

      if (!existing) {
        // * First ever fetch for this store today
        shouldUpdateRedis = true;
        shouldNotify = true;
        this.log(chalk.blue(`[${label}] First data today, storing + notifying`));
      } else if (hasDataChanged(existing, newData)) {
        shouldUpdateRedis = true;
        if (hasStockDecreased(existing, newData)) {
          shouldNotify = true;
          this.log(chalk.magenta(`[${label}] Stock DECREASED, updating + notifying`));
        } else {
          this.log(chalk.gray(`[${label}] Data changed (no stock decrease), updating Redis silently`));
        }
      } else {
        this.log(chalk.gray(`[${label}] No change`));
      }

      if (shouldUpdateRedis) {
        await setStoreData(this.redis, this.store.code, newData);
      }
    } catch (err) {
      // ! Redis down — still notify via Telegram, just skip Redis ops
      this.log(chalk.yellow(`[${label}] Redis error: ${err.message}. Skipping Redis, will still notify.`));
      shouldNotify = inStockCount > 0;
    }

    if (shouldNotify && this.telegram.enabled) {
      const msg = buildStockMessage(this.store, variants);
      const results = await this.telegram.sendToAll(msg.text);
      for (const r of results) {
        if (r.ok) {
          this.log(chalk.green(`[telegram] Sent to ${r.chatId} (msg: ${r.messageId})`));
        } else {
          this.log(chalk.yellow(`[telegram] Failed for ${r.chatId}: ${r.error}`));
        }
      }
    }
  }

  async relaunchProfile(profile) {
    try {
      // Close old context/page gracefully
      if (profile.context) {
        await profile.context.close().catch(() => {});
      } else if (profile.page) {
        await profile.page.close().catch(() => {});
      }

      this.log(`Relaunching profile ${profile.id}...`);
      await wait(5000);

      const { browser, page, context } = await launchProfile(this.store.code, profile.id);
      await setupStore(page, this.store.code);

      profile.browser = browser;
      profile.page = page;
      profile.context = context;

      this.log(chalk.green(`Profile ${profile.id} relaunched successfully`));
    } catch (err) {
      this.log(chalk.red(`Failed to relaunch profile ${profile.id}: ${err.message}`));
    }
  }

  async stop() {
    this.running = false;
    this.log('Stopping worker...');

    for (const p of this.profiles) {
      try {
        if (p.context) {
          await p.context.close();
        } else if (p.page) {
          await p.page.close();
        }
      } catch {
        // best effort
      }
    }

    // In 'separate' mode, close the browser too
    if (config.profileMode === 'separate') {
      const seen = new Set();
      for (const p of this.profiles) {
        if (p.browser && !seen.has(p.browser)) {
          seen.add(p.browser);
          await p.browser.close().catch(() => {});
        }
      }
    }
  }
}

module.exports = StoreWorker;
