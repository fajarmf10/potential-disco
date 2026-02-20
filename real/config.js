require("dotenv").config({ path: __dirname + "/.env" });

const VARIANTS = [
  { id: 11, gram: 0.5, name: "Emas Batangan - 0.5 gr", weight: 0.0005 },
  { id: 12, gram: 1, name: "Emas Batangan - 1 gr", weight: 0.001 },
  { id: 13, gram: 2, name: "Emas Batangan - 2 gr", weight: 0.002 },
  { id: 15, gram: 3, name: "Emas Batangan - 3 gr", weight: 0.003 },
  { id: 17, gram: 5, name: "Emas Batangan - 5 gr", weight: 0.005 },
  { id: 18, gram: 10, name: "Emas Batangan - 10 gr", weight: 0.01 },
  { id: 19, gram: 25, name: "Emas Batangan - 25 gr", weight: 0.025 },
  { id: 20, gram: 50, name: "Emas Batangan - 50 gr", weight: 0.05 },
  { id: 38, gram: 100, name: "Emas Batangan - 100 gr", weight: 0.1 },
  { id: 57, gram: 250, name: "Emas Batangan - 250 gr", weight: 0.25 },
  { id: 58, gram: 500, name: "Emas Batangan - 500 gr", weight: 0.5 },
  { id: 59, gram: 1000, name: "Emas Batangan - 1000 gr", weight: 1.0 },
];

// Valid gram inputs for display
const GRAM_OPTIONS = VARIANTS.map((v) => v.gram);

function parseCartItems(str) {
  if (!str) return [];
  return str
    .split(",")
    .map((pair) => {
      const [variantId, qty] = pair.trim().split(":");
      return { variantId: parseInt(variantId, 10), qty: parseInt(qty, 10) };
    })
    .filter((item) => item.variantId && item.qty > 0);
}

module.exports = {
  BASE_URL: "https://logammulia.com",
  VARIANTS,

  credentials: {
    email: process.env.LM_EMAIL || "",
    password: process.env.LM_PASSWORD || "",
  },

  storeCodes: (process.env.LM_STORE_CODES || "ASB1,ASB2")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  tujuanTransaksi: process.env.LM_TUJUAN_TRANSAKSI || "Investasi",
  paymentMethod: process.env.LM_PAYMENT_METHOD || "",
  headless: process.env.LM_HEADLESS !== "false",
  raceTabs: parseInt(process.env.LM_RACE_TABS || "10", 10),
  browserType: (process.env.LM_BROWSER || "chrome").toLowerCase(),

  telegram: {
    botToken: process.env.LM_TELEGRAM_BOT_TOKEN || "",
    chatId: process.env.LM_TELEGRAM_CHAT_ID || "",
    testMode: process.env.LM_TELEGRAM_TEST_MODE === "true",
  },

  cartItems: parseCartItems(process.env.LM_CART_ITEMS),

  endpoints: {
    purchasePage: "/id/purchase/gold",
    addToCartMultiple: "/add-to-cart-multiple",
    myCart: "/my-cart",
    login: "/login",
    popupLogin: "/popup-login",
    logout: "/logout",
    changeLocation: "/do-change-location",
    brankasPrice: "/get-brankas-price",
    checkout: "/checkout",
  },

  storeNames: {
    ABDH: "Pulogadung Jakarta (Ekspedisi)",
    AGDP: "Graha Dipta Pulo Gadung",
    AJK2: "Gedung Antam",
    AJK4: "Setiabudi One",
    ABDG: "Bandung",
    // ASMG: 'Semarang',
    AJOG: "Yogyakarta",
    ASB1: "Surabaya Darmo",
    ASB2: "Surabaya Pakuwon",
    // ADPS: 'Denpasar Bali',
    // ABPN: 'Balikpapan',
    // AMKS: 'Makassar',
    // AKNO: 'Medan',
    // APLG: 'Palembang',
    // APKU: 'Pekanbaru',
    ABSD: "Serpong",
    BTR01: "Bintaro",
    BGR01: "Bogor",
    BKS01: "Bekasi",
    JKT05: "Juanda",
    JKT06: "Puri Indah",
  },

  getStoreName(code) {
    return this.storeNames[code] || code;
  },

  GRAM_OPTIONS,

  getVariantById(id) {
    return VARIANTS.find((v) => v.id === id);
  },

  getVariantByGram(gram) {
    return VARIANTS.find((v) => v.gram === gram);
  },
};
