import { readFileSync } from 'fs';
import { join } from 'path';

// .env yoksa (CI) değişkenler ortamdan gelir.
try {
  for (const line of readFileSync(join(__dirname, '..', '.env'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^'(.*)'$/, '$1');
  }
} catch {
  /* ortamdan */
}
process.env.RUN_WORKERS = 'false';
process.env.NODE_ENV = 'test';
