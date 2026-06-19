/**
 * Modern data directory location.
 *
 * The extension stores all of its on-disk state (config, queue,
 * parsed-sessions, session-state) under {@link getDataDir}, currently
 * `<agentdir>/{@link DATA_DIR_NAME}` (`<agentdir>/epimetheus`). Earlier versions
 * used `<agentdir>/extensions/pi-hindsight`; that legacy layout is migrated
 * into the new location on first launch by `src/data-dir-migration.ts`.
 *
 * Keep this module focused on the path primitive; migration-only logic
 * (legacy dir, marker, copy) lives in `src/data-dir-migration.ts`.
 */

import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/** Directory name (under the agent dir) holding the extension's data. */
export const DATA_DIR_NAME = "epimetheus";

/**
 * New data directory: `<agentdir>/epimetheus`.
 *
 * All queue/parsed-session/session-state/config paths resolve under here.
 */
export function getDataDir(): string {
  return join(getAgentDir(), DATA_DIR_NAME);
}
