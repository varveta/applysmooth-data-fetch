import { CollectorError } from "./diagnostics";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { checkDatabase, ManifestSchema, type Manifest } from "./checkpoint";

const MAGIC = Buffer.from("ASENC001");
const MAX_CACHE_BYTES = 180_000_064;
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
function keyFrom(secret: string) {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(secret))
    throw new CollectorError("Invalid runner cache key");
  const key = Buffer.from(secret, "base64");
  if (key.length !== 32) throw new CollectorError("Invalid runner cache key");
  return key;
}
function context(manifest: Manifest) {
  return Buffer.from(
    `varveta/applysmooth-data-fetch:v1:${manifest.rawHash}:${manifest.rawBytes}`,
  );
}

/** Optional acceleration only. The private backend manifest remains authoritative. */
export function restoreRunnerCache(
  cachePath: string,
  databasePath: string,
  input: unknown,
  secret: string,
): boolean {
  const manifest = ManifestSchema.parse(input),
    key = keyFrom(secret);
  if (existsSync(databasePath))
    throw new CollectorError("Refusing to overwrite local checkpoint");
  if (!existsSync(cachePath)) return false;
  const temp = `${databasePath}.${randomBytes(8).toString("hex")}.restore`;
  try {
    if (statSync(cachePath).size > MAX_CACHE_BYTES) return false;
    const bytes = readFileSync(cachePath);
    if (bytes.length < 36 || !bytes.subarray(0, 8).equals(MAGIC)) return false;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      bytes.subarray(8, 20),
    );
    decipher.setAAD(context(manifest));
    decipher.setAuthTag(bytes.subarray(20, 36));
    const compressed = Buffer.concat([
      decipher.update(bytes.subarray(36)),
      decipher.final(),
    ]);
    const raw = gunzipSync(compressed, { maxOutputLength: 600_000_000 });
    if (raw.length !== manifest.rawBytes || hash(raw) !== manifest.rawHash)
      return false;
    writeFileSync(temp, raw, { flag: "wx", mode: 0o600 });
    checkDatabase(temp);
    renameSync(temp, databasePath);
    return true;
  } catch {
    // An unavailable, poisoned, rotated-key, or stale cache cannot replace durable history.
    return false;
  } finally {
    rmSync(temp, { force: true });
  }
}

/** Cache only a closed, already committed database. Never cache plaintext or credentials. */
export function saveRunnerCache(
  databasePath: string,
  cachePath: string,
  input: unknown,
  secret: string,
) {
  const manifest = ManifestSchema.parse(input),
    key = keyFrom(secret);
  if (existsSync(`${databasePath}-wal`) && statSync(`${databasePath}-wal`).size)
    throw new CollectorError("Runner cache requires closed SQLite");
  const raw = readFileSync(databasePath);
  if (raw.length !== manifest.rawBytes || hash(raw) !== manifest.rawHash)
    throw new CollectorError("Runner cache does not match committed checkpoint");
  const compressed = gzipSync(raw),
    nonce = randomBytes(12);
  if (compressed.length + 36 > MAX_CACHE_BYTES)
    throw new CollectorError("Runner cache budget exceeded");
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(context(manifest));
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const temp = `${cachePath}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    writeFileSync(
      temp,
      Buffer.concat([MAGIC, nonce, cipher.getAuthTag(), encrypted]),
      { flag: "wx", mode: 0o600 },
    );
    renameSync(temp, cachePath);
  } finally {
    rmSync(temp, { force: true });
  }
}
