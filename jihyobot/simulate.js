#!/usr/bin/env node
const chalk = require('chalk');

// -- Config -------------------------------------------------------------------
const CYCLE_MS       = 30_000;
const RETRY_DEADLINE = 18_000;
const RETRY_DELAY    = 6_000;
const PAGE_LOAD_MS   = 3_000;  // simulated page.goto on success
const PAGE_FAIL_MS   = 5_000;  // simulated page.goto on failure

const STORES = [
  { code: 'ASB1',  browsers: ['chrome','firefox','edge'], priority: true },
  { code: 'ASB2',  browsers: ['chrome','firefox','edge'], priority: true },
  { code: 'ABDH',  browsers: ['chrome','firefox','edge'], priority: true },
  { code: 'AJK2',  browsers: ['chrome'],                  priority: false },
  { code: 'ABDG',  browsers: ['firefox'],                 priority: false },
  { code: 'ABSD',  browsers: ['edge'],                    priority: false },
  { code: 'BTR01', browsers: ['chrome'],                  priority: false },
  { code: 'BGR01', browsers: ['firefox'],                 priority: false },
];

const BTAG = { chrome: 'CR', firefox: 'FF', edge: 'ED' };

// -- Helpers ------------------------------------------------------------------
const events = [];

function fmt(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

function emit(t, store, profile, event, detail) {
  events.push({ t, store, profile, event, detail: detail || '' });
}

// -- Simulate one profile within a window -------------------------------------
function simProfile(windowStart, store, pIdx, browser, scenario) {
  const label = store + '-' + String.fromCharCode(65 + pIdx) + ':' + BTAG[browser];
  let t = windowStart;
  const deadline = windowStart + RETRY_DEADLINE;
  let attempt = 0;

  while (t < deadline) {
    attempt++;
    if (deadline - t <= 0) break;

    const willSucceed =
      scenario === 'happy' ||
      (scenario === 'fail-then-ok' && attempt >= 2);

    if (willSucceed) {
      t += PAGE_LOAD_MS;
      emit(t, store, label, 'OK', 'HTTP 200 (attempt ' + attempt + ')');
      t += 200;
      emit(t, store, label, 'PARSE', '12 variants');
      t += 50;
      const redisMsg = attempt === 1 && scenario === 'happy' ? 'no change' : 'updated (first data)';
      emit(t, store, label, 'REDIS', redisMsg);
      return;
    }

    // Failure
    t += PAGE_FAIL_MS;
    emit(t, store, label, 'FAIL', 'HTTP 503 (attempt ' + attempt + ')');
    if (t + RETRY_DELAY >= deadline) {
      emit(deadline, store, label, 'DEADLINE', 'exceeded after ' + attempt + ' attempts');
      return;
    }
    t += RETRY_DELAY;
    emit(t, store, label, 'WAIT', 'retry in ' + (RETRY_DELAY / 1000) + 's');
  }

  emit(deadline, store, label, 'DEADLINE', 'exceeded');
}

// -- Print events -------------------------------------------------------------
function printEvents(title, desc) {
  console.log(chalk.bold.cyan('\n' + '='.repeat(80)));
  console.log(chalk.bold.cyan('  ' + title));
  console.log(chalk.gray('  ' + desc));
  console.log(chalk.bold.cyan('='.repeat(80) + '\n'));

  events.sort((a, b) => a.t - b.t || a.store.localeCompare(b.store));

  let lastT = -1;
  for (const e of events) {
    const tStr = fmt(e.t);
    const tCol = e.t !== lastT ? chalk.white.bold(tStr) : chalk.gray(tStr);
    lastT = e.t;

    let icon, color;
    switch (e.event) {
      case 'WINDOW':   icon = '>>'; color = chalk.cyan; break;
      case 'OK':       icon = chalk.green('OK'); color = chalk.green; break;
      case 'PARSE':    icon = chalk.green('>>'); color = chalk.green; break;
      case 'REDIS':    icon = chalk.blue('DB'); color = chalk.blue; break;
      case 'FAIL':     icon = chalk.red('XX'); color = chalk.yellow; break;
      case 'WAIT':     icon = chalk.yellow('..'); color = chalk.gray; break;
      case 'DEADLINE': icon = chalk.red('!!'); color = chalk.red; break;
      default:         icon = '  '; color = chalk.white;
    }

    if (e.event === 'WINDOW') {
      console.log('  ' + tCol + '  ' + color(e.detail));
    } else {
      console.log('  ' + tCol + '  ' + icon + '  ' + chalk.cyan(e.profile.padEnd(14)) + color(e.detail));
    }
  }
}

// -- Run scenario -------------------------------------------------------------
function run(title, desc, pickScenario) {
  events.length = 0;

  for (let cycle = 0; cycle < 2; cycle++) {
    const base = cycle * CYCLE_MS;
    emit(base, '---', '---', 'WINDOW', '=== Window ' + (cycle + 1) + ' at ' + fmt(base) + ' ===');

    for (const store of STORES) {
      for (let pi = 0; pi < store.browsers.length; pi++) {
        const browser = store.browsers[pi];
        const scenario = pickScenario(cycle, store.code, pi, browser);
        simProfile(base, store.code, pi, browser, scenario);
      }
    }
  }

  printEvents(title, desc);
}

// =============================================================================
// SCENARIO 1: Happy path
// =============================================================================
run(
  'HAPPY PATH - all succeed first try',
  'Every profile loads in 3s, parses instantly, compares Redis. 14 requests per window.',
  () => 'happy'
);

// =============================================================================
// SCENARIO 2: Chrome rate limited, Firefox/Edge fine
// =============================================================================
run(
  'SAD PATH - Chrome rate limited, Firefox/Edge fine',
  'All Chrome profiles fail first attempt (503), succeed on retry at +11s. Firefox/Edge unaffected.',
  (_cycle, _store, _pi, browser) => browser === 'chrome' ? 'fail-then-ok' : 'happy'
);

// =============================================================================
// SCENARIO 3: ASB1 Chrome totally down
// =============================================================================
run(
  'SAD PATH - ASB1 Chrome dead, others fine',
  'ASB1 Chrome fails every attempt until deadline (18s). Its Firefox and Edge profiles still succeed.',
  (_cycle, store, _pi, browser) => {
    if (store === 'ASB1' && browser === 'chrome') return 'all-fail';
    return 'happy';
  }
);

// =============================================================================
// ASCII timing diagrams
// =============================================================================
console.log(chalk.bold.cyan('\n' + '='.repeat(80)));
console.log(chalk.bold.cyan('  TIMING DIAGRAMS'));
console.log(chalk.bold.cyan('='.repeat(80)));

console.log(chalk.gray('\n  Legend: [===] page loading   X fail   --- wait   OK success   !! deadline\n'));

console.log(chalk.bold('  Priority store (ASB1) - Happy path:'));
console.log(chalk.gray('  sec:  0    3    6    9   12   15   18        30'));
console.log(chalk.gray('        |    |    |    |    |    |    |         |'));
console.log(chalk.green('  A:CR  [===]OK'));
console.log(chalk.green('  B:FF  [===]OK'));
console.log(chalk.green('  C:ED  [===]OK'));
console.log(chalk.gray('                                      quiet     next window'));

console.log(chalk.bold('\n  Priority store (ASB1) - Chrome retries once:'));
console.log(chalk.gray('  sec:  0    3    6    9   12   15   18        30'));
console.log(chalk.gray('        |    |    |    |    |    |    |         |'));
console.log(chalk.yellow('  A:CR  [====]X------[===]OK'));
console.log(chalk.green('  B:FF  [===]OK'));
console.log(chalk.green('  C:ED  [===]OK'));
console.log(chalk.gray('              fail  wait  retry ok'));

console.log(chalk.bold('\n  Priority store (ASB1) - Chrome hits deadline:'));
console.log(chalk.gray('  sec:  0    3    6    9   12   15   18        30'));
console.log(chalk.gray('        |    |    |    |    |    |    |         |'));
console.log(chalk.red('  A:CR  [====]X------[====]X------!! deadline'));
console.log(chalk.green('  B:FF  [===]OK'));
console.log(chalk.green('  C:ED  [===]OK'));
console.log(chalk.gray('        attempt 1    attempt 2    give up'));
console.log(chalk.gray('        Firefox and Edge still delivered data for this store.'));

console.log(chalk.bold('\n  Non-priority store (ABDG) - 1 profile only:'));
console.log(chalk.gray('  sec:  0    3    6    9   12   15   18        30'));
console.log(chalk.gray('        |    |    |    |    |    |    |         |'));
console.log(chalk.green('  A:FF  [===]OK'));
console.log(chalk.gray('        Single request. Less load, less redundancy.'));

// =============================================================================
// Request count summary
// =============================================================================
console.log(chalk.bold.cyan('\n' + '='.repeat(80)));
console.log(chalk.bold.cyan('  REQUEST COUNT PER WINDOW'));
console.log(chalk.bold.cyan('='.repeat(80) + '\n'));

const counts = { chrome: 0, firefox: 0, edge: 0 };
let total = 0;
for (const s of STORES) {
  for (const b of s.browsers) {
    counts[b]++;
    total++;
  }
}

console.log(chalk.gray('  Browser         Profiles   Requests/window (happy path)'));
console.log(chalk.gray('  ' + '-'.repeat(55)));
for (const [type, count] of Object.entries(counts)) {
  if (!count) continue;
  console.log('  ' + type.padEnd(16) + String(count).padEnd(11) + count + ' requests');
}
console.log(chalk.gray('  ' + '-'.repeat(55)));
console.log(chalk.bold('  TOTAL           ' + String(total).padEnd(11) + total + ' requests'));

const oldTotal = STORES.length * 2;
console.log(chalk.gray('\n  Old approach:   ' + oldTotal + ' requests/window (all Chrome, 2 per store)'));
console.log(chalk.gray('  New approach:   ' + total + ' requests/window across 3 browser types'));
console.log(chalk.gray('  Chrome load:    ' + counts.chrome + ' vs ' + oldTotal + ' (' + Math.round((1 - counts.chrome / oldTotal) * 100) + '% reduction)'));
console.log('');
