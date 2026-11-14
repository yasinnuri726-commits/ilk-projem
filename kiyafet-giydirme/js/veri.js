/* ==========================================================================
   veri.js — OYUNUN TÜM İÇERİĞİ BU DOSYADADIR
   --------------------------------------------------------------------------
   Yeni kıyafet / ayakkabı eklemek için aşağıdaki PARCALAR listesine tek satır
   eklemek yeterlidir:

     p('benzersiz-id', 'kategori', 'tip', 'tarz', 'Görünen Ad', '#renk', { özellikler })

   - kategori : ust | alt | elbise | ayakkabi
   - tip      : çizim şablonu (aşağıdaki tablolara bakın)
   - tarz     : TARZLAR listesindeki id'lerden biri
   - özellikler (isteğe bağlı) şablonun varsayılanlarını değiştirir.

   ÜST tipleri    : tisort, gomlek, bluz, kazak, crop, sweatshirt, ceket
     özellikler   : yaka (bisiklet|v|kayik|kare|gomlek|bogazli|straplez)
                    kol (yok|aski|kisa|dirsek|uzun|balon|balonUzun)
                    boy (etek ucu y), bol (bolluk), duz (0-1 düz kesim)
                    desen (cizgi|puantiye|ekose|cicek|zigzag|pul)
                    baski (kalp|yildiz|simsek|ay), fiyonk, firfir, kapuson,
                    kanguru, fermuar, ribana, manset, bant, saten, dikis
   ALT tipleri    : kot, kumas, sort, miniEtek, midiEtek, esofman
     özellikler   : boy, b:[üst,diz,paça bolluğu], yirtik, kemer, serit, kargo,
                    etekler için acilim, bicim (a|kalem|kabarik), pili, kat,
                    tul, yirtmac (yırtmacın tepe y değeri), fermuar
   ELBİSE tipleri : gunluk, abiye, yazlik, kokteyl, gece
     özellikler   : üst özelliklerinin hepsi + etek:{boy,acilim,bicim,...},
                    kemer, kurdele
   AYAKKABI tipleri: spor, topuklu, bot, sandalet, babet, cizme
     özellikler   : bilek, platform, serit, bagcik, toka, puskul, fiyonk, bant,
                    gladyator, topuk, tas, boy (bot/çizme üst y)

   Yeni saç rengi → SAC_RENKLERI, yeni saç şekli → SAC_SEKILLERI (+ cizim.js
   içinde aynı id ile çizimi), yeni arka plan → ARKA_PLANLAR.
   ========================================================================== */
(function (KG) {
  'use strict';

  /* ---------- Tarzlar (filtre çipleri) ---------- */
  const TARZLAR = [
    { id: 'gunluk',   ad: 'Günlük' },
    { id: 'sik',      ad: 'Şık / Klasik' },
    { id: 'sportif',  ad: 'Sportif' },
    { id: 'sokak',    ad: 'Sokak Modası' },
    { id: 'vintage',  ad: 'Vintage / Retro' },
    { id: 'bohem',    ad: 'Bohem' },
    { id: 'gotik',    ad: 'Gotik / Rock' },
    { id: 'romantik', ad: 'Romantik / Pastel' },
    { id: 'abiye',    ad: 'Abiye / Gece' },
  ];

  /* ---------- Kategoriler (sekmeler) ---------- */
  const KATEGORILER = [
    { id: 'ust',      ad: 'Üst',        giysi: true },
    { id: 'alt',      ad: 'Alt',        giysi: true },
    { id: 'elbise',   ad: 'Elbise',     giysi: true },
    { id: 'ayakkabi', ad: 'Ayakkabı',   giysi: true },
    { id: 'sacSekil', ad: 'Saç Şekli' },
    { id: 'sacBoy',   ad: 'Saç Boyu' },
    { id: 'sacRenk',  ad: 'Saç Rengi' },
    { id: 'arka',     ad: 'Arka Plan' },
  ];

  /* ---------- Saç ---------- */
  // ombre: [kök rengi, uç rengi]
  const SAC_RENKLERI = [
    { id: 'siyah',  ad: 'Siyah',  renk: '#2a2630' },
    { id: 'kahve',  ad: 'Kahve',  renk: '#5b3a29' },
    { id: 'kumral', ad: 'Kumral', renk: '#9a6a43' },
    { id: 'sari',   ad: 'Sarı',   renk: '#f0cf7a' },
    { id: 'kizil',  ad: 'Kızıl',  renk: '#c4502e' },
    { id: 'platin', ad: 'Platin', renk: '#efe7d6' },
    { id: 'pembe',  ad: 'Pembe',  renk: '#ff9ec4' },
    { id: 'mor',    ad: 'Mor',    renk: '#9b6fe0' },
    { id: 'mavi',   ad: 'Mavi',   renk: '#5fa8f0' },
    { id: 'yesil',  ad: 'Yeşil',  renk: '#5fcf9a' },
    { id: 'gri',    ad: 'Gri',    renk: '#a9a9b8' },
    { id: 'ombre',  ad: 'Ombre',  renk: '#5b3a29', ombre: ['#5b3a29', '#f2c877'] },
    { id: 'pastelOmbre', ad: 'Pastel Ombre', renk: '#9b6fe0', ombre: ['#9b6fe0', '#ffb3d1'] },
  ];

  const SAC_SEKILLERI = [
    { id: 'duz',       ad: 'Düz' },
    { id: 'dalgali',   ad: 'Dalgalı' },
    { id: 'kivircik',  ad: 'Kıvırcık' },
    { id: 'orgulu',    ad: 'Örgülü' },
    { id: 'topuz',     ad: 'Topuz' },
    { id: 'atkuyrugu', ad: 'At Kuyruğu' },
    { id: 'kakullu',   ad: 'Kâküllü' },
  ];

  // uc: saçın bittiği y koordinatı (karakter 300x620 birimlik tuvalde çizilir)
  const SAC_BOYLARI = [
    { id: 'kisa',    ad: 'Kısa',         uc: 150 },
    { id: 'omuz',    ad: 'Omuz Hizası',  uc: 190 },
    { id: 'orta',    ad: 'Orta',         uc: 255 },
    { id: 'uzun',    ad: 'Uzun',         uc: 335 },
    { id: 'cokUzun', ad: 'Çok Uzun',     uc: 430 },
  ];

  /* ---------- Arka planlar ---------- */
  const ARKA_PLANLAR = [
    { id: 'oda',    ad: 'Oda' },
    { id: 'sokak',  ad: 'Sokak' },
    { id: 'sahil',  ad: 'Sahil' },
    { id: 'podyum', ad: 'Podyum' },
  ];

  /* ---------- Kıyafet renk paleti ---------- */
  const PALET = [
    '#ffffff', '#f1e2c6', '#8d8fa3', '#2b2b36', '#e2574c', '#ff9f80',
    '#f6cf6a', '#8fd694', '#4fc3b0', '#7fb6e6', '#3d5a99', '#b9a4f0',
    '#7a4fb3', '#ffc4d9', '#e86fa5', '#b5653a',
  ];

  /* ---------- Parçalar ---------- */
  const PARCALAR = [];
  const p = (id, kategori, tip, tarz, ad, renk, ozellik) =>
    PARCALAR.push({ id, kategori, tip, tarz, ad, renk, ozellik: ozellik || {} });

  // ---- ÜST GİYİM ----
  p('ust-tisort-duz',     'ust', 'tisort',     'gunluk',   'Basic Tişört',        '#ffffff');
  p('ust-kazak-cizgili',  'ust', 'kazak',      'gunluk',   'Çizgili Kazak',       '#7fb6e6', { desen: 'cizgi' });
  p('ust-ceket-kot',      'ust', 'ceket',      'gunluk',   'Kot Ceket',           '#6f9bd6', { dikis: true, boy: 274 });
  p('ust-gomlek-klasik',  'ust', 'gomlek',     'sik',      'Klasik Gömlek',       '#f4f7ff');
  p('ust-ceket-blazer',   'ust', 'ceket',      'sik',      'Blazer Ceket',        '#2f3a5f', { dugme: true });
  p('ust-crop-spor',      'ust', 'crop',       'sportif',  'Spor Crop',           '#ff7f6e', { kol: 'yok', bant: true });
  p('ust-sweat-fermuar',  'ust', 'sweatshirt', 'sportif',  'Fermuarlı Eşofman Üstü', '#4fc3b0', { fermuar: true, yaka: 'bogazli' });
  p('ust-sweat-kapuson',  'ust', 'sweatshirt', 'sokak',    'Oversize Kapüşonlu',  '#b9a4f0', { kapuson: true, kanguru: true, bol: 10 });
  p('ust-tisort-grafik',  'ust', 'tisort',     'sokak',    'Grafik Tişört',       '#2b2b36', { baski: 'simsek', bol: 6, boy: 296 });
  p('ust-bluz-puantiye',  'ust', 'bluz',       'vintage',  'Puantiyeli Bluz',     '#e2574c', { desen: 'puantiye', fiyonk: true, yaka: 'bisiklet' });
  p('ust-gomlek-ekose',   'ust', 'gomlek',     'vintage',  'Ekose Gömlek',        '#c9803f', { desen: 'ekose' });
  p('ust-bluz-cicek',     'ust', 'bluz',       'bohem',    'Çiçekli Köylü Bluzu', '#f1dcb4', { desen: 'cicek', kol: 'balonUzun' });
  p('ust-kazak-etnik',    'ust', 'kazak',      'bohem',    'Etnik Örgü Kazak',    '#c96f4a', { desen: 'zigzag', yaka: 'v' });
  p('ust-ceket-deri',     'ust', 'ceket',      'gotik',    'Deri Ceket',          '#26222e', { yaka: 'biker', boy: 272 });
  p('ust-crop-gotik',     'ust', 'crop',       'gotik',    'Askılı Siyah Crop',   '#1e1a24', { kol: 'aski', baski: 'ay' });
  p('ust-bluz-firfir',    'ust', 'bluz',       'romantik', 'Fırfırlı Bluz',       '#ffc4d9', { firfir: true, yaka: 'kare' });
  p('ust-kazak-kalp',     'ust', 'kazak',      'romantik', 'Kalpli Kazak',        '#cfe3ff', { baski: 'kalp' });
  p('ust-bluz-saten',     'ust', 'bluz',       'abiye',    'Saten Bluz',          '#e8c36a', { yaka: 'v', kol: 'balonUzun', saten: true });
  p('ust-crop-payet',     'ust', 'crop',       'abiye',    'Payetli Büstiyer',    '#b78cf2', { kol: 'yok', yaka: 'straplez', desen: 'pul' });

  // ---- ALT GİYİM ----
  p('alt-kot-mavi',       'alt', 'kot',      'gunluk',   'Mavi Kot',             '#5b8fd0');
  p('alt-sort-kot',       'alt', 'sort',     'gunluk',   'Kot Şort',             '#7fb0e3', { kot: true });
  p('alt-kumas-klasik',   'alt', 'kumas',    'sik',      'Kumaş Pantolon',       '#3b3f58', { kemer: true });
  p('alt-midi-kalem',     'alt', 'midiEtek', 'sik',      'Kalem Etek',           '#6b4f6e', { bicim: 'kalem', boy: 452, acilim: 0 });
  p('alt-esofman-serit',  'alt', 'esofman',  'sportif',  'Şeritli Eşofman Altı', '#4a4f6a', { serit: true });
  p('alt-sort-spor',      'alt', 'sort',     'sportif',  'Spor Şort',            '#ff7f6e', { serit: true, ip: true, boy: 350 });
  p('alt-kot-bol',        'alt', 'kot',      'sokak',    'Bol Yırtık Kot',       '#9db8d8', { b: [5, 13, 15], yirtik: true });
  p('alt-esofman-kargo',  'alt', 'esofman',  'sokak',    'Kargo Eşofman',        '#8a8f5c', { kargo: true, b: [6, 10, 8] });
  p('alt-kumas-ispanyol', 'alt', 'kumas',    'vintage',  'İspanyol Paça',        '#b5653a', { b: [2, 2, 18] });
  p('alt-mini-ekose',     'alt', 'miniEtek', 'vintage',  'Ekose Pilili Etek',    '#c2453e', { desen: 'ekose', pili: true });
  p('alt-midi-katli',     'alt', 'midiEtek', 'bohem',    'Katlı Çiçekli Etek',   '#e8a25c', { desen: 'cicek', kat: true, acilim: 30, boy: 500 });
  p('alt-kumas-keten',    'alt', 'kumas',    'bohem',    'Bol Keten Pantolon',   '#e9dcc0', { b: [5, 14, 18], utu: false });
  p('alt-kot-siyah',      'alt', 'kot',      'gotik',    'Siyah Dar Kot',        '#25222c', { yirtik: true, b: [1.5, 2, 2.5] });
  p('alt-mini-deri',      'alt', 'miniEtek', 'gotik',    'Deri Mini Etek',       '#1f1c26', { fermuar: true, acilim: 6, kemer: true });
  p('alt-mini-tul',       'alt', 'miniEtek', 'romantik', 'Tül Etek',             '#ffc1d6', { tul: true, bicim: 'kabarik', acilim: 30, boy: 376 });
  p('alt-midi-cicek',     'alt', 'midiEtek', 'romantik', 'Çiçekli Midi Etek',    '#cfe5ff', { desen: 'cicek' });
  p('alt-midi-saten',     'alt', 'midiEtek', 'abiye',    'Saten Yırtmaçlı Etek', '#7a2e4f', { bicim: 'kalem', boy: 500, acilim: 2, yirtmac: 395, saten: true });
  p('alt-mini-payet',     'alt', 'miniEtek', 'abiye',    'Payetli Mini Etek',    '#e8c36a', { desen: 'pul', acilim: 8 });

  // ---- ELBİSE ----
  p('elb-tisort',     'elbise', 'gunluk',  'gunluk',   'Tişört Elbise',          '#9ad0c2');
  p('elb-kot',        'elbise', 'gunluk',  'gunluk',   'Kot Elbise',             '#6f9bd6', { yaka: 'gomlek', on: 'dugme', kemer: true, boy: 395 });
  p('elb-kalem',      'elbise', 'kokteyl', 'sik',      'Kalem Elbise',           '#2f3a5f', { yaka: 'kayik', kol: 'dirsek', etek: { boy: 450, bicim: 'kalem', acilim: 0 }, kemer: true });
  p('elb-gomlek',     'elbise', 'gunluk',  'sik',      'Gömlek Elbise',          '#f4efe6', { yaka: 'gomlek', on: 'dugme', kol: 'uzun', manset: true, kemer: true, boy: 420 });
  p('elb-tenis',      'elbise', 'yazlik',  'sportif',  'Tenis Elbisesi',         '#ffffff', { yaka: 'v', kol: 'yok', bant: true, etek: { boy: 372, acilim: 20, pili: true } });
  p('elb-kapuson',    'elbise', 'gunluk',  'sportif',  'Kapüşonlu Elbise',       '#ff9f80', { kol: 'uzun', manset: true, kapuson: true, kanguru: true, bol: 6, boy: 380 });
  p('elb-oversize',   'elbise', 'gunluk',  'sokak',    'Baskılı Oversize Elbise', '#2b2b36', { baski: 'yildiz', bol: 8, boy: 392 });
  p('elb-ekose',      'elbise', 'yazlik',  'sokak',    'Ekose Askılı Elbise',    '#c2453e', { desen: 'ekose' });
  p('elb-puantiye',   'elbise', 'kokteyl', 'vintage',  'Puantiyeli Retro Elbise', '#2e4a7a', { desen: 'puantiye', yaka: 'kayik', kol: 'kisa', kemer: true, etek: { boy: 455, acilim: 44, bicim: 'kabarik' } });
  p('elb-bebeyaka',   'elbise', 'yazlik',  'vintage',  'Bebe Yaka Elbise',       '#7a4b3a', { yaka: 'gomlek', kol: 'balon', etek: { boy: 410, acilim: 26 } });
  p('elb-cicek-uzun', 'elbise', 'yazlik',  'bohem',    'Çiçekli Uzun Elbise',    '#e9a66b', { desen: 'cicek', yaka: 'v', kol: 'balonUzun', etek: { boy: 570, acilim: 34, kat: true } });
  p('elb-dantel',     'elbise', 'yazlik',  'bohem',    'Dantel Yazlık Elbise',   '#fbf3e4', { etek: { boy: 440, acilim: 30, kat: true } });
  p('elb-tul-siyah',  'elbise', 'kokteyl', 'gotik',    'Siyah Tül Elbise',       '#1e1a24', { yaka: 'straplez', etek: { boy: 395, acilim: 36, bicim: 'kabarik', tul: true } });
  p('elb-kadife',     'elbise', 'gece',    'gotik',    'Kadife Gece Elbisesi',   '#4a1730', { kol: 'uzun' });
  p('elb-firfir',     'elbise', 'yazlik',  'romantik', 'Pastel Fırfırlı Elbise', '#ffc4d9', { yaka: 'kare', kol: 'balon', kurdele: true, etek: { boy: 420, acilim: 30, kat: true } });
  p('elb-fiyonk',     'elbise', 'kokteyl', 'romantik', 'Fiyonklu Elbise',        '#cdb8ff', { yaka: 'straplez', kurdele: true, etek: { boy: 410, acilim: 38, bicim: 'kabarik' } });
  p('elb-prenses',    'elbise', 'abiye',   'abiye',    'Prenses Abiye',          '#9fd0f5');
  p('elb-balik',      'elbise', 'abiye',   'abiye',    'Balık Abiye',            '#b3243f', { etek: { boy: 592, acilim: 40, bicim: 'balik' } });
  p('elb-payet-gece', 'elbise', 'gece',    'abiye',    'Payetli Gece Elbisesi',  '#c9a24a', { desen: 'pul', kol: 'aski' });

  // ---- AYAKKABI ----
  p('ayk-spor-beyaz',     'ayakkabi', 'spor',     'gunluk',   'Beyaz Spor Ayakkabı',  '#ffffff');
  p('ayk-babet-duz',      'ayakkabi', 'babet',    'gunluk',   'Düz Babet',            '#d9a37c');
  p('ayk-topuklu-klasik', 'ayakkabi', 'topuklu',  'sik',      'Klasik Stiletto',      '#2b2b36');
  p('ayk-bot-chelsea',    'ayakkabi', 'bot',      'sik',      'Chelsea Bot',          '#6b4a3a');
  p('ayk-cizme-suet',     'ayakkabi', 'cizme',    'sik',      'Süet Çizme',           '#7a5a48');
  p('ayk-spor-kosu',      'ayakkabi', 'spor',     'sportif',  'Koşu Ayakkabısı',      '#ff7f6e', { serit: true });
  p('ayk-spor-bilekli',   'ayakkabi', 'spor',     'sportif',  'Bilekli Spor',         '#4fc3b0', { bilek: true });
  p('ayk-spor-platform',  'ayakkabi', 'spor',     'sokak',    'Kalın Taban Spor',     '#e9e4f5', { platform: true, serit: true });
  p('ayk-bot-bagcikli',   'ayakkabi', 'bot',      'sokak',    'Bağcıklı Bot',         '#c98b3f', { bagcik: true });
  p('ayk-babet-mary',     'ayakkabi', 'babet',    'vintage',  'Mary Jane',            '#a3262e', { bant: true });
  p('ayk-cizme-retro',    'ayakkabi', 'cizme',    'vintage',  'Retro Beyaz Çizme',    '#fafafa', { boy: 500 });
  p('ayk-bot-puskul',     'ayakkabi', 'bot',      'bohem',    'Püsküllü Süet Bot',    '#b98456', { puskul: true });
  p('ayk-sandalet-ip',    'ayakkabi', 'sandalet', 'bohem',    'Gladyatör Sandalet',   '#8a5a3a', { gladyator: true });
  p('ayk-bot-postal',     'ayakkabi', 'bot',      'gotik',    'Platform Postal',      '#1e1a24', { platform: true, bagcik: true, toka: true, boy: 520 });
  p('ayk-cizme-toka',     'ayakkabi', 'cizme',    'gotik',    'Tokalı Uzun Çizme',    '#25222c', { toka: true });
  p('ayk-babet-fiyonk',   'ayakkabi', 'babet',    'romantik', 'Fiyonklu Babet',       '#ffc4d9', { fiyonk: true });
  p('ayk-sandalet-kurdele','ayakkabi', 'sandalet', 'romantik', 'Kurdeleli Sandalet',  '#cdb8ff', { fiyonk: true });
  p('ayk-topuklu-parlak', 'ayakkabi', 'topuklu',  'abiye',    'Parlak Stiletto',      '#e8c36a', { bilek: true, tas: true });
  p('ayk-sandalet-topuk', 'ayakkabi', 'sandalet', 'abiye',    'Taşlı Topuklu Sandalet', '#d9dbe8', { topuk: true, tas: true });

  /* ---------- Açılış kombini ---------- */
  const VARSAYILAN = {
    sacRenk: 'kahve', sacSekil: 'dalgali', sacBoy: 'orta',
    ust: 'ust-tisort-duz', alt: 'alt-kot-mavi', elbise: null, ayakkabi: 'ayk-spor-beyaz',
    renk: { ust: null, alt: null, elbise: null, ayakkabi: null }, // null = parçanın kendi rengi
    arka: 'oda',
  };

  const haritala = (liste) => Object.fromEntries(liste.map((x) => [x.id, x]));

  KG.veri = {
    TARZLAR, KATEGORILER, SAC_RENKLERI, SAC_SEKILLERI, SAC_BOYLARI,
    ARKA_PLANLAR, PALET, PARCALAR, VARSAYILAN,
    parca: haritala(PARCALAR),
    sacRenk: haritala(SAC_RENKLERI),
    sacBoy: haritala(SAC_BOYLARI),
    KAYIT_YERI: 6,
  };
})(window.KG = window.KG || {});
