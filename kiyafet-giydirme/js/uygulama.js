/* ==========================================================================
   uygulama.js — Oyun durumu ve arayüz
   --------------------------------------------------------------------------
   durum   : karakterin o anki kombini (veri.js > VARSAYILAN ile aynı biçim)
   gecmis  : "Geri Al" için önceki durumlar
   kayitlar: kaydedilmiş kombinler (KAYIT_YERI adet yuva)
   Her değişiklik degistir() üzerinden geçer: geçmişe yazar, sahneyi ve paneli
   günceller, cihazda saklar, ses + titreşim verir.
   ========================================================================== */
(function (KG) {
  'use strict';
  const { veri, cizim, ses, depo } = KG;
  const $ = (s) => document.querySelector(s);
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const GIYSI = ['ust', 'alt', 'elbise', 'ayakkabi'];
  const kopya = (x) => JSON.parse(JSON.stringify(x));
  const rastgeleSec = (l) => l[Math.floor(Math.random() * l.length)];

  /* ---------- İkonlar (24x24, çizgi) ---------- */
  const ik = (ic) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ic}</svg>`;
  const IKON = {
    geri: ik('<path d="M9 6L4 11l5 5"/><path d="M4 11h9.5a5.5 5.5 0 010 11H11"/>'),
    sifirla: ik('<path d="M5 12a7 7 0 107-7H8"/><path d="M11 2L8 5l3 3"/>'),
    zar: ik('<rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="9" cy="9" r="1.1" fill="currentColor"/><circle cx="15" cy="15" r="1.1" fill="currentColor"/><circle cx="15" cy="9" r="1.1" fill="currentColor"/><circle cx="9" cy="15" r="1.1" fill="currentColor"/>'),
    kaydet: ik('<path d="M12 20s-7-4.5-7-10a4 4 0 017-2.5A4 4 0 0119 10c0 5.5-7 10-7 10z"/>'),
    disa: ik('<path d="M12 4v11"/><path d="M7 11l5 5 5-5"/><path d="M5 20h14"/>'),
    sesAcik: ik('<path d="M4 10v4h3l5 4V6L7 10H4z"/><path d="M16 9a4 4 0 010 6"/><path d="M18.5 6.5a7.5 7.5 0 010 11"/>'),
    sesKapali: ik('<path d="M4 10v4h3l5 4V6L7 10H4z"/><path d="M16 9l5 6M21 9l-5 6"/>'),
    kapat: ik('<path d="M6 6l12 12M18 6L6 18"/>'),
    yok: ik('<circle cx="12" cy="12" r="8"/><path d="M6.5 17.5l11-11"/>'),
    ust: ik('<path d="M8 4L3 7l2 4 2-1v10h10V10l2 1 2-4-5-3a4 4 0 01-8 0z"/>'),
    alt: ik('<path d="M7 3h10l1 18h-4l-2-11-2 11H6z"/>'),
    elbise: ik('<path d="M9 3v3l-2 3 2 2-4 10h14l-4-10 2-2-2-3V3"/><path d="M9 6c1 1.5 5 1.5 6 0"/>'),
    ayakkabi: ik('<path d="M3 18v-7l4 1 3 3 8 1a3 3 0 013 2H3z"/><path d="M3 18h18"/>'),
    sacSekil: ik('<path d="M6 4c4 3-2 5 2 8s-2 5 2 8"/><path d="M12 4c4 3-2 5 2 8s-2 5 2 8"/><path d="M18 4c3 3-1 5 1 8"/>'),
    sacBoy: ik('<path d="M12 3v18"/><path d="M8 7l4-4 4 4"/><path d="M8 17l4 4 4-4"/>'),
    sacRenk: ik('<path d="M12 3s6 6.5 6 11a6 6 0 01-12 0c0-4.5 6-11 6-11z"/>'),
    arka: ik('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M4 17l5-5 4 4 3-3 4 4"/><circle cx="16" cy="9" r="1.4"/>'),
  };

  /* ---------- Durum ---------- */
  let durum, gecmis = [], kayitlar;
  let aktifKategori = 'ust';
  let aktifTarz = 'tum';
  let oncekiTakim = { ust: null, alt: null }; // elbise giyilmeden önceki üst/alt
  let kartImza = '';                           // kartların yeniden kurulması gerekip gerekmediği
  const katmanImza = {};                       // sahnede her katmanın son çizimi
  let pngBlob = null, pngUrl = null;

  // Saklanan veriyi güvenle yükle: silinmiş/bilinmeyen id'leri temizle
  function dogrula(d) {
    if (!d || typeof d !== 'object') return null;
    const v = kopya(veri.VARSAYILAN);
    const var_ = (liste, id) => liste.some((x) => x.id === id);
    if (var_(veri.SAC_RENKLERI, d.sacRenk)) v.sacRenk = d.sacRenk;
    if (var_(veri.SAC_SEKILLERI, d.sacSekil)) v.sacSekil = d.sacSekil;
    if (var_(veri.SAC_BOYLARI, d.sacBoy)) v.sacBoy = d.sacBoy;
    if (var_(veri.ARKA_PLANLAR, d.arka)) v.arka = d.arka;
    GIYSI.forEach((y) => {
      const p = d[y] && veri.parca[d[y]];
      v[y] = p && p.kategori === y ? d[y] : null;
      const r = d.renk && d.renk[y];
      v.renk[y] = v[y] && /^#[0-9a-f]{6}$/i.test(r || '') ? r : null;
    });
    if (v.elbise) { v.ust = v.alt = null; v.renk.ust = v.renk.alt = null; }
    return v;
  }

  function sakla() {
    depo.yaz({ durum, kayitlar, ses: ses.acik });
  }

  // Tüm değişikliklerin geçtiği tek kapı
  function degistir(islem, sesTipi) {
    const once = JSON.stringify(durum);
    islem(durum);
    if (JSON.stringify(durum) === once) return false;
    gecmis.push(once);
    if (gecmis.length > 60) gecmis.shift();
    hepsiniCiz(true);
    sakla();
    ses.cal(sesTipi || 'sec');
    ses.titre(10);
    return true;
  }

  /* ---------- Seçim kuralları ---------- */
  function sec(kategori, id) {
    degistir((d) => {
      if (!GIYSI.includes(kategori)) { d[kategori] = id; return; }
      if (d[kategori] !== id) d.renk[kategori] = null; // yeni parça kendi rengiyle gelir
      if (kategori === 'elbise' && id) {
        // elbise giyilince üst ve alt çıkar
        if (d.ust || d.alt) oncekiTakim = { ust: d.ust, alt: d.alt };
        d.ust = d.alt = null; d.renk.ust = d.renk.alt = null;
      }
      if ((kategori === 'ust' || kategori === 'alt') && id && d.elbise) {
        // üst ya da alt seçilince elbise çıkar; eksik kalan parça önceki takımdan tamamlanır
        d.elbise = null; d.renk.elbise = null;
        const diger = kategori === 'ust' ? 'alt' : 'ust';
        d[diger] = oncekiTakim[diger] || veri.VARSAYILAN[diger];
      }
      d[kategori] = id;
    });
  }

  function rastgeleKombin() {
    degistir((d) => {
      const parcaSec = (kat) => {
        let l = veri.PARCALAR.filter((p) => p.kategori === kat && (aktifTarz === 'tum' || p.tarz === aktifTarz));
        if (!l.length) l = veri.PARCALAR.filter((p) => p.kategori === kat);
        return rastgeleSec(l).id;
      };
      d.sacRenk = rastgeleSec(veri.SAC_RENKLERI).id;
      d.sacSekil = rastgeleSec(veri.SAC_SEKILLERI).id;
      d.sacBoy = rastgeleSec(veri.SAC_BOYLARI).id;
      d.renk = { ust: null, alt: null, elbise: null, ayakkabi: null };
      if (Math.random() < 0.38) { d.elbise = parcaSec('elbise'); d.ust = d.alt = null; }
      else { d.elbise = null; d.ust = parcaSec('ust'); d.alt = parcaSec('alt'); }
      d.ayakkabi = parcaSec('ayakkabi');
    }, 'rastgele') && ses.titre([12, 40, 12]);
  }

  function geriAl() {
    if (!gecmis.length) return;
    durum = JSON.parse(gecmis.pop());
    hepsiniCiz(true); sakla(); ses.cal('geri'); ses.titre(10);
  }

  function sifirla() {
    if (degistir((d) => { Object.assign(d, kopya(veri.VARSAYILAN), { arka: d.arka }); }, 'sifirla')) bildir('Kombin sıfırlandı');
  }

  /* ---------- Sahne ---------- */
  // Bir katmanın içeriği değiştiyse eskisini soldurup yenisini yumuşakça getirir
  function katmanDegistir(g, svg, animasyon) {
    [...g.children].forEach((eski) => {
      if (!animasyon) { eski.remove(); return; }
      eski.classList.remove('giris'); eski.classList.add('cikis');
      setTimeout(() => eski.remove(), 230);
    });
    if (!svg) return;
    const yeni = document.createElementNS(SVG_NS, 'g');
    yeni.innerHTML = svg;
    if (animasyon) yeni.classList.add('giris');
    g.appendChild(yeni);
  }

  function sahneCiz(animasyon) {
    const k = cizim.katmanlar(durum, 's');
    cizim.KATMAN_ADLARI.forEach((ad) => {
      if (katmanImza[ad] === k[ad]) return;
      katmanImza[ad] = k[ad];
      katmanDegistir($(`#karakter [data-katman="${ad}"]`), k[ad], animasyon);
    });
    if (katmanImza.arka !== durum.arka) {
      katmanImza.arka = durum.arka;
      katmanDegistir($('#arkaKatman'), cizim.arkaPlan(durum.arka, 'bg'), animasyon);
    }
  }

  /* ---------- Panel ---------- */
  function sekmeleriKur() {
    $('#sekmeler').innerHTML = veri.KATEGORILER.map((k) =>
      `<button class="sekme" role="tab" data-kategori="${k.id}" id="sekme-${k.id}">${IKON[k.id]}<span>${k.ad}</span></button>`).join('');
    $('#tarzlar').innerHTML = [{ id: 'tum', ad: 'Tümü' }].concat(veri.TARZLAR).map((t) =>
      `<button class="cip" data-tarz="${t.id}">${t.ad}</button>`).join('');
  }

  const tarzAdi = (id) => (veri.TARZLAR.find((t) => t.id === id) || {}).ad || '';

  function kartlariKur() {
    const kat = aktifKategori, kutu = $('#kartlar');
    const kart = (id, ad, ic, ek = '') =>
      `<button class="kart ${ek}" data-id="${id}"><span class="kart-resim">${ic}</span><span class="kart-ad">${ad}</span></button>`;
    let html = '';
    kutu.className = 'kartlar kaydir kartlar-' + kat;

    if (GIYSI.includes(kat)) {
      const liste = veri.PARCALAR.filter((p) => p.kategori === kat && (aktifTarz === 'tum' || p.tarz === aktifTarz));
      html = kart('', 'Yok', IKON.yok, 'kart-yok') +
        liste.map((p, i) => kart(p.id, p.ad, cizim.parcaSvg(p, 'k' + i))).join('');
    } else if (kat === 'sacRenk') {
      html = veri.SAC_RENKLERI.map((r) => {
        const zemin = r.ombre ? `linear-gradient(180deg, ${r.ombre[0]} 20%, ${r.ombre[1]} 85%)` : r.renk;
        return kart(r.id, r.ad, `<i class="boya" style="background:${zemin}"></i>`, 'kart-renk');
      }).join('');
    } else if (kat === 'sacSekil') {
      html = veri.SAC_SEKILLERI.map((x, i) =>
        kart(x.id, x.ad, cizim.karakterSvg(Object.assign({}, durum, { sacSekil: x.id }), 'ks' + i, '56 -16 188 250'))).join('');
    } else if (kat === 'sacBoy') {
      html = veri.SAC_BOYLARI.map((x, i) =>
        kart(x.id, x.ad, cizim.karakterSvg(Object.assign({}, durum, { sacBoy: x.id }), 'kb' + i, '20 -10 260 470'))).join('');
    } else {
      html = veri.ARKA_PLANLAR.map((x, i) =>
        kart(x.id, x.ad, `<svg viewBox="0 0 360 640" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${cizim.arkaPlan(x.id, 'ka' + i)}</svg>`, 'kart-arka')).join('');
    }
    kutu.innerHTML = html;
    kutu.scrollLeft = 0;
  }

  function paletiKur() {
    const kat = aktifKategori, kutu = $('#palet');
    const giysi = GIYSI.includes(kat);
    kutu.hidden = !giysi;
    $('#tarzlar').hidden = !giysi;
    if (!giysi) return;
    const p = durum[kat] && veri.parca[durum[kat]];
    if (!p) {
      kutu.innerHTML = `<p class="palet-ipucu">Rengini değiştirmek için önce bir parça seç.</p>`;
      return;
    }
    const secili = (durum.renk[kat] || '').toLowerCase();
    kutu.innerHTML =
      `<button class="renk renk-oz ${secili ? '' : 'secili'}" data-renk="" style="--r:${p.renk}" aria-label="Kendi rengi" title="Kendi rengi"></button>` +
      veri.PALET.map((r) => `<button class="renk ${secili === r ? 'secili' : ''}" data-renk="${r}" style="--r:${r}" aria-label="Renk ${r}"></button>`).join('');
  }

  function panelCiz() {
    // Küçük resimler saç rengine/şekline bağlı olduğundan imzaya dahil
    const imza = [aktifKategori, aktifTarz,
      aktifKategori.startsWith('sac') ? [durum.sacRenk, durum.sacSekil, durum.sacBoy, durum.ust, durum.alt, durum.elbise].join() : ''].join('|');
    if (imza !== kartImza) { kartImza = imza; kartlariKur(); }

    const seciliId = durum[aktifKategori] || '';
    document.querySelectorAll('#kartlar .kart').forEach((k) => {
      const s = k.dataset.id === seciliId;
      k.classList.toggle('secili', s);
      k.setAttribute('aria-pressed', s);
    });
    document.querySelectorAll('#sekmeler .sekme').forEach((s) => {
      const a = s.dataset.kategori === aktifKategori;
      s.classList.toggle('aktif', a); s.setAttribute('aria-selected', a);
    });
    document.querySelectorAll('#tarzlar .cip').forEach((c) => c.classList.toggle('aktif', c.dataset.tarz === aktifTarz));
    paletiKur();
    $('#btnGeri').disabled = !gecmis.length;
    $('#btnSes').innerHTML = ses.acik ? IKON.sesAcik : IKON.sesKapali;
    $('#btnSes').setAttribute('aria-label', ses.acik ? 'Sesi kapat' : 'Sesi aç');
  }

  function hepsiniCiz(animasyon) { sahneCiz(animasyon); panelCiz(); }

  /* ---------- Bildirim ---------- */
  let bildirimZamani;
  function bildir(metin) {
    const b = $('#bildirim');
    b.textContent = metin; b.classList.add('gorunur');
    clearTimeout(bildirimZamani);
    bildirimZamani = setTimeout(() => b.classList.remove('gorunur'), 1900);
  }

  /* ---------- Alt sayfalar (kayıtlar, dışa aktarım) ---------- */
  function sayfaAc(id) { $('#perde').hidden = false; document.querySelectorAll('.sayfa').forEach((s) => { s.hidden = s.id !== id; }); }
  function sayfaKapat() { $('#perde').hidden = true; }

  function kayitlariCiz() {
    $('#yuvalar').innerHTML = kayitlar.map((k, i) => {
      const resim = k ? cizim.karakterSvg(k, 'y' + i) : `<span class="yuva-bos">Boş</span>`;
      return `<div class="yuva ${k ? 'dolu' : ''}">
        <button class="yuva-resim" data-islem="${k ? 'yukle' : 'kaydet'}" data-yuva="${i}" aria-label="${k ? `Kombin ${i + 1}: giy` : `Yuva ${i + 1}: buraya kaydet`}">${resim}</button>
        <div class="yuva-dugmeler">
          <button data-islem="kaydet" data-yuva="${i}">${k ? 'Üstüne Yaz' : 'Kaydet'}</button>
          ${k ? `<button data-islem="yukle" data-yuva="${i}" class="vurgulu">Giy</button><button data-islem="sil" data-yuva="${i}" aria-label="Kombin ${i + 1}: sil">Sil</button>` : ''}
        </div></div>`;
    }).join('');
  }

  function yuvaIslemi(islem, i) {
    if (islem === 'kaydet') {
      kayitlar[i] = kopya(durum); sakla(); kayitlariCiz();
      ses.cal('kaydet'); ses.titre(15); bildir(`Kombin ${i + 1}. yuvaya kaydedildi`);
    } else if (islem === 'yukle' && kayitlar[i]) {
      const k = dogrula(kayitlar[i]);
      degistir((d) => { Object.assign(d, k); });
      sayfaKapat(); bildir('Kombin giyildi');
    } else if (islem === 'sil') {
      kayitlar[i] = null; sakla(); kayitlariCiz(); ses.cal('geri'); bildir('Kayıt silindi');
    }
  }

  // Kombini 1080x1920 PNG görsele çevirir
  function disaAktar() {
    const svg = cizim.disaAktarSvg(durum);
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => {
      const tuval = document.createElement('canvas');
      tuval.width = 1080; tuval.height = 1920;
      tuval.getContext('2d').drawImage(img, 0, 0, 1080, 1920);
      URL.revokeObjectURL(url);
      tuval.toBlob((blob) => {
        if (!blob) { bildir('Görsel oluşturulamadı, tekrar dene'); return; }
        if (pngUrl) URL.revokeObjectURL(pngUrl);
        pngBlob = blob; pngUrl = URL.createObjectURL(blob);
        $('#disaResim').src = pngUrl;
        const dosya = new File([blob], 'kombinim.png', { type: 'image/png' });
        $('#btnPaylas').hidden = !(navigator.canShare && navigator.canShare({ files: [dosya] }));
        sayfaAc('sayfaDisa');
        ses.cal('kaydet');
      }, 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); bildir('Görsel oluşturulamadı, tekrar dene'); };
    img.src = url;
  }

  function indir() {
    if (!pngUrl) return;
    const a = document.createElement('a');
    a.href = pngUrl; a.download = 'kombinim.png';
    document.body.appendChild(a); a.click(); a.remove();
  }
  function paylas() {
    if (!pngBlob) return;
    navigator.share({ files: [new File([pngBlob], 'kombinim.png', { type: 'image/png' })], title: 'Kombinim' }).catch(() => {});
  }

  /* ---------- Olaylar ---------- */
  function olaylariBagla() {
    $('#sekmeler').addEventListener('click', (e) => {
      const s = e.target.closest('.sekme'); if (!s || s.dataset.kategori === aktifKategori) return;
      aktifKategori = s.dataset.kategori; panelCiz(); ses.cal('sekme');
      s.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    });
    $('#tarzlar').addEventListener('click', (e) => {
      const c = e.target.closest('.cip'); if (!c) return;
      aktifTarz = c.dataset.tarz; panelCiz(); ses.cal('sekme');
    });
    $('#kartlar').addEventListener('click', (e) => {
      const k = e.target.closest('.kart'); if (k) sec(aktifKategori, k.dataset.id || null);
    });
    $('#palet').addEventListener('click', (e) => {
      const r = e.target.closest('.renk'); if (!r) return;
      degistir((d) => { d.renk[aktifKategori] = r.dataset.renk || null; }, 'renk');
    });
    $('#btnGeri').addEventListener('click', geriAl);
    $('#btnSifirla').addEventListener('click', sifirla);
    $('#btnRastgele').addEventListener('click', rastgeleKombin);
    $('#btnKayitlar').addEventListener('click', () => { kayitlariCiz(); sayfaAc('sayfaKayit'); ses.cal('sekme'); });
    $('#btnDisa').addEventListener('click', disaAktar);
    $('#btnSes').addEventListener('click', () => { ses.acik = !ses.acik; sakla(); panelCiz(); ses.cal('sec'); bildir(ses.acik ? 'Ses ve titreşim açık' : 'Ses ve titreşim kapalı'); });
    $('#yuvalar').addEventListener('click', (e) => {
      const b = e.target.closest('[data-islem]'); if (b) yuvaIslemi(b.dataset.islem, +b.dataset.yuva);
    });
    $('#btnIndir').addEventListener('click', indir);
    $('#btnPaylas').addEventListener('click', paylas);
    $('#perde').addEventListener('click', (e) => { if (e.target.id === 'perde' || e.target.closest('.sayfa-kapat')) sayfaKapat(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') sayfaKapat(); });
  }

  /* ---------- Başlangıç ---------- */
  function baslat() {
    const k = depo.oku();
    durum = dogrula(k.durum) || kopya(veri.VARSAYILAN);       // son kombin geri gelir
    kayitlar = Array.from({ length: veri.KAYIT_YERI }, (_, i) => (k.kayitlar && dogrula(k.kayitlar[i])) || null);
    ses.acik = k.ses !== false;

    $('#btnGeri').insertAdjacentHTML('afterbegin', IKON.geri);
    $('#btnSifirla').insertAdjacentHTML('afterbegin', IKON.sifirla);
    $('#btnRastgele').insertAdjacentHTML('afterbegin', IKON.zar);
    $('#btnKayitlar').insertAdjacentHTML('afterbegin', IKON.kaydet);
    $('#btnDisa').insertAdjacentHTML('afterbegin', IKON.disa);
    document.querySelectorAll('.sayfa-kapat').forEach((b) => { b.innerHTML = IKON.kapat; });
    $('#karakter #nefes').innerHTML = cizim.KATMAN_ADLARI.map((ad) => `<g data-katman="${ad}"></g>`).join('');

    sekmeleriKur();
    olaylariBagla();
    hepsiniCiz(false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', baslat);
  else baslat();
})(window.KG = window.KG || {});
