require('dotenv').config({ path: __dirname + '/../.env' });

const VARIANTS = [
  { id: 11, gram: 0.5,  name: 'Emas Batangan - 0.5 gr',  weight: 0.0005 },
  { id: 12, gram: 1,    name: 'Emas Batangan - 1 gr',    weight: 0.001  },
  { id: 13, gram: 2,    name: 'Emas Batangan - 2 gr',    weight: 0.002  },
  { id: 15, gram: 3,    name: 'Emas Batangan - 3 gr',    weight: 0.003  },
  { id: 17, gram: 5,    name: 'Emas Batangan - 5 gr',    weight: 0.005  },
  { id: 18, gram: 10,   name: 'Emas Batangan - 10 gr',   weight: 0.01   },
  { id: 19, gram: 25,   name: 'Emas Batangan - 25 gr',   weight: 0.025  },
  { id: 20, gram: 50,   name: 'Emas Batangan - 50 gr',   weight: 0.05   },
  { id: 38, gram: 100,  name: 'Emas Batangan - 100 gr',  weight: 0.1    },
  { id: 57, gram: 250,  name: 'Emas Batangan - 250 gr',  weight: 0.25   },
  { id: 58, gram: 500,  name: 'Emas Batangan - 500 gr',  weight: 0.5    },
  { id: 59, gram: 1000, name: 'Emas Batangan - 1000 gr', weight: 1.0    },
];

const storeNames = {
  ABDH: 'Pulogadung Jakarta (Ekspedisi)',
  AGDP: 'Graha Dipta Pulo Gadung',
  AJK2: 'Gedung Antam',
  AJK4: 'Setiabudi One',
  ABDG: 'Bandung',
  ASMG: 'Semarang',
  AJOG: 'Yogyakarta',
  ASB1: 'Surabaya Darmo',
  ASB2: 'Surabaya Pakuwon',
  ADPS: 'Denpasar Bali',
  ABPN: 'Balikpapan',
  AMKS: 'Makassar',
  AKNO: 'Medan',
  APLG: 'Palembang',
  APKU: 'Pekanbaru',
  ABSD: 'Serpong',
  BTR01: 'Bintaro',
  BGR01: 'Bogor',
  BKS01: 'Bekasi',
  JKT05: 'Juanda',
  JKT06: 'Puri Indah',
};

const BASE_URL = 'https://logammulia.com';

const endpoints = {
  purchasePage: '/id/purchase/gold',
  changeLocation: '/do-change-location',
};

function parseStores(raw) {
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(code => ({ code, name: storeNames[code] || code }));
}

function parseBrowserArgs(raw) {
  if (!raw) return [];
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

const stores = parseStores(process.env.JIHYO_STORES || 'ASB1,ASB2');

module.exports = {
  BASE_URL,
  VARIANTS,
  storeNames,
  endpoints,
  stores,

  cycleMs:          parseInt(process.env.JIHYO_CYCLE_MS || '30000', 10),
  retryDeadlineMs:  parseInt(process.env.JIHYO_RETRY_DEADLINE_MS || '18000', 10),
  retryDelayMs:     parseInt(process.env.JIHYO_RETRY_DELAY_MS || '6000', 10),

  redisUrl: process.env.JIHYO_REDIS_URL || 'redis://127.0.0.1:6379',

  telegram: {
    botToken: process.env.JIHYO_TELEGRAM_BOT_TOKEN || '',
    chatIds: (process.env.JIHYO_TELEGRAM_CHAT_IDS || '')
      .split(',').map(s => s.trim()).filter(Boolean),
  },

  headless:     process.env.JIHYO_HEADLESS !== 'false',
  profileMode:  process.env.JIHYO_PROFILE_MODE || 'context',
  browserArgs:  parseBrowserArgs(process.env.JIHYO_BROWSER_ARGS),

  getVariantById(id) {
    return VARIANTS.find(v => v.id === id);
  },

  getStoreName(code) {
    return storeNames[code] || code;
  },
};
