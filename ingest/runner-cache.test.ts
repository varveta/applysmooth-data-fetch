import { it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "./lib/store";
import { saveCheckpoint } from "./lib/checkpoint";
import { restoreRunnerCache, saveRunnerCache } from "./lib/runner-cache";

it("restores encrypted state only against the authoritative manifest and key", async () => {
  const dir = mkdtempSync(join(tmpdir(), "encrypted-cache-"));
  try {
    const dbPath = join(dir, "source.sqlite"),
      cache = join(dir, "runner-cache.bin");
    const key = randomBytes(32).toString("base64"),
      db = openStore(dbPath);
    db.prepare("insert into runs(kind,started_at,args) values(?,?,?)").run(
      "private-sentinel",
      new Date().toISOString(),
      "{}",
    );
    db.close();
    const manifest = await saveCheckpoint(dbPath, 0, {
      get: async () => new Uint8Array(),
      put: async () => {},
      commit: async () => {},
    });
    expect(
      restoreRunnerCache(cache, join(dir, "missing.sqlite"), manifest, key),
    ).toBe(false);
    saveRunnerCache(dbPath, cache, manifest, key);
    const encrypted = readFileSync(cache);
    expect(encrypted.includes(Buffer.from("private-sentinel"))).toBe(false);
    expect(encrypted.includes(Buffer.from("SQLite format 3"))).toBe(false);
    expect(
      restoreRunnerCache(cache, join(dir, "restored.sqlite"), manifest, key),
    ).toBe(true);
    expect(readFileSync(join(dir, "restored.sqlite"))).toEqual(
      readFileSync(dbPath),
    );
    expect(() =>
      restoreRunnerCache(cache, join(dir, "restored.sqlite"), manifest, key),
    ).toThrow("overwrite");
    expect(
      restoreRunnerCache(
        cache,
        join(dir, "wrong-key.sqlite"),
        manifest,
        randomBytes(32).toString("base64"),
      ),
    ).toBe(false);
    expect(
      restoreRunnerCache(
        cache,
        join(dir, "stale.sqlite"),
        { ...manifest, rawHash: "0".repeat(64) },
        key,
      ),
    ).toBe(false);
    encrypted[encrypted.length - 1] ^= 1;
    writeFileSync(cache, encrypted);
    expect(
      restoreRunnerCache(cache, join(dir, "corrupt.sqlite"), manifest, key),
    ).toBe(false);
    expect(existsSync(join(dir, "corrupt.sqlite"))).toBe(false);
    expect(() =>
      saveRunnerCache(
        dbPath,
        cache,
        { ...manifest, rawHash: "0".repeat(64) },
        key,
      ),
    ).toThrow("committed checkpoint");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
