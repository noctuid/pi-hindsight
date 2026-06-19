/**
 * One-time legacy data-dir migration.
 *
 * Earlier versions stored data under `<agentdir>/extensions/pi-hindsight`; the
 * current data dir is {@link getDataDir} (`<agentdir>/epimetheus`). This module
 * copies that legacy layout into the new location on first launch so existing
 * data is not lost. The modern data-dir path helpers live in `src/data-dir.ts`;
 * only migration-only logic lives here.
 *
 * Migration semantics (copy, non-destructive — the legacy dir is never removed):
 * - Trigger only when the *legacy* dir has recognized migratable contents: a
 *   `config.json`/`config.jsonc` OR a non-empty `queue/`, `parsed-sessions/`,
 *   or `session-state/`. Required config keys are NOT inspected. Unknown files
 *   in the legacy dir alone do NOT trigger migration. A known legacy subdir
 *   that exists but is unreadable is treated as migratable (do not silently
 *   skip possibly-migratable data).
 * - Copy only when the *new* dir is absent or empty (no top-level entry other
 *   than the `.migration.json` marker). The new-dir check is deliberately
 *   stricter than the legacy check: `cpSync(force: true)` would overwrite any
 *   unrecognized user file, so ANY non-marker top-level entry — known data or
 *   an unknown file — is treated as unsafe and blocks the copy with a warning.
 *   An unreadable new dir/listing is also treated as unsafe (warn) rather than
 *   risk copying into a dir we cannot inspect.
 * - If the new dir already has the `.migration.json` marker, migration is a
 *   silent no-op (already migrated) — no repeated warnings.
 * - On success, write `.migration.json` recording `copiedFrom`/`oldPath`/
 *   `migratedAt`.
 * - If the copy fails partway and this migration created the new dir, the
 *   partial new dir is removed before warning.
 *
 * Run very early — before config load and before any new-dir creation — so the
 * config and data the rest of the extension reads/writes already lives in the
 * new location.
 */

import { cpSync, existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { LOG_PREFIX } from "./constants";
import { getDataDir } from "./data-dir";

/** Marker file written into the new data dir after a successful migration. */
export const MIGRATION_MARKER = ".migration.json";

/** Data subdirectories that count as "meaningful contents" when non-empty. */
const DATA_SUBDIRS = ["queue", "parsed-sessions", "session-state"] as const;

/**
 * Legacy data directory: `<agentdir>/extensions/pi-hindsight`.
 * Used only as the migration source.
 */
export function getLegacyDataDir(): string {
  return join(getAgentDir(), "extensions", "pi-hindsight");
}

/**
 * Whether the *legacy* data dir has recognized contents worth migrating: a
 * config file (`config.json`/`config.jsonc`) OR a non-empty `queue/`,
 * `parsed-sessions/`, or `session-state/` subdirectory. Required config keys
 * are NOT inspected. Unknown files in the legacy dir alone do NOT count — only
 * recognized migratable data triggers migration.
 *
 * A known subdir that exists but cannot be read is treated as meaningful
 * (migratable) so possible data is not silently skipped.
 */
function hasLegacyMigratableContents(dir: string): boolean {
  if (!existsSync(dir)) return false;
  if (existsSync(join(dir, "config.json")) || existsSync(join(dir, "config.jsonc"))) {
    return true;
  }
  for (const sub of DATA_SUBDIRS) {
    const subDir = join(dir, sub);
    if (existsSync(subDir)) {
      try {
        if (readdirSync(subDir, { withFileTypes: true }).length > 0) return true;
      } catch {
        // Unreadable known subdir: treat as migratable rather than silently
        // skipping possibly-migratable data.
        return true;
      }
    }
  }
  return false;
}

/**
 * Whether the *new* data dir is unsafe to copy into: the dir exists and holds
 * ANY top-level entry other than the {@link MIGRATION_MARKER}. Stricter than
 * {@link hasLegacyMigratableContents} because `cpSync(force: true)` would
 * overwrite unrecognized user files — so any non-marker entry (known data OR
 * an unknown file) blocks the copy. An absent or empty new dir is safe. An
 * unreadable new dir/listing is treated as unsafe (warn) rather than risk
 * copying into a dir we cannot inspect.
 */
function isUnsafeToCopyInto(dir: string): boolean {
  if (!existsSync(dir)) return false;
  try {
    return readdirSync(dir, { withFileTypes: true }).some(
      (entry) => entry.name !== MIGRATION_MARKER
    );
  } catch {
    // Cannot inspect the new dir → unsafe; warn rather than risk overwriting.
    return true;
  }
}

/**
 * Recursive copy used by {@link migrateDataDir} when no override is supplied.
 * Extracted as a named default so the `copyLegacy` option can default to it
 * via destructuring rather than an inline `??` fallback.
 */
function copyDataDir(src: string, dst: string): void {
  cpSync(src, dst, { recursive: true, force: true });
}

/**
 * Marker-file writer used by {@link migrateDataDir} when no override is
 * supplied. Extracted as a named default so the `writeMarker` option can
 * default to it via destructuring.
 */
function writeMarkerFile(path: string, contents: string): void {
  writeFileSync(path, contents, "utf-8");
}

/** Result of {@link migrateDataDir}. */
export interface MigrationResult {
  /** `copied` = legacy data copied to the new dir; `skipped` = nothing to do; `warned` = a conflict/failure the user should know about. */
  action: "copied" | "skipped" | "warned";
  /** Human-readable detail (always set when `action === "warned"`). */
  message?: string;
}

/**
 * Perform the one-time legacy → new data-dir copy. Safe to call on every
 * startup: it is a silent no-op once the new dir has the `.migration.json`
 * marker, and only copies when the legacy dir has meaningful contents and the
 * new dir is absent or empty without a marker. Never throws — copy failures are
 * reported via the returned `warned` action.
 *
 * @param options.copyLegacy - Test-only seam that overrides the recursive
 *   copy step (defaults to {@link copyDataDir}). Used to exercise the
 *   partial-failure cleanup branch deterministically.
 * @param options.writeMarker - Test-only seam that overrides the marker-file
 *   write step (defaults to {@link writeMarkerFile}). Used to exercise the
 *   marker-write-failure cleanup branch deterministically.
 */
export function migrateDataDir({
  copyLegacy = copyDataDir,
  writeMarker = writeMarkerFile,
}: {
  copyLegacy?: (src: string, dst: string) => void;
  writeMarker?: (path: string, contents: string) => void;
} = {}): MigrationResult {
  const oldDir = getLegacyDataDir();
  const newDir = getDataDir();
  const newMarkerPath = join(newDir, MIGRATION_MARKER);

  // Nothing to migrate if the legacy dir has no recognized migratable contents
  // (unknown files in the legacy dir alone do NOT trigger migration).
  if (!hasLegacyMigratableContents(oldDir)) {
    return { action: "skipped" };
  }

  // Already migrated: marker present in the new dir — stay silent so we don't
  // warn repeatedly about the legacy dir still existing. The marker is the
  // authoritative "already done" signal; we never copy when it is present, so
  // there is no risk of overwriting any (even unknown) new-dir contents.
  if (existsSync(newMarkerPath)) {
    return { action: "skipped" };
  }

  // New dir already has ANY top-level entry other than the marker (known data
  // OR an unrecognized user file), but no marker → do not copy/merge. cpSync
  // with force:true would overwrite unrecognized user files; surface a warning
  // with manual instructions instead. An unreadable new dir also warns here.
  if (isUnsafeToCopyInto(newDir)) {
    return {
      action: "warned",
      message:
        `${LOG_PREFIX}found legacy data dir (${oldDir}) with migratable contents, ` +
        `but the new data dir (${newDir}) already has contents. Not auto-merging ` +
        `to avoid overwriting unrecognized files. Back up and merge manually, or ` +
        `remove the dir you do not want. To stop seeing this, either remove the ` +
        `legacy dir or place a ${MIGRATION_MARKER} marker in the new dir.`,
    };
  }

  // Legacy has migratable data, new dir is absent/empty (no marker) → copy.
  const createdNewDir = !existsSync(newDir);
  try {
    copyLegacy(oldDir, newDir);
    writeMarker(
      newMarkerPath,
      `${JSON.stringify(
        {
          copiedFrom: "extensions/pi-hindsight",
          oldPath: oldDir,
          migratedAt: new Date().toISOString(),
        },
        null,
        2
      )}\n`
    );
    return { action: "copied" };
  } catch (e) {
    // Remove the partial new dir only if this migration created it; never touch
    // a pre-existing (even if empty) dir other than what we wrote into it.
    if (createdNewDir) {
      try {
        rmSync(newDir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup; the warning below still reports the failure.
      }
    }
    const reason = e instanceof Error ? e.message : String(e);
    return {
      action: "warned",
      message:
        `${LOG_PREFIX}failed to migrate data dir from ${oldDir} to ${newDir}: ${reason}. ` +
        `Continuing with the new (possibly empty) data dir. Legacy data is untouched at ` +
        `${oldDir}; see it for your queued/session state.`,
    };
  }
}
