# KlipAI — Klasör yapısı

Yol: `klipai/docs/02-klasor-yapisi.md`

pnpm çalışma alanı + Turborepo. Aşama numaraları her dizinin hangi teslimde doldurulacağını gösterir.

```
klipai/
├── package.json                    # kök betikler (turbo run build|lint|test)          [2]
├── pnpm-workspace.yaml             #                                                    [2]
├── turbo.json                      #                                                    [2]
├── .env.example                    # tüm ortam değişkenleri, açıklamalı                 [2]
├── docker-compose.yml              # dev: postgres, redis, minio, api, video            [2]
│
├── docs/
│   ├── 01-mimari.md                                                                    [1]
│   ├── 02-klasor-yapisi.md                                                             [1]
│   ├── 03-veri-modeli.md                                                               [1]
│   ├── api/
│   │   ├── openapi.yaml            # REST sözleşmesi (doğruluk kaynağı)                 [1]
│   │   ├── redocly.yaml            # lint kuralları                                     [1]
│   │   └── websocket.md            # canlı olay sözleşmesi                              [1]
│   └── yayin-kontrol-listesi.md    # mağaza + YouTube denetimi                          [7]
│
├── packages/
│   ├── shared/                     # API ve mobilin ortak kodu (saf TypeScript)
│   │   └── src/
│   │       ├── state-machines.ts   # durum geçişleri, plan hakları, roller              [1]
│   │       ├── settings.schema.ts  # ayar gruplarının zod şemaları + varsayılanlar      [2]
│   │       ├── edit-spec.schema.ts # kurgu tarifi şeması                                [2]
│   │       ├── queue-contracts.ts  # kuyruk adları, iş yükü ve sonuç tipleri            [2]
│   │       ├── error-codes.ts      # kararlı hata kodları                               [2]
│   │       └── index.ts
│   └── api-client/                 # openapi.yaml'dan üretilen tipli istemci            [5]
│       └── src/{generated/, client.ts, index.ts}
│
├── apps/
│   ├── api/                        # NestJS
│   │   ├── Dockerfile                                                                  [2]
│   │   ├── prisma.config.ts                                                            [2]
│   │   ├── prisma/
│   │   │   ├── schema.prisma                                                           [1]
│   │   │   ├── migrations/                                                             [2]
│   │   │   └── seed.ts             # sistem şablonları                                  [2]
│   │   ├── src/
│   │   │   ├── main.ts             # HTTP girişi                                        [2]
│   │   │   ├── worker.ts           # ROLE=worker girişi (kuyruk işleyicileri)           [2]
│   │   │   ├── app.module.ts
│   │   │   ├── config/             # zod ile doğrulanan ortam yapılandırması            [2]
│   │   │   ├── common/             # filtre (problem+json), guard, interceptor,
│   │   │   │                       # idempotensi, sayfalama, hız sınırı, i18n           [2]
│   │   │   ├── infra/
│   │   │   │   ├── prisma/         # PrismaService                                      [2]
│   │   │   │   ├── redis/                                                              [2]
│   │   │   │   ├── storage/        # S3: multipart, imzalı adres, CDN imzası            [2]
│   │   │   │   ├── crypto/         # zarf şifreleme (OAuth token)                       [2]
│   │   │   │   └── queue/          # BullMQ kuyruk tanımları                            [2]
│   │   │   └── modules/
│   │   │       ├── auth/           # e-posta, Google, JWT, refresh rotasyonu            [2]
│   │   │       ├── users/          # profil, cihaz, KVKK talepleri                      [2]
│   │   │       ├── projects/       # proje, hak beyanı, kaynak/yükleme                  [2]
│   │   │       ├── pipeline/       # orkestratör: aşama geçişleri, QueueEvents          [2]
│   │   │       ├── realtime/       # WebSocket geçidi, bilet, olay akışı                [2]
│   │   │       ├── candidates/                                                         [3]
│   │   │       ├── clips/          # klip, kurgu tarifi, render tetikleme               [3]
│   │   │       ├── channels/       # YouTube OAuth, kanal, kota                         [4]
│   │   │       ├── team/           # üyeler, davetler                                   [4]
│   │   │       ├── settings/       # kanal profili                                      [4]
│   │   │       ├── templates/                                                          [4]
│   │   │       ├── publishing/     # zamanlayıcı, resumable upload, takvim              [4]
│   │   │       ├── billing/        # RevenueCat, haklar, kredi defteri                  [6]
│   │   │       ├── notifications/  # push + bildirim merkezi                            [6]
│   │   │       ├── stats/          # panel, kanal/klip istatistikleri                   [6]
│   │   │       └── learning/       # 24 sa/7 gün istatistik, ChannelInsight             [6]
│   │   └── test/                   # birim + e2e (Testcontainers)                       [7]
│   │
│   └── mobile/                     # Expo (SDK 57), TypeScript
│       ├── app.config.ts                                                               [5]
│       ├── eas.json                # dev / staging / prod profilleri                    [5]
│       ├── app/                    # Expo Router
│       │   ├── _layout.tsx
│       │   ├── (auth)/             # welcome, sign-in, sign-up, forgot-password
│       │   ├── (onboarding)/       # connect-channel
│       │   ├── (tabs)/             # index (panel), calendar, stats, settings
│       │   ├── project/
│       │   │   ├── new/            # sihirbaz: source → rights → options → upload
│       │   │   └── [id]/           # index (ilerleme), candidates
│       │   ├── clip/[id]/          # index (ayrıntı), editor
│       │   ├── templates/
│       │   ├── subscription.tsx
│       │   ├── notifications.tsx
│       │   └── oauth/youtube.tsx   # derin bağlantı dönüşü
│       └── src/
│           ├── api/                # React Query kancaları (api-client üzerinde)
│           ├── stores/             # Zustand: oturum, tema, etkin kanal, taslaklar
│           ├── features/           # ekran başına bileşen + mantık
│           │   ├── upload/         # parçalı, devam ettirilebilir, arka plan
│           │   ├── editor/         # kırpma, altyazı, zaman çizgisi
│           │   └── ...
│           ├── components/         # tasarım sistemi (Button, Card, Sheet…)
│           ├── theme/              # koyu/açık renk belirteçleri
│           ├── i18n/               # tr.json, en.json
│           ├── realtime/           # socket istemcisi → sorgu önbelleği köprüsü
│           ├── offline/            # taslak deposu (MMKV) + eşitleme kuyruğu
│           └── lib/                # güvenli depolama, bildirim, satın alma, sentry
│
├── services/
│   └── video/                      # Python 3.12
│       ├── Dockerfile              # CPU imajı                                          [3]
│       ├── Dockerfile.gpu          # CUDA imajı                                         [3]
│       ├── pyproject.toml                                                              [3]
│       ├── app/
│       │   ├── main.py             # FastAPI: sağlık, ölçüm, ses önizleme
│       │   ├── worker.py           # BullMQ tüketicisi; WORKER_QUEUES ile seçilir
│       │   ├── config.py
│       │   ├── contracts.py        # iş yükü/sonuç modelleri (queue-contracts.ts eşi)
│       │   ├── storage.py          # S3
│       │   ├── costs.py            # GPU sn, token, karakter → maliyet
│       │   ├── stages/
│       │   │   ├── ingest.py       # 1
│       │   │   ├── analyze.py      # 2
│       │   │   ├── candidates.py   # 3
│       │   │   ├── score.py        # 4
│       │   │   ├── edit.py         # 5
│       │   │   ├── originalize.py  # 6
│       │   │   ├── metadata.py     # 7
│       │   │   └── qc.py           # 8
│       │   ├── media/              # ffmpeg sarmalayıcıları, kırpma, altyazı (ASS),
│       │   │                       # ses (LUFS, ducking), efektler
│       │   ├── ai/                 # whisper, sahne, konuşmacı, yüz, tts, llm istemcisi
│       │   └── prompts/            # sürümlü prompt şablonları (puan, yorum, meta veri)
│       └── tests/                                                                      [7]
│
└── infra/
    ├── docker/                     # prod compose, nginx
    └── k8s/                        # dağıtım, HPA/KEDA (kuyruk derinliği)               [7]

.github/workflows/                  # depo kökünde: ci.yml, deploy-staging.yml,
                                    # deploy-prod.yml, mobile-build.yml                  [7]
```

## Bağımlılık kuralları

- `packages/shared` hiçbir çalışma zamanı bağımlılığı içermez (yalnızca `zod`); hem API hem mobil içe aktarır.
- `apps/mobile` yalnızca `packages/api-client` ve `packages/shared` üzerinden API ile konuşur; `apps/api` kodunu içe aktarmaz.
- `services/video` Postgres'e bağlanmaz. Sözleşmesi `queue-contracts.ts` ↔ `contracts.py` çiftidir; ikisinin uyumu CI'da JSON Schema karşılaştırmasıyla denetlenir.
- API modülleri birbirine yalnızca dışa aktarılan servisler üzerinden erişir; başka modülün tablosuna doğrudan sorgu atılmaz.
