-- Yol: klipai/apps/api/prisma/migrations/20261115124500_constraints/migration.sql
-- Prisma şemasında ifade edilemeyen kısıtlar, kısmi indeksler ve tetikleyici.

-- ───────────── CHECK kısıtları ─────────────
ALTER TABLE "clips"
  ADD CONSTRAINT "clips_range_check" CHECK ("endMs" > "startMs"),
  ADD CONSTRAINT "clips_selected_title_check" CHECK ("selectedTitle" BETWEEN 0 AND 2);

ALTER TABLE "clip_candidates"
  ADD CONSTRAINT "clip_candidates_range_check" CHECK ("endMs" > "startMs"),
  ADD CONSTRAINT "clip_candidates_score_check" CHECK ("score" IS NULL OR "score" BETWEEN 0 AND 100);

ALTER TABLE "settings"
  ADD CONSTRAINT "settings_duration_check" CHECK ("minDurationSec" <= "maxDurationSec"),
  ADD CONSTRAINT "settings_min_score_check" CHECK ("minScore" BETWEEN 0 AND 100);

ALTER TABLE "projects"
  ADD CONSTRAINT "projects_progress_check" CHECK ("progress" BETWEEN 0 AND 100);

ALTER TABLE "publish_jobs"
  ADD CONSTRAINT "publish_jobs_attempt_check" CHECK ("attempt" >= 0 AND "attempt" <= "maxAttempts");

-- ───────────── Kısmi indeksler ─────────────
-- Zamanlayıcı taraması yalnızca bekleyen yayınlara bakar.
CREATE INDEX "publish_jobs_due_idx" ON "publish_jobs" ("scheduledAt") WHERE "status" = 'SCHEDULED';

-- Bir klibin aynı anda yalnızca bir etkin yayın işi olabilir.
CREATE UNIQUE INDEX "publish_jobs_one_active_per_clip" ON "publish_jobs" ("clipId")
  WHERE "status" IN ('SCHEDULED', 'QUEUED', 'UPLOADING', 'PROCESSING');

-- Okunmamış bildirim sayısı.
CREATE INDEX "notifications_unread_idx" ON "notifications" ("userId") WHERE "readAt" IS NULL;

-- Süresi dolmamış, kullanılabilir refresh token'lar.
CREATE INDEX "refresh_tokens_live_idx" ON "refresh_tokens" ("userId")
  WHERE "revokedAt" IS NULL AND "rotatedAt" IS NULL;

-- ───────────── Hak beyanı değiştirilemez ─────────────
-- Beyan hukuki kanıttır: silinemez, içeriği değiştirilemez. İzin verilen tek
-- güncelleme, proje silindiğinde projectId'nin NULL'a düşmesidir (ON DELETE SET NULL).
CREATE FUNCTION rights_declarations_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'rights_declarations kayıtları silinemez';
  END IF;
  IF NEW."projectId" IS NOT NULL AND NEW."projectId" IS DISTINCT FROM OLD."projectId" THEN
    RAISE EXCEPTION 'rights_declarations.projectId yalnızca NULL yapılabilir';
  END IF;
  IF (to_jsonb(NEW) - 'projectId') IS DISTINCT FROM (to_jsonb(OLD) - 'projectId') THEN
    RAISE EXCEPTION 'rights_declarations kayıtları değiştirilemez';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER rights_declarations_immutable_trg
  BEFORE UPDATE OR DELETE ON "rights_declarations"
  FOR EACH ROW EXECUTE FUNCTION rights_declarations_immutable();
