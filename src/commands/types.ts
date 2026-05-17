/**
 * Shared types for slash commands.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** A subcommand handler with description, handler, and optional argument completion. */
export interface Subcommand {
  /** Short description shown in the subcommand list. */
  description: string;
  /** Called when the subcommand is invoked. */
  handler: (args: string, ctx: ExtensionContext) => Promise<void>;
  /** Optional argument completion provider for the subcommand. */
  getArgumentCompletions?: (
    argumentPrefix: string
  ) => Promise<Array<{ label: string; value: string }> | null>;
}
