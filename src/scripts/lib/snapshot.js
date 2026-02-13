const fs = require('fs');
const path = require('path');

const RESULTS_DIR = path.join(__dirname, '..', 'results');

let runTimestamp = null;

function getRunDir() {
  if (!runTimestamp) {
    runTimestamp = String(Math.floor(Date.now() / 1000));
  }
  const dir = path.join(RESULTS_DIR, runTimestamp);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

async function saveSnapshot(page, label) {
  try {
    const dir = getRunDir();
    const safeName = label.replace(/[^a-zA-Z0-9_-]/g, '_') + '.html';
    const filePath = path.join(dir, safeName);
    const html = await page.content();
    fs.writeFileSync(filePath, html, 'utf-8');
    console.log(`[snapshot] Saved: ${path.relative(path.join(__dirname, '..'), filePath)}`);
    return filePath;
  } catch (err) {
    console.log(`[snapshot] Failed to save "${label}": ${err.message}`);
    return null;
  }
}

function saveHtml(html, label) {
  try {
    const dir = getRunDir();
    const safeName = label.replace(/[^a-zA-Z0-9_-]/g, '_') + '.html';
    const filePath = path.join(dir, safeName);
    fs.writeFileSync(filePath, html, 'utf-8');
    console.log(`[snapshot] Saved: ${path.relative(path.join(__dirname, '..'), filePath)}`);
    return filePath;
  } catch (err) {
    console.log(`[snapshot] Failed to save "${label}": ${err.message}`);
    return null;
  }
}

module.exports = { saveSnapshot, saveHtml };
