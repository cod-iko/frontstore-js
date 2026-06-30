/**
 * producer-details.js
 * ---------------------------------------------------------------------------
 * Moduł karty produktu (Shoper, nowy Storefront / SPA, sklep kupujeszpomagasz.pl).
 * Dodaje akordeon "O twórcy" z opisem producenta, zaraz po opisie produktu.
 *
 * "Furtka" zamiast api.php/REST:
 *   opis producenta jest renderowany server-side na jego stronie listingu.
 *   Link producenta na karcie (moduł product_producer) prowadzi WPROST na tę
 *   stronę (href, np. "/pawel-sikorski" — indywidualny lub domyślny URL).
 *   Pobieramy ją same-origin fetch-em i wyciągamy kontener opisu.
 *   -> bez własnego serwera, CORS, auth, bez product_id i ProductFetcherApi.
 *
 * Akordeon budujemy 1:1 jak moduł product_description (te same web-componenty
 * h-accordion*, już zarejestrowane na stronie) -> natywne zachowanie toggle.
 *
 * Wydajność: fetch NIE jest na ścieżce krytycznej karty. Lazy (IntersectionObserver
 * na module product_description) + cache (Map + sessionStorage TTL) +
 * requestIdleCallback + AbortController.
 *
 * Ładowany przez inline-snippet (panel) -> jsDelivr.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  // ====================== CONFIG ======================
  var CONFIG = {
    // --- KARTA PRODUKTU ---
    // link producenta -> href to strona listingu producenta (same-origin)
    producerLinkSelector: '[data-module-name="product_producer"] a.product-producer__link',
    // kotwica: wstrzykujemy zaraz PO module opisu produktu
    injectAnchorSelector: '[data-module-name="product_description"]',
    injectPosition: 'afterend',

    // --- STRONA PRODUCENTA (selektor opisu, kandydaci) ---
    descSelectors: [
      '[data-module-name="list_producer_description"] .producer-section-description',
      '.producer-section-description'
    ],

    // --- CZYSZCZENIE opisu: usuń te elementy (+ puste kontenery po nich) ---
    stripSelectors: 'img, picture, h1, h2, h3, h4, h5, h6, script, noscript, iframe',

    // --- AKORDEON ---
    // TODO: walidator edytora szablonu zgłasza "div does not have one of the
    // required classes" dla struktury akordeonu i blokuje zapis. Tymczasowo
    // renderujemy zwykły div z tekstem (useAccordion=false). Wrócić po debugu.
    useAccordion: false,
    accordionTitle: 'O twórcy',
    chevronHref: '/assets/img/icons/symbol-defs.svg#icon-chevron-down',

    // --- cache ---
    sessionTtlMs: 12 * 60 * 60 * 1000, // 12h
    sessionKeyPrefix: 'kp-prod-desc:',

    // --- lazy ---
    ioRootMargin: '400px',

    debug: false
  };
  // ====================================================

  var memCache = new Map();   // href -> Promise<string|null> (oczyszczony HTML opisu)
  var currentAbort = null;
  var uidSeq = 0;

  function log() {
    if (CONFIG.debug && window.console) console.log.apply(console, ['[producer-details]'].concat([].slice.call(arguments)));
  }

  function uid(prefix) {
    uidSeq += 1;
    return 'kp-' + prefix + '-' + Date.now().toString(36) + '-' + uidSeq;
  }

  function normalizeKey(href) {
    try { return new URL(href, location.origin).pathname; }
    catch (e) { return href; }
  }

  // ---- sessionStorage cache ----
  function ssGet(key) {
    try {
      var raw = sessionStorage.getItem(CONFIG.sessionKeyPrefix + key);
      if (!raw) return undefined;
      var o = JSON.parse(raw);
      if (!o || (Date.now() - o.t) > CONFIG.sessionTtlMs) {
        sessionStorage.removeItem(CONFIG.sessionKeyPrefix + key);
        return undefined;
      }
      return o.html; // string lub null (null = sprawdzone, brak opisu)
    } catch (e) { return undefined; }
  }
  function ssSet(key, html) {
    try { sessionStorage.setItem(CONFIG.sessionKeyPrefix + key, JSON.stringify({ t: Date.now(), html: html })); }
    catch (e) {}
  }

  // ---- czyszczenie pobranego opisu ----
  function cleanDescription(srcEl) {
    var box = document.createElement('div');
    box.innerHTML = srcEl.innerHTML;

    // usuń niechciane elementy (img, nagłówki, skrypty...)
    box.querySelectorAll(CONFIG.stripSelectors).forEach(function (n) { n.remove(); });

    // usuń atrybuty on* (higiena — źródło to własny sklep, ale na wszelki wypadek)
    box.querySelectorAll('*').forEach(function (el) {
      for (var i = el.attributes.length - 1; i >= 0; i--) {
        if (/^on/i.test(el.attributes[i].name)) el.removeAttribute(el.attributes[i].name);
      }
    });

    // usuń kontenery, które po czyszczeniu zostały puste (np. kolumna po zdjęciu)
    var changed = true;
    while (changed) {
      changed = false;
      box.querySelectorAll('div, span, section, figure').forEach(function (el) {
        if (!el.querySelector('img,picture,svg,video') && el.textContent.replace(/ /g, '').trim() === '') {
          el.remove(); changed = true;
        }
      });
    }

    var html = box.innerHTML.trim();
    return html || null;
  }

  // ---- fetch + ekstrakcja (dedup przez memCache + sessionStorage) ----
  function fetchDescription(href) {
    var key = normalizeKey(href);

    var ss = ssGet(key);
    if (ss !== undefined) { log('ss hit', key); return Promise.resolve(ss); }
    if (memCache.has(key)) return memCache.get(key);

    if (currentAbort) currentAbort.abort();
    currentAbort = ('AbortController' in window) ? new AbortController() : null;

    var p = fetch(href, {
      credentials: 'same-origin',
      signal: currentAbort ? currentAbort.signal : undefined
    })
      .then(function (r) { return r.ok ? r.text() : null; })
      .then(function (html) {
        if (!html) return null;
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var el = null;
        for (var i = 0; i < CONFIG.descSelectors.length && !el; i++) {
          el = doc.querySelector(CONFIG.descSelectors[i]);
        }
        var out = el ? cleanDescription(el) : null;
        ssSet(key, out);
        return out;
      })
      .catch(function (e) {
        if (e && e.name === 'AbortError') { memCache.delete(key); return null; }
        log('fetch error', e);
        return null;
      });

    memCache.set(key, p);
    return p;
  }

  // ---- wersja tymczasowa: zwykły div z tekstem (bez akordeonu) ----
  // Minimum klas, brak grid__col / module / web-componentów — żeby nie wpaść
  // w walidator edytora ("div does not have one of the required classes").
  function buildSimple(contentHtml) {
    var box = document.createElement('div');
    box.className = 'kp-producer-about fr-view';
    box.setAttribute('data-kp-producer-details', '1');
    box.innerHTML =
      '<p class="kp-producer-about__title"><strong>' + CONFIG.accordionTitle + '</strong></p>' +
      '<div class="kp-producer-about__content"></div>';
    box.querySelector('.kp-producer-about__content').innerHTML = contentHtml;
    return box;
  }

  // ---- budowa akordeonu (1:1 jak product_description) ----
  function buildAccordion(contentHtml) {
    var headingId = uid('about-heading');
    var togId = uid('about-tog');
    var contId = uid('about-cont');

    var module = document.createElement('div');
    module.className = 'module kp-producer-about';
    module.setAttribute('data-module-name', 'kp_producer_about');
    module.setAttribute('data-kp-producer-details', '1');

    module.innerHTML =
      '<h-accordion class="accordion" role="none">' +
        '<h-accordion-group role="none">' +
          '<h2 class="header_h2 module__header header_underline kp-producer-about__header" id="' + headingId + '">' +
            '<h-accordion-toggler class="accordion__toggler" id="' + togId + '" aria-expanded="false" aria-controls="' + contId + '" aria-disabled="false" role="button" tabindex="0">' +
              '<div class="module__header-title module__header-title_highlight">' +
                '<span class="module__header-content module__header_highlight">' + CONFIG.accordionTitle + '</span>' +
              '</div>' +
              '<svg class="icon accordion__toggler-icon" aria-hidden="true">' +
                '<use href="' + CONFIG.chevronHref + '" xlink:href="' + CONFIG.chevronHref + '"></use>' +
              '</svg>' +
            '</h-accordion-toggler>' +
          '</h2>' +
          '<h-accordion-content aria-labelledby="' + headingId + '" is-dev-accordion-optimization-flag-enabled="" role="region" style="height: 0px;" id="' + contId + '" labelledby="' + togId + '" class="accordion-toggle-transition-start" hidden>' +
            '<div class="grid__row grid__row_xs-hcenter">' +
              '<div class="kp-producer-about__content grid__col grid__col_md-10 fr-view grid-mobile-wrap resetcss"></div>' +
            '</div>' +
          '</h-accordion-content>' +
        '</h-accordion-group>' +
      '</h-accordion>';

    module.querySelector('.kp-producer-about__content').innerHTML = contentHtml;
    return module;
  }

  function inject(anchor, node) {
    var prev = document.querySelector('[data-kp-producer-details]');
    if (prev) prev.remove();
    anchor.insertAdjacentElement(CONFIG.injectPosition, node);
  }

  // ---- orkiestracja na pojedynczej karcie ----
  function run() {
    var link = document.querySelector(CONFIG.producerLinkSelector);
    var anchor = document.querySelector(CONFIG.injectAnchorSelector);
    if (!link || !anchor) { log('brak linku producenta / kotwicy — pomijam'); return; }

    var href = link.getAttribute('href');
    if (!href) { log('link producenta bez href'); return; }

    var fired = false;
    function fire() {
      if (fired) return;
      fired = true;
      var idle = window.requestIdleCallback || function (cb) { return setTimeout(cb, 1); };
      idle(function () {
        fetchDescription(href).then(function (contentHtml) {
          if (!contentHtml) { log('brak opisu dla', href); return; }
          var node = CONFIG.useAccordion ? buildAccordion(contentHtml) : buildSimple(contentHtml);
          inject(anchor, node);
        });
      });
    }

    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.isIntersecting) { io.disconnect(); fire(); } });
      }, { rootMargin: CONFIG.ioRootMargin });
      io.observe(anchor);
    } else {
      fire();
    }
  }

  // ---- bootstrap: czekamy na useStorefront, hook na render SPA ----
  function boot(storefront) {
    try {
      storefront.eventBus.on('PageManager.rendered', function () { setTimeout(run, 50); });
    } catch (e) { log('eventBus niedostępny', e); }
    setTimeout(run, 50); // gdy skrypt doszedł po pierwszym renderze
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
