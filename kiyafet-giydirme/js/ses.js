/* ==========================================================================
   ses.js — Hafif ses efektleri (Web Audio) ve titreşim geri bildirimi
   Ses dosyası kullanılmaz; kısa tonlar anında üretilir.
   ========================================================================== */
(function (KG) {
  'use strict';
  let ctx = null;

  // Her efekt: [frekans(Hz), başlangıç(sn), süre(sn)] notalarından oluşur
  const EFEKT = {
    sec:      [[660, 0, 0.07], [990, 0.05, 0.09]],
    sekme:    [[520, 0, 0.05]],
    renk:     [[784, 0, 0.06]],
    rastgele: [[523, 0, 0.08], [659, 0.07, 0.08], [784, 0.14, 0.08], [1047, 0.21, 0.14]],
    kaydet:   [[784, 0, 0.09], [1175, 0.09, 0.16]],
    geri:     [[494, 0, 0.07], [370, 0.06, 0.1]],
    sifirla:  [[440, 0, 0.08], [330, 0.08, 0.08], [262, 0.16, 0.12]],
  };

  const ses = {
    acik: true,

    cal(tip) {
      if (!this.acik) return;
      try {
        ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') ctx.resume();
        const t0 = ctx.currentTime;
        (EFEKT[tip] || EFEKT.sec).forEach(([frekans, bas, sure]) => {
          const osc = ctx.createOscillator(), kazanc = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = frekans;
          kazanc.gain.setValueAtTime(0.0001, t0 + bas);
          kazanc.gain.exponentialRampToValueAtTime(0.11, t0 + bas + 0.012);
          kazanc.gain.exponentialRampToValueAtTime(0.0001, t0 + bas + sure);
          osc.connect(kazanc).connect(ctx.destination);
          osc.start(t0 + bas);
          osc.stop(t0 + bas + sure + 0.02);
        });
      } catch (e) { /* ses desteklenmiyorsa sessizce devam et */ }
    },

    // Titreşim: destekleyen cihazlarda (ör. Android) çalışır
    titre(ms) {
      if (!this.acik) return;
      try { if (navigator.vibrate) navigator.vibrate(ms || 10); } catch (e) { /* yok say */ }
    },
  };

  KG.ses = ses;
})(window.KG = window.KG || {});
