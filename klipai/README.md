# KlipAI

Uzun videolardan yapay zeka ile en güçlü anları bulan, bunları altyazı, yorum ve
seslendirmeyle kısa videolara dönüştüren ve YouTube'a planlı yükleyen mobil uygulama.

## Teslim durumu

| Aşama | İçerik | Durum |
|---|---|---|
| 1 | Mimari, klasör yapısı, veritabanı şeması, API sözleşmesi | ✅ |
| 2 | Backend çekirdeği: kimlik, proje, kuyruk | ✅ |
| 3 | Video servisi ve yapay zeka hattı | bekliyor |
| 4 | YouTube entegrasyonu ve zamanlayıcı | bekliyor |
| 5 | Mobil uygulama ekranları | bekliyor |
| 6 | Abonelik, bildirim, istatistik | bekliyor |
| 7 | Testler, CI/CD, mağaza yayın kontrol listesi | bekliyor |

## Aşama 1 dosyaları

| Dosya | İçerik |
|---|---|
| [`docs/01-mimari.md`](docs/01-mimari.md) | Sistem şeması, kararlar, kuyruk topolojisi, performans bütçesi, güvenlik |
| [`docs/02-klasor-yapisi.md`](docs/02-klasor-yapisi.md) | Monorepo düzeni ve bağımlılık kuralları |
| [`docs/03-veri-modeli.md`](docs/03-veri-modeli.md) | İlişkiler, durum makineleri, indeksler, kredi modeli |
| [`apps/api/prisma/schema.prisma`](apps/api/prisma/schema.prisma) | PostgreSQL şeması |
| [`docs/api/openapi.yaml`](docs/api/openapi.yaml) | REST sözleşmesi (OpenAPI 3.1) |
| [`docs/api/websocket.md`](docs/api/websocket.md) | Canlı olay sözleşmesi |
| [`packages/shared/src/state-machines.ts`](packages/shared/src/state-machines.ts) | Durum geçişleri, plan hakları, rol yetkileri |

## Çalıştırma (geliştirme)

Gerekenler: Node 22, pnpm 10, Docker.

```bash
cd klipai
pnpm install
docker compose up -d postgres redis minio minio-init   # Postgres, Redis, MinIO + kova
cp apps/api/.env.example apps/api/.env                  # JWT_SECRET ve TOKEN_ENC_KEYS'i değiştirin
pnpm --filter @klipai/shared build
pnpm db:migrate && pnpm db:seed
pnpm dev:api                                            # http://localhost:3000/v1/health
```

**Uygulamayı ücretsiz ve sınırsız kullanmak için** `apps/api/.env` içine kendi e-postanızı yazın:

```
OWNER_EMAILS=siz@ornek.com
```

Bu adresle kayıtlı hesap abonelik gerekmeden sınırsız klip ve kredi, 4K ve filigransız çıktı alır.

Video servisi (3. aşama) gelene kadar hattı uçtan uca denemek için `.env` içinde `PIPELINE_STUB=1`
yapın: kuyruklar gerçek çalışır, analiz ve puanlama sonuçları **sahtedir** (medya işlenmez).
YouTube bağlama (4. aşama) gelene kadar deneme kanalı açmak için:

```bash
pnpm --filter @klipai/api dev:channel siz@ornek.com
```

## Aşama 2 kapsamı

| Alan | Uçlar / parçalar |
|---|---|
| Kimlik | kayıt, giriş, Google ile giriş, refresh rotasyonu (yeniden kullanım tespiti), çıkış, e-posta doğrulama, parola sıfırlama |
| Kullanıcı | `GET/PATCH /me`, push cihaz kaydı |
| Proje | oluşturma (değiştirilemez hak beyanı + ayar kopyası), liste, ayrıntı, iptal, yeniden deneme, silme, transkript |
| Alım | parçalı ve devam ettirilebilir yükleme (imzalı adresler), bağlantıdan alım (SSRF korumalı) |
| Kuyruk | 12 BullMQ kuyruğu, aşama 1-4 orkestratörü, öncelik, yeniden deneme, kaçan olay telafisi, yarım yükleme temizliği |
| Canlı durum | bilet tabanlı Socket.IO geçidi, konu yetkisi, yeniden bağlanmada olay tekrarı |
| Plan / kredi | plan hakları, kredi defteri (düşüm, iade, dönem yenileme), sahip hesabı |
| Ortak | problem+json hatalar (TR/EN), hız sınırı, idempotensi, traceId'li JSON log, Sentry, sağlık ucu |

Sözleşmede olup sonraki aşamalara bırakılanlar: aday/klip uçları (3), kanal bağlama, ayar, ekip,
şablon ve yayın uçları (4), KVKK veri talepleri, abonelik, bildirim ve istatistik uçları (6).

## Testler

Gerçek Postgres, Redis ve S3 uyumlu depolamaya karşı çalışır (adresler `apps/api/test/env.ts`
içindeki `TEST_*` değişkenleriyle değiştirilir; `klipai_test` veritabanı ve `klipai-test` kovası gerekir).

```bash
pnpm test
```

## Doğrulama

```bash
pnpm typecheck            # tüm paketler
pnpm lint:api-contract    # OpenAPI sözleşmesi
```
