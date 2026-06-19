/**
 * Centralized extension identifiers and log prefix.
 *
 * The status-bar key and user-facing console/notification log prefix have moved
 * to the current `epimetheus` brand. Centralizing these values keeps current
 * branding from being scattered as string literals across the codebase.
 *
 * No behavioral dependence on these values; `/hindsight` (the slash command),
 * `hindsight_*` (tool names), `hindsight-recall` (custom message type), and the
 * Hindsight service identifiers are intentionally separate and unchanged here.
 */

/** Extension identifier / status-bar key used for `ui.setStatus`. Not the slash
 *  command (`/hindsight`), tool names, or message types — those are separate. */
export const EXTENSION_ID = "epimetheus";

/** Status-bar key (currently equal to {@link EXTENSION_ID}). */
export const STATUS_ID = EXTENSION_ID;

/** Console-log prefix for extension messages (trailing space included). */
export const LOG_PREFIX = "epimetheus: ";

/**
 * Prefix a message with the extension log prefix.
 * @example prefixLog("migrated data directory") → "epimetheus: migrated data directory"
 */
export function prefixLog(message: string): string {
  return `${LOG_PREFIX}${message}`;
}
