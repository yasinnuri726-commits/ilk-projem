# KlipAI

Uzun videolardan yapay zeka ile en güçlü anları bulan, bunları altyazı, yorum ve
seslendirmeyle kısa videolara dönüştüren ve YouTube'a planlı yükleyen mobil uygulama.

## Teslim durumu

| Aşama | İçerik | Durum |
|---|---|---|
| 1 | Mimari, klasör yapısı, veritabanı şeması, API sözleşmesi | ✅ |
| 2 | Backend çekirdeği: kimlik, proje, kuyruk | bekliyor |
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

## Doğrulama

```bash
npx prisma@7 validate --schema apps/api/prisma/schema.prisma
npx @redocly/cli lint docs/api/openapi.yaml --config docs/api/redocly.yaml
npx -p typescript tsc --noEmit --strict --target es2022 packages/shared/src/state-machines.ts
```
