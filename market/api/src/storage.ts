/**
 * Where photos live. The client always uploads directly to `uploadUrl` with a
 * PUT, so the API never proxies image bytes. Two drivers:
 *
 * - s3:    any S3-compatible bucket (AWS S3, Cloudflare R2, Railway buckets).
 *          A presigned PUT, and a public base URL for reads.
 * - local: a directory on the API host, for development and for a single
 *          Railway service with a volume. The API signs its own upload URLs.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Config } from "./env.js";
import { newId } from "./ids.js";
import type { PresignResponse } from "../../shared/types.js";

export interface Storage {
  /** Only keys under this prefix belong to `userId`; the API refuses anything else. */
  keyFor(userId: string, contentType: string): string;
  publicUrl(key: string): string;
  presign(key: string, contentType: string): Promise<PresignResponse>;
  delete(key: string): Promise<void>;
  /** The local driver serves and accepts uploads itself; s3 has no routes. */
  local?: LocalHandlers;
}

export interface LocalHandlers {
  verify(key: string, expires: string, signature: string): boolean;
  write(key: string, body: Uint8Array): Promise<void>;
  read(key: string): Promise<{ body: Buffer; contentType: string } | null>;
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const TYPE_BY_EXT: Record<string, string> = Object.fromEntries(
  Object.entries(EXT).map(([type, ext]) => [ext, type]),
);

const KEY_PATTERN =
  /^[a-z0-9-]+\/[A-Za-z0-9_-]+\/[0-9a-z]{16}\.(jpg|png|webp)$/;

/** True when `key` is one this API would have issued to `userId`. */
export function keyBelongsTo(
  key: string,
  prefix: string,
  userId: string,
): boolean {
  return KEY_PATTERN.test(key) && key.startsWith(`${prefix}/${userId}/`);
}

function makeKey(prefix: string, userId: string, contentType: string): string {
  const ext = EXT[contentType];
  if (!ext) throw new Error(`Unsupported content type ${contentType}`);
  return `${prefix}/${userId}/${newId()}.${ext}`;
}

export function s3Storage(config: Config["storage"]): Storage {
  const { bucket, region, endpoint, publicBaseUrl, forcePathStyle } = config.s3;
  if (!bucket) throw new Error("MARKET_S3_BUCKET is required for s3 storage");
  const client = new S3Client({
    region,
    endpoint: endpoint ?? undefined,
    forcePathStyle,
  });
  const base =
    publicBaseUrl ??
    (endpoint
      ? `${endpoint.replace(/\/$/, "")}/${bucket}`
      : `https://${bucket}.s3.${region}.amazonaws.com`);
  return {
    keyFor: (userId, contentType) =>
      makeKey(config.prefix, userId, contentType),
    publicUrl: (key) => `${base}/${key}`,
    async presign(key, contentType) {
      const uploadUrl = await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          ContentType: contentType,
        }),
        { expiresIn: 300 },
      );
      return {
        key,
        uploadUrl,
        method: "PUT",
        headers: { "Content-Type": contentType },
        publicUrl: `${base}/${key}`,
      };
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

export function localStorage(
  config: Config["storage"],
  publicUrl: string,
): Storage {
  const root = resolve(config.local.dir);
  const secret = config.local.secret || randomBytes(32).toString("hex");
  const sign = (key: string, expires: string) =>
    createHmac("sha256", secret).update(`${key}\n${expires}`).digest("hex");
  const pathFor = (key: string) => {
    const full = resolve(root, key);
    if (!full.startsWith(root + sep))
      throw new Error("Key escapes the upload directory");
    return full;
  };
  const url = (key: string) => `${publicUrl}/api/market/uploads/${key}`;
  return {
    keyFor: (userId, contentType) =>
      makeKey(config.prefix, userId, contentType),
    publicUrl: url,
    async presign(key, contentType) {
      const expires = String(Date.now() + 5 * 60 * 1000);
      const query = new URLSearchParams({
        expires,
        signature: sign(key, expires),
      });
      return {
        key,
        uploadUrl: `${url(key)}?${query}`,
        method: "PUT",
        headers: { "Content-Type": contentType },
        publicUrl: url(key),
      };
    },
    async delete(key) {
      await rm(pathFor(key), { force: true });
    },
    local: {
      verify(key, expires, signature) {
        if (!KEY_PATTERN.test(key)) return false;
        if (!/^\d+$/.test(expires) || Number(expires) < Date.now())
          return false;
        const expected = Buffer.from(sign(key, expires));
        const given = Buffer.from(signature);
        return (
          expected.length === given.length && timingSafeEqual(expected, given)
        );
      },
      async write(key, body) {
        const path = pathFor(key);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, body);
      },
      async read(key) {
        if (!KEY_PATTERN.test(key)) return null;
        const path = pathFor(key);
        try {
          const info = await stat(path);
          if (!info.isFile()) return null;
          const ext = key.slice(key.lastIndexOf(".") + 1);
          return {
            body: await readFile(path),
            contentType: TYPE_BY_EXT[ext] ?? "application/octet-stream",
          };
        } catch {
          return null;
        }
      },
    },
  };
}
