/**
 * stock-quantity.js
 * ---------------------------------------------------------------------------
 * Pokazuje DOKŁADNĄ ilość magazynową na karcie produktu (Shoper nowy Storefront / SPA).
 *
 * Źródło danych (client-side, bez REST/proxy):
 *   ProductStock.quantityInWarehouses  (mapa: ID magazynu -> ilość) — suma = łączny stan.
 *   Pobierane z:
 *     1) Message Storage API — ostatni event 'product.stockChanged' (bieżący wariant),
 *     2) fallback: ProductFetcherApi.getProductVariant(productId, { variantOptions: {} }),
 *   oraz aktualizowane na żywo eventem eventBus 'product.stockChanged' (zmiana wariantu).
 *
 * UWAGA: działa tylko gdy sklep TRZYMA stany magazynowe (magazyn włączony). Jeśli produkt
 * ma nielimitowany stan / brak trackowania — mapa jest pusta i nic nie pokazujemy.
 *
 * Ładowany przez inline-snippet (pole .hidden-script) tylko na karcie produktu.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  if (window.__KP_STOCK_QTY__) return;
  window.__KP_STOCK_QTY__ = true;

  var CONFIG = {
    // element ze statusem dostępności, do którego dopisujemy liczbę
    hostSelector: '.product-availability__image-and-description strong',
    // fallback, gdyby <strong> nie było
    hostFallbackSelector: '.product-availability__image-and-description',
    // źródło product-id na karcie
    productIdSelector: 'product-availability[product-id], [product-id]',
    // szablon: {qty} = liczba, {unit} = jednostka
    template: ' ({qty} {unit})',
    unit: 'szt.',
    markerClass: 'kp-stock-qty',
    debug: false
  };

  function log() {
    if (CONFIG.debug && window.console) console.log.apply(console, ['[stock-qty]'].concat([].slice.call(arguments)));
  }

  // suma wartości quantityInWarehouses; null gdy brak danych (stan nietrackowany)
  function sumQty(stock) {
    var q = stock && stock.quantityInWarehouses;
    if (!q || typeof q !== 'object') return null;
    var total = 0, has = false;
    for (var k in q) {
      if (Object.prototype.hasOwnProperty.call(q, k)) { total += Number(q[k]) || 0; has = true; }
    }
    return has ? total : null;
  }

  function getProductId() {
    var el = document.querySelector(CONFIG.productIdSelector);
    var id = el && el.getAttribute('product-id');
    return id ? Number(id) : null;
  }

  function render(qty) {
    // usuń poprzednią liczbę (idempotencja, re-render web-componentu)
    var old = document.querySelector('.' + CONFIG.markerClass);
    if (old) old.remove();
    if (qty === null || qty === undefined) return; // brak danych -> nic

    var host = document.querySelector(CONFIG.hostSelector) || document.querySelector(CONFIG.hostFallbackSelector);
    if (!host) { log('brak host-a availability'); return; }

    var span = document.createElement('span');
    span.className = CONFIG.markerClass;
    span.textContent = CONFIG.template.replace('{qty}', String(qty)).replace('{unit}', CONFIG.unit);
    host.appendChild(span);
    log('render', qty);
  }

  function bodyOf(ev) {
    return ev && ev.body ? ev.body : ev;
  }

  // pobierz bieżący ProductStock: najpierw z Message Storage, potem z ProductFetcher
  function currentStock(storefront, productId) {
    return Promise.resolve()
      .then(function () { return storefront.getApi('MessageStorageApi'); })
      .then(function (ms) {
        if (ms && typeof ms.getChannelMessages === 'function') {
          var msgs = ms.getChannelMessages('product.stockChanged') || [];
          if (msgs.length) {
            var body = bodyOf(msgs[msgs.length - 1]);
            if (body && body.quantityInWarehouses) return body;
          }
        }
        return null;
      })
      .catch(function () { return null; })
      .then(function (stock) {
        if (stock) return stock;
        // fallback: ProductFetcherApi
        return Promise.resolve(storefront.getApi('ProductFetcherApi'))
          .then(function (pf) {
            if (pf) return pf;
            var fs = storefront.getApiSync ? storefront.getApiSync('FeatureSystemApi') : null;
            if (fs && typeof fs.registerDynamic === 'function') {
              return Promise.resolve(fs.registerDynamic('ProductFetcher'))
                .then(function () { return storefront.getApi('ProductFetcherApi'); });
            }
            return null;
          })
          .then(function (pf) {
            if (!pf || !productId) return null;
            return pf.getProductVariant(productId, { variantOptions: {} });
          })
          .catch(function () { return null; });
      });
  }

  function run(storefront) {
    var pid = getProductId();
    if (!pid) { log('brak product-id — pewnie nie karta produktu'); return; }
    currentStock(storefront, pid).then(function (stock) { render(sumQty(stock)); });
  }

  function boot(storefront) {
    try {
      // aktualizacja na żywo przy zmianie wariantu (po re-renderze web-componentu)
      storefront.eventBus.on('product.stockChanged', function (ev) {
        var qty = sumQty(bodyOf(ev));
        setTimeout(function () { render(qty); }, 50);
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
