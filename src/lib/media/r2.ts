import "server-only";
import { AwsClient } from "aws4fetch";
import {
  completeMultipartXml,
  objectUrl,
  parseListParts,
  parseUploadId,
  type StoredPart,
} from "./r2-core";

// Server-only access to the private R2 bucket. The keys come from the server
// environment (never NEXT_PUBLIC_) and are never sent to the browser, logged,
// or returned. The browser only ever receives short-lived signed links for
// one object and one operation.

function readConfig() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return {
    accountId,
    bucket,
    client: new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" }),
  };
}

export function isR2Configured() {
  return readConfig() !== null;
}

function required() {
  const config = readConfig();
  if (!config) throw new Error("R2 is not configured.");
  return config;
}

function url(key: string, query: Record<string, string> = {}) {
  const { accountId, bucket } = required();
  const u = new URL(objectUrl(accountId, bucket, key));
  for (const [name, value] of Object.entries(query)) u.searchParams.set(name, value);
  return u;
}

async function send(method: string, target: URL, init: { headers?: HeadersInit; body?: string } = {}) {
  const { client } = required();
  return client.fetch(target.toString(), { method, ...init });
}

// A link that allows exactly one operation on one object until it expires.
async function presign(
  method: "GET" | "PUT",
  key: string,
  seconds: number,
  query: Record<string, string> = {},
  headers?: Record<string, string>,
) {
  const { client } = required();
  const target = url(key, { ...query, "X-Amz-Expires": String(seconds) });
  const signed = await client.sign(target.toString(), {
    method,
    headers,
    // allHeaders: also sign content-type, which aws4fetch skips by default.
    aws: { signQuery: true, allHeaders: true },
  });
  return signed.url;
}

// Single upload: the browser must send this exact Content-Type.
export function presignPut(key: string, contentType: string, seconds: number) {
  return presign("PUT", key, seconds, {}, { "content-type": contentType });
}

export function presignPart(key: string, uploadId: string, partNumber: number, seconds: number) {
  return presign("PUT", key, seconds, { partNumber: String(partNumber), uploadId });
}

export function presignGet(key: string, seconds: number, contentType: string) {
  return presign("GET", key, seconds, {
    "response-content-type": contentType,
    "response-content-disposition": "inline",
    "response-cache-control": "private, max-age=300",
  });
}

export async function createMultipartUpload(key: string, contentType: string) {
  const response = await send("POST", url(key, { uploads: "" }), {
    headers: { "content-type": contentType },
  });
  if (!response.ok) throw new Error(`R2 refused to start the upload (${response.status}).`);
  const id = parseUploadId(await response.text());
  if (!id) throw new Error("R2 did not return an upload id.");
  return id;
}

export async function listParts(key: string, uploadId: string): Promise<StoredPart[] | null> {
  const parts: StoredPart[] = [];
  let marker: number | null = null;
  for (let page = 0; page < 20; page++) {
    const query: Record<string, string> = { uploadId, "max-parts": "1000" };
    if (marker !== null) query["part-number-marker"] = String(marker);
    const response = await send("GET", url(key, query));
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`R2 refused to list the upload (${response.status}).`);
    const result = parseListParts(await response.text());
    parts.push(...result.parts);
    if (!result.truncated || result.nextMarker === null) break;
    marker = result.nextMarker;
  }
  return parts;
}

export async function completeMultipartUpload(key: string, uploadId: string, parts: StoredPart[]) {
  const response = await send("POST", url(key, { uploadId }), {
    headers: { "content-type": "application/xml" },
    body: completeMultipartXml(parts),
  });
  const text = await response.text();
  // R2 can report an error inside a 200 response.
  if (!response.ok || text.includes("<Error>")) {
    throw new Error(`R2 refused to finish the upload (${response.status}).`);
  }
}

export async function abortMultipartUpload(key: string, uploadId: string) {
  const response = await send("DELETE", url(key, { uploadId }));
  if (!response.ok && response.status !== 404) {
    throw new Error(`R2 refused to cancel the upload (${response.status}).`);
  }
}

export async function headObject(key: string) {
  const response = await send("HEAD", url(key));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`R2 refused to check the file (${response.status}).`);
  const length = response.headers.get("content-length");
  return {
    size: length === null ? null : Number(length),
    contentType: response.headers.get("content-type"),
  };
}

export async function deleteObject(key: string) {
  const response = await send("DELETE", url(key));
  if (!response.ok && response.status !== 404) {
    throw new Error(`R2 refused to delete the file (${response.status}).`);
  }
}
