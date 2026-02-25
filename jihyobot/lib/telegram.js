const axios = require('axios');
const config = require('./config');

const JIHYO_STOCK_GREETINGS = [
  "Annyeong~ Jihyo here with your gold update!",
  "Jihyo reporting in~ let's check on that gold!",
  "Hi ONCE! Jihyo's gold stock report is here~",
  "Yah~ Jihyo checked the stores for you!",
  "Your leader Jihyo is here with the update~!",
];

const JIHYO_STOCK_FOUND = [
  "Omo omo omo! There's stock available!! Grab it fast~! Go go go!",
  "YAAAH! Stock is in!! Grab it fast before it's gone~!",
  "I found something~! Grab it fast, don't miss this, okay?! Fighting!",
  "Daebak!! The gold is here! Grab it fast, move quick, I believe in you~!",
  "ONCE, listen!! Stock just appeared!! Grab it fast~! Palli palli~!",
];

const JIHYO_NO_STOCK = [
  "Aigoo~ nothing yet... but don't give up, ne? I'll keep watching!",
  "Empty shelves again~ but Jihyo won't stop checking for you!",
  "Not yet~ but we wait together, okay? ONCE never gives up!",
  "Hmm, still nothing... let's be patient a little more~",
  "No stock for now~ but your leader is on duty, don't worry!",
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function formatPrice(n) {
  return 'Rp ' + Number(n).toLocaleString('id-ID');
}

function buildStockMessage(store, variants) {
  const inStock = variants.filter(v => v.inStock);
  const hasStock = inStock.length > 0;
  const lines = [];

  if (hasStock) {
    lines.push(`🔔 @channel`);
  }
  lines.push(`💎 <b>${pick(JIHYO_STOCK_GREETINGS)}</b>`);

  const icon = hasStock ? '🟢' : '🔴';
  lines.push(
    `${icon} <b>${store.name}</b> (${store.code}) - ${inStock.length}/${variants.length} in stock`
  );

  if (hasStock) {
    for (const v of inStock) {
      const variant = config.getVariantById(v.id);
      const gramStr = variant ? variant.gram + 'g' : v.name;
      const qtyStr = v.availableQty != null ? ` x${v.availableQty}` : '';
      lines.push(`    ✦ <b>${gramStr}</b> - ${formatPrice(v.price)}${qtyStr}`);
    }
  }

  lines.push('');
  lines.push(hasStock ? pick(JIHYO_STOCK_FOUND) : pick(JIHYO_NO_STOCK));

  return { text: lines.join('\n'), hasStock };
}

function createTelegramSender(botToken, chatIds) {
  const enabled = !!(botToken && chatIds.length > 0);

  async function sendToAll(text) {
    if (!enabled) return [];

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const results = await Promise.allSettled(
      chatIds.map(chatId =>
        axios.post(url, {
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        })
      )
    );

    return results.map((r, i) => ({
      chatId: chatIds[i],
      ok: r.status === 'fulfilled',
      messageId: r.status === 'fulfilled' ? r.value?.data?.result?.message_id : null,
      error: r.status === 'rejected' ? (r.reason?.response?.data?.description || r.reason?.message) : null,
    }));
  }

  return { sendToAll, enabled };
}

module.exports = {
  buildStockMessage,
  createTelegramSender,
  formatPrice,
};
