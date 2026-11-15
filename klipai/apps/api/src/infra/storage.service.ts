// Yol: klipai/apps/api/src/infra/storage.service.ts
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { AppConfig } from '../config/app-config';

export interface UploadedPart {
  partNumber: number;
  etag: string;
  size: number;
}

/** S3 uyumlu depolama. Kova özeldir; istemci yalnızca kısa ömürlü imzalı adres görür. */
@Injectable()
export class StorageService {
  private readonly s3: S3Client;
  /** İmzalı adresler telefonun erişebildiği uç ile üretilir. */
  private readonly signer: S3Client;
  private readonly bucket: string;

  constructor(config: AppConfig) {
    const base = {
      region: config.s3.region,
      forcePathStyle: config.s3.forcePathStyle,
      credentials: {
        accessKeyId: config.s3.accessKeyId,
        secretAccessKey: config.s3.secretAccessKey,
      },
      // İmzalı PUT adreslerine sağlama toplamı parametresi eklenmesin (istemci gönderemez).
      requestChecksumCalculation: 'WHEN_REQUIRED' as const,
      responseChecksumValidation: 'WHEN_REQUIRED' as const,
    };
    this.s3 = new S3Client({ ...base, endpoint: config.s3.endpoint });
    this.signer = new S3Client({
      ...base,
      endpoint: config.s3.publicEndpoint ?? config.s3.endpoint,
    });
    this.bucket = config.s3.bucket;
  }

  async createMultipart(key: string, contentType: string): Promise<string> {
    const out = await this.s3.send(
      new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
    );
    if (!out.UploadId) throw new Error('Depolama UploadId döndürmedi');
    return out.UploadId;
  }

  presignPart(key: string, uploadId: string, partNumber: number, ttlSec = 1800): Promise<string> {
    return getSignedUrl(
      this.signer,
      new UploadPartCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, PartNumber: partNumber }),
      { expiresIn: ttlSec },
    );
  }

  async listParts(key: string, uploadId: string): Promise<UploadedPart[]> {
    const parts: UploadedPart[] = [];
    let marker: string | undefined;
    do {
      const out = await this.s3.send(
        new ListPartsCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, PartNumberMarker: marker }),
      );
      for (const part of out.Parts ?? []) {
        parts.push({ partNumber: part.PartNumber!, etag: part.ETag!, size: part.Size ?? 0 });
      }
      marker = out.IsTruncated ? out.NextPartNumberMarker : undefined;
    } while (marker);
    return parts;
  }

  async completeMultipart(
    key: string,
    uploadId: string,
    parts: { partNumber: number; etag: string }[],
  ): Promise<void> {
    await this.s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: [...parts]
            .sort((a, b) => a.partNumber - b.partNumber)
            .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
        },
      }),
    );
  }

  async abortMultipart(key: string, uploadId: string): Promise<void> {
    try {
      await this.s3.send(
        new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }),
      );
    } catch (error) {
      if ((error as { name?: string }).name !== 'NoSuchUpload') throw error;
    }
  }

  /** Nesne yoksa null döner. */
  async head(key: string): Promise<{ size: number; contentType?: string } | null> {
    try {
      const out = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: out.ContentLength ?? 0, contentType: out.ContentType };
    } catch (error) {
      const name = (error as { name?: string }).name;
      if (name === 'NotFound' || name === 'NoSuchKey') return null;
      throw error;
    }
  }

  presignGet(key: string, ttlSec = 600): Promise<string> {
    return getSignedUrl(this.signer, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: ttlSec,
    });
  }

  presignPut(key: string, contentType: string, ttlSec = 900): Promise<string> {
    return getSignedUrl(
      this.signer,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn: ttlSec },
    );
  }

  async putJson(key: string, value: unknown): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: JSON.stringify(value),
        ContentType: 'application/json',
      }),
    );
  }

  async getJson<T = unknown>(key: string): Promise<T> {
    const out = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!out.Body) throw new Error(`Nesne gövdesi boş: ${key}`);
    return JSON.parse(await out.Body.transformToString('utf-8')) as T;
  }

  /** Önek altındaki tüm nesneleri siler; silinen nesne sayısını döner. */
  async deletePrefix(prefix: string): Promise<number> {
    if (!prefix.endsWith('/')) throw new Error('Önek "/" ile bitmeli');
    let deleted = 0;
    let token: string | undefined;
    do {
      const list = await this.s3.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      const keys = (list.Contents ?? []).map((o) => ({ Key: o.Key! }));
      if (keys.length) {
        await this.s3.send(
          new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys, Quiet: true } }),
        );
        deleted += keys.length;
      }
      token = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (token);
    return deleted;
  }
}
