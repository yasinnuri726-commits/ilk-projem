# KlipAI

Uzun videolardan (film, dizi, podcast, yayın) yapay zeka ile en güçlü anları bulan, yorum/altyazı/seslendirmeyle kısa videolara çeviren ve YouTube'a planlı yükleyen mobil ürün.

| Bileşen | Yol | Teknoloji |
|---|---|---|
| Mobil | `apps/mobile` | Expo SDK 57, React Native, TypeScript, Expo Router, Zustand, React Query, Reanimated |
| API | `apps/api` | NestJS 11, Prisma/PostgreSQL, BullMQ/Redis, Socket.IO |
| Video servisi | `services/video` | Python 3.12, FFmpeg, faster-whisper, PySceneDetect, OpenCV, Claude API |
| Ortak sözleşme | `packages/shared` | Zod şemaları, enum'lar, plan sınırları |
| Belgeler | `docs/` | mimari, OpenAPI, mağaza kontrol listesi |

## Hızlı başlangıç (yerel)

```bash
cp .env.example .env              # değerleri doldurun (aşağıya bakın)
docker compose up -d              # postgres, redis, minio, api, video-cpu
npm ci && npm run build:shared
cd apps/api && npx prisma migrate deploy && npm run db:seed   # sistem şablonları (+ geliştirici hesabı)
npm run dev:mobile                # Expo
```

GPU analiz/kurgu worker'ı: `docker compose --profile gpu up -d` (NVIDIA Container Toolkit gerekir).

### Geliştirici hesabı (ücretsiz, sınırsız)
`DEVELOPER` rolündeki hesapta kredi, klip, kanal ve çözünürlük sınırı yoktur, filigran eklenmez.
`.env` içine `SEED_DEV_USERNAME` ve `SEED_DEV_PASSWORD` yazıp `npm run db:seed` çalıştırın; kullanıcı adı veya e-posta ile giriş yapılır.
Parola depoya yazılmaz; `.env` git tarafından yok sayılır.

### Gerçek servisler için gerekenler
| Özellik | Değişken |
|---|---|
| Kesit puanlama, yorum, meta veri, çeviri | `ANTHROPIC_API_KEY` (model: `LLM_MODEL`, varsayılan `claude-opus-5-5`) |
| Seslendirme | `ELEVENLABS_API_KEY`, `ELEVENLABS_DEFAULT_VOICE_ID` |
| Konuşmacı ayrımı (isteğe bağlı) | `HF_TOKEN` (pyannote) |
| YouTube bağlama + Google ile giriş | `GOOGLE_CLIENT_ID/SECRET`, `GOOGLE_EXTRA_AUDIENCES` |
| Abonelik | `REVENUECAT_WEBHOOK_SECRET`, `REVENUECAT_API_KEY` |
| E-posta | `SMTP_URL` (yoksa bağlantılar API loguna yazılır) |

## Testler
```bash
npm test                                   # API birim + mobil birim
npm run test:e2e -w @klipai/api            # Postgres + Redis gerekir
cd services/video && python -m pytest      # ffmpeg gerekir (gerçek render testi dahil)
```

## Aşamalar
| Aşama | İçerik |
|---|---|
| 1 | Mimari, şema, API sözleşmesi — [`docs/01-mimari.md`](docs/01-mimari.md), [`docs/api/openapi.yaml`](docs/api/openapi.yaml) |
| 2 | Kimlik, proje, kuyruk, orkestratör, kredi/abonelik, bildirim, KVKK |
| 3 | Video servisi ve yapay zeka hattı (prompt şablonları: `services/video/klipai_video/prompts`) |
| 4 | YouTube OAuth, resumable yükleme, kota, zamanlayıcı, öğrenme döngüsü |
| 5 | Mobil ekranlar (karşılama→panel→sihirbaz→analiz→kesitler→editör→takvim→istatistik→şablonlar→ayarlar→abonelik→bildirimler) |
| 6 | RevenueCat, push, istatistik |
| 7 | Testler, CI/CD (`.github/workflows`), mağaza listesi — [`docs/store-checklist.md`](docs/store-checklist.md) |
