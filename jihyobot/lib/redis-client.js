const Redis = require('ioredis');
const crypto = require('crypto');
const config = require('./config');

function buildRedisKey(storeCode) {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  return `antam:${storeCode}:${dd}${mm}${yyyy}`;
}

function hashVariants(variants) {
  const payload = variants.map(v => ({
    id: v.id,
    price: v.price,
    inStock: v.inStock,
    availableQty: v.availableQty,
  }));
  payload.sort((a, b) => a.id - b.id);
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function createRedisClient() {
  const client = new Redis(config.redisUrl, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 5) return null;
      return Math.min(times * 500, 3000);
    },
    lazyConnect: true,
  });
  return client;
}

async function getStoreData(client, storeCode) {
  const key = buildRedisKey(storeCode);
  const raw = await client.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function setStoreData(client, storeCode, data) {
  const key = buildRedisKey(storeCode);
  await client.set(key, JSON.stringify(data));
}

/**
 * Returns true if variant data has changed (any field: price, inStock, availableQty).
 */
function hasDataChanged(oldData, newData) {
  if (!oldData || !oldData.variants) return true;
  return hashVariants(oldData.variants) !== hashVariants(newData.variants);
}

/**
 * Returns true if any variant's stock decreased:
 * - availableQty went down
 * - inStock flipped from true to false
 */
function hasStockDecreased(oldData, newData) {
  if (!oldData || !oldData.variants) return false;

  const oldMap = new Map(oldData.variants.map(v => [v.id, v]));

  for (const nv of newData.variants) {
    const ov = oldMap.get(nv.id);
    if (!ov) continue;

    if (ov.inStock && !nv.inStock) return true;

    if (
      ov.availableQty != null &&
      nv.availableQty != null &&
      nv.availableQty < ov.availableQty
    ) {
      return true;
    }
  }

  return false;
}

module.exports = {
  createRedisClient,
  getStoreData,
  setStoreData,
  hasDataChanged,
  hasStockDecreased,
  buildRedisKey,
  hashVariants,
};
