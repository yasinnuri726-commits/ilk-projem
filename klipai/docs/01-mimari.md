# KlipAI — Aşama 1: Mimari

İlgili dosyalar:
- Veritabanı şeması: [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma)
- REST sözleşmesi: [`docs/api/openapi.yaml`](api/openapi.yaml)
- WebSocket sözleşmesi: bu belgenin 6. bölümü

## 1. Mimari şema

```mermaid
flowchart LR
  subgraph Client
    M[Mobil uygulama<br/>Expo · RN · TS]
  end

  subgraph Edge
    CDN[CDN]
    LB[Yük dengeleyici / TLS]
  end

  subgraph API["API — NestJS"]
    REST[REST /v1]
    WS[WebSocket /ws]
    ORCH[Hat orkestratörü<br/>durum makineleri]
    SCHED[Zamanlayıcı<br/>yayın + öğrenme]
    PUB[YouTube yayıncı worker]
  end

  subgraph Queue["Redis + BullMQ"]
    Q1[(ingest)]
    Q2[(analyze · GPU)]
    Q3[(candidates)]
    Q4[(score)]
    Q5[(edit · GPU)]
    Q6[(commentary)]
    Q7[(metadata)]
    Q8[(qc)]
    Q9[(publish)]
    Q10[(learn)]
    PS{{pub/sub: canlı olaylar}}
  end

  subgraph Video["Video servisi — Python"]
    FA[FastAPI<br/>sağlık · önizleme]
    WC[CPU worker'lar<br/>FFmpeg · PySceneDetect]
    WG[GPU worker'lar<br/>Whisper large-v3 · yüz takibi · NVENC]
  end

  subgraph Data
    PG[(PostgreSQL)]
    S3[(S3 uyumlu depolama)]
  end

  subgraph External["Dış servisler"]
    LLM[LLM]
    TTS[TTS]
    YT[YouTube Data API v3]
    RC[RevenueCat]
    EXPO[Expo Push]
    SENTRY[Sentry]
  end

  M -- HTTPS --> LB --> REST
  M <-- WSS --> WS
  M -- parçalı PUT, imzalı URL --> S3
  M -- izleme --> CDN --> S3
  REST --> PG
  REST --> ORCH --> Queue
  SCHED --> Q9 & Q10
  Q1 & Q3 & Q8 --> WC
  Q2 & Q5 --> WG
  Q4 & Q6 & Q7 --> WC
  WC & WG -- HMAC geri çağrı --> REST
  WC & WG --> S3
  WC --> LLM & TTS
  Q9 --> PUB --> YT
  Q10 --> PUB
  ORCH --> PS --> WS
  ORCH --> EXPO
  RC -- webhook --> REST
  API & Video --> SENTRY
```

### Bir projenin akışı

```mermaid
sequenceDiagram
  participant M as Mobil
  participant A as API
  participant S as S3
  participant Q as BullMQ
  participant W as Worker
  M->>A: POST /uploads
  M->>S: parçalar (imzalı PUT, devam ettirilebilir)
  M->>A: POST /uploads/{id}/complete
  M->>A: POST /projects (kaynak + hak beyanı)
  A->>A: kredi rezerve et, Project=INGESTING
  A->>Q: ingest işi
  loop INGEST → ANALYZE → CANDIDATES → SCORE
    Q->>W: iş
    W->>A: /internal/jobs/{id}/events (PROGRESS…SUCCEEDED)
    A-->>M: WS project.progress
    A->>Q: sonraki aşama
  end
  A-->>M: WS project.ready + push
  Note over A: FULL_AUTO ise eşik üstü adaylar otomatik kabul edilir
  M->>A: POST /candidates/{id}/accept
  loop EDIT → COMMENTARY → METADATA → QC
    Q->>W: iş
    W->>A: olay
  end
  A-->>M: WS clip.ready + push
  M->>A: POST /clips/{id}/schedule
  A->>Q: gecikmeli publish işi
  Q->>A: yayın zamanı → resumable upload → YouTube
  A-->>M: WS publish.published + push
  A->>Q: learn işleri (+24 sa, +7 gün)
```

## 2. Mimari kararlar

| # | Karar | Gerekçe |
|---|---|---|
| 1 | pnpm + Turborepo monorepo | Mobil ve API aynı Zod sözleşmesini (`packages/shared`) paylaşır; tip kayması olmaz. |
| 2 | Orkestrasyon API'de, işlem worker'da | Durum makinesi tek yerde (PostgreSQL) yaşar; worker'lar durumsuz ve yatayda ölçeklenir. |
| 3 | Python worker'lar BullMQ'yu resmi `bullmq` Python istemcisiyle tüketir | Öncelik, yeniden deneme ve gecikmeli iş için ikinci bir kuyruk sistemi gerekmez. |
| 4 | Worker → API bildirimi HMAC imzalı HTTP geri çağrısı | Worker'lara veritabanı erişimi verilmez; sır yüzeyi küçülür. |
| 5 | Her aşama ayrı kuyruk | GPU ve CPU havuzları bağımsız ölçeklenir, bir aşama diğerlerini tıkamaz. |
| 6 | Aşama çıktıları S3'te, anahtarları DB'de | Yeniden deneme önceki aşamayı tekrar çalıştırmaz (idempotent, devam edilebilir). |
| 7 | Dosya yükleme istemciden doğrudan S3'e (multipart, imzalı URL) | 20 GB'lık dosya API'den geçmez; parça bazında devam ettirilir. |
| 8 | Klip düzeni `editSpec` JSON'unda | Editör yalnızca tarif değiştirir; render sunucuda deterministik tekrar üretilir. |
| 9 | Access token 15 dk + dönen refresh token (aile iptali) | Çalınan refresh token tekrar kullanıldığında tespit edilip tüm oturum zinciri kapatılır. |
| 10 | OAuth token'ları AES-256-GCM, anahtar ortam sırrında/KMS'te | Veritabanı sızıntısı tek başına kanal erişimi vermez. |
| 11 | Kredi = işlenen kaynak dakikası, yalnızca eklemeli `UsageLog` defteri | Denetlenebilir; iade ve rezervasyon aynı defterde tutulur. |
| 12 | 60 dk → 10 dk hedefi: ses 16 kHz'e indirilir, 10 dk'lık parçalara bölünüp GPU'larda paralel Whisper (faster-whisper, batched); sahne/yüz tespiti 720p proxy üzerinde eşzamanlı | Analiz süresi video süresinden bağımsızlaşır, GPU sayısıyla ölçeklenir. |
| 13 | Bildirim metinleri i18n anahtarı + parametre olarak saklanır | Aynı kayıt TR ve EN gösterilir; dil değişince geçmiş de çevrilir. |
| 14 | Hak beyanı değiştirilemez ve kullanıcı silinse de saklanır | Telif ihtilafında hukuki kanıt; KVKK'da "hukuki yükümlülük" istisnası. |

### Plan sınırları

| | Ücretsiz | Pro | Ajans |
|---|---|---|---|
| Klip/ay | 5 | 150 | sınırsız |
| Kredi (işlenen dk)/ay | 60 | 1.800 | 12.000 (adil kullanım) |
| Azami çözünürlük | 720p | 1080p | 4K |
| Kanal | 1 | 1 | 10 |
| Filigran | var | yok | yok |
| Ekip erişimi | — | — | var |
| Kuyruk önceliği (1 = en yüksek) | 5 | 3 | 1 |

Kredi kotaları şartnamede yoktu; birim maliyete göre seçilmiş varsayımdır, `packages/shared/src/plans.ts` içinde tek yerden değişir.

## 3. Kuyruklar

| Kuyruk | Çalıştıran | Eşzamanlılık | Deneme | Geri çekilme | Zaman aşımı |
|---|---|---|---|---|---|
| `ingest` | Python CPU | 8 | 3 | üstel 30 sn | 30 dk |
| `analyze` | Python GPU | GPU başına 1 | 3 | üstel 60 sn | 15 dk |
| `candidates` | Python CPU | 8 | 3 | üstel 10 sn | 2 dk |
| `score` | Python CPU (LLM) | 16 | 4 | üstel 15 sn | 5 dk |
| `edit` | Python GPU | GPU başına 2 | 3 | üstel 60 sn | 10 dk |
| `commentary` | Python CPU (LLM+TTS) | 16 | 3 | üstel 15 sn | 3 dk |
| `metadata` | Python CPU (LLM) | 16 | 3 | üstel 15 sn | 3 dk |
| `qc` | Python CPU | 8 | 2 | sabit 10 sn | 3 dk |
| `publish` | NestJS | 4 | 3 | üstel 5 dk | 30 dk |
| `learn` | NestJS | 4 | 5 | üstel 10 dk | 2 dk |
| `notifications` | NestJS | 16 | 5 | üstel 5 sn | 30 sn |
| `maintenance` | NestJS (cron) | 1 | 1 | — | 10 dk |

İş kimliği `{stage}:{projectId|clipId}:{attempt}` biçimindedir; aynı aşama iki kez kuyruğa girmez. Tükenen işler `failed` kümesinde 7 gün tutulur.

## 4. Durum makineleri

```mermaid
stateDiagram-v2
  direction LR
  state "Project" as P {
    [*] --> DRAFT
    DRAFT --> INGESTING: start
    INGESTING --> ANALYZING
    ANALYZING --> GENERATING
    GENERATING --> SCORING
    SCORING --> READY
    INGESTING --> FAILED
    ANALYZING --> FAILED
    GENERATING --> FAILED
    SCORING --> FAILED
    FAILED --> INGESTING: retry (kaldığı aşama)
    INGESTING --> CANCELED: cancel
    ANALYZING --> CANCELED: cancel
    READY --> ARCHIVED
  }
```

```mermaid
stateDiagram-v2
  direction LR
  state "Clip" as C {
    [*] --> CANDIDATE: aday kabul edildi
    CANDIDATE --> EDITING: kurgu kuyruğa alındı
    EDITING --> READY: QC geçti / otomatik düzeltildi
    EDITING --> FAILED: deneme tükendi / QC işaretledi
    READY --> EDITING: yeniden kurgu
    READY --> SCHEDULED: planlandı
    SCHEDULED --> READY: plan iptal
    SCHEDULED --> PUBLISHED: YouTube işledi
    SCHEDULED --> FAILED: 3 deneme başarısız
    FAILED --> EDITING: yeniden kurgu
    FAILED --> SCHEDULED: yeniden yayın
    READY --> ARCHIVED
    PUBLISHED --> ARCHIVED
  }
```

```mermaid
stateDiagram-v2
  direction LR
  state "PublishJob" as J {
    [*] --> PENDING_APPROVAL: onaylı mod
    [*] --> SCHEDULED: tam otomatik / elle plan
    PENDING_APPROVAL --> SCHEDULED: onay
    SCHEDULED --> QUOTA_DEFERRED: kota yetersiz
    QUOTA_DEFERRED --> SCHEDULED: kota sıfırlandı
    SCHEDULED --> UPLOADING: zamanı geldi
    UPLOADING --> PROCESSING: yükleme bitti
    UPLOADING --> RETRY_WAIT: geçici hata
    RETRY_WAIT --> UPLOADING: 5 dk · 10 dk · 20 dk
    RETRY_WAIT --> FAILED: 3 deneme
    PROCESSING --> PUBLISHED
    SCHEDULED --> CANCELED
    PENDING_APPROVAL --> CANCELED
  }
```

Geçişler `apps/api/src/common/state-machine.ts` içindeki tek tablodan doğrulanır; geçersiz geçiş `409 INVALID_STATE` döner. Güncellemeler `UPDATE … WHERE status = <beklenen>` ile atomiktir.

Otomasyon modunun etkisi:

| Mod | Aday kabulü | Yayın |
|---|---|---|
| Tam otomatik | eşik üstü ilk N aday otomatik | QC geçince otomatik planlanır |
| Onaylı | eşik üstü ilk N aday otomatik | `PENDING_APPROVAL`, kullanıcı onaylar |
| Sadece taslak | kullanıcı seçer | kullanıcı planlar |

## 5. Yetki matrisi

| İşlem | Sahip | Editör | İzleyici |
|---|---|---|---|
| Proje / klip / takvim / istatistik görüntüleme | ✓ | ✓ | ✓ |
| Proje oluşturma, klip düzenleme, render | ✓ | ✓ | — |
| Planlama, onay, yayın iptali | ✓ | ✓ | — |
| Kanal ayarları, şablonlar | ✓ | ✓ | — |
| Üye yönetimi, kanal bağlantısını kesme | ✓ | — | — |

Kredi ve klip hakkı her zaman kanal sahibinin aboneliğinden düşer.

## 6. WebSocket sözleşmesi

- Uç nokta: `wss://api.klipai.app/ws` (Socket.IO v4, yalnızca `websocket` taşıması).
- Kimlik: el sıkışmada `auth: { token: <accessToken> }`; süresi dolunca sunucu `auth.expired` yollar, istemci yenileyip tekrar bağlanır.
- Odalar sunucu tarafından atanır: `user:{id}` ve üyesi olunan her `channel:{id}`. İstemci ayrıntılı ilerleme için `subscribe` ile `project:{id}` odasına girer.
- Her olayın zarfı: `{ id, type, ts, data }`. İstemci yeniden bağlanırken `lastEventId` yollar; sunucu Redis Stream'den son 5 dakikayı tekrar oynatır, daha eskisi için istemci React Query önbelleğini geçersiz kılar.

İstemci → sunucu:

| Olay | Gövde | Yanıt (ack) |
|---|---|---|
| `subscribe` | `{ projectId }` | `{ ok: true }` \| `{ ok: false, code }` |
| `unsubscribe` | `{ projectId }` | `{ ok: true }` |

Sunucu → istemci:

| `type` | `data` |
|---|---|
| `project.progress` | `{ projectId, status, stage, stageProgress, progress, etaSec }` |
| `project.ready` | `{ projectId, candidateCount, topScore }` |
| `project.failed` | `{ projectId, stage, error: { code, message } }` |
| `candidate.scored` | `{ projectId, candidateId, score }` |
| `clip.progress` | `{ clipId, projectId, stage, progress }` |
| `clip.updated` | `{ clipId, status, qcStatus, version }` |
| `clip.ready` | `{ clipId, thumbnailUrl, needsApproval }` |
| `clip.failed` | `{ clipId, stage, error }` |
| `publish.updated` | `{ publishJobId, clipId, status, uploadProgress, nextAttemptAt }` |
| `publish.published` | `{ publishJobId, clipId, youtubeVideoId, youtubeUrl }` |
| `publish.failed` | `{ publishJobId, clipId, error }` |
| `quota.updated` | `{ channelId, used, limit, resetAt }` |
| `credits.updated` | `{ used, granted, clipsUsed }` |
| `notification.created` | `Notification` (OpenAPI şeması) |
| `auth.expired` | `{}` |

İlerleme olayları iş başına saniyede en çok 1 kez yayılır.

## 7. Depolama düzeni

```
s3://klipai-{env}/
  uploads/{userId}/{uploadId}/{dosyaAdı}          orijinal kaynak (30 gün sonra soğuk katman)
  projects/{projectId}/proxy.mp4                  720p analiz proxy'si
  projects/{projectId}/audio.wav                  16 kHz mono
  projects/{projectId}/analysis/{words,scenes,energy,faces}.json
  projects/{projectId}/previews/{candidateId}.mp4
  clips/{clipId}/v{n}/{output.mp4,thumb.jpg,commentary.mp3}
  brand/{channelId}/{logo,watermark,intro,outro}.*
  rights/{declarationId}/evidence.*               ayrı kova politikası, silinmez
  exports/{userId}/{requestId}.zip                7 gün sonra silinir
  music/{genre}/{trackId}.mp3                     telifsiz müzik kütüphanesi
```

Tüm nesneler özeldir; istemci yalnızca kısa ömürlü imzalı CDN URL'leri alır.

## 8. Klasör yapısı

```
klipai/
├── package.json · pnpm-workspace.yaml · turbo.json · tsconfig.base.json
├── docker-compose.yml                  postgres, redis, minio, api, video-cpu, video-gpu
├── .env.example
├── .github/workflows/                  ci.yml · deploy-staging.yml · deploy-prod.yml · mobile-eas.yml
├── docs/
│   ├── 01-mimari.md
│   ├── api/openapi.yaml
│   └── store-checklist.md              (Aşama 7)
├── packages/
│   └── shared/                         API + mobil ortak
│       └── src/  enums.ts · plans.ts · schemas/ (zod) · ws-events.ts · error-codes.ts
├── apps/
│   ├── api/                            NestJS
│   │   ├── Dockerfile
│   │   ├── prisma/  schema.prisma · migrations/ · seed.ts
│   │   ├── test/                       e2e
│   │   └── src/
│   │       ├── main.ts · app.module.ts
│   │       ├── config/                 env doğrulama (zod)
│   │       ├── common/                 guards, filters (problem+json), interceptors, crypto, state-machine, idempotency
│   │       ├── prisma/ · redis/ · storage/ (S3, imzalı URL)
│   │       ├── auth/                   e-posta, Google, JWT, refresh rotasyonu
│   │       ├── users/                  profil, cihazlar, KVKK dışa aktarma/silme
│   │       ├── channels/               OAuth bağlama, ayarlar, üyeler, kota
│   │       ├── uploads/                multipart oturumları
│   │       ├── projects/               proje, kaynak, hak beyanı, adaylar
│   │       ├── clips/                  klip, editSpec, render tetikleme
│   │       ├── pipeline/               orkestratör, kuyruk tanımları, internal olay ucu
│   │       ├── publishing/             zamanlayıcı, YouTube istemcisi, resumable upload, kota
│   │       ├── learning/               istatistik çekme, içgörü üretimi
│   │       ├── templates/ · stats/ · notifications/ (push + merkez)
│   │       ├── billing/                RevenueCat webhook, krediler, yetki denetimi
│   │       ├── realtime/               Socket.IO gateway, Redis adaptörü
│   │       └── health/
│   └── mobile/                         Expo (TypeScript)
│       ├── app.config.ts · eas.json
│       ├── app/                        Expo Router
│       │   ├── _layout.tsx
│       │   ├── (auth)/  welcome · login · register · forgot-password
│       │   ├── (onboarding)/  connect-channel
│       │   ├── (tabs)/  index (panel) · calendar · stats · templates · settings
│       │   ├── project/  new (sihirbaz) · [id]/index (ilerleme) · [id]/candidates
│       │   ├── clip/[id].tsx           editör
│       │   ├── subscription.tsx · notifications.tsx
│       │   └── oauth/youtube.tsx       derin bağlantı dönüşü
│       └── src/
│           ├── api/                    istemci, React Query kancaları, token yenileme
│           ├── realtime/               socket + önbellek eşitleme
│           ├── stores/                 Zustand: auth, tema, taslaklar (kalıcı), yükleme kuyruğu
│           ├── upload/                 parçalı, devam ettirilebilir, arka planda
│           ├── components/ · theme/ (koyu/açık) · i18n/ (tr.json, en.json)
│           ├── offline/                taslak kuyruğu ve sürüm çakışması çözümü
│           └── lib/                    purchases (RevenueCat), push, sentry
└── services/
    └── video/                          Python 3.12
        ├── Dockerfile.cpu · Dockerfile.gpu · pyproject.toml
        ├── tests/
        └── klipai_video/
            ├── main.py                 FastAPI (sağlık, metrikler)
            ├── worker.py               BullMQ tüketicileri (kuyruk → aşama)
            ├── config.py · storage.py · callback.py (HMAC) · costs.py · ffmpeg.py
            ├── stages/  ingest · analyze · candidates · score · edit · commentary · metadata · qc
            ├── ai/      whisper · scenes · diarization · faces · llm · tts
            ├── render/  crop (yüz takibi) · subtitles (ASS, kelime kelime) · effects · audio (LUFS, ducking) · compose
            └── prompts/ score.md · commentary_{reaction,analysis,ranking}.md · metadata.md · learning.md
```

## 9. Veri modeli özeti

```mermaid
erDiagram
  User ||--o{ AuthIdentity : ""
  User ||--o{ RefreshToken : ""
  User ||--o{ Device : ""
  User ||--o| Subscription : ""
  User ||--o{ UsageLog : ""
  User ||--o{ Notification : ""
  User ||--o{ Channel : sahip
  Channel ||--o{ ChannelMember : ""
  User ||--o{ ChannelMember : ""
  Channel ||--|| Settings : ""
  Channel ||--o{ Template : ""
  Channel ||--o{ LearningInsight : ""
  Channel ||--o{ Project : ""
  Project ||--|| SourceVideo : ""
  SourceVideo ||--|| RightsDeclaration : ""
  SourceVideo |o--o| UploadSession : ""
  Project ||--o| Transcript : ""
  Project ||--o{ PipelineJob : ""
  Project ||--o{ ClipCandidate : ""
  ClipCandidate ||--o| Clip : ""
  Project ||--o{ Clip : ""
  Clip ||--o{ RenderJob : ""
  Clip ||--o{ PublishJob : ""
  Clip ||--o{ ClipStats : ""
```

Şartnamedeki 14 modele ek olarak: `AuthIdentity`, `RefreshToken`, `OneTimeToken`, `Device`, `ChannelMember`, `UploadSession`, `PipelineJob`, `ClipStats`, `LearningInsight`, `Notification`, `DataRequest`. İndeksler ve alan açıklamaları şema dosyasındadır.
