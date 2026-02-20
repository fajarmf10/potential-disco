const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar, Cookie } = require('tough-cookie');
const cheerio = require('cheerio');
const FormData = require('form-data');
const config = require('../config');
const { saveHtml } = require('./snapshot');

class LogamMuliaAPI {
  constructor() {
    this.jar = new CookieJar();
    this.client = wrapper(axios.create({
      baseURL: config.BASE_URL,
      jar: this.jar,
      withCredentials: true,
      timeout: 30_000,
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'sec-ch-ua': '"Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
      },
    }));

    this.csrfToken = null;
    this.xsrfToken = null;
  }

  // Import cookies from Puppeteer into the tough-cookie jar
  async importCookies(puppeteerCookies) {
    let imported = 0;
    for (const c of puppeteerCookies) {
      // Handle both .logammulia.com and www.logammulia.com cookies
      const domain = c.domain || '.logammulia.com';

      const cookieStr = [
        `${c.name}=${c.value}`,
        `Domain=${domain}`,
        `Path=${c.path || '/'}`,
        c.secure ? 'Secure' : '',
        c.httpOnly ? 'HttpOnly' : '',
      ].filter(Boolean).join('; ');

      try {
        const cookie = Cookie.parse(cookieStr);
        if (cookie) {
          cookie.domain = domain;
          cookie.path = c.path || '/';
          // Try setting for both base URL and www subdomain
          for (const url of [config.BASE_URL, 'https://www.logammulia.com']) {
            try {
              await this.jar.setCookie(cookie, url);
            } catch (e) {
              // Continue if one fails
            }
          }
          imported++;
        }
      } catch (e) {
        console.log(`[api] Failed to import cookie ${c.name}: ${e.message}`);
      }
    }
    console.log(`[api] Imported ${imported}/${puppeteerCookies.length} cookies`);

    // Extract XSRF-TOKEN from cookies for use in headers
    const cookies = await this.jar.getCookies(config.BASE_URL);
    const xsrf = cookies.find(c => c.key === 'XSRF-TOKEN');
    if (xsrf) {
      this.xsrfToken = decodeURIComponent(xsrf.value);
    }
  }

  // Set CSRF token from page parse
  setCsrfToken(token) {
    this.csrfToken = token;
  }

  // Switch the active store/location via POST to /do-change-location
  async changeLocation(storeCode) {
    if (!this.csrfToken) {
      // Fetch the page first to get a CSRF token
      await this.fetchPricesAndStock();
    }

    const form = new FormData();
    form.append('_token', this.csrfToken);
    form.append('location', storeCode);

    const headers = {
      ...form.getHeaders(),
      'Origin': config.BASE_URL,
      'Referer': config.BASE_URL + config.endpoints.purchasePage,
    };

    if (this.xsrfToken) {
      headers['X-XSRF-TOKEN'] = this.xsrfToken;
    }

    const response = await this.client.post(config.endpoints.changeLocation, form, {
      headers,
      maxRedirects: 5,
      validateStatus: (status) => status < 500,
    });

    // Update CSRF/XSRF tokens from response
    if (response.data && typeof response.data === 'string') {
      saveHtml(response.data, `api-change-location-${response.status}`);
      const $ = cheerio.load(response.data);
      const newToken = $('meta[name="_token"]').attr('content');
      if (newToken) this.csrfToken = newToken;
    }

    const cookies = await this.jar.getCookies(config.BASE_URL);
    const xsrf = cookies.find(c => c.key === 'XSRF-TOKEN');
    if (xsrf) this.xsrfToken = decodeURIComponent(xsrf.value);

    return response.status === 200 || response.status === 302;
  }

  // Fetch the purchase page and parse prices + stock availability
  // If a Puppeteer page is provided, use it instead of axios (bypasses CF issues)
  async fetchPricesAndStock(puppeteerPage = null) {
    console.log('[api] Fetching purchase page...');

    let html;
    if (puppeteerPage) {
      // Use Puppeteer page (when --use-browser is active)
      console.log('[api] Using Puppeteer to fetch page (CF-safe)');
      html = await puppeteerPage.content();
    } else {
      // Use axios (normal mode)
      console.log('[api] Using axios to fetch page');
      const response = await this.client.get(config.endpoints.purchasePage, {
        headers: {
          'Referer': config.BASE_URL + '/id',
        },
      });
      html = response.data;
    }

    saveHtml(html, 'api-fetch-prices');

    const $ = cheerio.load(html);

    // Extract CSRF token
    const token = $('meta[name="_token"]').attr('content')
      || $('input[name="_token"]').first().val();
    if (token) {
      this.csrfToken = token;
    }

    // Extract tax parameters
    const taxParams = {
      taxType: $('#tax_type').val() || 'PPH22',
      taxRateNpwp: parseFloat($('#tax_rate_npwp').val()) || 0,
      taxRateNonNpwp: parseFloat($('#tax_rate_non_npwp').val()) || 0,
      taxNumber: $('#tax_number').val() || 'off',
      ppnRate: parseFloat($('#ppn_rate').val()) || 12,
      dppRate: parseFloat($('#dpp_rate').val()) || 0.91666666666667,
      hematBrankas: parseFloat($('#hemat_brankas').val()) || 10,
    };

    // Parse purchase_array from inline script for quantity data
    let purchaseArray = null;
    $('script').each((i, el) => {
      const text = $(el).html() || '';
      const match = text.match(/var\s+purchase_array\s*=\s*(\[[\s\S]*?\]);/);
      if (match) {
        try { purchaseArray = JSON.parse(match[1]); } catch (e) { /* ignore */ }
      }
    });

    // Parse each variant row
    const variants = [];
    $('form#purchase .ctr').each((i, el) => {
      const row = $(el);
      const isDisabled = row.hasClass('disabled');
      const nameEl = row.find('.cart-product .ngc-text');
      const name = nameEl.contents().first().text().trim();
      const noStock = row.find('.no-stock').length > 0;

      const idInput = row.find('input[name="id_variant[]"]');
      const qtyInput = row.find('input[name="qty[]"]');

      if (!idInput.length) return;

      const variantId = parseInt(idInput.val(), 10);
      const price = parseFloat(qtyInput.attr('price')) || 0;
      const weight = parseFloat(qtyInput.attr('weight')) || 0;

      variants.push({
        id: variantId,
        name: name || `Variant ${variantId}`,
        price,
        weight,
        inStock: !isDisabled && !noStock,
      });
    });

    // Merge availableQty from purchase_array (matched by index - same 12 variants)
    if (purchaseArray && Array.isArray(purchaseArray)) {
      for (let i = 0; i < variants.length; i++) {
        const pa = purchaseArray[i];
        if (pa) {
          variants[i].availableQty = pa.quantity ?? null;
          if (!variants[i].price && pa.price) variants[i].price = pa.price;
        }
      }
    }

    return { variants, taxParams, csrfToken: this.csrfToken };
  }

  // Add items to cart via the add-to-cart-multiple endpoint
  async addToCart(items, taxParams) {
    if (!this.csrfToken) {
      throw new Error('No CSRF token available. Call fetchPricesAndStock() first.');
    }

    console.log('[api] Adding items to cart...');

    // Build the form data matching what the site expects
    const form = new FormData();
    form.append('_token', this.csrfToken);

    // The site sends ALL variants with qty (0 for unselected).
    // We replicate that behavior.
    for (const variant of config.VARIANTS) {
      form.append('id_variant[]', String(variant.id));
      const cartItem = items.find(i => i.variantId === variant.id);
      form.append('qty[]', String(cartItem ? cartItem.qty : 0));
    }

    // Compute grand total
    let grandTotal = 0;
    for (const item of items) {
      // We need the price - caller should pass it
      if (item.price) {
        grandTotal += item.price * item.qty;
      }
    }

    form.append('grand_total', String(grandTotal));
    form.append('tax_type', taxParams.taxType || 'PPH22');
    form.append('tax_rate_npwp', String(taxParams.taxRateNpwp || 0));
    form.append('tax_rate_non_npwp', String(taxParams.taxRateNonNpwp || 0));
    form.append('tax_number', taxParams.taxNumber || 'off');
    form.append('ppn_rate', String(taxParams.ppnRate || 12));
    form.append('dpp_rate', String(taxParams.dppRate || 0.91666666666667));
    form.append('hemat_brankas', String(taxParams.hematBrankas || 10));
    form.append('current_url', config.BASE_URL + config.endpoints.purchasePage);

    const headers = {
      ...form.getHeaders(),
      'Origin': config.BASE_URL,
      'Referer': config.BASE_URL + config.endpoints.purchasePage,
    };

    if (this.xsrfToken) {
      headers['X-XSRF-TOKEN'] = this.xsrfToken;
    }

    console.log('[api] POST', config.endpoints.addToCartMultiple);
    console.log('[api] CSRF token:', this.csrfToken ? this.csrfToken.substring(0, 20) + '...' : 'MISSING');
    console.log('[api] XSRF token:', this.xsrfToken ? 'yes' : 'no');
    console.log('[api] Items:', items.map(i => `${i.name} x${i.qty}`).join(', '));
    console.log('[api] Grand total:', grandTotal);

    let response;
    try {
      response = await this.client.post(config.endpoints.addToCartMultiple, form, {
        headers,
        maxRedirects: 5,
        validateStatus: () => true, // Accept all status codes for logging
      });
    } catch (err) {
      console.error('[api] Request error:', err.message);
      if (err.response) {
        console.error('[api] Response status:', err.response.status);
        console.error('[api] Response headers:', JSON.stringify(err.response.headers, null, 2));
        console.error('[api] Response body:', typeof err.response.data === 'string'
          ? err.response.data.substring(0, 2000)
          : JSON.stringify(err.response.data));
      }
      throw err;
    }

    if (response.data && typeof response.data === 'string') {
      saveHtml(response.data, `api-add-to-cart-${response.status}`);
    }

    const is2xx = response.status >= 200 && response.status < 300;
    const success = is2xx || response.status === 302;
    const redirectedTo = response.request?.res?.responseUrl || response.headers?.location || '';

    console.log('[api] Response status:', response.status);
    console.log('[api] Response headers:', JSON.stringify({
      'content-type': response.headers['content-type'],
      'location': response.headers['location'],
      'set-cookie': response.headers['set-cookie'] ? `(${response.headers['set-cookie'].length} cookies)` : 'none',
      'cf-ray': response.headers['cf-ray'],
      'server': response.headers['server'],
    }, null, 2));

    if (!success) {
      const body = typeof response.data === 'string'
        ? response.data.substring(0, 3000)
        : JSON.stringify(response.data);
      console.error('[api] Response body:', body);
    }

    if (redirectedTo) {
      console.log('[api] Redirected to:', redirectedTo);
    }

    // Update CSRF token if the response contains a new one
    if (response.data && typeof response.data === 'string') {
      const $ = cheerio.load(response.data);
      const newToken = $('meta[name="_token"]').attr('content');
      if (newToken) {
        this.csrfToken = newToken;
      }
    }

    // Update XSRF cookie
    const cookies = await this.jar.getCookies(config.BASE_URL);
    const xsrf = cookies.find(c => c.key === 'XSRF-TOKEN');
    if (xsrf) {
      this.xsrfToken = decodeURIComponent(xsrf.value);
    }

    return {
      success,
      is2xx,
      status: response.status,
      redirectedTo,
    };
  }

  // Add items to cart via browser's fetch (bypasses Cloudflare)
  async addToCartViaBrowser(page, items, taxParams) {
    if (!this.csrfToken) {
      throw new Error('No CSRF token available. Call fetchPricesAndStock() first.');
    }

    console.log('[api] Adding items to cart via browser fetch...');
    console.log('[api] CSRF token:', this.csrfToken ? this.csrfToken.substring(0, 20) + '...' : 'MISSING');
    console.log('[api] Items:', items.map(i => `${i.name} x${i.qty}`).join(', '));

    const formItems = config.VARIANTS.map(v => {
      const cartItem = items.find(i => i.variantId === v.id);
      return { id: String(v.id), qty: String(cartItem ? cartItem.qty : 0) };
    });

    let grandTotal = 0;
    for (const item of items) {
      if (item.price) grandTotal += item.price * item.qty;
    }
    console.log('[api] Grand total:', grandTotal);

    const result = await page.evaluate(async (csrfToken, formItems, grandTotal, taxParams, currentUrl, endpoint) => {
      const formData = new FormData();
      formData.append('_token', csrfToken);

      for (const item of formItems) {
        formData.append('id_variant[]', item.id);
        formData.append('qty[]', item.qty);
      }

      formData.append('grand_total', String(grandTotal));
      formData.append('tax_type', taxParams.taxType || 'PPH22');
      formData.append('tax_rate_npwp', String(taxParams.taxRateNpwp || 0));
      formData.append('tax_rate_non_npwp', String(taxParams.taxRateNonNpwp || 0));
      formData.append('tax_number', taxParams.taxNumber || 'off');
      formData.append('ppn_rate', String(taxParams.ppnRate || 12));
      formData.append('dpp_rate', String(taxParams.dppRate || 0.91666666666667));
      formData.append('hemat_brankas', String(taxParams.hematBrankas || 10));
      formData.append('current_url', currentUrl);

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          body: formData,
          credentials: 'same-origin',
        });

        const text = await response.text();
        return {
          status: response.status,
          ok: response.ok,
          redirected: response.redirected,
          url: response.url,
          body: text.substring(0, 5000),
        };
      } catch (err) {
        return { error: err.message, status: 0 };
      }
    }, this.csrfToken, formItems, grandTotal, taxParams,
       config.BASE_URL + config.endpoints.purchasePage,
       config.endpoints.addToCartMultiple);

    if (result.error) {
      console.error('[api] Browser fetch error:', result.error);
      return { success: false, status: 0 };
    }

    console.log('[api] Response status:', result.status);
    console.log('[api] Response URL:', result.url);

    if (result.body) {
      saveHtml(result.body, `api-add-to-cart-browser-${result.status}`);
    }

    const is2xx = result.status >= 200 && result.status < 300;
    const success = is2xx || result.status === 302 || result.redirected;

    if (!success) {
      console.error('[api] Response body (first 2000 chars):', result.body?.substring(0, 2000));
    }

    // Update CSRF token from response if present
    if (result.body) {
      const $ = cheerio.load(result.body);
      const newToken = $('meta[name="_token"]').attr('content');
      if (newToken) this.csrfToken = newToken;
    }

    return {
      success,
      is2xx,
      status: result.status,
      redirectedTo: result.url,
    };
  }

  // Export cookies back to a format Puppeteer can use
  async exportCookies() {
    const cookies = await this.jar.getCookies(config.BASE_URL);
    return cookies.map(c => {
      let expires = -1;
      if (c.expires && c.expires !== 'Infinity') {
        const ts = new Date(c.expires).getTime();
        if (!isNaN(ts)) {
          expires = ts / 1000;
        }
      }
      return {
        name: c.key,
        value: c.value,
        domain: c.domain,
        path: c.path,
        expires,
        httpOnly: c.httpOnly,
        secure: c.secure,
      };
    });
  }
}

module.exports = LogamMuliaAPI;
