#!/usr/bin/env node
const chalk = require('chalk');
const config = require('./lib/config');
const { createRedisClient } = require('./lib/redis-client');
const { createTelegramSender } = require('./lib/telegram');
const { getSharedBrowsers } = require('./lib/browser');
const StoreWorker = require('./lib/store-worker');

function ts() {
  return new Date().toLocaleTimeString('id-ID', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

async function main() {
  const debugMode = process.argv.includes('--debug');
  if (debugMode) {
    config.headless = false;
  }

  console.log(chalk.bold('\n  ╔══════════════════════════════════════╗'));
  console.log(chalk.bold('  ║  Jihyobot - Parallel Stock Monitor   ║'));
  console.log(chalk.bold('  ╚══════════════════════════════════════╝\n'));

  console.log(chalk.gray(`  [${ts()}] Configuration:`));
  console.log(chalk.gray(`    Stores:         ${config.stores.map(s => s.code).join(', ')} (${config.stores.length})`));
  console.log(chalk.gray(`    Cycle:          ${config.cycleMs / 1000}s`));
  console.log(chalk.gray(`    Retry deadline: ${config.retryDeadlineMs / 1000}s`));
  console.log(chalk.gray(`    Retry delay:    ${config.retryDelayMs / 1000}s`));
  console.log(chalk.gray(`    Profile mode:   ${config.profileMode}`));
  console.log(chalk.gray(`    Headless:       ${config.headless}`));

  const profileCount = config.profileMode === 'context'
    ? config.stores.length  // 1 Chrome per store (2 contexts each)
    : config.stores.length * 2;  // 2 Chrome per store
  const contextCount = config.stores.length * 2;
  console.log(chalk.gray(`    Chrome procs:   ${profileCount}`));
  console.log(chalk.gray(`    Total profiles: ${contextCount}`));

  // Redis
  let redis;
  try {
    redis = createRedisClient();
    await redis.connect();
    console.log(chalk.green(`  [${ts()}] Redis: connected`));
  } catch (err) {
    console.log(chalk.yellow(`  [${ts()}] Redis: ${err.message} (running without Redis)`));
    // * Create a dummy client that silently fails
    redis = createDummyRedis();
  }

  // Telegram
  const telegram = createTelegramSender(
    config.telegram.botToken,
    config.telegram.chatIds
  );
  if (telegram.enabled) {
    console.log(chalk.green(`  [${ts()}] Telegram: enabled (${config.telegram.chatIds.length} channel(s))`));
  } else {
    console.log(chalk.gray(`  [${ts()}] Telegram: disabled (set JIHYO_TELEGRAM_BOT_TOKEN and JIHYO_TELEGRAM_CHAT_IDS)`));
  }

  console.log('');

  // Create workers
  const workers = config.stores.map(
    store => new StoreWorker(store, redis, telegram)
  );

  // Graceful shutdown
  let shutdownRequested = false;

  async function shutdown() {
    if (shutdownRequested) return;
    shutdownRequested = true;

    console.log(chalk.yellow(`\n  [${ts()}] Shutting down...`));

    await Promise.allSettled(workers.map(w => w.stop()));

    // Close shared browsers (context mode)
    const shared = getSharedBrowsers();
    for (const [code, browser] of shared) {
      try {
        if (browser.isConnected()) await browser.close();
      } catch {}
    }

    try {
      await redis.quit();
    } catch {}

    console.log(chalk.gray(`  [${ts()}] Bye~! Jihyo out.\n`));
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Launch all workers in parallel
  console.log(chalk.cyan(`  [${ts()}] Launching ${workers.length} store workers...\n`));

  await Promise.allSettled(
    workers.map(w => w.start())
  );

  // If all workers exited (shouldn't happen in normal ops), shutdown
  if (!shutdownRequested) {
    console.log(chalk.yellow(`  [${ts()}] All workers exited unexpectedly`));
    await shutdown();
  }
}

function createDummyRedis() {
  const noop = async () => null;
  return {
    get: noop,
    set: noop,
    connect: noop,
    quit: noop,
    status: 'dummy',
  };
}

main().catch(err => {
  console.error(chalk.red(`\n  Fatal error: ${err.message}`));
  console.error(err.stack);
  process.exit(1);
});
