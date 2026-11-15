# KlipAI — WebSocket sözleşmesi (canlı iş durumu)

Yol: `klipai/docs/api/websocket.md`

Aktarım: Socket.IO v4 (NestJS Gateway; örnekler arası dağıtım Redis pub/sub ile). Gerekçe: yeniden bağlanma,
oda yönetimi ve çok örnekli yayın hazır gelir; ham WebSocket'te bunları yeniden yazmak gerekir.

## Bağlantı

1. `POST /v1/realtime/ticket` → `{ ticket, url, expiresAt }` (30 sn, tek kullanımlık).
2. `io(url, { path: '/v1/ws', auth: { ticket }, transports: ['websocket'] })`
3. Sunucu bileti doğrular, kullanıcıyı `user:{userId}` odasına alır. Geçersiz bilette bağlantı
   `connect_error` (`UNAUTHORIZED`) ile reddedilir.

Soket yolu (`/v1/ws`) bilet ucundan (`/v1/realtime/ticket`) bilerek ayrıdır: engine.io kendi
yolunun altındaki tüm istekleri sahiplenir.

Erişim token'ı süresi dolunca sunucu `auth:expired` yollar ve bağlantıyı kapatır;
istemci yeni bilet alıp yeniden bağlanır.

## İstemci → sunucu

| Olay | Yük | Yanıt (ack) | Açıklama |
|---|---|---|---|
| `subscribe` | `{ topic: string, lastEventId?: string }` | `{ ok: true } \| { ok: false, code }` | Konuya abone ol. Sunucu üyelik/rol denetimi yapar. |
| `unsubscribe` | `{ topic: string }` | `{ ok: true }` | |

Konular:

| Konu | Yetki | İçerik |
|---|---|---|
| `project:{projectId}` | kanal üyesi | Proje ve aşama ilerlemesi, aday listesi hazır |
| `clip:{clipId}` | kanal üyesi | Render ilerlemesi, QC, yayın durumu |
| `channel:{channelId}` | kanal üyesi | Kanaldaki tüm proje/klip durum değişiklikleri (ana panel, takvim) |
| `user:{userId}` | otomatik | Bildirim, abonelik, kredi değişiklikleri |

## Sunucu → istemci

Tüm olaylar aynı zarfla gelir:

```ts
interface Envelope<T> {
  id: string;        // Redis Stream kimliği; yeniden bağlanmada lastEventId olarak gönderilir
  topic: string;
  type: string;
  at: string;        // ISO-8601
  data: T;
}
```

| `type` | `data` | Ne zaman |
|---|---|---|
| `project.status` | `{ projectId, status, progress, currentStage }` | Proje durum geçişi |
| `project.stage` | `{ projectId, stage, status, progress, attempt, etaSec?, error? }` | Aşama ilerlemesi (en çok saniyede 1) |
| `project.candidates_ready` | `{ projectId, count, topScore }` | Puanlama bitti |
| `clip.status` | `{ clipId, projectId, status, version }` | Klip durum geçişi |
| `clip.render` | `{ clipId, kind, status, progress, error? }` | Kurgu / özgünleştirme / meta veri / QC ilerlemesi |
| `clip.qc` | `{ clipId, qcStatus, checks: QcCheck[] }` | Kalite kontrol sonucu |
| `clip.publish` | `{ clipId, status, uploadProgress?, attempt, nextRetryAt?, youtubeVideoId?, error? }` | Yayın ilerlemesi |
| `clip.updated` | `{ clipId, version, by }` | Başka bir ekip üyesi klibi düzenledi |
| `notification.created` | `Notification` | Yeni bildirim |
| `billing.updated` | `{ plan, status, creditsRemaining, clipsUsed }` | Abonelik veya kredi değişti |
| `channel.status` | `{ channelId, status }` | Kanal yeniden yetkilendirme gerektiriyor vb. |
| `auth:expired` | `{}` | Oturum süresi doldu |

`QcCheck` ve `Notification` biçimleri `openapi.yaml` içindeki şemalarla aynıdır.

## Teslim garantisi

- Olaylar konu başına bir Redis Stream'e yazılır (son 200 olay, 1 saat).
- Yeniden bağlanan istemci `subscribe` içinde `lastEventId` gönderir; kaçan olaylar sırayla
  yeniden oynatılır. Akış kırpılmışsa sunucu `{ ok: false, code: 'RESYNC_REQUIRED' }` döner,
  istemci ilgili REST kaynağını yeniden çeker (React Query `invalidateQueries`).
- WebSocket yalnızca önbellek tazeleme sinyalidir; doğruluk kaynağı her zaman REST'tir.
  Uygulama arka plandayken bağlantı kapanır, sonuç push bildirimiyle gelir.
