/**
 * scroll-animations.js v.2
 * ---------------------------------------------------------------------------
 * Animacje modułów przy scrollu (Shoper, nowy Storefront / SPA).
 * Każdy .module dostaje klasę "visible" gdy wejdzie w viewport.
 * Styl przejść (.module / .module.visible) jest w CSS bezwarunkowy (bez body.animations).
 *
 * Próg dynamiczny (jak w oryginale): moduł wyższy niż viewport -> 0,
 * w innym wypadku 0.45 (animacja, gdy moduł jest już sporo widoczny).
 * Per moduł osobny IntersectionObserver (bo próg różny).
 *
 * Re-init na każdej nawigacji SPA (PageManager.rendered). Na wybranych podstronach
 * (koszyk, regulamin, polityka) moduły w <main> pokazywane od razu, bez animacji.
 *
 * Ładowany przez inline-snippet (panel) -> jsDelivr / githack. Globalnie (każda strona).
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  if (window.__SCROLL_ANIMATIONS__) return;
  window.__SCROLL_ANIMATIONS__ = true;

  // podstrony, na których moduły w <main> NIE są animowane (pokazane od razu)
  var SKIP_MAIN = [
    '/regulamin',
    '/polityka-prywatnosci',
    '/pl/basket',
    '/pl/basket/step2',
    '/pl/basket/done'
  ];

  var observers = [];

  function disconnectAll() {
    observers.forEach(function (o) { o.disconnect(); });
    observers = [];
  }

  function initAnimations() {
    var path = window.location.pathname;

    var skipMain = false;
    for (var i = 0; i < SKIP_MAIN.length; i++) {
      if (path.indexOf(SKIP_MAIN[i]) === 0) { skipMain = true; break; }
    }

    disconnectAll();

    var modules = document.querySelectorAll('.module');
    if (!modules.length) return;

    modules.forEach(function (el) { el.classList.remove('visible'); });

    modules.forEach(function (el) {
      // od razu widoczne, bez animacji
      if ((skipMain && el.closest('main')) || el.dataset.moduleName === 'list_context_products') {
        el.classList.add('visible');
        return;
      }

      // próg dynamiczny: moduł wyższy niż viewport -> 0, inaczej 0.45 (jak w oryginale)
      var threshold = el.offsetHeight > window.innerHeight ? 0 : 0.45;

      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: threshold });

      observer.observe(el);
      observers.push(observer);
    });
  }

  // bootstrap: useStorefront + re-init na render SPA (z fallbackiem bez SDK)
  function setupEventBus(retries) {
    if (retries === undefined) retries = 50;
    if (typeof window.useStorefront === 'function') {
      window.useStorefront(function (storefront) {
        storefront.eventBus.on('PageManager.rendered', function () {
          setTimeout(initAnimations, 200);
        });
      });
      setTimeout(initAnimations, 200);
    } else if (retries > 0) {
      setTimeout(function () { setupEventBus(retries - 1); }, 100);
    } else {
      setTimeout(initAnimations, 200);
    }
  }

  setupEventBus();
})();
