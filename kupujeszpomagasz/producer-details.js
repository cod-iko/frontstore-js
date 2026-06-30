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
    // placeholder autoryzowany w polu tekstowym — to go WYPEŁNIAMY opisem
    targetSelector: '.product-producer-desc',
    // link producenta -> href to strona listingu producenta (same-origin)
    producerLinkSelector: '[data-module-name="product_producer"] a.product-producer__link',

    // --- STRONA PRODUCENTA (selektor opisu, kandydaci) ---
    descSelectors: [
      '[data-module-name="list_producer_description"] .producer-section-description',
      '.producer-section-description',
      '[data-module-name="list_producer_description"] .section-description',
      '.section-description'
    ],

    // --- PRZEBUDOWA opisu: wyciągamy zdjęcie + akapity i składamy własny układ ---
    // (froalowy flex f-row/f-grid ze strony producenta NIE pasuje do naszego diva)
    extractPhoto: true,
    dropSelectors: 'h1,h2,h3,h4,h5,h6,script,noscript,iframe,style',
    // style zdjęcia producenta (okrągłe — jak klasa "zaokrag" na stronie producenta)
    photoStyle: 'width:140px;height:140px;object-fit:cover;border-radius:50%;flex:0 0 auto;',

    // --- AKORDEON ---
    // TODO: walidator edytora szablonu zgłasza "div does not have one of the
    // required classes" dla struktury akordeonu i blokuje zapis. Tymczasowo
    // renderujemy zwykły div z tekstem (useAccordion=false). Wrócić po debugu.
    useAccordion: false,
    accordionTitle: 'O twórcy',
    chevronHref: '/assets/img/icons/symbol-defs.svg#icon-chevron-down',

    // --- cache ---
    cache: false,                 // false na czas debugowania -> fetch ZA KAŻDYM razem
    sessionTtlMs: 12 * 60 * 60 * 1000, // 12h
    sessionKeyPrefix: 'kp-prod-desc:v2:', // bump = unieważnia stary cache

    // --- lazy ---
    ioRootMargin: '400px',

    debug: true
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

  // ---- przebudowa opisu: zdjęcie + akapity -> własny układ (bez froala flex) ----
  function escAttr(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function rebuildDescription(srcEl) {
    var box = document.createElement('div');
    box.innerHTML = srcEl.innerHTML;

    // usuń nagłówki/skrypty + atrybuty on* (higiena)
    box.querySelectorAll(CONFIG.dropSelectors).forEach(function (n) { n.remove(); });
    box.querySelectorAll('*').forEach(function (el) {
      for (var i = el.attributes.length - 1; i >= 0; i--) {
        if (/^on/i.test(el.attributes[i].name)) el.removeAttribute(el.attributes[i].name);
      }
    });

    // wyciągnij pierwsze zdjęcie do własnego, kontrolowanego elementu
    var photoHtml = '';
    if (CONFIG.extractPhoto) {
      var img = box.querySelector('img');
      if (img && img.getAttribute('src')) {
        photoHtml = '<img class="kp-producer-about__photo" src="' + escAttr(img.getAttribute('src')) +
          '" alt="' + escAttr(img.getAttribute('alt')) + '" loading="lazy" style="' + CONFIG.photoStyle + '">';
      }
    }
    box.querySelectorAll('img, picture').forEach(function (n) { n.remove(); });

    // zneutralizuj froalowy układ (klasy f-row/f-grid-* + ich inline style),
    // ale ZACHOWAJ style treści (np. kolor linku) na pozostałych elementach
    box.querySelectorAll('[class]').forEach(function (el) {
      var raw = el.getAttribute('class') || ''; // getAttribute -> bezpieczne dla SVG
      var classes = raw.split(/\s+/);
      var isLayout = classes.some(function (c) { return /^f-(row|grid)/.test(c); });
      var kept = classes.filter(function (c) { return c && !/^f-(row|grid)/.test(c); });
      if (kept.length) el.setAttribute('class', kept.join(' ')); else el.removeAttribute('class');
      if (isLayout) el.removeAttribute('style');
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

    var textHtml = box.innerHTML.trim();
    log('rebuild: zdjęcie=', !!photoHtml, '| dł. tekstu=', textHtml.length);
    if (!photoHtml && !textHtml) return null;

    return '<div class="kp-producer-about__layout" style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;">' +
             photoHtml +
             '<div class="kp-producer-about__text" style="flex:1 1 240px;min-width:200px;">' + textHtml + '</div>' +
           '</div>';
  }

  // ---- fetch + ekstrakcja (dedup przez memCache + sessionStorage) ----
  function fetchDescription(href) {
    var key = normalizeKey(href);

    if (CONFIG.cache) {
      var ss = ssGet(key);
      if (ss !== undefined) { log('ss hit', key); return Promise.resolve(ss); }
      if (memCache.has(key)) return memCache.get(key);
    }

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
        var el = null, usedSel = '';
        for (var i = 0; i < CONFIG.descSelectors.length && !el; i++) {
          el = doc.querySelector(CONFIG.descSelectors[i]);
          if (el) usedSel = CONFIG.descSelectors[i];
        }
        log('selektor opisu:', usedSel || 'BRAK', '| dł. HTML strony:', html.length);
        var out = el ? rebuildDescription(el) : null;
        if (CONFIG.cache) ssSet(key, out);
        return out;
      })
      .catch(function (e) {
        if (e && e.name === 'AbortError') { memCache.delete(key); return null; }
        log('fetch error', e);
        return null;
      });

    if (CONFIG.cache) memCache.set(key, p);
    return p;
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

  // ---- wypełnienie placeholdera ----
  function fill(target, contentHtml) {
    if (CONFIG.useAccordion) {
      // wersja akordeonowa (na razie wyłączona) — budowana WEWNĄTRZ targetu
      target.innerHTML = '';
      target.appendChild(buildAccordion(contentHtml));
    } else {
      target.classList.add('fr-view'); // style froala ze sklepu
      target.innerHTML = contentHtml;
    }
  }

  // ---- orkiestracja na pojedynczej karcie ----
  function run() {
    var target = document.querySelector(CONFIG.targetSelector);
    if (!target) { log('brak', CONFIG.targetSelector, '— pomijam'); return; }

    var link = document.querySelector(CONFIG.producerLinkSelector);
    if (!link) { log('brak linku producenta — pomijam'); return; }
    var href = link.getAttribute('href');
    if (!href) { log('link producenta bez href'); return; }

    var key = normalizeKey(href);
    if (target.getAttribute('data-kp-filled') === key) return; // już wypełnione tym producentem

    var fired = false;
    function fire() {
      if (fired) return;
      fired = true;
      var idle = window.requestIdleCallback || function (cb) { return setTimeout(cb, 1); };
      idle(function () {
        fetchDescription(href).then(function (contentHtml) {
          if (!contentHtml) { log('brak opisu dla', href); return; }
          fill(target, contentHtml);
          target.setAttribute('data-kp-filled', key);
        });
      });
    }

    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.isIntersecting) { io.disconnect(); fire(); } });
      }, { rootMargin: CONFIG.ioRootMargin });
      io.observe(target);
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
