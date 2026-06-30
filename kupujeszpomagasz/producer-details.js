/**
 * producer-details.js  v.36
 * ---------------------------------------------------------------------------
 * Moduł karty produktu (Shoper, nowy Storefront / SPA, sklep kupujeszpomagasz.pl).
 * Akordeon "Poznaj artystę" z danymi producenta: zdjęcie + nazwa (h3) + opis (p).
 *
 * Render: wypełniamy autoryzowany placeholder <div class="product-producer-desc">.
 * Akordeon budowany 1:1 jak moduł product_description (web-componenty h-accordion*
 * już zarejestrowane na stronie) -> natywne zachowanie toggle.
 *
 * Wydajność: fetch poza ścieżką krytyczną. Lazy (IntersectionObserver) +
 * cache (Map + sessionStorage TTL) + requestIdleCallback + AbortController.
 *
 * Klasy do stylowania (CSS po stronie sklepu):
 *   .kp-producer-about           — kontener treści (ma też fr-view)
 *   .kp-producer-about__photo    — <img> zdjęcie producenta
 *   .kp-producer-about__name     — <h3> nazwa producenta
 *   .kp-producer-about__text     — wrapper opisu
 *   .kp-producer-about__desc     — <p> akapit opisu
 *   .kp-producer-about-accordion — wrapper modułu akordeonu
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  // ====================== CONFIG ======================
  var CONFIG = {
    // --- KARTA PRODUKTU ---
    targetSelector: '.product-producer-desc',                  // placeholder do wypełnienia
    producerLinkSelector: '[data-module-name="product_producer"] a.product-producer__link',
    // edytor dorzuca placeholderowi te klasy (resetcss psuje marginesy modułów) — zdejmujemy
    stripTargetClasses: ['resetcss'],

    // --- STRONA PRODUCENTA (selektor opisu, kandydaci) ---
    descSelectors: [
      '[data-module-name="list_producer_description"] .producer-section-description',
      '.producer-section-description',
      '[data-module-name="list_producer_description"] .section-description',
      '.section-description'
    ],

    // --- TREŚĆ ---
    extractPhoto: true,                          // wyciągnij pierwsze <img> z opisu
    dropSelectors: 'script,noscript,iframe,style',

    // --- AKORDEON ---
    useAccordion: true,
    accordionTitle: 'Poznaj artystę',
    chevronHref: '/assets/img/icons/symbol-defs.svg#icon-chevron-down',

    // --- cache ---
    cache: false,                 // false na czas debugowania -> fetch ZA KAŻDYM razem
    sessionTtlMs: 12 * 60 * 60 * 1000, // 12h
    sessionKeyPrefix: 'kp-prod-desc:v3:', // bump = unieważnia stary cache

    // --- lazy ---
    ioRootMargin: '400px',

    debug: true
  };
  // ====================================================

  var memCache = new Map();   // href -> Promise<{photo,alt,paragraphs}|null>
  var currentAbort = null;
  var uidSeq = 0;

  function log() {
    if (CONFIG.debug && window.console) console.log.apply(console, ['[producer-details]'].concat([].slice.call(arguments)));
  }

  function uid(prefix) {
    uidSeq += 1;
    return 'kp-' + prefix + '-' + Date.now().toString(36) + '-' + uidSeq;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
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
      return o.data; // obiekt lub null (null = sprawdzone, brak opisu)
    } catch (e) { return undefined; }
  }
  function ssSet(key, data) {
    try { sessionStorage.setItem(CONFIG.sessionKeyPrefix + key, JSON.stringify({ t: Date.now(), data: data })); }
    catch (e) {}
  }

  // ---- ekstrakcja: zdjęcie + akapity (bez froalowego układu) ----
  function extract(srcEl) {
    var box = document.createElement('div');
    box.innerHTML = srcEl.innerHTML;

    // higiena: usuń skrypty + atrybuty on*
    box.querySelectorAll(CONFIG.dropSelectors).forEach(function (n) { n.remove(); });
    box.querySelectorAll('*').forEach(function (el) {
      for (var i = el.attributes.length - 1; i >= 0; i--) {
        if (/^on/i.test(el.attributes[i].name)) el.removeAttribute(el.attributes[i].name);
      }
    });

    // zdjęcie: pierwsze <img>
    var photo = '', alt = '';
    if (CONFIG.extractPhoto) {
      var img = box.querySelector('img');
      if (img && img.getAttribute('src')) { photo = img.getAttribute('src'); alt = img.getAttribute('alt') || ''; }
    }

    // akapity: wszystkie <p> z treścią; fallback: cały tekst jako jeden akapit
    var paragraphs = [].slice.call(box.querySelectorAll('p'))
      .map(function (p) { return p.innerHTML.trim(); })
      .filter(Boolean);
    if (!paragraphs.length) {
      var t = box.textContent.trim();
      if (t) paragraphs = [t];
    }

    log('extract: zdjęcie=', !!photo, '| akapitów=', paragraphs.length);
    if (!paragraphs.length) return null; // brak opisu -> akordeonu nie pokazujemy wcale
    return { photo: photo, alt: alt, paragraphs: paragraphs };
  }

  // ---- złożenie treści: zdjęcie + nazwa(h3) + akapity(p), same klasy ----
  function buildContent(name, data) {
    // modyfikator --no-photo: hook CSS na układ bez zdjęcia
    var html = '<div class="kp-producer-about' + (data.photo ? '' : ' kp-producer-about--no-photo') + '">';
    if (data.photo) {
      html += '<img class="kp-producer-about__photo" src="' + esc(data.photo) +
        '" alt="' + esc(data.alt || name) + '" loading="lazy">';
    }
    if (name) {
      html += '<h3 class="kp-producer-about__name">' + esc(name) + '</h3>';
    }
    if (data.paragraphs && data.paragraphs.length) {
      html += '<div class="kp-producer-about__text">';
      data.paragraphs.forEach(function (p) { html += '<p class="kp-producer-about__desc">' + p + '</p>'; });
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  // ---- fetch + ekstrakcja (dedup przez memCache + sessionStorage) ----
  function fetchData(href) {
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
        var out = el ? extract(el) : null;
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

  // ---- akordeon 1:1 jak natywny moduł (.module > h-accordion); BEZ drugiego .module ----
  function buildAccordion(contentHtml) {
    var headingId = uid('about-heading');
    var togId = uid('about-tog');
    var contId = uid('about-cont');

    var acc = document.createElement('h-accordion');
    acc.className = 'accordion kp-producer-about-accordion';
    acc.setAttribute('role', 'none');
    acc.setAttribute('data-kp-producer-details', '1');

    acc.innerHTML =
      '<h-accordion-group role="none">' +
        '<h2 class="header_h2 module__header header_underline kp-producer-about__header" id="' + headingId + '">' +
          '<h-accordion-toggler class="accordion__toggler" id="' + togId + '" aria-expanded="false" aria-controls="' + contId + '" aria-disabled="false" role="button" tabindex="0">' +
            '<div class="module__header-title module__header-title_highlight">' +
              '<span class="module__header-content module__header_highlight">' + esc(CONFIG.accordionTitle) + '</span>' +
            '</div>' +
            '<svg class="icon accordion__toggler-icon" aria-hidden="true">' +
              '<use href="' + CONFIG.chevronHref + '" xlink:href="' + CONFIG.chevronHref + '"></use>' +
            '</svg>' +
          '</h-accordion-toggler>' +
        '</h2>' +
        '<h-accordion-content aria-labelledby="' + headingId + '" is-dev-accordion-optimization-flag-enabled="" role="region" style="height: 0px;" id="' + contId + '" labelledby="' + togId + '" class="accordion-toggle-transition-start" hidden>' +
          '<section class="grid__row grid__row_xs-hcenter">' +
            '<div class="kp-producer-about__content grid__col grid__col_md-10">' + contentHtml + '</div>' +
          '</section>' +
        '</h-accordion-content>' +
      '</h-accordion-group>';

    return acc;
  }

  // ---- wypełnienie placeholdera ----
  function fill(target, contentHtml) {
    // zdejmij klasy dorzucone przez edytor (resetcss -> górny margines na h2)
    CONFIG.stripTargetClasses.forEach(function (c) { target.classList.remove(c); });
    if (CONFIG.useAccordion) {
      target.innerHTML = '';
      target.appendChild(buildAccordion(contentHtml));
    } else {
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
    var name = (link.textContent || '').trim();

    var key = normalizeKey(href);
    if (target.getAttribute('data-kp-filled') === key) return; // już wypełnione tym producentem

    var fired = false;
    function fire() {
      if (fired) return;
      fired = true;
      var idle = window.requestIdleCallback || function (cb) { return setTimeout(cb, 1); };
      idle(function () {
        fetchData(href).then(function (data) {
          if (!data) { log('brak opisu dla', href); return; }
          fill(target, buildContent(name, data));
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
