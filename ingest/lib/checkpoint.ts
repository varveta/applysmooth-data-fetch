import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import {
  ManifestSchema,
  type Manifest,
} from "@/lib/jobs-collector/checkpoint-contract";
export {
  ManifestSchema,
  type Manifest,
} from "@/lib/jobs-collector/checkpoint-contract";

const digest = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
export interface CheckpointStorage {
  get(key: string): Promise<Uint8Array>;
  put(key: string, bytes: Uint8Array): Promise<void>;
  /** Must atomically compare generation and retain previous manifest for recovery. */
  commit(expectedGeneration: number, manifest: Manifest): Promise<void>;
}
export function checkDatabase(path: string) {
  if (!existsSync(path))
    throw new Error("Missing checkpoint; explicit operator bootstrap required");
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const integrity = db.prepare("pragma integrity_check").get();
    if (!integrity || Object.values(integrity)[0] !== "ok")
      throw new Error("Corrupt checkpoint");
    for (const table of [
      "postings",
      "publish_targets",
      "raw_payloads",
      "targets",
      "runs",
    ])
      db.prepare(`select count(*) from ${table}`).get();
  } finally {
    db.close();
  }
}
/** Caller must close SQLite first; never snapshot live WAL by copying its main file. */
export async function saveCheckpoint(
  path: string,
  generation: number,
  storage: CheckpointStorage,
) {
  checkDatabase(path);
  if (existsSync(`${path}-wal`) && readFileSync(`${path}-wal`).length)
    throw new Error("Checkpoint requires closed SQLite WAL");
  const raw = readFileSync(path);
  const compressed = gzipSync(raw);
  const chunks: Manifest["chunks"] = [];
  if (raw.length > 600_000_000 || compressed.length > 180_000_000)
    throw new Error("Archive storage budget exceeded");
  for (let offset = 0; offset < compressed.length; offset += 16_000_000) {
    const bytes = compressed.subarray(offset, offset + 16_000_000);
    const key = digest(bytes);
    await storage.put(key, bytes);
    chunks.push({ key, bytes: bytes.length });
  }
  const manifest = ManifestSchema.parse({
    version: 1,
    generation: generation + 1,
    rawHash: digest(raw),
    rawBytes: raw.length,
    chunks,
  });
  await storage.commit(generation, manifest);
  return manifest;
}
export async function restoreCheckpoint(
  path: string,
  input: unknown,
  storage: CheckpointStorage,
) {
  const manifest = ManifestSchema.parse(input);
  if (existsSync(path))
    throw new Error("Refusing to overwrite local checkpoint");
  const chunks = [];
  for (const chunk of manifest.chunks) {
    const bytes = await storage.get(chunk.key);
    if (bytes.length !== chunk.bytes || digest(bytes) !== chunk.key)
      throw new Error("Corrupt checkpoint chunk");
    chunks.push(bytes);
  }
  const raw = gunzipSync(Buffer.concat(chunks), {
    maxOutputLength: 600_000_000,
  });
  if (raw.length !== manifest.rawBytes || digest(raw) !== manifest.rawHash)
    throw new Error("Corrupt checkpoint archive");
  const temp = `${path}.restore`;
  writeFileSync(temp, raw, { flag: "wx", mode: 0o600 });
  checkDatabase(temp);
  renameSync(temp, path);
  return manifest;
}
