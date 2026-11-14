/* ==========================================================================
   cizim.js — Karakterin ve tüm parçaların SVG çizimi
   --------------------------------------------------------------------------
   Her şey 300x620 birimlik tek bir tuvale çizilir. Vücudun dış hattı tek bir
   profil tablosundan (DIS / IC) üretilir; kıyafetler de aynı profili küçük bir
   "bolluk" payıyla kullandığı için bütün parçalar bedene tam oturur.

   Katman sırası (alttan üste):
     arka saç > gövde > alt giyim > üst giyim > elbise > ayakkabı > baş > ön saç
   (Yere kadar uzanan etek/paçalarda ayakkabı kumaşın altına alınır.)
   ========================================================================== */
(function (KG) {
  'use strict';
  const V = KG.veri;

  /* ------------------------------------------------------------------ */
  /* Küçük yardımcılar                                                   */
  /* ------------------------------------------------------------------ */
  const f = (n) => Math.round(n * 10) / 10;

  function hexRgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function karistir(a, b, o) {
    const A = hexRgb(a), B = hexRgb(b);
    return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * o).toString(16).padStart(2, '0')).join('');
  }
  const koyu = (c, o = 0.18) => karistir(c, '#2a1640', o);
  const acik = (c, o = 0.3) => karistir(c, '#ffffff', o);
  const parlaklik = (c) => { const [r, g, b] = hexRgb(c); return (r * 299 + g * 587 + b * 114) / 255000; };
  // Detay rengi: koyu kumaşta açık, açık kumaşta koyu ton
  const zit = (c, o = 0.2) => (parlaklik(c) < 0.3 ? acik(c, o + 0.08) : koyu(c, o));

  /* ------------------------------------------------------------------ */
  /* Vücut profili                                                       */
  /* ------------------------------------------------------------------ */
  // [y, x] — sol dış hat (omuzdan bileğe) ve sol bacağın iç hattı
  const DIS = [[168, 112], [182, 109], [206, 116], [252, 125], [306, 106], [360, 106], [455, 118], [572, 128]];
  const IC = [[334, 150], [455, 144.5], [572, 142]];

  function ara(tablo, y) {
    if (y <= tablo[0][0]) return tablo[0][1];
    for (let i = 1; i < tablo.length; i++) {
      if (y <= tablo[i][0]) {
        const [y0, x0] = tablo[i - 1], [y1, x1] = tablo[i];
        const t = (1 - Math.cos(((y - y0) / (y1 - y0)) * Math.PI)) / 2; // yumuşak geçiş
        return x0 + (x1 - x0) * t;
      }
    }
    return tablo[tablo.length - 1][1];
  }
  const disX = (y) => ara(DIS, y);
  const icX = (y) => ara(IC, y);

  // Dış hat boyunca noktalar. e: bolluk (sayı ya da y'ye bağlı fonksiyon),
  // duz: 0 = bedene oturur, 1 = iki uç arasında dümdüz iner.
  function kenar(y0, y1, e, duz = 0) {
    const ef = typeof e === 'function' ? e : () => e;
    const n = Math.max(1, Math.ceil(Math.abs(y1 - y0) / 7));
    const xa = disX(y0) - ef(y0), xb = disX(y1) - ef(y1);
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const y = y0 + ((y1 - y0) * i) / n;
      const xp = disX(y) - ef(y), xl = xa + ((xb - xa) * i) / n;
      pts.push([xp + (xl - xp) * duz, y]);
    }
    return pts;
  }
  function icKenar(y0, y1, e) {
    const ef = typeof e === 'function' ? e : () => e;
    const n = Math.max(1, Math.ceil(Math.abs(y1 - y0) / 7));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const y = y0 + ((y1 - y0) * i) / n;
      pts.push([Math.min(149.7, icX(y) + ef(y)), y]);
    }
    return pts;
  }

  const ayna = (p) => p.map(([x, y]) => [300 - x, y]).reverse();
  const cizgi = (p) => 'M' + p.map(([x, y]) => f(x) + ',' + f(y)).join('L');
  const yol = (p) => cizgi(p) + 'Z';
  const sim = (sol) => yol(sol.concat(ayna(sol)));           // sol yarıdan simetrik şekil
  const cift = (h) => h + `<g transform="translate(300,0) scale(-1,1)">${h}</g>`; // sol + sağ

  // Noktalardan geçen yumuşak eğri (Catmull-Rom → Bezier)
  function egri(p) {
    let d = `M${f(p[0][0])},${f(p[0][1])}`;
    for (let i = 0; i < p.length - 1; i++) {
      const p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2;
      d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)},${f(p1[1] + (p2[1] - p0[1]) / 6)} ` +
           `${f(p2[0] - (p3[0] - p1[0]) / 6)},${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])},${f(p2[1])}`;
    }
    return d;
  }
  // Merkez hattı boyunca değişken kalınlıkta şerit (örgü, at kuyruğu, perçem)
  function serit(merkez, gen) {
    const sol = [], sag = [], n = merkez.length;
    for (let i = 0; i < n; i++) {
      const a = merkez[Math.max(0, i - 1)], b = merkez[Math.min(n - 1, i + 1)], m = merkez[i];
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      const w = gen(i / (n - 1));
      sol.push([m[0] - (dy / l) * w, m[1] + (dx / l) * w]);
      sag.push([m[0] + (dy / l) * w, m[1] - (dx / l) * w]);
    }
    return egri(sol.concat(sag.reverse())) + 'Z';
  }

  // Dolgulu şekil; köşeleri yuvarlatmak için aynı renkte ince kontur
  const S = (d, dolgu, kontur, ek = '') =>
    `<path d="${d}" fill="${dolgu}" stroke="${kontur || dolgu}" stroke-width="2" stroke-linejoin="round" ${ek}/>`;
  // Dolgusuz çizgi
  const C = (d, renk, kalin = 1.5, ek = '') =>
    `<path d="${d}" fill="none" stroke="${renk}" stroke-width="${kalin}" stroke-linecap="round" stroke-linejoin="round" ${ek}/>`;

  /* Kol: omuz → dirsek → bilek eğrisi (t: 0..1) */
  function kolNokta(t) {
    const q = (a, c, b, u) => [
      (1 - u) * (1 - u) * a[0] + 2 * (1 - u) * u * c[0] + u * u * b[0],
      (1 - u) * (1 - u) * a[1] + 2 * (1 - u) * u * c[1] + u * u * b[1]];
    return t < 0.5 ? q([111, 180], [101, 225], [100, 258], t * 2) : q([100, 258], [98, 295], [93, 326], (t - 0.5) * 2);
  }
  function kolCizgi(t0, t1, renk, kalin, uc = 'round') {
    const pts = [];
    const n = Math.max(2, Math.ceil((t1 - t0) / 0.04));
    for (let i = 0; i <= n; i++) pts.push(kolNokta(t0 + ((t1 - t0) * i) / n));
    return `<path d="${cizgi(pts)}" fill="none" stroke="${renk}" stroke-width="${f(kalin)}" stroke-linecap="${uc}" stroke-linejoin="round"/>`;
  }

  /* Küçük süs şekilleri */
  const SUS = {
    kalp: 'M0,5 C-9,-2 -5,-9 0,-4.5 C5,-9 9,-2 0,5Z',
    simsek: 'M2,-9 L-5,1 L-0.5,1 L-2.5,9 L5.5,-2 L1,-2 Z',
    ay: 'M3,-8 A8,8 0 1,0 3,8 A6,6 0 1,1 3,-8Z',
    yildiz: (() => {
      const p = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 3.6 : 8.5, a = (Math.PI / 5) * i - Math.PI / 2;
        p.push([r * Math.cos(a), r * Math.sin(a)]);
      }
      return yol(p);
    })(),
  };
  const sus = (ad, x, y, olcek, renk) =>
    `<path d="${SUS[ad]}" transform="translate(${x},${y}) scale(${olcek})" fill="${renk}"/>`;
  const fiyonk = (x, y, s, renk) =>
    `<path d="M${x},${y}l${-s},${-s * 0.6}v${s * 1.2}zM${x},${y}l${s},${-s * 0.6}v${s * 1.2}z" fill="${renk}" stroke="${renk}" stroke-width="1.5" stroke-linejoin="round"/>` +
    `<circle cx="${x}" cy="${y}" r="${f(s * 0.28)}" fill="${koyu(renk, 0.2)}"/>`;

  /* ------------------------------------------------------------------ */
  /* Kumaş desenleri (SVG <pattern>)                                     */
  /* ------------------------------------------------------------------ */
  function desenTanim(id, tip, renk) {
    const a = acik(renk, 0.55), k = koyu(renk, 0.3);
    const govde = {
      cizgi: [12, 12, `<rect y="0" width="12" height="5" fill="${a}"/>`],
      puantiye: [14, 14, `<circle cx="3.5" cy="3.5" r="2.1" fill="#fff"/><circle cx="10.5" cy="10.5" r="2.1" fill="#fff"/>`],
      ekose: [18, 18, `<rect x="0" width="6" height="18" fill="${k}" opacity=".45"/><rect y="0" width="18" height="6" fill="${k}" opacity=".45"/>` +
        `<path d="M12,0v18M0,12h18" stroke="${a}" stroke-width="1.2" opacity=".8"/>`],
      cicek: [24, 24, [[6, 6, '#fff'], [18, 18, acik(k, 0.1)]].map(([x, y, c]) =>
        [0, 72, 144, 216, 288].map((d) => `<circle cx="${x}" cy="${y - 2.6}" r="1.9" fill="${c}" transform="rotate(${d} ${x} ${y})"/>`).join('') +
        `<circle cx="${x}" cy="${y}" r="1.4" fill="#f6cf6a"/>`).join('') +
        `<circle cx="18" cy="5" r="1" fill="${a}"/><circle cx="5" cy="18" r="1" fill="${a}"/>`],
      zigzag: [16, 18, `<path d="M0,5l4,-4l4,4l4,-4l4,4" fill="none" stroke="${a}" stroke-width="1.8"/>` +
        `<path d="M0,12h16" stroke="${k}" stroke-width="2" opacity=".5"/><circle cx="4" cy="15.5" r="1" fill="${a}"/><circle cx="12" cy="15.5" r="1" fill="${a}"/>`],
      pul: [9, 9, `<circle cx="2.5" cy="2.5" r="1.7" fill="#fff" opacity=".6"/><circle cx="7" cy="7" r="1.7" fill="#fff" opacity=".28"/>` +
        `<circle cx="7" cy="2.5" r="1.2" fill="${k}" opacity=".25"/>`],
    }[tip];
    if (!govde) return '';
    return `<defs><pattern id="${id}" width="${govde[0]}" height="${govde[1]}" patternUnits="userSpaceOnUse">` +
      `<rect width="${govde[0]}" height="${govde[1]}" fill="${renk}"/>${govde[2]}</pattern></defs>`;
  }
  // Parçanın dolgusu: düz renk ya da desen
  function dolguHazirla(o, renk, id) {
    if (!o.desen) return { dolgu: renk, tanim: '' };
    return { dolgu: `url(#${id})`, tanim: desenTanim(id, o.desen, renk) };
  }

  /* ------------------------------------------------------------------ */
  /* Gövde ve baş                                                        */
  /* ------------------------------------------------------------------ */
  const TEN = '#f6cfb4', TEN_GOLGE = '#e8b394';
  const AYAK = 'M128,558 L142,558 L143,584 Q143,598 131,600 L112,601 Q103,600 107,592 Q113,584 126,577 Z';

  function govdeCiz(icUst, icAlt) {
    let s = '';
    // kollar ve eller
    s += cift(kolCizgi(0, 1, TEN, 19) + `<ellipse cx="92" cy="334" rx="8.5" ry="11.5" fill="${TEN}"/>`);
    // bacaklar + ayaklar
    s += cift(S(yol(kenar(300, 572, 0).concat(icKenar(572, 334, 0))), TEN) + S(AYAK, TEN));
    // boyun + gövde
    s += S(sim([[141, 136], [141, 158], [128, 164]].concat(kenar(168, 336, 0))), TEN);
    s += `<path d="M141,140 Q150,154 159,140 L159,136 L141,136Z" fill="${TEN_GOLGE}" opacity=".7"/>`;
    s += cift(C('M119,300 Q128,306 140,304', TEN_GOLGE, 1.2, 'opacity=".5"'));
    // Kıyafet yokken görünen sade iç giyim
    const IC_RENK = '#f6f0fc', IC_GOLGE = '#dcd0ee';
    if (icAlt) {
      s += S(sim([[150, 288]].concat(kenar(288, 350, 1), icKenar(350, 337, 1), [[150, 337]])), IC_RENK, IC_GOLGE);
    }
    if (icUst) {
      s += cift(C('M133,198 L138,160', IC_GOLGE, 3));
      s += S(sim([[150, 200], [134, 196], [117, 200]].concat(kenar(206, 240, 0.8), [[150, 240]])), IC_RENK, IC_GOLGE);
    }
    return s;
  }

  function basCiz(kasRenk) {
    let s = '';
    s += cift(`<ellipse cx="106" cy="98" rx="5" ry="9" fill="${TEN}"/>`);
    s += `<path d="M106,90 C106,40 194,40 194,90 C194,122 172,142 150,142 C128,142 106,122 106,90Z" fill="${TEN}"/>`;
    // allık
    s += cift(`<ellipse cx="121" cy="115" rx="8.5" ry="5" fill="#ff8fa3" opacity=".32"/>`);
    // gözler (.goz sınıfı: göz kırpma animasyonu)
    s += cift(
      `<g class="goz"><ellipse cx="131" cy="101" rx="8.2" ry="9" fill="#fff"/>` +
      `<circle cx="131.6" cy="101.5" r="6.3" fill="#7a4b33"/><circle cx="131.6" cy="101.5" r="3.2" fill="#2b1a18"/>` +
      `<circle cx="129.4" cy="98.6" r="2" fill="#fff"/><circle cx="134" cy="104" r="1" fill="#fff" opacity=".8"/>` +
      `<path d="M120.5,97 Q130,87.5 141,96" fill="none" stroke="#2b1a18" stroke-width="2.8" stroke-linecap="round"/>` +
      `<path d="M121.5,96.5 L118.4,93.2" stroke="#2b1a18" stroke-width="2" stroke-linecap="round"/></g>` +
      C('M121.5,84.5 Q130,79.5 140,83', kasRenk, 2.6));
    // burun + dudak
    s += C('M147.5,113.5 Q150,116 152.5,113.5', TEN_GOLGE, 1.6);
    s += `<path d="M141.5,124 Q146,123 150,125 Q154,123 158.5,124 Q150,134 141.5,124Z" fill="#e7798c"/>`;
    s += C('M143,125 Q150,128.5 157,125', '#c95a70', 1);
    return s;
  }

  /* ------------------------------------------------------------------ */
  /* Saç                                                                 */
  /* ------------------------------------------------------------------ */
  // Açık (salık) saçın arka kütlesi: düz / dalgalı / kıvırcık / kâküllü
  function sacArkaAcik(L, sekil) {
    const h = sekil === 'kivircik' ? 9 : sekil === 'dalgali' ? 3 : 0; // hacim
    const sol = [[150, 36 - h * 0.5], [124, 41 - h * 0.4], [105 - h * 0.6, 60], [98 - h, 92]];
    for (let y = 110; y < L - 8; y += 12) {
      let x = 97 - h - 17 * Math.min(1, Math.max(0, (y - 135) / 55)); // omuzlara doğru yayıl
      if (sekil === 'dalgali') x += Math.sin((y - 100) / 13) * 4.2;
      sol.push([x, y]);
    }
    const son = sol[sol.length - 1][0];
    // uç: içe doğru yumuşakça toplanır
    sol.push([son + 2, L - 20], [son + 9, L - 6], [son + 24, L]);
    let d = egri(sol.concat([[150, L + 3]], ayna(sol))) + 'Z';
    let ek = '';
    if (sekil === 'kivircik') {
      // kenar boyunca bukleler
      const bukle = sol.slice(2);
      ek = cift(bukle.map(([x, y], i) => `<circle cx="${f(x + 2)}" cy="${f(y)}" r="${11 + (i % 2) * 2}"/>`).join(''));
    }
    return { d, ek };
  }

  function sacCiz(sekil, L, dolgu, renk) {
    const golge = koyu(renk, 0.25), isik = acik(renk, 0.35);
    const acikSac = sekil === 'duz' || sekil === 'dalgali' || sekil === 'kivircik' || sekil === 'kakullu';
    let arka = '', on = '';
    const boyOrani = (L - 150) / 280; // 0 (kısa) .. 1 (çok uzun)

    /* ---- arka katman ---- */
    if (acikSac) {
      const a = sacArkaAcik(L, sekil);
      arka += `<g fill="${dolgu}"><path d="${a.d}"/>${a.ek}</g>`;
    } else {
      // toplanmış saçlarda başın arkasını dolduran küçük kütle
      arka += `<path d="M101,96 C96,56 122,37 150,37 C178,37 204,56 199,96 C196,118 104,118 101,96Z" fill="${dolgu}"/>`;
    }
    if (sekil === 'topuz') {
      const r = 15 + boyOrani * 13;
      const cy = 40 - r * 0.62;
      arka += `<circle cx="150" cy="${f(cy)}" r="${f(r)}" fill="${dolgu}"/>`;
      arka += C(`M${f(150 - r * 0.55)},${f(cy - r * 0.1)} Q150,${f(cy - r * 0.75)} ${f(150 + r * 0.55)},${f(cy - r * 0.1)}`, isik, 2.2, 'opacity=".55"');
      arka += C(`M${f(150 - r * 0.5)},${f(cy + r * 0.45)} Q150,${f(cy + r * 0.05)} ${f(150 + r * 0.5)},${f(cy + r * 0.45)}`, golge, 1.6, 'opacity=".5"');
      arka += `<rect x="139" y="${f(cy + r - 5)}" width="22" height="6" rx="3" fill="#ff7fa8"/>`;
    }
    if (sekil === 'atkuyrugu') {
      const merkez = [[176, 44], [200, 52], [215, 80]];
      const n = Math.max(2, Math.round((L - 80) / 22));
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        merkez.push([215 - 9 * t * t + Math.sin(t * 5) * 3, 80 + (L - 80) * t]);
      }
      arka += `<path d="${serit(merkez, (t) => (t < 0.15 ? 10 + t * 66 : 20 * (1 - t) + 5))}" fill="${dolgu}"/>`;
      arka += C(egri(merkez.slice(2, -1)), isik, 2, 'opacity=".4"');
      arka += `<rect x="172" y="37" width="9" height="20" rx="4.5" fill="#ff7fa8" transform="rotate(-58 176 47)"/>`;
    }

    /* ---- ön katman: baş üstü ---- */
    const KEP = {
      // yana taranmış
      yan: 'M103,106 C97,60 120,35 150,35 C180,35 203,60 197,106 C195,90 187,74 171,65 C150,78 124,75 110,88 C106,94 104,100 103,106Z',
      // ortadan ayrık
      orta: 'M103,106 C97,60 120,35 150,35 C180,35 203,60 197,106 C196,86 176,68 150,57 C124,68 104,86 103,106Z',
      // geriye taranmış
      geri: 'M104,100 C98,60 120,36 150,36 C180,36 202,60 196,100 C191,76 172,63 150,63 C128,63 109,76 104,100Z',
      // düz kâkül
      kakul: 'M103,108 C97,60 120,35 150,35 C180,35 203,60 197,108 C196,98 193,90 189,83 Q150,90 111,83 C107,90 104,98 103,108Z',
    };
    const kep = sekil === 'kakullu' ? 'kakul' : sekil === 'orgulu' ? 'orta' : (sekil === 'topuz' || sekil === 'atkuyrugu') ? 'geri' : 'yan';
    on += `<path d="${KEP[kep]}" fill="${dolgu}"/>`;
    if (kep === 'kakul') {
      on += C('M128,62 Q126,76 127,86 M150,60 L150,88 M172,62 Q174,76 173,86', golge, 1.3, 'opacity=".45"');
    } else if (kep === 'yan') {
      on += C('M171,65 Q160,50 150,36', golge, 1.3, 'opacity=".4"');
    } else if (kep === 'orta') {
      on += C('M150,57 L150,36', golge, 1.3, 'opacity=".45"');
    }
    on += C('M120,54 Q150,41 180,54', isik, 4, 'opacity=".35"');

    if (sekil === 'kivircik') {
      // baş çevresi ve alın hattında bukleler
      let b = '';
      for (let i = 0; i <= 10; i++) {
        const a = (Math.PI * i) / 10;
        b += `<circle cx="${f(150 + 51 * Math.cos(a))}" cy="${f(88 - 50 * Math.sin(a))}" r="${11 + (i % 2) * 2}"/>`;
      }
      [[116, 78, 9], [130, 68, 10], [146, 63, 10], [162, 64, 10], [178, 71, 10], [190, 82, 8]].forEach(([x, y, r]) => { b += `<circle cx="${x}" cy="${y}" r="${r}"/>`; });
      on += `<g fill="${dolgu}">${b}</g>`;
      on += C('M118,58 q5,-6 10,0 M150,46 q5,-6 10,0 M176,58 q5,-6 10,0 M134,74 q4,-5 8,0 M164,72 q4,-5 8,0', isik, 1.8, 'opacity=".5"');
    }

    /* ---- ön katman: omuza dökülen tutamlar (açık saç, omuz ve daha uzun) ---- */
    if (acikSac && L >= 185) {
      const bitis = Math.min(L, 246) - 6;
      const merkez = [];
      for (let y = 96; y <= bitis; y += 14) {
        const t = (y - 96) / (bitis - 96);
        let x = 100 + 13 * Math.pow(t, 0.8) + (y > 150 ? 2 : 0);
        if (sekil === 'dalgali') x += Math.sin((y - 96) / 12) * 3;
        merkez.push([x, y]);
      }
      let tutam = `<path d="${serit(merkez, (t) => (t < 0.2 ? 5 + 38 * t : 11 * (1 - t * t) + 2.2))}" fill="${dolgu}"/>`;
      if (sekil === 'kivircik') {
        tutam = `<g fill="${dolgu}">` + merkez.map(([x, y], i) => `<circle cx="${f(x)}" cy="${f(y)}" r="${f(10 - i * 0.35)}"/>`).join('') + '</g>';
      }
      on += cift(tutam);
    }

    /* ---- ön katman: örgüler ---- */
    if (sekil === 'orgulu') {
      let o = '';
      const xOrgu = (y) => 104 + 9 * Math.min(1, Math.max(0, (y - 110) / 60));
      let i = 0, y = 112;
      for (; y < L - 16; y += 12, i++) {
        const x = xOrgu(y);
        o += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="9.5" ry="8" transform="rotate(${i % 2 ? 28 : -28} ${f(x)} ${f(y)})" fill="${dolgu}" stroke="${golge}" stroke-width="1" stroke-opacity=".45"/>`;
      }
      const x = xOrgu(y);
      o += `<path d="M${f(x - 6)},${f(y - 4)} Q${f(x)},${f(y + 22)} ${f(x + 6)},${f(y - 4)}Z" fill="${dolgu}"/>`;
      o += `<rect x="${f(x - 7)}" y="${f(y - 8)}" width="14" height="6" rx="3" fill="#ff7fa8"/>`;
      on += cift(o);
    }
    return { arka, on };
  }

  /* ------------------------------------------------------------------ */
  /* Üst beden kalıbı (üst giyim ve elbiselerin ortak parçası)           */
  /* ------------------------------------------------------------------ */
  const YAKA = { // [boyun x, boyun y, yaka ortası y]
    bisiklet: [137, 160, 172], v: [138, 159, 198], kayik: [126, 164, 171],
    kare: [130, 163, 188], gomlek: [139, 158, 180], bogazli: [139, 158, 161],
  };
  const askili = (o) => o.kol === 'aski' || o.yaka === 'straplez';

  // Yaka hattı: ortadan sol omuza
  function yakaNokta(o) {
    const [nx, ny, yc] = YAKA[o.yaka] || YAKA.bisiklet;
    if (o.yaka === 'v' || o.yaka === 'gomlek') return [[150, yc], [nx, ny]];
    if (o.yaka === 'kare') return [[150, yc], [nx + 1, yc], [nx, ny]];
    const p = [];
    for (let i = 0; i <= 5; i++) {
      const u = i / 5;
      p.push([(1 - u) * (1 - u) * 150 + 2 * (1 - u) * u * (nx + 1) + u * u * nx, (1 - u) * (1 - u) * yc + 2 * (1 - u) * u * yc + u * u * ny]);
    }
    return p;
  }

  function bedenSol(o, yan) {
    const e = o.bol;
    if (askili(o)) return [[150, 203], [135, 197], [118 - e, 200]].concat(yan, [[150, o.boy]]);
    const p = yakaNokta(o);
    if (o.kol === 'yok') p.push([121, 166.5], [123, 186]);
    else p.push([111 - e * 0.4, 168.5], [109 - e, 182]);
    return p.concat(yan, [[150, o.boy]]);
  }

  // yan noktalarından yatay bant (ribana, kemer vb.)
  function bant(yan, y0, y1) {
    const p = yan.filter((q) => q[1] >= y0 - 3.5 && q[1] <= y1 + 3.5);
    return p.length >= 2 ? sim(p) : '';
  }

  function kollarCiz(o, dolgu, g) {
    const w = 23 + o.bol * 1.2;
    let h = '';
    switch (o.kol) {
      case 'kisa': h = kolCizgi(0, 0.3, dolgu, w); break;
      case 'dirsek': h = kolCizgi(0, 0.52, dolgu, w); break;
      case 'uzun':
        h = kolCizgi(0, 0.95, dolgu, w);
        if (o.manset) h += kolCizgi(0.87, 0.96, g, w + 0.5, 'butt');
        break;
      case 'balon':
        h = `<ellipse cx="105" cy="190" rx="15.5" ry="18.5" fill="${dolgu}"/>` + kolCizgi(0.27, 0.31, g, w - 3, 'butt');
        break;
      case 'balonUzun':
        h = kolCizgi(0, 0.85, dolgu, w + 6) + kolCizgi(0.85, 0.94, g, w - 2, 'butt');
        break;
      default: return '';
    }
    return cift(h);
  }

  // Beden + tüm detaylar. o: {yaka,kol,boy,bol,duz,...}
  function bedenCiz(o, dolgu, renk) {
    const g = zit(renk), hem = o.boy, e = o.bol;
    const yan = kenar(206, hem, e, o.duz || 0);
    let s = '';

    if (o.on === 'acik') {
      /* ---- ceket: iç tişört + iki ön panel ---- */
      const ic = { yaka: 'bisiklet', kol: 'kisa', boy: hem - 5, bol: 1 };
      s += S(sim(bedenSol(ic, kenar(206, hem - 5, 1))), o.ic || '#ffffff', '#e6e0ef');
      const panel = [[137, 159], [111 - e * 0.4, 168.5], [109 - e, 182]].concat(yan, [[143, hem], [143, 224], [140, 190]]);
      let ps = S(yol(panel), dolgu, renk);
      if (o.ribana) ps += S(yol(yan.filter((q) => q[1] >= hem - 12).concat([[143, hem], [143, hem - 9]])), g);
      if (o.yaka === 'biker') {
        ps += S('M137,159 L145,222 L124,198 L122,178Z', g);
        ps += C(`M143,224 L143,${hem}`, '#d8d8e2', 1.6, 'stroke-dasharray="2 2"');
        ps += `<circle cx="128" cy="184" r="1.6" fill="#d8d8e2"/><circle cx="131" cy="196" r="1.6" fill="#d8d8e2"/>`;
        ps += C(`M118,${hem - 22} l14,-3`, '#d8d8e2', 1.6);
      } else {
        ps += S('M137,159 L144,214 L130,196 L128,174Z', g);
      }
      if (o.dikis) {
        ps += C(`M139,226 L139,${hem - 3}`, acik(renk, 0.6), 1, 'stroke-dasharray="3 2.5"');
        ps += `<rect x="118" y="212" width="16" height="13" rx="2" fill="none" stroke="${acik(renk, 0.6)}" stroke-width="1" stroke-dasharray="3 2.5"/>`;
        ps += C(`M${f(yan[yan.length - 1][0])},${hem - 8} L143,${hem - 8}`, g, 1.4);
      }
      s += cift(ps);
      if (o.dugme) s += `<circle cx="139.5" cy="240" r="2" fill="${g}"/><circle cx="139.5" cy="258" r="2" fill="${g}"/>`;
      return s;
    }

    /* ---- kapalı beden ---- */
    if (o.kol === 'aski') s += cift(C('M134,198 L138,160', renk, 2.6));
    s += S(sim(bedenSol(o, yan)), dolgu, renk);
    if (!askili(o) && o.kol !== 'yok') s += cift(C('M113,173 Q112,192 117,207', koyu(renk, 0.3), 1.3, 'opacity=".35"'));

    // fırfırlı etek ucu (peplum)
    if (o.firfir) {
      const u = [[disX(250) - e, 250], [disX(250) - e - 9, hem + 2], [150, hem + 5]];
      s += S(sim(u), acik(renk, 0.25), renk);
      s += cift(C(`M128,256 L122,${hem} M138,256 L135,${hem + 2} M147,256 L146,${hem + 3}`, koyu(renk, 0.3), 1.1, 'opacity=".4"'));
      s += S(sim(kenar(247, 254, e + 0.5)), g);
    }
    if (o.ribana) { const b = bant(yan, hem - 9, hem); if (b) s += S(b, g); }
    if (o.saten) s += C('M128,204 Q132,226 130,246', '#ffffff', 5, 'opacity=".22"');

    // yaka detayları
    const yp = yakaNokta(o);
    if (askili(o)) {
      s += C('M118,200 L135,197 L150,203 L165,197 L182,200', g, 1.6, 'opacity=".6"');
    } else if (o.yaka === 'gomlek') {
      const yr = o.yakaRenk || acik(renk, 0.35);
      s += cift(S('M139,157 L150,170 L135,183 L129,163Z', yr, koyu(renk, 0.12)));
    } else if (o.yaka === 'bogazli') {
      s += `<rect x="136.5" y="145" width="27" height="20" rx="5" fill="${g}"/>`;
      s += C('M143,148v14M150,148v14M157,148v14', renk, 1, 'opacity=".5"');
    } else if (o.yakaBant || o.yaka === 'v' || o.yaka === 'bisiklet' || o.yaka === 'kare' || o.yaka === 'kayik') {
      s += C(cizgi(ayna(yp).concat(yp)), g, o.yakaBant ? 3.2 : 1.8, o.yakaBant ? '' : 'opacity=".7"');
    }
    if (o.kapuson) {
      s += S('M122,168 Q116,149 137,150 L150,174 L163,150 Q184,149 178,168 Q150,190 122,168Z', g);
      s += C('M144,180 L143,208 M156,180 L157,208', '#ffffff', 1.6, 'opacity=".9"');
    }

    // ön kapama
    const onY = o.yaka === 'gomlek' ? 172 : (YAKA[o.yaka] || YAKA.bisiklet)[2] + 2;
    if (o.on === 'dugme') {
      s += C(`M150,${onY} L150,${hem}`, koyu(renk, 0.3), 1.2, 'opacity=".45"');
      for (let y = onY + 12; y < hem - 6; y += 24) s += `<circle cx="150" cy="${y}" r="2" fill="${g}"/>`;
    }
    if (o.fermuar) {
      s += C(`M150,${onY - 4} L150,${hem}`, '#f4f4f8', 2);
      s += `<rect x="147.5" y="${onY + 8}" width="5" height="8" rx="1.5" fill="#c9c9d6"/>`;
    }

    // göğüs bandı, baskı, fiyonk, cep
    if (o.bant) {
      const b = bant(kenar(206, 230, e), 214, 224);
      if (b) s += `<path d="${b}" fill="#ffffff" opacity=".85"/>`;
    }
    if (o.baski) s += sus(o.baski, 150, 218, 1.7, o.baskiRenk || (parlaklik(renk) < 0.45 ? '#ffd35c' : '#ff6f91'));
    if (o.fiyonk) s += fiyonk(150, 176, 9, g);
    if (o.kanguru) {
      const ky = Math.min(hem - 12, 286);
      s += S(`M129,${ky - 26} L171,${ky - 26} L178,${ky} L122,${ky}Z`, 'none', g);
    }
    if (o.kemer) {
      const b = bant(yan, 247, 256);
      if (b) s += S(b, koyu(renk, 0.45)) + `<rect x="145.5" y="246.5" width="9" height="10" rx="2" fill="none" stroke="#e8c36a" stroke-width="2"/>`;
    }
    return s;
  }

  const UST_TIP = {
    tisort:     { yaka: 'bisiklet', kol: 'kisa', boy: 288, bol: 3, duz: 0.45 },
    gomlek:     { yaka: 'gomlek', kol: 'uzun', manset: true, on: 'dugme', boy: 292, bol: 3, duz: 0.4 },
    bluz:       { yaka: 'kayik', kol: 'balon', boy: 284, bol: 2, duz: 0.15 },
    kazak:      { yaka: 'bisiklet', yakaBant: true, kol: 'uzun', manset: true, ribana: true, boy: 292, bol: 5, duz: 0.6 },
    crop:       { yaka: 'bisiklet', kol: 'kisa', boy: 234, bol: 1.5, duz: 0 },
    sweatshirt: { yaka: 'bisiklet', yakaBant: true, kol: 'uzun', manset: true, ribana: true, boy: 296, bol: 7, duz: 0.8 },
    ceket:      { on: 'acik', yaka: 'klapa', kol: 'uzun', boy: 292, bol: 5, duz: 0.5 },
  };

  function ustCiz(o, renk, id) {
    const { dolgu, tanim } = dolguHazirla(o, renk, id);
    return tanim + kollarCiz(o, dolgu, zit(renk)) + bedenCiz(o, dolgu, renk);
  }

  /* ------------------------------------------------------------------ */
  /* Etek kalıbı (alt giyim ve elbiselerin ortak parçası)                */
  /* ------------------------------------------------------------------ */
  function etekSol(o, bel) {
    const hem = o.boy, acilim = o.acilim == null ? 14 : o.acilim;
    const x0 = disX(bel) - 1.5, xh = Math.min(disX(hem), 106) - acilim;
    const n = Math.ceil((hem - bel) / 8), p = [[150, bel]];
    for (let i = 0; i <= n; i++) {
      const t = i / n, y = bel + (hem - bel) * t;
      let x;
      if (o.bicim === 'kalem') x = y < 455 ? disX(y) - 2.5 : disX(455) - 2.5 - acilim * (y - 455) / Math.max(1, hem - 455); // dizden sonra düz iner
      else if (o.bicim === 'balik') x = y < 430 ? disX(y) - 2.5 : disX(430) - 2.5 - acilim * Math.pow((y - 430) / (hem - 430), 1.4);
      else x = Math.min(x0 + (xh - x0) * (o.bicim === 'kabarik' ? Math.pow(t, 0.45) : t), disX(y) - 2.5);
      p.push([x, y]);
    }
    return p;
  }

  function etekCiz(o, dolgu, renk, bel) {
    const hem = o.boy, sol = etekSol(o, bel);
    const sarkma = o.bicim === 'kalem' ? 0 : 5;
    const xs = sol[sol.length - 1][0], xr = 300 - xs;
    let sag = ayna(sol), centik = [];
    if (o.yirtmac) centik = [[xr - 24, hem + sarkma * 0.5], [xr - 18, o.yirtmac], [xr - 7, hem]];
    let s = '';
    if (o.tul) {
      const t = etekSol(Object.assign({}, o, { boy: hem + 9, acilim: (o.acilim || 14) + 9 }), bel);
      s += `<path d="${yol(t.concat([[150, hem + 15]], ayna(t)))}" fill="${acik(renk, 0.35)}" opacity=".6"/>`;
    }
    s += S(yol(sol.concat([[150, hem + sarkma]], centik, sag)), dolgu, renk);
    // kıvrım çizgileri
    const kv = koyu(renk, 0.35), w0 = 150 - sol[1][0], w1 = 150 - xs;
    const adet = o.pili ? 5 : o.bicim === 'kalem' ? 0 : 2;
    let k = '';
    for (let i = 1; i <= adet; i++) {
      const u = i / (adet + 1);
      for (const yon of [-1, 1]) {
        if (o.yirtmac && yon === 1 && u > 0.4) continue;
        k += `M${f(150 + yon * w0 * u)},${bel + 12} L${f(150 + yon * w1 * u)},${f(hem + sarkma * (1 - u))}`;
      }
    }
    if (o.pili) k += `M150,${bel + 12} L150,${hem + sarkma}`;
    if (k) s += C(k, kv, 1.2, 'opacity=".32"');
    // katlar (fırfırlı etek)
    if (o.kat) {
      for (const u of [0.38, 0.7]) {
        const y = bel + (hem - bel) * u, i = Math.round((sol.length - 2) * u) + 1;
        const x = sol[Math.min(i, sol.length - 1)][0];
        s += C(`M${f(x)},${f(y)} Q150,${f(y + 7)} ${f(300 - x)},${f(y)}`, zit(renk, 0.25), 2.2, 'opacity=".55"');
      }
    }
    if (o.saten) s += C(`M${f(sol[3][0] + 9)},${bel + 20} Q${f(sol[3][0] + 4)},${f((bel + hem) / 2)} ${f(xs + 12)},${hem - 14}`, '#ffffff', 5, 'opacity=".2"');
    if (o.fermuar) s += C(`M150,${bel + 8} L150,${hem}`, '#d8d8e2', 1.8, 'stroke-dasharray="2 2"');
    return s;
  }

  /* ------------------------------------------------------------------ */
  /* Alt giyim                                                           */
  /* ------------------------------------------------------------------ */
  const ALT_TIP = {
    kot:      { tur: 'pantolon', boy: 566, b: [2, 3, 5], kot: true },
    kumas:    { tur: 'pantolon', boy: 566, b: [3, 5, 8], utu: true },
    sort:     { tur: 'pantolon', boy: 358, b: [3, 5, 5] },
    esofman:  { tur: 'pantolon', boy: 562, b: [5, 8, 6], ip: true, pacaBant: true },
    miniEtek: { tur: 'etek', boy: 366, acilim: 14, bicim: 'a' },
    midiEtek: { tur: 'etek', boy: 478, acilim: 22, bicim: 'a' }, // kalem biçiminde acilim = dizden sonraki açılma
  };
  const BEL = 248;

  function altCiz(o, renk, id) {
    const { dolgu, tanim } = dolguHazirla(o, renk, id);
    const g = zit(renk);
    let s = tanim;

    if (o.tur === 'etek') {
      s += etekCiz(o, dolgu, renk, BEL);
      s += S(sim(kenar(BEL, BEL + 8, 2)), o.kemer ? acik(renk, 0.12) : g);
      if (o.kemer) s += `<rect x="145" y="${BEL - 1}" width="10" height="10" rx="2" fill="none" stroke="#d8d8e2" stroke-width="2"/>`;
      return s;
    }

    // pantolon / şort / eşofman
    const [bu, bd, bp] = o.b, hem = o.boy;
    const ef = (y) => (y <= 306 ? bu : y <= 455 ? bu + ((bd - bu) * (y - 306)) / 149 : bd + ((bp - bd) * (y - 455)) / 117);
    const ei = (y) => ef(y) * 0.6;
    const dis = kenar(BEL, hem, ef), ic = icKenar(hem, 337, ei);
    s += S(sim([[150, BEL]].concat(dis, ic, [[150, 337]])), dolgu, renk);
    // ağ ve paça ayrımı
    s += C(`M150,${BEL + 9} L150,337`, koyu(renk, 0.35), 1.2, 'opacity=".35"');
    if (hem > 345) s += C(cizgi(icKenar(337, hem, ei).map(([x, y]) => [Math.min(x, 149.2), y])), koyu(renk, 0.35), 1, 'opacity=".25"');

    const orta = (y) => (disX(y) - ef(y) + Math.min(149.7, icX(y) + ei(y))) / 2;
    let d = '';
    if (o.kot) {
      const dk = acik(renk, 0.55);
      d += C('M121,258 Q126,272 113,279', dk, 1.1, 'stroke-dasharray="3 2.5"');
      d += C(cizgi(kenar(262, hem - 4, (y) => ef(y) - 3.5)), dk, 1, 'stroke-dasharray="3 2.5" opacity=".8"');
      d += C(`M${f(disX(hem) - ef(hem))},${hem - 7} L${f(Math.min(149.7, icX(hem) + ei(hem)))},${hem - 7}`, dk, 1, 'stroke-dasharray="3 2.5" opacity=".8"');
    }
    if (o.yirtik) {
      const x1 = orta(410), x2 = orta(452);
      d += C(`M${f(x1 - 7)},404 h13 M${f(x1 - 8)},409 h15 M${f(x1 - 6)},414 h12 M${f(x2 - 6)},450 h11 M${f(x2 - 7)},455 h13`, '#ffffff', 1.8, 'opacity=".75"');
    }
    if (o.utu) {
      const p = [];
      for (let y = 275; y <= hem - 3; y += 14) p.push([orta(y), y]);
      d += C(cizgi(p), koyu(renk, 0.4), 1.1, 'opacity=".3"');
    }
    if (o.serit) {
      d += C(cizgi(kenar(BEL + 10, hem - (o.pacaBant ? 12 : 2), (y) => ef(y) - 5)), '#ffffff', 3.2, 'opacity=".9"');
    }
    if (o.kargo) {
      const x = disX(385) - ef(385) + 2;
      d += `<rect x="${f(x)}" y="378" width="21" height="27" rx="2.5" fill="${acik(renk, 0.1)}" stroke="${g}" stroke-width="1.3"/>` + C(`M${f(x)},387 h21`, g, 1.3);
    }
    if (o.pacaBant) {
      d += S(yol(kenar(hem - 11, hem, (y) => ef(y) - 1).concat(icKenar(hem, hem - 11, (y) => ei(y) - 1))), g);
    }
    s += cift(d);

    // bel bandı
    s += S(sim(kenar(BEL, BEL + 8, bu + 0.5)), o.kemer ? koyu(renk, 0.5) : g);
    if (o.kemer) s += `<rect x="145" y="${BEL - 1}" width="10" height="10" rx="2" fill="none" stroke="#e8c36a" stroke-width="2"/>`;
    else if (o.ip) s += C(`M147,${BEL + 7} Q146,${BEL + 18} 143,${BEL + 24} M153,${BEL + 7} Q154,${BEL + 18} 157,${BEL + 24}`, '#ffffff', 1.7);
    else s += `<circle cx="150" cy="${BEL + 4}" r="2" fill="${o.kot ? '#e8c36a' : koyu(renk, 0.4)}"/>`;
    return s;
  }

  /* ------------------------------------------------------------------ */
  /* Elbise                                                              */
  /* ------------------------------------------------------------------ */
  const ELBISE_TIP = {
    gunluk:  { yaka: 'bisiklet', kol: 'kisa', boy: 385, bol: 3, duz: 0.5 },
    yazlik:  { yaka: 'bisiklet', kol: 'aski', etek: { boy: 420, acilim: 28, bicim: 'a' } },
    kokteyl: { yaka: 'v', kol: 'yok', etek: { boy: 400, acilim: 22, bicim: 'a' } },
    abiye:   { yaka: 'straplez', kol: 'yok', etek: { boy: 592, acilim: 54, bicim: 'kabarik', tul: true } },
    gece:    { yaka: 'v', kol: 'yok', etek: { boy: 592, acilim: 4, bicim: 'kalem', yirtmac: 410 } },
  };

  function elbiseCiz(o, renk, id) {
    const { dolgu, tanim } = dolguHazirla(o, renk, id);
    const g = zit(renk);
    let s = tanim;
    if (!o.etek) return s + kollarCiz(o, dolgu, g) + bedenCiz(o, dolgu, renk); // düz kesim elbise

    const ust = Object.assign({}, o, { boy: 256, bol: 1.5, duz: 0, kemer: false });
    s += kollarCiz(ust, dolgu, g);
    s += etekCiz(Object.assign({ saten: o.saten }, o.etek), dolgu, renk, 250);
    s += bedenCiz(ust, dolgu, renk);
    // bel detayı
    if (o.kemer) {
      s += S(sim(kenar(246, 256, 2)), koyu(renk, 0.45)) + `<rect x="145.5" y="245.5" width="9" height="11" rx="2" fill="none" stroke="#e8c36a" stroke-width="2"/>`;
    } else if (o.kurdele) {
      const kr = parlaklik(renk) > 0.6 ? koyu(renk, 0.22) : acik(renk, 0.35);
      s += S(sim(kenar(247, 255, 2)), kr) + fiyonk(150, 251, 11, kr);
    } else {
      s += C(cizgi(ayna(kenar(251, 251.5, 1.5)).concat(kenar(251, 251.5, 1.5))), koyu(renk, 0.3), 1.3, 'opacity=".4"');
    }
    return s;
  }

  /* ------------------------------------------------------------------ */
  /* Ayakkabı (sol ayak çizilir, sağ ayak aynalanır)                     */
  /* ------------------------------------------------------------------ */
  const AYK_TIP = {
    spor: {}, topuklu: {}, babet: {}, sandalet: {},
    bot: { boy: 532 }, cizme: { boy: 470 },
  };

  function ayakkabiCiz(o, renk) {
    const g = zit(renk), tip = o.tip;
    let s = '';
    const taban = (c, kalin) => C('M102.5,598.5 Q101,605 110,605.5 L133,605 Q147,604 146,592', c, kalin);

    if (tip === 'spor') {
      const ust = o.bilek ? 540 : 556;
      s += S(`M125,${ust} L145,${ust} L145.5,585 Q146,601 132,602 L110,603 Q99,602 104,591 Q111,582 124,576 Z`, renk, koyu(renk, 0.1));
      s += `<ellipse cx="111" cy="596.5" rx="7.5" ry="4.6" transform="rotate(-10 111 596)" fill="${parlaklik(renk) > 0.85 ? '#e9e4f5' : acik(renk, 0.45)}"/>`;
      if (o.serit) s += C('M128,594 L142,578 M133,596 L144,584', g, 2.6);
      s += C(`M124,581 L134,587 M127,573 L138,579 M127,565 L140,568${o.bilek ? ' M127,556 L141,558 M127,548 L142,549' : ''}`, parlaklik(renk) > 0.8 ? '#b9a4f0' : '#ffffff', 1.8);
      s += taban(o.platform ? '#fffdf8' : '#ffffff', o.platform ? 9.5 : 5.5);
      if (o.platform || parlaklik(renk) > 0.85) s += C('M103,602 Q104,607 111,607.5 L133,607', '#d7cfe6', 1.2);
    } else if (tip === 'topuklu' || tip === 'babet') {
      if (tip === 'topuklu') s += `<rect x="138.5" y="589" width="4.6" height="17" rx="1.5" fill="${koyu(renk, 0.35)}"/>`;
      s += S('M127,572 Q135,578 142.5,572 L143,586 Q142,598 131,600.5 L110,602.5 Q100,601.5 105,591 Q112,582 126,575.5 Z', renk, koyu(renk, 0.12));
      s += C('M108,594 Q112,589 119,586', acik(renk, 0.55), 1.6, 'opacity=".7"');
      if (o.bant) s += C('M126,578 Q135,571 143,579', renk, 3.2) + `<circle cx="127" cy="578" r="1.7" fill="#e8c36a"/>`;
      if (o.bilek) s += C('M127.5,561 L142.5,561', renk, 3) + `<circle cx="128" cy="561" r="1.6" fill="#ffffff"/>`;
      if (o.fiyonk) s += fiyonk(114, 593, 6.5, koyu(renk, 0.2));
      if (o.tas) s += `<circle cx="112" cy="595" r="1.6" fill="#fff"/><circle cx="118" cy="591" r="1.3" fill="#fff"/><circle cx="124" cy="587" r="1.1" fill="#fff"/>`;
    } else if (tip === 'bot' || tip === 'cizme') {
      const ust = o.boy;
      s += `<rect x="137" y="590" width="9" height="${o.platform ? 19 : 15}" rx="2" fill="${koyu(renk, 0.45)}"/>`;
      s += S(yol(kenar(ust, 572, 3).concat(icKenar(572, ust, 3))), renk, koyu(renk, 0.1));
      s += S('M125,560 L145,560 L145.5,585 Q146,601 132,602 L110,603 Q99,602 104,591 Q111,582 124,576 Z', renk, koyu(renk, 0.1));
      s += C('M107,595 Q112,588 121,584', acik(renk, 0.5), 1.6, 'opacity=".55"');
      s += taban(parlaklik(renk) > 0.85 ? '#d7cfe6' : koyu(renk, 0.5), o.platform ? 9.5 : 5);
      s += S(yol(kenar(ust, ust + 7, 4).concat(icKenar(ust + 7, ust, 4))), g);
      if (o.bagcik) {
        let l = '';
        for (let y = ust + 14; y < 572; y += 9) { const cx = (disX(y) + icX(y)) / 2; l += `M${f(cx - 4.5)},${y} l9,2.5`; }
        s += C(l, parlaklik(renk) < 0.3 ? '#d8d8e2' : '#ffffff', 1.7);
      }
      if (o.toka) {
        const y = tip === 'cizme' ? ust + 34 : 556;
        s += S(yol(kenar(y, y + 6, 3.6).concat(icKenar(y + 6, y, 3.6))), acik(renk, 0.18));
        s += `<rect x="${f(disX(y) - 1)}" y="${y - 1.5}" width="8" height="9" rx="1.5" fill="none" stroke="#d8d8e2" stroke-width="1.8"/>`;
      }
      if (o.puskul) {
        let l = '';
        for (let x = disX(ust) - 3; x <= icX(ust) + 3; x += 3.4) l += `M${f(x)},${ust + 7} v${9 + (Math.round(x) % 3)}`;
        s += C(l, g, 1.5);
      }
    } else if (tip === 'sandalet') {
      if (o.topuk) s += `<rect x="138.5" y="589" width="4.6" height="17" rx="1.5" fill="${koyu(renk, 0.35)}"/>`;
      s += C('M104,601 Q110,604.5 131,603 Q144.5,601.5 144.5,589', koyu(renk, 0.3), 3.6);
      let b = 'M110,589 L117,602 M122,580.5 L131,601.5 M127.5,563 L142.5,563 M142.8,563 L143.5,588';
      if (o.gladyator) b += ' M127,551 L142.3,551 M126,539 L142,539 M134.5,539 L135,575';
      s += C(b, renk, 3.4);
      if (o.fiyonk) s += fiyonk(135, 563, 7, renk);
      if (o.tas) s += `<circle cx="113.5" cy="595.5" r="1.5" fill="#fff"/><circle cx="126.5" cy="591" r="1.5" fill="#fff"/><circle cx="135" cy="563" r="1.7" fill="#fff"/>`;
    }
    return cift(s);
  }

  /* ------------------------------------------------------------------ */
  /* Parça çizimi (veri satırından SVG'ye)                               */
  /* ------------------------------------------------------------------ */
  const SABLON = { ust: UST_TIP, alt: ALT_TIP, elbise: ELBISE_TIP, ayakkabi: AYK_TIP };

  // Şablon varsayılanları + parçanın kendi özellikleri
  function ozellikler(parca) {
    const taban = SABLON[parca.kategori][parca.tip] || {};
    const o = Object.assign({ tip: parca.tip }, taban, parca.ozellik);
    if (taban.etek && parca.ozellik.etek) o.etek = Object.assign({}, taban.etek, parca.ozellik.etek);
    return o;
  }

  function parcaCiz(parca, renk, onek) {
    const o = ozellikler(parca);
    const id = `${onek}-${parca.id}-${renk.slice(1)}`;
    switch (parca.kategori) {
      case 'ust': return ustCiz(o, renk, id);
      case 'alt': return altCiz(o, renk, id);
      case 'elbise': return elbiseCiz(o, renk, id);
      default: return ayakkabiCiz(o, renk);
    }
  }
  // Kumaş ayakkabının üstüne mi düşüyor? (yere kadar etek, bol paça)
  function ayakUstu(parca) {
    if (!parca) return false;
    const o = ozellikler(parca);
    if (o.etek) return o.etek.boy >= 560;
    return o.tur === 'pantolon' && o.boy >= 555 && o.b[2] >= 10;
  }

  /* ------------------------------------------------------------------ */
  /* Karakter katmanları                                                 */
  /* ------------------------------------------------------------------ */
  const KATMAN_ADLARI = ['sacArka', 'govde', 'ayakkabiAlt', 'alt', 'ust', 'elbise', 'ayakkabi', 'bas', 'sacOn'];

  function katmanlar(d, onek) {
    const sr = V.sacRenk[d.sacRenk] || V.SAC_RENKLERI[0];
    const L = (V.sacBoy[d.sacBoy] || V.SAC_BOYLARI[2]).uc;
    let sacDolgu = sr.renk, sacTanim = '';
    if (sr.ombre) {
      const gid = `${onek}-sac-${sr.id}-${L}`;
      sacDolgu = `url(#${gid})`;
      sacTanim = `<defs><linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="0" y1="70" x2="0" y2="${Math.max(L, 175)}">` +
        `<stop offset=".15" stop-color="${sr.ombre[0]}"/><stop offset=".85" stop-color="${sr.ombre[1]}"/></linearGradient></defs>`;
    }
    const sac = sacCiz(d.sacSekil, L, sacDolgu, sr.renk);

    const parca = (yuva) => (d[yuva] ? V.parca[d[yuva]] : null);
    const ciz = (yuva) => { const p = parca(yuva); return p ? parcaCiz(p, (d.renk && d.renk[yuva]) || p.renk, onek + yuva) : ''; };
    const ayakkabi = ciz('ayakkabi');
    const altta = ayakUstu(parca('elbise')) || ayakUstu(parca('alt'));
    const kas = parlaklik(sr.renk) > 0.6 ? '#8a6248' : koyu(sr.renk, 0.25);

    return {
      sacArka: sacTanim + sac.arka,
      govde: govdeCiz(!d.ust && !d.elbise, !d.alt && !d.elbise),
      ayakkabiAlt: altta ? ayakkabi : '',
      alt: ciz('alt'),
      ust: ciz('ust'),
      elbise: ciz('elbise'),
      ayakkabi: altta ? '' : ayakkabi,
      bas: basCiz(kas),
      sacOn: sac.on,
    };
  }

  const birlestir = (k) => KATMAN_ADLARI.map((ad) => k[ad]).join('');
  const SVG_BAS = 'xmlns="http://www.w3.org/2000/svg"';

  // Tam karakter (küçük resimler, kayıt yuvaları). kutu: viewBox
  function karakterSvg(d, onek, kutu) {
    return `<svg ${SVG_BAS} viewBox="${kutu || '0 0 300 620'}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${birlestir(katmanlar(d, onek))}</svg>`;
  }

  // Seçenek kartı için tek parçanın küçük resmi
  function parcaSvg(parca, onek) {
    const o = ozellikler(parca);
    let y0, y1, enAz;
    if (parca.kategori === 'ust') { y0 = 146; y1 = o.boy + 10; enAz = 132; }
    else if (parca.kategori === 'alt') { y0 = 240; y1 = o.boy + 14; enAz = 126; }
    else if (parca.kategori === 'elbise') { y0 = 146; y1 = (o.etek ? o.etek.boy : o.boy) + 16; enAz = 150; }
    else { y0 = (o.boy || 552) - 10; y1 = 614; enAz = 112; }
    const h = y1 - y0, w = Math.max(enAz, h * 0.72);
    return `<svg ${SVG_BAS} viewBox="${f(150 - w / 2)} ${y0} ${f(w)} ${h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${parcaCiz(parca, parca.renk, onek)}</svg>`;
  }

  /* ------------------------------------------------------------------ */
  /* Arka planlar (360x640)                                              */
  /* ------------------------------------------------------------------ */
  function arkaPlan(id, onek) {
    const gr = (ad, c1, c2) => `<linearGradient id="${onek}-${ad}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>`;
    const u = (ad) => `url(#${onek}-${ad})`;
    switch (id) {
      case 'sokak': {
        const bina = (x, y, w, c, pc) => {
          let s = `<rect x="${x}" y="${y}" width="${w}" height="${480 - y}" fill="${c}"/>`;
          for (let py = y + 18; py < 430; py += 44) for (let px = x + 12; px < x + w - 20; px += 30) s += `<rect x="${px}" y="${py}" width="18" height="24" rx="3" fill="${pc}"/>`;
          return s;
        };
        return `<defs>${gr('g', '#bfe3ff', '#ffeef3')}</defs><rect width="360" height="640" fill="${u('g')}"/>` +
          `<circle cx="70" cy="90" r="26" fill="#fff" opacity=".7"/><ellipse cx="250" cy="70" rx="46" ry="14" fill="#fff" opacity=".8"/><ellipse cx="280" cy="82" rx="30" ry="10" fill="#fff" opacity=".8"/>` +
          bina(-10, 190, 96, '#f7c9d4', '#fff4f7') + bina(86, 130, 104, '#c9d8f5', '#f3f7ff') + bina(190, 210, 84, '#fde3b5', '#fff8e8') + bina(274, 150, 96, '#cfeadb', '#f2fbf6') +
          `<path d="M86,410h104v16h-104z" fill="#ff9fb8"/><path d="M86,426h104l-8,14h-88z" fill="#ffc4d3"/>` +
          `<rect y="476" width="360" height="164" fill="#dcd6e8"/><rect y="476" width="360" height="8" fill="#c9c1da"/>` +
          `<path d="M0,540h360M0,600h360M60,484v56M180,484v56M300,484v56M120,540v60M240,540v60" stroke="#cbc3db" stroke-width="2"/>` +
          `<rect x="34" y="250" width="6" height="234" rx="3" fill="#6f6a86"/><path d="M37,252 q0,-22 22,-22" fill="none" stroke="#6f6a86" stroke-width="5" stroke-linecap="round"/><circle cx="62" cy="234" r="9" fill="#fff3c4"/>` +
          `<rect x="318" y="400" width="8" height="84" rx="3" fill="#9a7a62"/><circle cx="322" cy="372" r="34" fill="#9bdcb4"/><circle cx="300" cy="392" r="20" fill="#86d1a3"/><circle cx="342" cy="394" r="18" fill="#86d1a3"/>`;
      }
      case 'sahil':
        return `<defs>${gr('g', '#ffd9c2', '#c8ecff')}${gr('d', '#7fd6e8', '#a9e6ee')}</defs><rect width="360" height="640" fill="${u('g')}"/>` +
          `<circle cx="282" cy="118" r="38" fill="#fff6cf"/><circle cx="282" cy="118" r="54" fill="#fff6cf" opacity=".35"/>` +
          `<ellipse cx="90" cy="150" rx="44" ry="12" fill="#fff" opacity=".75"/><ellipse cx="120" cy="162" rx="28" ry="9" fill="#fff" opacity=".75"/>` +
          `<rect y="330" width="360" height="160" fill="${u('d')}"/>` +
          `<path d="M20,360q14,-8 28,0t28,0 M200,352q14,-8 28,0t28,0 M110,392q14,-8 28,0t28,0 M260,410q14,-8 28,0t28,0 M30,430q14,-8 28,0t28,0" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" opacity=".8"/>` +
          `<path d="M0,476 Q90,452 180,470 T360,462 V640 H0Z" fill="#fbe7bd"/><path d="M0,478 Q90,454 180,472 T360,464" fill="none" stroke="#fff" stroke-width="5" opacity=".8"/>` +
          `<path d="M326,500 Q312,400 330,300" fill="none" stroke="#b98a62" stroke-width="10" stroke-linecap="round"/>` +
          `<g fill="#7fcf9a"><path d="M330,300q-50,-30 -84,2q46,-12 84,-2z"/><path d="M330,300q-30,-52 -72,-44q44,8 72,44z"/><path d="M330,300q20,-50 60,-40q-40,6 -60,40z"/><path d="M330,300q44,-14 62,24q-28,-24 -62,-24z"/></g>` +
          `<path d="M46,540 L52,430" stroke="#b98a62" stroke-width="4" stroke-linecap="round"/><path d="M4,440 Q52,380 104,432 Q52,418 4,440Z" fill="#ff9fb8"/><path d="M36,426 Q52,398 70,424 Q52,418 36,426Z" fill="#fff"/>` +
          sus('yildiz', 300, 580, 1.3, '#ffb38a') + `<circle cx="96" cy="596" r="5" fill="#f3d39a"/><circle cx="240" cy="610" r="4" fill="#f3d39a"/>`;
      case 'podyum': {
        let isik = '';
        [[30, 80, 5], [70, 150, 3], [330, 100, 4], [290, 170, 3], [46, 250, 4], [318, 260, 5], [20, 340, 3], [340, 350, 3], [80, 60, 2.5], [270, 50, 2.5]]
          .forEach(([x, y, r], i) => { isik += `<circle cx="${x}" cy="${y}" r="${r}" fill="${i % 2 ? '#ffd9ec' : '#fff6cf'}" opacity=".8"/><circle cx="${x}" cy="${y}" r="${r * 2.6}" fill="#fff" opacity=".1"/>`; });
        return `<defs>${gr('g', '#2b1f4a', '#6a4696')}${gr('p', '#f6eeff', '#d9c6f5')}</defs><rect width="360" height="640" fill="${u('g')}"/>` +
          `<path d="M100,0 L140,0 L250,640 L20,640Z" fill="#fff" opacity=".09"/><path d="M220,0 L260,0 L340,640 L110,640Z" fill="#fff" opacity=".09"/>` +
          isik +
          `<path d="M0,480 H360 V640 H0Z" fill="#3a2a5f"/><path d="M112,478 L248,478 L344,640 L16,640Z" fill="${u('p')}"/>` +
          `<path d="M112,478 L16,640 M248,478 L344,640" stroke="#ffd35c" stroke-width="3"/>` +
          `<ellipse cx="180" cy="614" rx="92" ry="16" fill="#fff" opacity=".55"/>` +
          sus('yildiz', 60, 420, 1.1, '#ffd35c') + sus('yildiz', 306, 430, 0.9, '#ffd9ec') + sus('yildiz', 180, 40, 1, '#fff6cf');
      }
      default: // oda
        return `<defs>${gr('p', '#cdeaff', '#fff3e2')}</defs><rect width="360" height="640" fill="#fdebe6"/>` +
          `<path d="M30,0v500M90,0v500M150,0v500M210,0v500M270,0v500M330,0v500" stroke="#fbdcd6" stroke-width="10"/>` +
          `<rect x="24" y="96" width="112" height="150" rx="10" fill="${u('p')}" stroke="#fff" stroke-width="7"/><path d="M80,96v150M24,171h112" stroke="#fff" stroke-width="5"/>` +
          `<path d="M14,84 h132 v10 h-132z" fill="#e9b7c6"/><path d="M18,94 q20,70 -2,170 l22,0 q-14,-90 12,-170z" fill="#bfe8d6"/><path d="M142,94 q-20,70 2,170 l-22,0 q14,-90 -12,-170z" fill="#bfe8d6"/>` +
          `<rect x="238" y="110" width="84" height="104" rx="8" fill="#fff" stroke="#eac6d3" stroke-width="5"/>` + sus('kalp', 280, 164, 3, '#ffb3c8') +
          `<rect x="232" y="262" width="96" height="8" rx="4" fill="#e7c6a2"/><rect x="244" y="236" width="12" height="26" rx="2" fill="#b9a4f0"/><rect x="258" y="230" width="10" height="32" rx="2" fill="#ffc4d9"/><rect x="270" y="240" width="14" height="22" rx="2" fill="#9be3cf"/>` +
          `<rect y="494" width="360" height="146" fill="#efd6ba"/><path d="M0,540h360M0,590h360M70,500v40M210,500v40M140,540v50M290,540v50M40,590v50M200,590v50" stroke="#e4c5a4" stroke-width="2"/>` +
          `<rect y="488" width="360" height="9" fill="#fff"/>` +
          `<ellipse cx="180" cy="602" rx="136" ry="26" fill="#f9bfd2"/><ellipse cx="180" cy="602" rx="112" ry="19" fill="none" stroke="#fff" stroke-width="3" opacity=".7"/>` +
          `<path d="M312,440 L334,440 L330,492 L316,492Z" fill="#e8a98a"/><g fill="#8fd6a9"><ellipse cx="323" cy="410" rx="9" ry="30"/><ellipse cx="306" cy="420" rx="8" ry="24" transform="rotate(-28 306 420)"/><ellipse cx="340" cy="420" rx="8" ry="24" transform="rotate(28 340 420)"/></g>`;
    }
  }

  // Dışa aktarım: arka plan + karakter tek bir bağımsız SVG belgesinde (9:16)
  function disaAktarSvg(d) {
    return `<svg ${SVG_BAS} width="1080" height="1920" viewBox="0 0 360 640">${arkaPlan(d.arka, 'dx')}` +
      `<g transform="translate(30,10)">${birlestir(katmanlar(d, 'dx'))}</g></svg>`;
  }

  KG.cizim = { KATMAN_ADLARI, katmanlar, karakterSvg, parcaSvg, arkaPlan, disaAktarSvg };
})(window.KG = window.KG || {});
