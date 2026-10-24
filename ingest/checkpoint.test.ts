import { it, expect } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "./lib/store";
import {
  saveCheckpoint,
  restoreCheckpoint,
  checkDatabase,
  type CheckpointStorage,
  type Manifest,
} from "./lib/checkpoint";

it("roundtrips state, detects corruption, rejects stale commits, and preserves pointer on failed upload", async () => {
  const dir = mkdtempSync(join(tmpdir(), "checkpoint-"));
  const path = join(dir, "jobs.sqlite");
  let pointer: Manifest | undefined;
  const objects = new Map<string, Uint8Array>();
  const storage: CheckpointStorage = {
    get: async (key) => {
      const b = objects.get(key);
      if (!b) throw Error("missing");
      return b;
    },
    put: async (key, b) => {
      objects.set(key, b);
    },
    commit: async (expected, m) => {
      if (expected !== (pointer?.generation ?? 0)) throw Error("stale");
      pointer = m;
    },
  };
  try {
    const db = openStore(path);
    db.close();
    const first = await saveCheckpoint(path, 0, storage);
    await restoreCheckpoint(join(dir, "restored.sqlite"), first, storage);
    checkDatabase(join(dir, "restored.sqlite"));
    await expect(saveCheckpoint(path, 0, storage)).rejects.toThrow("stale");
    await expect(
      saveCheckpoint(path, 1, {
        ...storage,
        put: async () => {
          throw Error("upload failed");
        },
      }),
    ).rejects.toThrow("upload failed");
    expect(pointer?.generation).toBe(1);
    objects.set(first.chunks[0].key, new Uint8Array([0]));
    await expect(
      restoreCheckpoint(join(dir, "corrupt.sqlite"), first, storage),
    ).rejects.toThrow("Corrupt");
    expect(existsSync(join(dir, "corrupt.sqlite"))).toBe(false);
    await expect(
      restoreCheckpoint(join(dir, "missing.sqlite"), null, storage),
    ).rejects.toThrow();
    expect(() => checkDatabase(join(dir, "absent.sqlite"))).toThrow(
      "Missing checkpoint",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
