/**
 * Tests for the one-time data-dir migration (legacy
 * <agentdir>/extensions/pi-hindsight → <agentdir>/epimetheus) and that
 * production path helpers resolve under the new location.
 *
 * Exercises the real migrateDataDir() against a temp agent dir.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../src/config";
import { getDataDir } from "../src/data-dir";
import { getLegacyDataDir, MIGRATION_MARKER, migrateDataDir } from "../src/data-dir-migration";
import { getParsedSessionDir } from "../src/parsed-store";
import { getQueueDir } from "../src/queue-paths";
import { getSessionStatePath } from "../src/session-state";
import { HINDSIGHT_ENV_KEYS, saveEnvKeys, setupTempAgentDir } from "./fixtures";

setupTempAgentDir("migration");

const OLD = () => getLegacyDataDir();
const NEW = () => getDataDir();

/** Recreate the temp agent dir's legacy + new dirs from scratch for each test. */
beforeEach(() => {
  rmSync(OLD(), { recursive: true, force: true });
  rmSync(NEW(), { recursive: true, force: true });
});

afterEach(() => {
  rmSync(OLD(), { recursive: true, force: true });
  rmSync(NEW(), { recursive: true, force: true });
});

describe("data-dir path helpers", () => {
  it("getDataDir resolves under <agentdir>/epimetheus", () => {
    expect(getDataDir().endsWith(join("epimetheus"))).toBe(true);
  });

  it("getLegacyDataDir resolves under the old extensions/pi-hindsight layout", () => {
    expect(getLegacyDataDir().endsWith(join("extensions", "pi-hindsight"))).toBe(true);
  });

  it("production data paths resolve under the new epimetheus dir", () => {
    expect(getQueueDir().startsWith(getDataDir())).toBe(true);
    expect(getQueueDir().endsWith(join("epimetheus", "queue"))).toBe(true);
    expect(getParsedSessionDir().startsWith(getDataDir())).toBe(true);
    expect(getSessionStatePath("s1").startsWith(getDataDir())).toBe(true);
  });
});

describe("migrateDataDir", () => {
  it("is a no-op when the legacy dir does not exist", () => {
    const result = migrateDataDir();
    expect(result.action).toBe("skipped");
    expect(existsSync(NEW())).toBe(false);
  });

  it("is a no-op when the legacy dir has only empty data subdirs (no config, no data)", () => {
    // Empty subdirs alone are not meaningful contents.
    mkdirSync(join(OLD(), "queue"), { recursive: true });
    mkdirSync(join(OLD(), "parsed-sessions"), { recursive: true });
    mkdirSync(join(OLD(), "session-state"), { recursive: true });

    const result = migrateDataDir();
    expect(result.action).toBe("skipped");
    expect(existsSync(NEW())).toBe(false);
  });

  it("copies legacy config.json to the new dir and writes the migration marker", () => {
    mkdirSync(OLD(), { recursive: true });
    writeFileSync(join(OLD(), "config.json"), JSON.stringify({ apiUrl: "https://x" }));

    const result = migrateDataDir();
    expect(result.action).toBe("copied");

    // New dir has the copied config + marker.
    expect(existsSync(join(NEW(), "config.json"))).toBe(true);
    expect(existsSync(join(NEW(), MIGRATION_MARKER))).toBe(true);
    // Legacy dir is left in place (non-destructive).
    expect(existsSync(join(OLD(), "config.json"))).toBe(true);
  });

  it("copies non-empty data subdirs (queue with a session) and config together", () => {
    mkdirSync(join(OLD(), "queue", "session-1", "pending"), { recursive: true });
    writeFileSync(join(OLD(), "queue", "session-1", "pending", "marker.json"), "{}");
    writeFileSync(join(OLD(), "config.jsonc"), JSON.stringify({}));

    const result = migrateDataDir();
    expect(result.action).toBe("copied");

    expect(existsSync(join(NEW(), "config.jsonc"))).toBe(true);
    expect(existsSync(join(NEW(), "queue", "session-1", "pending", "marker.json"))).toBe(true);
    expect(existsSync(join(NEW(), MIGRATION_MARKER))).toBe(true);
  });

  it("triggers migration from a non-empty session-state subdir even without a config file", () => {
    mkdirSync(join(OLD(), "session-state"), { recursive: true });
    writeFileSync(join(OLD(), "session-state", "s1.json"), "{}");

    const result = migrateDataDir();
    expect(result.action).toBe("copied");
    expect(existsSync(join(NEW(), "session-state", "s1.json"))).toBe(true);
    expect(existsSync(join(NEW(), MIGRATION_MARKER))).toBe(true);
  });

  it("is a silent no-op when the new dir already has the migration marker", () => {
    // First migration: copies config + writes marker.
    mkdirSync(OLD(), { recursive: true });
    writeFileSync(join(OLD(), "config.json"), JSON.stringify({ apiUrl: "https://x" }));
    expect(migrateDataDir().action).toBe("copied");
    expect(existsSync(join(NEW(), MIGRATION_MARKER))).toBe(true);

    // Mutate the copied config so we can detect a re-copy would overwrite it.
    writeFileSync(join(NEW(), "config.json"), JSON.stringify({ apiUrl: "https://changed" }));

    // Second call should be a silent skip (marker present), not a re-copy.
    const result = migrateDataDir();
    expect(result.action).toBe("skipped");
    // New dir config was NOT overwritten by a re-copy.
    expect(JSON.parse(readFileSync(join(NEW(), "config.json"), "utf-8")).apiUrl).toBe(
      "https://changed"
    );
    // Legacy still present and untouched.
    expect(existsSync(join(OLD(), "config.json"))).toBe(true);
  });

  it("warns and does not auto-merge when the new dir has meaningful contents but no marker", () => {
    mkdirSync(OLD(), { recursive: true });
    writeFileSync(join(OLD(), "config.json"), JSON.stringify({ apiUrl: "https://legacy" }));

    // New dir already has its own config (meaningful) and no marker.
    mkdirSync(NEW(), { recursive: true });
    writeFileSync(join(NEW(), "config.json"), JSON.stringify({ apiUrl: "https://existing" }));

    const result = migrateDataDir();
    expect(result.action).toBe("warned");
    expect(result.message).toBeDefined();
    expect(result.message).toContain("Not auto-merging");

    // Neither dir was modified.
    expect(JSON.parse(readFileSync(join(NEW(), "config.json"), "utf-8")).apiUrl).toBe(
      "https://existing"
    );
    expect(JSON.parse(readFileSync(join(OLD(), "config.json"), "utf-8")).apiUrl).toBe(
      "https://legacy"
    );
    expect(existsSync(join(NEW(), MIGRATION_MARKER))).toBe(false);
  });

  it("warns and does not copy when the new dir has an unrecognized user file (no marker)", () => {
    // Regression: a narrow new-dir check that only inspects known data dirs
    // would miss an unknown file and let cpSync(force:true) overwrite it.
    mkdirSync(OLD(), { recursive: true });
    writeFileSync(join(OLD(), "config.json"), JSON.stringify({ apiUrl: "https://legacy" }));

    // New dir has an unrecognized user file (not a known data dir, not config,
    // and no marker) — must be treated as unsafe and block the copy.
    mkdirSync(NEW(), { recursive: true });
    writeFileSync(join(NEW(), "my-notes.txt"), "important");

    const result = migrateDataDir();
    expect(result.action).toBe("warned");
    expect(result.message).toContain("Not auto-merging");
    // The unknown file was left untouched (no copy, no marker written).
    expect(readFileSync(join(NEW(), "my-notes.txt"), "utf-8")).toBe("important");
    expect(existsSync(join(NEW(), MIGRATION_MARKER))).toBe(false);
    // Legacy dir untouched.
    expect(existsSync(join(OLD(), "config.json"))).toBe(true);
  });

  it("does not trigger migration from unknown files in the legacy dir alone (new dir absent)", () => {
    // Unknown files in the OLD dir alone do not count as migratable contents.
    mkdirSync(OLD(), { recursive: true });
    writeFileSync(join(OLD(), "junk.txt"), "x");
    // No config, no known data subdirs → not migratable.

    const result = migrateDataDir();
    expect(result.action).toBe("skipped");
    // New dir was not created (no copy happened).
    expect(existsSync(NEW())).toBe(false);
  });

  it("skips silently when the new dir has the marker plus other contents (marker is authoritative)", () => {
    // The marker is the authoritative "already migrated" signal: even if the
    // new dir also holds an unknown user file, migration is a silent skip and
    // never copies/overwrites anything.
    mkdirSync(OLD(), { recursive: true });
    writeFileSync(join(OLD(), "config.json"), JSON.stringify({ apiUrl: "https://legacy" }));

    mkdirSync(NEW(), { recursive: true });
    writeFileSync(join(NEW(), MIGRATION_MARKER), "{}");
    writeFileSync(join(NEW(), "local.txt"), "keep-me");

    const result = migrateDataDir();
    expect(result.action).toBe("skipped");
    // The unknown file is untouched, and nothing was copied over it.
    expect(readFileSync(join(NEW(), "local.txt"), "utf-8")).toBe("keep-me");
    expect(existsSync(join(NEW(), "config.json"))).toBe(false);
  });

  // The next two tests exercise the readdir-failure catch branches in
  // hasLegacyMigratableContents / isUnsafeToCopyInto. A `chmod 000` would be the
  // literal "unreadable listing" case but is unreliable under root (root
  // bypasses permission bits, common in container CI). Instead we force
  // readdirSync to throw via ENOTDIR (a known path that exists as a file, not a
  // directory) — this exercises the same catch branch deterministically on all
  // platforms, including root CI.
  it("treats a legacy known data path whose listing fails as migratable (not skipped)", () => {
    // `queue` exists but is not a readable directory → readdirSync throws
    // (ENOTDIR) → the catch treats it as migratable rather than silently
    // skipping possibly-migratable data. No config file is present, so this
    // only passes the migratable gate via the unreadable subdir branch.
    mkdirSync(OLD(), { recursive: true });
    writeFileSync(join(OLD(), "queue"), "not-a-dir");

    const result = migrateDataDir();
    // Migration was attempted (got past the "not migratable → skipped" gate).
    expect(result.action).not.toBe("skipped");
    expect(result.action).toBe("copied");
    // The unreadable path was copied through as-is, and the marker was written.
    expect(existsSync(join(NEW(), "queue"))).toBe(true);
    expect(existsSync(join(NEW(), MIGRATION_MARKER))).toBe(true);
  });

  it("warns and does not copy when the new dir listing is unreadable", () => {
    // The new dir path exists but is not a readable directory → readdirSync
    // throws (ENOTDIR) → isUnsafeToCopyInto returns true → migration warns and
    // does NOT copy into a dir it cannot inspect.
    mkdirSync(OLD(), { recursive: true });
    writeFileSync(join(OLD(), "config.json"), JSON.stringify({ apiUrl: "https://legacy" }));

    // New "dir" is actually a file → unreadable as a directory.
    writeFileSync(NEW(), "existing");

    const result = migrateDataDir();
    expect(result.action).toBe("warned");
    expect(result.message).toContain("Not auto-merging");
    // Nothing was copied over the existing entry, and no marker was written.
    expect(readFileSync(NEW(), "utf-8")).toBe("existing");
    expect(existsSync(join(NEW(), MIGRATION_MARKER))).toBe(false);
  });

  it("warns and removes a migration-created new dir when the marker write fails after copy", () => {
    // Copy succeeds and creates the new dir, but writing the marker fails.
    // Since migration created the new dir, the partial dir is removed so a
    // retry is clean (no populated-without-marker state left behind).
    mkdirSync(OLD(), { recursive: true });
    writeFileSync(join(OLD(), "config.json"), JSON.stringify({ apiUrl: "https://x" }));

    const result = migrateDataDir({
      writeMarker: () => {
        throw new Error("marker io");
      },
    });

    expect(result.action).toBe("warned");
    expect(result.message).toContain("failed to migrate");
    expect(result.message).toContain("marker io");
    // The new dir migration created was removed by the cleanup branch.
    expect(existsSync(NEW())).toBe(false);
    // Legacy dir is untouched.
    expect(existsSync(join(OLD(), "config.json"))).toBe(true);
  });

  it("warns but leaves a pre-existing new dir when the marker write fails after copy", () => {
    // The new dir pre-existed (empty) before migration. Copy fills it, then the
    // marker write fails. Because migration did NOT create the new dir, it is
    // left in place (the cleanup only removes dirs migration itself created).
    mkdirSync(OLD(), { recursive: true });
    writeFileSync(join(OLD(), "config.json"), JSON.stringify({ apiUrl: "https://x" }));
    mkdirSync(NEW(), { recursive: true });

    const result = migrateDataDir({
      writeMarker: () => {
        throw new Error("marker io");
      },
    });

    expect(result.action).toBe("warned");
    expect(result.message).toContain("failed to migrate");
    // Pre-existing new dir is left in place (with copied data, no marker).
    expect(existsSync(NEW())).toBe(true);
    expect(existsSync(join(NEW(), "config.json"))).toBe(true);
    expect(existsSync(join(NEW(), MIGRATION_MARKER))).toBe(false);
  });

  it("removes the partial new dir and warns when the copy fails after creating it", () => {
    mkdirSync(OLD(), { recursive: true });
    writeFileSync(join(OLD(), "config.json"), JSON.stringify({ apiUrl: "https://x" }));

    // Inject a failing copy that partially creates the new dir before throwing.
    const result = migrateDataDir({
      copyLegacy: (_src, dst) => {
        mkdirSync(dst, { recursive: true });
        writeFileSync(join(dst, "partial"), "x");
        throw new Error("copy exploded");
      },
    });

    expect(result.action).toBe("warned");
    expect(result.message).toContain("failed to migrate");
    expect(result.message).toContain("copy exploded");
    // The new dir we created was removed by the cleanup branch.
    expect(existsSync(NEW())).toBe(false);
    // Legacy dir is untouched.
    expect(existsSync(join(OLD(), "config.json"))).toBe(true);
  });

  it("leaves a pre-existing new dir in place when the copy fails (did not create it)", () => {
    mkdirSync(OLD(), { recursive: true });
    writeFileSync(join(OLD(), "config.json"), JSON.stringify({ apiUrl: "https://x" }));
    // New dir pre-exists but is empty (no meaningful contents, no marker).
    mkdirSync(NEW(), { recursive: true });

    const result = migrateDataDir({
      copyLegacy: () => {
        throw new Error("nope");
      },
    });

    expect(result.action).toBe("warned");
    // We did not create the new dir, so it is left in place.
    expect(existsSync(NEW())).toBe(true);
  });

  it("end-to-end: after migration, loadConfig reads config from the new dir", () => {
    // Proves the switch-readers invariant: migrateDataDir copies the legacy
    // config into <agentdir>/epimetheus, and production loadConfig() (which
    // resolves to the new dir) picks it up from there.
    const restoreEnv = saveEnvKeys(HINDSIGHT_ENV_KEYS);
    try {
      mkdirSync(OLD(), { recursive: true });
      writeFileSync(
        join(OLD(), "config.json"),
        JSON.stringify({ apiUrl: "https://migrated.example", apiKey: "k", bankId: "b" })
      );

      expect(migrateDataDir().action).toBe("copied");
      expect(existsSync(join(NEW(), "config.json"))).toBe(true);

      const { config, configPath } = loadConfig();
      expect(config.apiUrl).toBe("https://migrated.example");
      expect(config.apiKey).toBe("k");
      expect(config.bankId).toBe("b");
      // loadConfig resolved to the new (migrated) dir.
      expect(configPath).toBe(join(NEW(), "config.json"));
    } finally {
      restoreEnv();
    }
  });
});
