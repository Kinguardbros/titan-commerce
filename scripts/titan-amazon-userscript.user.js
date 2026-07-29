// ==UserScript==
// @name         Titan Commerce — Amazon Reviews Importer
// @namespace    https://titan-commerce.vercel.app/
// @version      1.0.0
// @description  Scrape Amazon product reviews on this page and import them into Titan Commerce as pending reviews.
// @author       Dan
// @match        https://www.amazon.com/*
// @match        https://smile.amazon.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      titan-commerce.vercel.app
// @updateURL    https://raw.githubusercontent.com/Kinguardbros/titan-commerce/main/scripts/titan-amazon-userscript.user.js
// @downloadURL  https://raw.githubusercontent.com/Kinguardbros/titan-commerce/main/scripts/titan-amazon-userscript.user.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const DEFAULT_TITAN_URL = 'https://titan-commerce.vercel.app';

  function getConfig() {
    return {
      token: GM_getValue('TITAN_API_TOKEN', ''),
      titanUrl: GM_getValue('TITAN_URL', DEFAULT_TITAN_URL),
    };
  }

  function promptForToken() {
    const current = GM_getValue('TITAN_API_TOKEN', '');
    const next = window.prompt('Paste your Titan API token (Settings > Users > Generate API token):', current);
    if (next && next.trim()) {
      GM_setValue('TITAN_API_TOKEN', next.trim());
      window.alert('Titan API token saved.');
    }
  }

  function promptForUrl() {
    const current = GM_getValue('TITAN_URL', DEFAULT_TITAN_URL);
    const next = window.prompt('Titan dashboard URL:', current);
    if (next && next.trim()) {
      GM_setValue('TITAN_URL', next.trim().replace(/\/$/, ''));
      window.alert('Titan URL saved.');
    }
  }

  GM_registerMenuCommand('Configure Titan API token', promptForToken);
  GM_registerMenuCommand('Configure Titan URL', promptForUrl);

  // Amazon product pages: /dp/{ASIN} or /product-reviews/{ASIN}
  function extractAsin() {
    const m = window.location.pathname.match(/\/(?:dp|product-reviews|gp\/product)\/([A-Z0-9]{10})/i);
    return m ? m[1].toUpperCase() : null;
  }

  function injectButton(asin) {
    if (document.getElementById('titan-import-btn')) return; // already injected
    const btn = document.createElement('button');
    btn.id = 'titan-import-btn';
    btn.textContent = 'Import to Titan';
    btn.style.cssText = [
      'position:fixed', 'bottom:24px', 'right:24px', 'z-index:99999',
      'background:#1a1a2e', 'color:#fff', 'border:1px solid #4a4a6a',
      'border-radius:8px', 'padding:12px 18px', 'font-size:14px', 'font-weight:600',
      'cursor:pointer', 'box-shadow:0 4px 12px rgba(0,0,0,0.3)',
    ].join(';');

    btn.addEventListener('click', () => {
      const { token } = getConfig();
      if (!token) {
        window.alert('No API token configured — go to Titan Settings > Users to generate one, then use the Tampermonkey menu (Configure Titan API token) to paste it in.');
        return;
      }
      // Step 8 replaces this placeholder with the real scrape + modal + POST flow.
      window.alert('Not implemented yet — scrape/import logic lands in the next userscript task.');
    });

    document.body.appendChild(btn);
  }

  function init() {
    const asin = extractAsin();
    if (!asin) return; // not a product/review page
    injectButton(asin);

    const { token, titanUrl } = getConfig();
    console.info('[Titan Importer] loaded, config:', { hasToken: !!token, titanUrl, asin });
  }

  init();
})();
