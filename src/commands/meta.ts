/**
 * Session metadata subcommands (retention toggling, tags).
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { HindsightClientWrapper } from "../client";
import type { HindsightConfig } from "../config";
import {
  buildMetaUpdate,
  getHindsightMeta,
  hasExtraContext,
  shouldSessionBeRetained,
} from "../meta";
import { deleteAutoQueue, deleteToolQueue } from "../queue";
import { isToolEnabled, updateRetainToolVisibility } from "../tools";
import type { Subcommand } from "./types";
import { parseAndUpsertSession } from "./utils";

/**
 * Create the toggle-retain subcommand — toggle whether the current session is retained.
 *
 * When toggling on, prompts the user to parse-and-upsert the full session first,
 * then deletes queue files since the full session was just upserted.
 * When toggling off, deletes queue files to prevent flushing.
 * Preserves existing tags in both directions.
 */
export function createToggleRetainSubcommand(
  pi: ExtensionAPI,
  client: HindsightClientWrapper | null,
  config: HindsightConfig
): Subcommand {
  return {
    description: "Toggle whether the current session should be retained",
    handler: async (_args: string, ctx: ExtensionContext) => {
      if (!client) {
        ctx.ui.notify("Hindsight not configured", "error");
        return;
      }

      const entries = ctx.sessionManager.getEntries();
      const currentRetained = shouldSessionBeRetained(entries, config);
      const newShouldRetain = !currentRetained;

      const sessionId = ctx.sessionManager.getSessionId();

      if (newShouldRetain) {
        // Block toggling on if flush guard is active and extra context isn't set.
        // Without extra context, the subsequent parse-and-upsert would also be blocked.
        if (config.requireExtraContextBeforeFlush && !hasExtraContext(getHindsightMeta(entries))) {
          ctx.ui.notify(
            "Cannot enable retention: extra context not set. Use /hindsight set-extra-context or the hindsight_set_extra_context tool first.",
            "warning"
          );
          return;
        }

        // Toggling ON: ask if user wants to parse-and-upsert first so the
        // full session content is retained (newly queued messages append correctly)
        const answer = await ctx.ui.confirm(
          "Enable retention?",
          "Parse and upsert the full session before enabling retention? This ensures the full conversation is retained."
        );

        if (!answer) {
          ctx.ui.notify(
            "Retention not enabled. Use /hindsight toggle-retain again to enable.",
            "info"
          );
          return;
        }

        const existingMeta = getHindsightMeta(entries);
        const meta = buildMetaUpdate(existingMeta, { retained: true });
        pi.appendEntry("hindsight-meta", meta);

        // Delete any existing queue files
        // Note: there should not be a tool queue for a non-retained session
        // (tool retains are only queued when retention is enabled), but clean up
        // defensively in case the state got out of sync.
        if (sessionId) {
          deleteAutoQueue(sessionId);
          deleteToolQueue(sessionId);
        }

        // Parse and upsert the full session
        try {
          const result = await parseAndUpsertSession(ctx, config, client);
          ctx.ui.notify(`Session retention: enabled. ${result.message}.`, result.level);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          ctx.ui.notify(
            `Session retention: enabled, but parse-and-upsert failed: ${msg}`,
            "warning"
          );
        }

        // Show hindsight_retain tool now that session is retained
        if (isToolEnabled(config, "retain")) {
          updateRetainToolVisibility(pi, true);
        }
      } else {
        // Toggling OFF: confirm since queued messages will be deleted
        const answer = await ctx.ui.confirm(
          "Disable retention?",
          "Queued messages will be deleted and will not be flushed."
        );

        if (!answer) {
          ctx.ui.notify(
            "Retention not disabled. Use /hindsight toggle-retain again to disable.",
            "info"
          );
          return;
        }

        const existingMeta = getHindsightMeta(entries);
        const meta = buildMetaUpdate(existingMeta, { retained: false });
        pi.appendEntry("hindsight-meta", meta);

        // Delete queue files so queued messages will NOT be flushed
        if (sessionId) {
          deleteAutoQueue(sessionId);
          deleteToolQueue(sessionId);
        }

        ctx.ui.notify("Session retention: disabled (queued messages deleted)", "info");

        // Hide hindsight_retain tool now that session is not retained
        if (isToolEnabled(config, "retain")) {
          updateRetainToolVisibility(pi, false);
        }
      }
    },
  };
}

/**
 * Create the tag subcommand — add a tag to session metadata.
 *
 * Appends the tag to the existing tag list, preserving the current retained state.
 * Warns if the tag already exists or no tag is provided.
 */
export function createTagSubcommand(pi: ExtensionAPI): Subcommand {
  return {
    description: "Add a tag to session metadata",
    handler: async (args: string, ctx: ExtensionContext) => {
      const tag = args.trim();
      if (!tag) {
        ctx.ui.notify("Usage: /hindsight tag <tag>", "warning");
        return;
      }

      const entries = ctx.sessionManager.getEntries();
      const existingMeta = getHindsightMeta(entries);
      const tags = [...(existingMeta?.tags ?? [])];

      if (tags.includes(tag)) {
        ctx.ui.notify(`Tag "${tag}" already exists`, "warning");
        return;
      }

      tags.push(tag);

      const meta = buildMetaUpdate(existingMeta, { tags });
      pi.appendEntry("hindsight-meta", meta);
      ctx.ui.notify(`Tag "${tag}" added`, "info");
    },
  };
}

/**
 * Create the remove-tag subcommand — remove a tag from session metadata.
 *
 * Removes the tag from the tag list, preserving the current retained state.
 * Omits the tags field entirely if no tags remain. Warns if the tag is not found.
 */
export function createRemoveTagSubcommand(pi: ExtensionAPI): Subcommand {
  return {
    description: "Remove a tag from session metadata",
    handler: async (args: string, ctx: ExtensionContext) => {
      const tag = args.trim();
      if (!tag) {
        ctx.ui.notify("Usage: /hindsight remove-tag <tag>", "warning");
        return;
      }

      const entries = ctx.sessionManager.getEntries();
      const existingMeta = getHindsightMeta(entries);
      const tags = [...(existingMeta?.tags ?? [])];

      const index = tags.indexOf(tag);
      if (index === -1) {
        ctx.ui.notify(`Tag "${tag}" not found`, "warning");
        return;
      }

      tags.splice(index, 1);

      const meta = buildMetaUpdate(existingMeta, { tags });
      pi.appendEntry("hindsight-meta", meta);
      ctx.ui.notify(`Tag "${tag}" removed`, "info");
    },
  };
}

/**
 * Create the set-extra-context subcommand — set extra context for the Hindsight context field.
 *
 * Extra context is appended after the session name in the Hindsight context string,
 * separated by a newline. It provides caveats/instructions for extraction to help
 * Hindsight correctly classify content (e.g., "This session involves reading a fiction
 * book; characters are not the user and information is not factual").
 *
 * The extra context is used in all places the Hindsight context field is used:
 * - Fact extraction: included in the extraction prompt so the LLM knows the nature of the source
 * - Full-text search: indexed in the tsvector for recall filtering
 * - Consolidation: included in source fact data passed to the observation synthesis LLM
 * - Recall results: returned as a field on each memory fact
 * - Reflect agent: available as context for answer synthesis
 *
 * Pass an empty string ("") to indicate that no extra context is needed for this session.
 * This is distinct from not having set extra context at all: when requireExtraContextBeforeFlush
 * is enabled, an explicit empty string satisfies the flush guard (you've confirmed you don't
 * need extra context), while never having set it blocks the flush.
 * Replaces any previously set extra context.
 */
export function createExtraContextSubcommand(pi: ExtensionAPI): Subcommand {
  return {
    description: "Set extra context for extraction caveats (appended to Hindsight context field)",
    handler: async (args: string, ctx: ExtensionContext) => {
      const extraContext = args.trim();

      const entries = ctx.sessionManager.getEntries();
      const existingMeta = getHindsightMeta(entries);

      // Always store extraContext (even empty string) so the flush guard
      // can distinguish "explicitly set to empty" from "never set".
      const meta = buildMetaUpdate(existingMeta, { extraContext });
      pi.appendEntry("hindsight-meta", meta);
      if (extraContext) {
        ctx.ui.notify(`Extra context set`, "info");
      } else {
        ctx.ui.notify(`No extra context needed (flush guard satisfied)`, "info");
      }
    },
  };
}
