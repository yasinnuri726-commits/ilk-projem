import {
  AbortMultipartUploadCommand, CompleteMultipartUploadCommand, CreateMultipartUploadCommand, DeleteObjectsCommand, GetObjectCommand,
  HeadBucketCommand, HeadObjectCommand, ListObjectsV2Command, ListPartsCommand, PutObjectCommand, S3Client, UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import type { Readable } from 'stream';
import { env } from '../config';

@Injectable()
export class StorageService {
  private readonly bucket = env().S3_BUCKET;
  private readonly s3 = this.makeClient(env().S3_ENDPOINT);
  /** İmzalı URL'ler istemcinin erişebildiği uç noktayla üretilir (yerelde MinIO için farklıdır). */
  private readonly signer = this.makeClient(env().S3_PUBLIC_ENDPOINT || env().S3_ENDPOINT);

  private makeClient(endpoint?: string) {
    const e = env();
    return new S3Client({
      region: e.S3_REGION,
      endpoint: endpoint || undefined,
      forcePathStyle: e.S3_FORCE_PATH_STYLE,
      credentials: e.S3_ACCESS_KEY ? { accessKeyId: e.S3_ACCESS_KEY, secretAccessKey: e.S3_SECRET_KEY } : undefined,
    });
  }

  /** Kovaya erişimi doğrular (sağlık denetimi). */
  async ping(): Promise<void> {
    await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  async createMultipart(key: string, contentType: string): Promise<string> {
    const r = await this.s3.send(new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }));
    return r.UploadId!;
  }

  signPart(key: string, uploadId: string, partNumber: number, expiresIn = 900): Promise<string> {
    return getSignedUrl(this.signer, new UploadPartCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, PartNumber: partNumber }), { expiresIn });
  }

  async listParts(key: string, uploadId: string): Promise<{ partNumber: number; etag: string }[]> {
    const out: { partNumber: number; etag: string }[] = [];
    let marker: string | undefined;
    do {
      const r = await this.s3.send(new ListPartsCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, PartNumberMarker: marker }));
      for (const p of r.Parts ?? []) out.push({ partNumber: p.PartNumber!, etag: p.ETag! });
      marker = r.IsTruncated ? r.NextPartNumberMarker : undefined;
    } while (marker);
    return out;
  }

  async completeMultipart(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<void> {
    await this.s3.send(new CompleteMultipartUploadCommand({
      Bucket: this.bucket, Key: key, UploadId: uploadId,
      MultipartUpload: { Parts: [...parts].sort((a, b) => a.partNumber - b.partNumber).map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
    }));
  }

  async abortMultipart(key: string, uploadId: string): Promise<void> {
    await this.s3.send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId })).catch(() => undefined);
  }

  /** Kısa ömürlü imzalı GET URL'si. */
  signGet(key: string, expiresIn = 3600, downloadName?: string): Promise<string> {
    return getSignedUrl(
      this.signer,
      new GetObjectCommand({ Bucket: this.bucket, Key: key, ResponseContentDisposition: downloadName ? `attachment; filename="${downloadName}"` : undefined }),
      { expiresIn },
    );
  }
  async signGetOrNull(key: string | null | undefined, expiresIn = 3600): Promise<string | null> {
    return key ? this.signGet(key, expiresIn) : null;
  }

  signPut(key: string, contentType: string, expiresIn = 900): Promise<string> {
    return getSignedUrl(this.signer, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }), { expiresIn });
  }

  async putJson(key: string, body: unknown): Promise<void> {
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: JSON.stringify(body), ContentType: 'application/json' }));
  }

  async head(key: string): Promise<{ size: number } | null> {
    try {
      const r = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: r.ContentLength ?? 0 };
    } catch {
      return null;
    }
  }

  /** Bayt aralığı akışı (YouTube'a parça parça yükleme için). */
  async getRange(key: string, start: number, endInclusive: number): Promise<Buffer> {
    const r = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=${start}-${endInclusive}` }));
    const chunks: Buffer[] = [];
    for await (const c of r.Body as Readable) chunks.push(c as Buffer);
    return Buffer.concat(chunks);
  }

  async deletePrefix(prefix: string): Promise<number> {
    let token: string | undefined;
    let n = 0;
    do {
      const r = await this.s3.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }));
      const keys = (r.Contents ?? []).map((o) => ({ Key: o.Key! }));
      if (keys.length) {
        await this.s3.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys, Quiet: true } }));
        n += keys.length;
      }
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    return n;
  }
}
