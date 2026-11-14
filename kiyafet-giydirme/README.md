# Kombin Atölyesi — Kıyafet Giydirme Oyunu

Telefonda dikey ekranda, tek elle oynanan bir kıyafet giydirme (dress-up) oyunu.
Kurulum gerektirmez: `index.html` dosyasını tarayıcıda açmak yeterlidir.

## Özellikler

- Üstte tam boy karakter, altta kategori sekmeleri ve seçenek kartları
- Saç: 13 renk (ombre dahil), 7 şekil, 5 boy
- 19 üst, 18 alt, 19 elbise, 19 ayakkabı; her biri 9 tarzdan birine ait ve tarza göre filtrelenir
- Elbise giyince üst + alt çıkar; üst ya da alt seçince elbise çıkar
- Her parça için renk paleti, Rastgele Kombin, Sıfırla, Geri Al
- 6 kayıt yuvası ve 1080×1920 PNG olarak dışa aktarma
- 4 arka plan: oda, sokak, sahil, podyum
- Ses efektleri ve (destekleyen cihazlarda) titreşim
- Son kombin ve kayıtlar cihazda saklanır (`localStorage`)

## Dosya yapısı

| Dosya | Görevi |
| --- | --- |
| `js/veri.js` | **Tüm içerik**: parçalar, tarzlar, saç renkleri, arka planlar, palet |
| `js/cizim.js` | Karakterin ve parçaların SVG çizimi (katmanlar, desenler, arka planlar) |
| `js/uygulama.js` | Oyun durumu, arayüz, geri al, kayıt, dışa aktarma |
| `js/ses.js` | Ses efektleri ve titreşim |
| `js/depo.js` | Cihazda saklama |
| `css/stil.css` | Görünüm ve animasyonlar |

## Yeni parça eklemek

`js/veri.js` içindeki listeye tek satır eklenir; kart, filtre, rastgele kombin ve
kayıtlar kendiliğinden günceller:

```js
p('ust-tisort-sari', 'ust', 'tisort', 'gunluk', 'Sarı Tişört', '#f6cf6a', { baski: 'yildiz' });
```

Kullanılabilir tipler ve özellikler dosyanın başındaki açıklamada listelenir.
Yeni saç rengi için `SAC_RENKLERI` listesine bir satır eklemek yeterlidir.
