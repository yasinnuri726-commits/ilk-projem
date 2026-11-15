// Yol: klipai/apps/api/src/common/zod.pipe.ts
import { Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { AppException } from './app-exception';

/** Gövde / sorgu doğrulaması. Kullanım: @Body(new ZodPipe(Schema)) body: z.infer<typeof Schema> */
@Injectable()
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value ?? {});
    if (!result.success) {
      throw new AppException(
        'VALIDATION_FAILED',
        undefined,
        result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      );
    }
    return result.data;
  }
}

/** Yol parametresi UUID doğrulaması; geçersizse kaynak yok sayılır. */
@Injectable()
export class UuidPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      throw new AppException('NOT_FOUND');
    }
    return value.toLowerCase();
  }
}
