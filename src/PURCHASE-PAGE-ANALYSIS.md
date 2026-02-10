# Logam Mulia Purchase Page - Technical Analysis

## 1. Page Overview

- **URL:** `https://logammulia.com/id/purchase/gold`
- **Title:** BELI EMAS | Logam Mulia
- **Purpose:** E-commerce purchase page for ANTAM gold bullion products. Users select gold bar denominations (0.5g to 1kg), view prices, calculate taxes, and add items to cart.
- **Framework:** Laravel (PHP backend), jQuery frontend, Cloudflare CDN/WAF
- **Company:** PT ANTAM Tbk - Unit Bisnis Pengolahan dan Pemurnian Logam Mulia

---

## 2. Page Structure

### Header (`<header id="web-header">`)
- **Top Header** - location selector, FAQ, product verify, order tracking, language switcher, user account dropdown
- **Bottom Header** - logo, search toggle, cart icon, main navigation mega-menu
- **User State** - when logged in shows "Hi, {name}" with links to My Account, Order History, Logout

### Mobile Menu (`#mobile-menu-container`)
- Collapsible menu with language selector and category navigation

### Main Content
1. Static banner image
2. Breadcrumbs: Home > BELI EMAS
3. Location/store selector box (current store code shown)
4. **Product table** (`div.cart-table`) - 12 gold bar variants with price, qty, subtotal
5. **Price summary sidebar** - item total, PPh 22, DPP, PPN, grand total
6. **Brankas comparison box** - shows savings with Brankas LM secure storage
7. **Budget calculator** - "Simulasi Pembelian Emas" form
8. Product carousel - related products
9. Tax information alert

### Footer (`<footer id="web-footer">`)
- Store locations with contact info
- Newsletter subscription form
- Navigation links, accreditations, copyright

---

## 3. Authentication

### How Login Works
- Login popup loaded via AJAX: `<a href="#" data-fancybox data-type="ajax" data-src="/popup-login">Masuk</a>`
- Registration link: `<a href="/register">Daftar</a>`
- Logout: GET `/logout`

### Auth State Detection (JavaScript)
```javascript
var auth = parseInt("1");      // 1 = logged in, 0 = not
var isLogin = 'login';         // set to 'login' when authenticated
var newLogin = 'true' === 'true';
```

### Session Cookies
| Cookie | Purpose |
|--------|---------|
| `logammulia_session` | Laravel session ID |
| `XSRF-TOKEN` | Encrypted CSRF token (Laravel) |
| `remember_web_59ba36addc2b2f9401580f014c7f58ea4e30989d` | "Remember me" token |

---

## 4. Product Catalog

### Variant Table

| # | Variant Name | ID | Price (IDR) | Weight (kg) | Item Code |
|---|-------------|-----|-------------|-------------|-----------|
| 1 | Emas Batangan - 0.5 gr | 11 | 1,510,000 | 0.0005 | P06P112 |
| 2 | Emas Batangan - 1 gr | 12 | 2,920,000 | 0.001 | P06P111 |
| 3 | Emas Batangan - 2 gr | 13 | 5,790,000 | 0.002 | P06P110 |
| 4 | Emas Batangan - 3 gr | 15 | 8,667,000 | 0.003 | P06P108 |
| 5 | Emas Batangan - 5 gr | 17 | 14,415,000 | 0.005 | P06P107 |
| 6 | Emas Batangan - 10 gr | 18 | 28,750,000 | 0.01 | P06P106 |
| 7 | Emas Batangan - 25 gr | 19 | 71,710,000 | 0.025 | P06P105 |
| 8 | Emas Batangan - 50 gr | 20 | 143,255,000 | 0.05 | P06P104 |
| 9 | Emas Batangan - 100 gr | 38 | 286,360,000 | 0.1 | P06P103 |
| 10 | Emas Batangan - 250 gr | 57 | 715,590,000 | 0.25 | P06P102 |
| 11 | Emas Batangan - 500 gr | 58 | 1,430,900,000 | 0.5 | P06P115 |
| 12 | Emas Batangan - 1000 gr | 59 | 2,860,600,000 | 1.0 | P06P101 |

### Price Embedding

Prices are embedded as `price` attributes directly on the quantity input elements:

```html
<input type="hidden" name="id_variant[]" value="11">
<input step="1" min="0" name="qty[]" price="1510000.00" id="qty11"
       value="0" class="input-text qty text" type="number" weight="0.0005">
```

The `price` and `weight` attributes are custom HTML attributes used by the JavaScript calculation logic.

### Google Analytics Product Array

A `purchase_array` variable contains structured product data used for GA4 ecommerce tracking:

```javascript
var purchase_array = [
  {"item_id":"P06P112","item_name":"Certicard Emas Batangan @ 0.5 gr",
   "currency":"IDR","index":0,"item_category":"Gold Bullion",
   "price":1510000,"quantity":0},
  // ... 11 more entries
];
```

---

## 5. Stock Availability

### Indicators

Two HTML patterns indicate a variant is out of stock:

1. **CSS class** `disabled` on the row container:
   ```html
   <div class="ctr disabled">
   ```

2. **No-stock span** inside the product text:
   ```html
   <span class="no-stock">Belum tersedia</span>
   ```

When in stock, the `disabled` class is absent and the `no-stock` span is not rendered. The `disabled` class visually grays out the row and prevents interaction.

In the captured snapshot, all 12 variants show "Belum tersedia" (not yet available).

---

## 6. Purchase Form (`form#purchase`)

### Form Attributes
```html
<form id="purchase" method="post"
      action="https://logammulia.com/add-to-cart-multiple"
      enctype="multipart/form-data" autocomplete="off">
```

### All Form Fields

#### CSRF Token
```html
<input type="hidden" name="_token" value="mFNQe5g2316Z0f7fEuJ1oLDlOT9I93TirtwTmAuO">
```

#### Variant Arrays (repeated 12 times, one per variant)
```html
<input type="hidden" name="id_variant[]" value="11">
<input name="qty[]" price="1510000.00" id="qty11" value="0"
       type="number" weight="0.0005">
```

All 12 variants are always submitted. Unselected variants have `qty=0`.

#### Tax and Calculation Fields
```html
<input type="hidden" name="grand_total" id="grand_total" value="0">
<input type="hidden" name="tax_type" id="tax_type" value="PPH22">
<input type="hidden" name="tax_rate_npwp" id="tax_rate_npwp" value="0">
<input type="hidden" name="tax_rate_non_npwp" id="tax_rate_non_npwp" value="0">
<input type="hidden" name="tax_number" id="tax_number" value="on">
<input type="hidden" name="ppn_rate" id="ppn_rate" value=" 12 ">
<input type="hidden" name="dpp_rate" id="dpp_rate" value=" 0.91666666666667 ">
<input type="hidden" name="hemat_brankas" id="hemat_brankas" value="10">
<input type="hidden" name="current_url" id="current_url"
       value="https://logammulia.com/id/purchase/gold">
```

| Field | Value | Description |
|-------|-------|-------------|
| `grand_total` | Calculated | Updated by JS before submission |
| `tax_type` | `PPH22` | Tax scheme identifier |
| `tax_rate_npwp` | `0` | Tax rate for NPWP holders (%) |
| `tax_rate_non_npwp` | `0` | Tax rate for non-NPWP holders (%) |
| `tax_number` | `on` or `off` | Whether user has NPWP |
| `ppn_rate` | `12` | VAT rate (%) |
| `dpp_rate` | `0.91666666666667` | DPP multiplier (11/12) |
| `hemat_brankas` | `10` | Brankas savings percentage |
| `current_url` | Page URL | Return/referer URL |

### Form Submission
The "Tambah ke Keranjang" (Add to Cart) button triggers form submission:
```javascript
$('#add-cart-button-gold').click(function() {
    $("#purchase").submit();
});
```

---

## 7. JavaScript Calculation Logic

### Global Variables
```javascript
var total_weight = 0;     // Total weight in grams (accumulated)
var brankas_price = 0;    // Brankas price from API
```

### `calculateAll()` - Main Orchestrator
Called whenever any quantity changes. Iterates all qty inputs:

```javascript
function calculateAll() {
    total_weight = 0;
    $(".input-number-wrap .qty").each(function() {
        var thisVal = $(this).val();
        var thisPrice = $(this).attr('price');
        var thisWeight = $(this).attr('weight');
        var getID = $(this).attr('id');

        total_weight += parseFloat(thisWeight) * parseInt(thisVal) * 1000;

        // Update subtotal display
        $('.'+ getID).text(addCommas(parseInt(thisVal) * parseInt(thisPrice)))
                      .attr('value', parseInt(thisVal) * parseInt(thisPrice));
        calculateGrand();
    });
    brankas();
}
```

### `calculateGrand()` - Summary Display
Sums all subtotals and updates the price summary sidebar:

```javascript
function calculateGrand() {
    var a = 0;
    $(".subtotal").each(function() {
        a += parseInt($(this).attr('value'));
        $('#item_price_total').text(addCommas(a));
    });
    $("#item_tax").text(addCommas(tax(a)));
    $("#item_ppn").text(addCommas(ppn(a)));
    $("#item_dpp").text(addCommas(dpp(a)));
    $("#item_grand_total").text(addCommas(all_total(a)));
}
```

### `tax(total_before_tax)` - PPh 22 Calculation
```
IF tax_number == "on" (has NPWP):
    tax = total * tax_rate_npwp / 100
ELSE:
    tax = total * tax_rate_non_npwp / 100
Result: Math.round(tax)
```

### `ppn(total_before_tax)` - PPN/VAT Calculation
```
IF tax_type in ["PPN2Percent", "PPN2Percent_P"]:
    ppn = total * (ppn_rate / 100)
ELSE:
    ppn = total * dpp_rate * (ppn_rate / 100)
Result: Math.round(ppn)
```

### `dpp(total_before_tax)` - DPP Calculation
```
dpp = total * dpp_rate    // total * 11/12
Result: Math.round(dpp)
```

### `all_total(total_before_tax)` - Grand Total
```
grand_total = total + tax(total)
IF tax_type in ["PPN2Percent", "PPN2Percent_P", "PPN"]:
    grand_total += ppn(total)
```

Note: With current `tax_type=PPH22`, PPN is NOT added to grand total.

### `brankas()` - Brankas Price (AJAX)
```javascript
$.ajax({
    type: "POST",
    url: "https://logammulia.com/get-brankas-price",
    data: {"weight": total_weight, "_token": csrfToken},
    success: function(data) {
        brankas_price = data;
        $("#brankas_price").text(addCommas(data));
        // savings = (total_price + pph) - brankas_price
    }
});
```

### Quantity +/- Button Handlers
- **Plus button** (`.plus`): increments qty by 1, calls `calculateAll()`
- **Minus button** (`.minus`): decrements qty by 1 (min 0), calls `calculateAll()`
- **Manual input** (`.qty` change): validates non-negative, shows SweetAlert warning if negative, calls `calculateAll()`

---

## 8. API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/add-to-cart-multiple` | POST (multipart) | Add variants to cart |
| `/get-brankas-price` | POST (AJAX) | Get Brankas storage price for weight |
| `/popup-login` | GET (AJAX) | Load login form popup |
| `/login` | POST | Submit login credentials |
| `/logout` | GET | Terminate session |
| `/do-search` | POST | Search products |
| `/do-change-location` | POST | Change store location |
| `/change-location` | GET (AJAX) | Load location selector popup |
| `/change-destination-transaction` | GET (AJAX) | Load transaction destination popup |
| `/consent-confirmation` | GET (AJAX) | Load consent/privacy popup |
| `/do-subscribe` | POST | Newsletter subscription |
| `/my-cart` | GET | View shopping cart |
| `/my-account` | GET | User account page |
| `/my-account/order-history` | GET | Order history |
| `/product-verify` | GET | Product verification |
| `/track-order` | GET (AJAX) | Order tracking popup |
| `/harga-emas-hari-ini` | GET | Today's gold prices |
| `/grafik-harga-emas` | GET | Gold price chart |

---

## 9. Cloudflare Integration

### Rocket Loader
```html
<script src="/cdn-cgi/scripts/7d0fa10a/cloudflare-static/rocket-loader.min.js"
        data-cf-settings="3f6e79ea2bfd5a7f7e901f5c-|49" defer></script>
```
Defers JS execution for performance. All `<script>` tags use a custom type (`3f6e79ea2bfd5a7f7e901f5c-text/javascript`) so Rocket Loader can control their execution order.

### Email Decode
```html
<script data-cfasync="false" src="/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js"></script>
```
Protects email addresses from scraping bots. Emails encoded with `data-cfemail` attribute.

### Cloudflare Cookies
- `cf_clearance` - issued after passing CF challenge (JS challenge or Turnstile)
- `cf_use_ob=0` - optimization flag
- `cf*chl_rc_ni` - challenge result

---

## 10. Third-Party Scripts

| Service | ID/Config | Purpose |
|---------|-----------|---------|
| Google Analytics | UA-117676598-1 | Web analytics, ecommerce tracking |
| Google Tag Manager | GTM-NVS4MLD | Tag management |
| TikTok Pixel | CR39QRJC77U85A2HF4A0 | Conversion tracking |
| Hotjar | hjid: 1121314, hjsv: 6 | Heatmaps, session recordings |
| Highstock | (bundled) | Financial charts (for price pages) |
| SweetAlert | (bundled) | Confirmation/warning dialogs |
| FancyBox | (via bundle.min.js) | Modal/lightbox popups |
| Slick Carousel | (via bundle.min.js) | Product carousel |
| Tippy.js | (via bundle.min.js) | Tooltips |
| jQuery Validate | (bundled) | Form validation |
| Inputmask | (bundled) | Input formatting |
| Modernizr | (via bundle.min.js) | Browser feature detection |

---

## 11. Location/Store System

### Store Codes and Locations

```javascript
var current_storage = 'ABPN';   // Current active store
```

| Code | Location | Lat | Long |
|------|----------|-----|------|
| ABDH | Pulogadung Jakarta (Ekspedisi) | -6.1927 | 106.9036 |
| AGDP | Graha Dipta Pulo Gadung (Butik) | -6.1927 | 106.9036 |
| AJK2 | Gedung Antam (Butik) | -6.3024 | 106.8428 |
| AJK4 | Setiabudi One (Butik) | -6.2161 | 106.8278 |
| ABDG | Bandung | -6.9068 | 107.6173 |
| ASMG | Semarang | -6.9822 | 110.4120 |
| AJOG | Yogyakarta | -7.7832 | 110.3899 |
| ASB1 | Surabaya Darmo | -7.2807 | 112.7389 |
| ASB2 | Surabaya Pakuwon | -7.2829 | 112.6837 |
| ADPS | Denpasar Bali | -8.6359 | 115.2200 |
| ABPN | Balikpapan | -1.2719 | 116.8596 |
| AMKS | Makassar | -5.1545 | 119.4160 |
| AKNO | Medan | 3.5913 | 98.6817 |
| APLG | Palembang | -2.9512 | 104.7622 |
| APKU | Pekanbaru | 0.5025 | 101.4255 |
| ABSD | Serpong (Butik) | -6.2304 | 106.6341 |
| BTR01 | Bintaro | -6.2722 | 106.7160 |
| BGR01 | Bogor | -6.6102 | 106.8115 |
| BKS01 | Bekasi | -6.2271 | 107.0048 |
| JKT05 | Juanda | -6.1669 | 106.8239 |
| JKT06 | Puri Indah | -6.1868 | 106.7352 |

### Location Change Flow
1. `initiateGeoLoc()` called on page load
2. Browser geolocation used to find nearest store
3. User can manually change via "Ubah Lokasi" button (opens FancyBox modal at `/change-location`)
4. Selection submitted via hidden form `#geoloc-change-location` to `POST /do-change-location`
5. Matchcode/store code stored in hidden field for budget calculator

---

## 12. Tax Calculation Details

### Indonesian Tax Context
- **PPh 22** - Pajak Penghasilan Pasal 22: withholding tax on precious metals sales per PMK 48/2023, rate 0.25%
- **PPN** - Pajak Pertambahan Nilai: VAT at 12%, but NOT CHARGED per PP 49/2022
- **DPP** - Dasar Pengenaan Pajak: tax base = 11/12 of selling price
- **NPWP** - Nomor Pokok Wajib Pajak: tax ID number

### Current Tax Configuration (from form fields)
```
tax_type        = PPH22
tax_rate_npwp   = 0     (rate for NPWP holders)
tax_rate_non_npwp = 0   (rate for non-NPWP holders)
tax_number      = on    (user has NPWP)
ppn_rate        = 12    (%)
dpp_rate        = 0.91666666666667  (11/12)
```

### Calculation Flow for Grand Total
```
1. total_price = SUM(qty[i] * price[i]) for all variants
2. pph22_tax = total_price * tax_rate / 100  (currently 0)
3. dpp = total_price * 11/12
4. ppn = dpp * 12/100  (displayed but NOT added to total)
5. grand_total = total_price + pph22_tax
```

PPN is calculated and displayed for transparency but excluded from the grand total per PP 49/2022 regulation.

---

## 13. Budget Calculator

### Form
```html
<form id="quick_buy" method="get" autocomplete="off">
    <input type="text" class="input-text input-budget"
           placeholder="masukan anggaran anda" name="budget">
    <input type="hidden" id="matchcode" value="ABPN" />
    <button type="submit">Hitung</button>
</form>
```

### Input Formatting
JavaScript adds comma separators as the user types:
- Input: `15000000`
- Display: `15,000,000`

### Parameters
- `budget` - user's budget amount in IDR
- `matchcode` - store code (ABPN = Balikpapan)

Submitted as GET request. The backend calculates which gold bar combinations fit the budget.

---

## 14. Cookie Reference (from curl capture)

### Session/Auth
| Cookie | Example Value | Scope |
|--------|--------------|-------|
| `logammulia_session` | `Cs6s6KiUwaf...` | Session |
| `XSRF-TOKEN` | `eyJpdiI6IkFN...` (encrypted) | CSRF |
| `remember_web_*` | `eyJpdiI6ImJc...` (encrypted) | Persistent auth |

### Cloudflare
| Cookie | Example Value | Scope |
|--------|--------------|-------|
| `cf_clearance` | `FhPp13C1WPxd...` | CF challenge pass |
| `cf_use_ob` | `0` | CF optimization |
| `wb-p-SERVER` | `wwwb-app227` | Load balancer |

### Analytics
| Cookie | Service |
|--------|---------|
| `_ga`, `_gid`, `_gat_*` | Google Analytics |
| `_ga_8XC1TTYW3C` | GA4 |
| `_gcl_au` | Google Conversion Linker |
| `_fbp` | Facebook Pixel |
| `_ttp`, `_tt_enable_cookie`, `ttcsid*` | TikTok |
| `_hjSession*`, `_hjSessionUser*` | Hotjar |

---

## 15. Responsive Breakpoints

The page uses a custom grid system:

| Class prefix | Breakpoint | Description |
|-------------|------------|-------------|
| `n-1-` | Default (mobile) | Mobile-first base |
| `n-540-` | 540px+ | Large phone |
| `n-768-` | 768px+ | Tablet |
| `n-992-` | 992px+ | Desktop |
| `n-1200-` | 1200px+ | Large desktop |

Grid column notation: `n-768-1per5` = 1/5 width on 768px+, `n-992-1per3` = 1/3 width on 992px+
