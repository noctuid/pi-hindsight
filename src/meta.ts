/**
 * Hindsight session metadata management.
 *
 * Session metadata (retention state, tags) is stored as CustomEntry
 * entries in the session file with customType "hindsight-meta".
 * Since session files are append-only, each operation appends a new entry,
 * and the latest one is the current state.
 */

import type { HindsightConfig } from "./config";

/**
 * Session metadata stored in CustomEntry with customType "hindsight-meta".
 * All fields are optional - only the fields that have been set are present.
 */
export interface HindsightMeta {
  retained?: boolean;
  tags?: string[];
  /** Extra context appended to the Hindsight context field (after session name). Used to provide caveats/instructions for extraction, e.g. "This session involves reading a fiction book; characters are not the user and information is not factual." */
  extraContext?: string;
}

/**
 * Get the latest hindsight metadata from session entries.
 * Scans from newest to oldest for the most recent "hindsight-meta" CustomEntry.
 * Returns null if no metadata entry exists.
 */
export function getHindsightMeta(
  entries: Array<{ type: string; customType?: string; data?: unknown }>
): HindsightMeta | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (
      entry &&
      entry.type === "custom" &&
      entry.customType === "hindsight-meta" &&
      entry.data !== undefined
    ) {
      return entry.data as HindsightMeta;
    }
  }
  return null;
}

/**
 * Build a new HindsightMeta by merging partial updates with existing metadata.
 *
 * Preserves existing fields that aren't being overridden. Uses `!== undefined`
 * for `retained` and `extraContext` (not truthiness) so that `false` and `""`
 * are preserved as intentional values. Uses truthiness for `tags` since an
 * empty tag array is pointless and should be omitted.
 *
 * A field in `updates` that is `undefined` means "keep existing" (not "clear").
 * To drop `tags` from the result, pass an empty array (empty tag lists are omitted).
 * The effect is the same as clearing — the next `getHindsightMeta` call won't
 * see a `tags` field.
 */
export function buildMetaUpdate(
  existing: HindsightMeta | null,
  updates: Partial<HindsightMeta>
): HindsightMeta {
  const meta: HindsightMeta = {};

  // retained: preserve from existing if not overridden
  const retained = updates.retained ?? existing?.retained;
  if (retained !== undefined) {
    meta.retained = retained;
  }

  // tags: preserve from existing if not overridden.
  // An empty array in updates means "explicitly clear tags" (don't carry forward).
  // undefined in updates means "keep existing".
  const tags = updates.tags !== undefined ? updates.tags : existing?.tags;
  if (tags && tags.length > 0) {
    meta.tags = tags;
  }

  // extraContext: preserve from existing if not overridden
  const extraContext =
    updates.extraContext !== undefined ? updates.extraContext : existing?.extraContext;
  if (extraContext !== undefined) {
    meta.extraContext = extraContext;
  }

  return meta;
}

/**
 * Check whether extra context has been explicitly set in session metadata.
 * Returns true if the extraContext key exists in the meta (even if empty string).
 * Returns false if the key doesn't exist (extra context was never chosen).
 *
 * This distinction matters for requireExtraContextBeforeFlush:
 * - Key not present: user hasn't made a choice → block flush
 * - Key present (even empty string): user explicitly said "no extra context needed" → allow flush
 */
export function hasExtraContext(meta: HindsightMeta | null): boolean {
  return meta !== null && "extraContext" in meta;
}

/**
 * Checks the latest hindsight-meta entry for a retained field.
 * If no metadata entry exists or retained is undefined, falls back
 * to the retainSessionsByDefault config value.
 *
 * Note: The session_start handler auto-creates metadata with
 * retained=retainSessionsByDefault when no metadata exists, so this
 * fallback is only relevant before session_start fires or if
 * metadata somehow gets into an inconsistent state.
 */
export function shouldSessionBeRetained(
  entries: Array<{ type: string; customType?: string; data?: unknown }>,
  config: Pick<HindsightConfig, "retainSessionsByDefault">
): boolean {
  const meta = getHindsightMeta(entries);
  if (meta?.retained !== undefined) {
    return meta.retained;
  }
  return config.retainSessionsByDefault;
}
