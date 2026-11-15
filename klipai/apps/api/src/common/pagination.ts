// Yol: klipai/apps/api/src/common/pagination.ts
import { z } from 'zod';

/** UUIDv7 zamana göre sıralı olduğundan imleç doğrudan son kaydın kimliğidir. */
export const PageQuerySchema = z.object({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type PageQuery = z.infer<typeof PageQuerySchema>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** `limit + 1` kayıt çekilmiş listeyi sayfaya çevirir. */
export function toPage<T extends { id: string }>(rows: T[], limit: number): { rows: T[]; nextCursor: string | null } {
  if (rows.length <= limit) return { rows, nextCursor: null };
  const page = rows.slice(0, limit);
  return { rows: page, nextCursor: page[page.length - 1]!.id };
}
