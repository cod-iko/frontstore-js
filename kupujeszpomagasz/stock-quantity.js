/**
 * stock-quantity.js v2
 * ---------------------------------------------------------------------------
 * Pokazuje DOKŁADNĄ ilość magazynową na karcie produktu (Shoper nowy Storefront / SPA).
 *
 * Źródło (client-side, bez REST/proxy):
 *   ProductStock.quantityInWarehouses (mapa: ID magazynu -> ilość) — suma = łączny stan.
 *   ProductFetcherApi jest DYNAMICZNE: najpierw FeatureSystemApi.registerDynamic('ProductFetcher'),
 *   dopiero potem getApi('ProductFetcherApi') -> getProductVariant(productId, { variantOptions: {} }).
 *   Aktualizacja na żywo: eventBus 'product.stockChanged'.
 *   Fallback z DOM: h-input-stepper[max] (gdy stan trackowany, max = dostępna ilość).
 *
 * UWAGA: działa tylko gdy sklep trzyma stany magazynowe. Brak trackowania -> nic nie pokazujemy.
 * Ładowany przez inline-snippet (.hidden-script) tylko na karcie produktu.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  if (window.__KP_STOCK_QTY__) return;
  window.__KP_STOCK_QTY__ = true;

  var CONFIG = {
    hostSelector: '.product-availability__image-and-description strong',
    hostFallbackSelector: '.product-availability__image-and-description',
    productIdSelector: 'product-availability[product-id], [product-id]',
    stepperSelector: 'h-input-stepper[max]',
    template: ' ({qty} {unit})',
    unit: 'szt.',
    markerClass: 'kp-stock-qty',
    debug: true
  };

  function log() {
    if (CONFIG.debug && window.console) console.log.apply(console, ['[stock-qty]'].concat([].slice.call(arguments)));
  }

  // suma quantityInWarehouses; null gdy brak danych
  function sumQty(stock) {
    var q = stock && stock.quantityInWarehouses;
    if (!q || typeof q !== 'object') return null;
    var total = 0, has = false;
    for (var k in q) {
      if (Object.prototype.hasOwnProperty.call(q, k)) { total += Number(q[k]) || 0; has = true; }
    }
    return has ? total : null;
  }

  // fallback: max ze steppera ilości (gdy stan trackowany, max = dostępna ilość)
  function stepperQty() {
    var s = document.querySelector(CONFIG.stepperSelector);
    var m = s && s.getAttribute('max');
    if (!m) return null;
    var n = Number(m);
    return (isFinite(n) && n > 0) ? n : null;
  }

  function getProductId() {
    var el = document.querySelector(CONFIG.productIdSelector);
    var id = el && el.getAttribute('product-id');
    return id ? Number(id) : null;
  }

  function render(qty) {
    var old = document.querySelector('.' + CONFIG.markerClass);
    if (old) old.remove();
    if (qty === null || qty === undefined) { log('brak danych o stanie — nie pokazuję'); return; }

    var host = document.querySelector(CONFIG.hostSelector) || document.querySelector(CONFIG.hostFallbackSelector);
    if (!host) { log('brak hosta availability'); return; }

    var span = document.createElement('span');
    span.className = CONFIG.markerClass;
    span.textContent = CONFIG.template.replace('{qty}', String(qty)).replace('{unit}', CONFIG.unit);
    host.appendChild(span);
    log('render', qty);
  }

  function bodyOf(ev) { return ev && ev.body ? ev.body : ev; }

  // ProductFetcher: rejestracja DYNAMICZNA -> getApi (kolejność ma znaczenie!)
  function getProductFetcher(storefront) {
    return Promise.resolve()
      .then(function () {
        var fs = storefront.getApiSync ? storefront.getApiSync('FeatureSystemApi') : null;
        if (fs && typeof fs.registerDynamic === 'function') {
          return fs.registerDynamic('ProductFetcher');
        }
      })
      .then(function () { return storefront.getApi('ProductFetcherApi'); })
      .catch(function (e) { log('ProductFetcher niedostępne:', e && e.message); return null; });
  }

  function currentStock(storefront, productId) {
    return getProductFetcher(storefront).then(function (pf) {
      if (!pf || !productId) return null;
      return Promise.resolve(pf.getProductVariant(productId, { variantOptions: {} }))
        .catch(function (e) { log('getProductVariant:', e && e.message); return null; });
    });
  }

  function run(storefront) {
    var pid = getProductId();
    if (!pid) { log('brak product-id — pewnie nie karta produktu'); return; }
    currentStock(storefront, pid).then(function (stock) {
      var qty = sumQty(stock);
      if (qty === null) { qty = stepperQty(); if (qty !== null) log('fallback ze steppera:', qty); }
      render(qty);
    });
  }

  function boot(storefront) {
    try {
      storefront.eventBus.on('product.stockChanged', function (ev) {
        var qty = sumQty(bodyOf(ev));
        setTimeout(function () { render(qty !== null ? qty : stepperQty()); }, 50);
      });
      storefront.eventBus.on('PageManager.rendered', function () {
        setTimeout(function () { run(storefront); }, 200);
      });
    } catch (e) { log('eventBus error', e); }
    setTimeout(function () { run(storefront); }, 200);
  }

  var attempts = 0, MAX = 50;
  var iv = setInterval(function () {
    attempts++;
    if (typeof useStorefront === 'function') {
      clearInterval(iv);
      useStorefront(function (storefront) { boot(storefront); });
    } else if (attempts >= MAX) {
      clearInterval(iv);
      log('useStorefront nie pojawił się w 5s');
    }
  }, 100);
})();
