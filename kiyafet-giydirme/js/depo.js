/* ==========================================================================
   depo.js — Cihazda saklama (localStorage)
   Son kombin, kayıtlı kombinler ve ses tercihi tek anahtarda tutulur.
   ========================================================================== */
(function (KG) {
  'use strict';
  const ANAHTAR = 'kombin-atolyesi-v1';

  KG.depo = {
    oku() {
      try { return JSON.parse(localStorage.getItem(ANAHTAR)) || {}; } catch (e) { return {}; }
    },
    yaz(veri) {
      try { localStorage.setItem(ANAHTAR, JSON.stringify(veri)); return true; } catch (e) { return false; }
    },
  };
})(window.KG = window.KG || {});
