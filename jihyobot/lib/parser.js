/**
 * Parses stock/price data from the logammulia.com purchase page.
 * Combines form#purchase .ctr elements with the purchase_array JS variable.
 * Returns array of { id, name, price, inStock, availableQty } sorted by id.
 */
async function parseStock(page) {
  const purchaseArray = await extractPurchaseArray(page);

  const variants = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('form#purchase .ctr').forEach(el => {
      const isDisabled = el.classList.contains('disabled');
      const nameEl = el.querySelector('.cart-product .ngc-text');
      const name = nameEl
        ? nameEl.childNodes[0]?.textContent?.trim() || ''
        : '';
      const noStock = el.querySelector('.no-stock') !== null;

      const idInput = el.querySelector('input[name="id_variant[]"]');
      const qtyInput = el.querySelector('input[name="qty[]"]');
      if (!idInput) return;

      results.push({
        id: parseInt(idInput.value, 10),
        name: name || 'Variant ' + idInput.value,
        price: parseFloat(qtyInput?.getAttribute('price')) || 0,
        inStock: !isDisabled && !noStock,
      });
    });
    return results;
  });

  if (purchaseArray && Array.isArray(purchaseArray)) {
    for (let i = 0; i < variants.length; i++) {
      const pa = purchaseArray[i];
      if (pa) {
        variants[i].availableQty = pa.quantity ?? null;
        if (!variants[i].price && pa.price) variants[i].price = pa.price;
      }
    }
  }

  variants.sort((a, b) => a.id - b.id);
  return variants;
}

async function extractPurchaseArray(page) {
  return page.evaluate(() => {
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const text = script.textContent || '';
      const match = text.match(/var\s+purchase_array\s*=\s*(\[[\s\S]*?\]);/);
      if (match) {
        try {
          return JSON.parse(match[1]);
        } catch (e) {
          /* ignore */
        }
      }
    }
    return null;
  });
}

module.exports = { parseStock, extractPurchaseArray };
