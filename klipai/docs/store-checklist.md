# KlipAI — Mağaza yayın kontrol listesi

Durum: ☐ yapılacak · ✔ kodda hazır. Kod tarafında hazır olanlar yine de ilgili kimlik bilgileriyle bir kez doğrulanmalıdır.

## 0. Yayın öncesi (her iki mağaza)
- ☐ **Gerçek uygulama ikonu ve açılış görseli**: `apps/mobile/assets/` altındaki dosyalar yer tutucudur (mor zemin üzerinde "K"). 1024×1024 ikon, adaptif ikon ön planı, `splash-icon.png`.
- ☐ Alan adı `klipai.app` (veya kendinizin) ve **canlı** `/privacy` ve `/terms` sayfaları. Uygulama bu bağlantıları açar (`src/config.ts`).
- ☐ **Destek e-postası ve destek URL'si**.
- ☐ Ekran görüntüleri (6,7" ve 6,1" iPhone; telefon ve 7" tablet Android), kısa tanıtım metni, TR + EN mağaza metni.
- ☐ Yaş derecelendirmesi anketi: kullanıcı içeriği/ağ üzerinden yükleme var, şiddet/cinsellik içeriği üretmez.
- ✔ `ITSAppUsesNonExemptEncryption: false` (yalnızca standart HTTPS).
- ☐ `EAS_PROJECT_ID`, bundle kimliği `app.klipai.mobile` (alınmış mı kontrol edin) — `eas init`.

## 1. Hesap ve veri (Apple 5.1.1, Google Kullanıcı Verileri)
- ✔ **Uygulama içinden hesap silme** (Ayarlar → Hesabımı sil): hesap hemen devre dışı, 30 gün sonra kalıcı silinir.
- ✔ Veri dışa aktarma (Ayarlar → Verilerimi dışa aktar), 7 gün geçerli bağlantı e-postayla.
- ☐ **Gizlilik politikası** şunları açıkça yazmalı: işlenen veriler (e-posta, kullanıcı içeriği/videolar, YouTube kanal bilgisi, kullanım ve maliyet kayıtları), üçüncü taraflar (Google/YouTube, LLM sağlayıcısı, TTS sağlayıcısı, RevenueCat, Expo/Apple/Google push, Sentry), saklama süreleri, KVKK/GDPR hakları ve başvuru yolu, hak beyanı kayıtlarının hukuki yükümlülük gereği anonim saklanması.
- ☐ **Apple "App Privacy" etiketleri**: İletişim bilgisi (e-posta), Kullanıcı içeriği (video/ses), Tanımlayıcılar (kullanıcı kimliği, cihaz push token'ı), Satın alma geçmişi, Tanılama (Sentry). "Takip için kullanılmaz" seçilebilir.
- ☐ **Google Play "Data safety"** formu aynı veri türleriyle; "veri aktarımda şifreli" ✔, "silme talebi" ✔.
- ☐ Test/inceleme hesabı: Apple ve Google inceleme ekibi için hazır bir kullanıcı adı/parola ve **önceden bağlanmış bir test YouTube kanalı** verin (inceleme notlarına yazın). Geliştirici hesabı (`DEVELOPER` rolü) bu iş için uygundur; üretimde ayrı bir inceleme hesabı kullanın ve parolasını depoya yazmayın.

## 2. Abonelikler (Apple 3.1.1/3.1.2, Google Payments)
- ☐ App Store Connect'te iki otomatik yenilenen abonelik (grup: *KlipAI*): `klipai_pro_monthly`, `klipai_agency_monthly`; Play Console'da karşılıkları.
- ☐ RevenueCat'te yetkiler `pro` ve `agency`, bir *current offering* ve iki paket; `EXPO_PUBLIC_REVENUECAT_IOS_KEY` / `_ANDROID_KEY` (herkese açık SDK anahtarları).
- ☐ RevenueCat webhook: `https://api.klipai.app/v1/webhooks/revenuecat`, yetkilendirme başlığı `Bearer <REVENUECAT_WEBHOOK_SECRET>`; sunucuda `REVENUECAT_API_KEY` (gizli, REST).
- ✔ Uygulamada "Satın alımları geri yükle" düğmesi.
- ☐ Abonelik ekranında zorunlu metinler (mağaza incelemesinde sık red nedeni): fiyat, dönem, otomatik yenileme ve iptal bilgisi, Kullanım Koşulları ve Gizlilik bağlantıları. `subscription.tsx` fiyatı ve planı gösterir; **yenileme/iptal metnini ve bağlantıları mağaza metnine uygun biçimde ekleyin**.
- ☐ Mağaza ürün adları ve açıklamaları, fiyatlar (TR/EN yerelleştirme).

## 3. Google / YouTube
- ☐ Google Cloud projesi: YouTube Data API v3 + YouTube Analytics API etkin; **OAuth izin ekranı** üretime alınmış.
- ☐ Kullanılan kapsamlar: `youtube.upload`, `youtube.readonly`, `yt-analytics.readonly` — hassas kapsam olduğu için **Google OAuth doğrulaması** gerekir (doğrulanana kadar 100 kullanıcı sınırı ve "doğrulanmamış uygulama" uyarısı). Tanıtım videosu ve alan adı sahipliği istenir.
- ☐ **YouTube API Services denetimi ve kota artışı**: varsayılan 10.000 birim/gün ≈ 6 yükleme (yükleme 1.600 birim). Çok kanallı kullanım için "Quota Extension" başvurusu yapın; denetim kapsamında uygulamanın YouTube Hizmet Şartları'na uyumu incelenir.
- ☐ **YouTube API Hizmet Şartları gereği**: gizlilik politikasında Google Gizlilik Politikası'na bağlantı ve kullanıcıya YouTube erişimini iptal etme yolu (`https://myaccount.google.com/permissions`) gösterilmeli. Uygulamada "Bağlantıyı kes" token'ı iptal eder ✔.
- ☐ Google ile giriş: web + iOS + Android OAuth istemci kimlikleri; sunucuda `GOOGLE_EXTRA_AUDIENCES`.
- ☐ Yönlendirme URI'si: `https://api.klipai.app/v1/channels/youtube/oauth/callback`.

## 4. İçerik politikası ve telif
- ✔ Kullanıcı her projede kaynak hakkını beyan eder (kendi / lisanslı / kamu malı / izinli); beyan metni, sürüm, IP ve cihaz bilgisiyle değiştirilemez kaydedilir.
- ✔ Link ile alım yalnızca doğrudan medya dosyalarını kabul eder; YouTube vb. platform sayfalarından indirme **yoktur** (hizmet şartları ve mağaza riski).
- ☐ **Telif bildirimi / kaldırma süreci**: mağaza ve hukuk açısından bir *DMCA / hak ihlali bildirim adresi* ve bunu işletecek insan süreci tanımlayın; Kullanım Koşulları'nda tekrarlayan ihlalde hesap kapatma maddesi.
- ☐ Üretilen içerik (LLM yorumu, TTS) için **yapay zeka içeriği bildirimi**: YouTube "değiştirilmiş/sentetik içerik" beyanı gereklidir; sentetik ses kullanan kliplerde bu ayarı kanal akışınıza ekleyip eklemeyeceğinize karar verin (şu an API ile işaretlenmiyor).
- ☐ Müzik: `music/{tür}/` kovasına **telifsiz/lisanslı** parçalar yükleyin ve lisans kayıtlarını saklayın (depoda müzik yoktur; tür seçilmezse müzik eklenmez).
- ☐ TTS sağlayıcı sözleşmesi ticari kullanım ve yayın hakkını kapsıyor mu doğrulayın.

## 5. Bildirimler ve izinler
- ☐ APNs anahtarı ve FCM (Expo push kimlik bilgileri) EAS'e yüklenmeli.
- ✔ Bildirim izni bağlam içinde, oturum açıldıktan sonra istenir; reddedilirse uygulama çalışmaya devam eder.
- ✔ Kamera/mikrofon/konum izni istenmez. Dosya seçici sistem arayüzünü kullanır (galeri izni metni `app.config.ts`).

## 6. Erişilebilirlik ve yerelleştirme
- ✔ Düğme, anahtar, ilerleme ve seçim kontrollerinde `accessibilityRole/Label/State`; koyu/açık tema; TR + EN.
- ☐ Gerçek cihazda VoiceOver/TalkBack ve yazı tipi büyütme turu; kontrast denetimi (palet açık/koyu için seçildi, kesin ölçüm yapılmadı).

## 7. Teknik yayın adımları
1. `eas build --profile production --platform all` (CI: *Mobile build (EAS)* iş akışı).
2. iOS: TestFlight iç test → dış test; Android: iç test kanalı → kapalı test (yeni kişisel hesaplarda **12 test kullanıcısı / 14 gün** koşulu geçerli olabilir).
3. Üretim sunucusu: Postgres yedeği, Redis kalıcılığı, S3 kova yaşam döngüsü (yüklemeler 30 gün sonra soğuk katman, `exports/` 7 gün), Sentry, `YOUTUBE_DAILY_QUOTA`, gizli anahtarlar (`JWT_ACCESS_SECRET`, `TOKEN_ENC_KEY`, `INTERNAL_HMAC_SECRET`) için gizli yönetimi ve **anahtar döndürme planı**.
4. Hız sınırı ve `trust proxy` ayarını yük dengeleyicinizin gerçek istemci IP'sini verdiğinden emin olacak şekilde doğrulayın.
5. Yük testi: 60 dakikalık video → analiz ≤ 10 dk hedefi **gerçek GPU'da ölçülmeli** (tasarım: paralel toplu Whisper; ölçüm yapılmadı).
