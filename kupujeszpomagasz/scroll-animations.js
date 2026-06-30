/**
 * scroll-animations.js
 * ---------------------------------------------------------------------------
 * Animacje modułów przy scrollu (Shoper, nowy Storefront / SPA).
 * Każdy .module dostaje klasę "visible" gdy wejdzie w viewport (IntersectionObserver).
 * Style przejść (.module / .module.visible) po stronie CSS sklepu.
 *
 * Re-init na każdej nawigacji SPA (PageManager.rendered). Na wybranych podstronach
 * (koszyk, regulamin, polityka) moduły w <main> pokazywane od razu, bez animacji.
 *
 * Ładowany przez inline-snippet (panel) -> jsDelivr / githack.
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

  var currentObserver = null;

  function initAnimations() {
    var path = window.location.pathname;

    var skipMain = false;
    for (var i = 0; i < SKIP_MAIN.length; i++) {
      if (path.indexOf(SKIP_MAIN[i]) === 0) { skipMain = true; break; }
    }

    if (currentObserver) {
      currentObserver.disconnect();
      currentObserver = null;
    }

    var modules = document.querySelectorAll('.module');
    if (!modules.length) return;

    modules.forEach(function (el) { el.classList.remove('visible'); });

    currentObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          currentObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });

    modules.forEach(function (el) {
      if ((skipMain && el.closest('main')) || el.dataset.moduleName === 'list_context_products') {
        el.classList.add('visible');
      } else {
        currentObserver.observe(el);
      }
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
