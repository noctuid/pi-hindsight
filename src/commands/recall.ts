/**
 * Recall display subcommands (toggle display, popup overlay).
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { HindsightConfig } from "../config";
import type { RecallMessageDetails } from "../index";
import { RecallOverlayComponent } from "../overlay";
import type { Subcommand } from "./types";

/**
 * Create the toggle-display subcommand — toggle recall message visibility.
 *
 * When recallPersist is false, recall messages are never shown in the TUI,
 * so this command warns and does nothing. When recallPersist is true, toggles
 * the display override between visible and hidden.
 */
export function createToggleDisplaySubcommand(
  config: HindsightConfig,
  getRecallDisplayOverride: () => boolean | null,
  setRecallDisplayOverride: (value: boolean | null) => void
): Subcommand {
  return {
    description: "Toggle recall message display",
    handler: async (_args: string, ctx: ExtensionContext) => {
      // Cannot toggle when recallPersist is false (context event never shows in TUI)
      if (!config.recallPersist) {
        ctx.ui.notify(
          "Cannot toggle display: recallPersist is false (context event never shows in TUI)",
          "warning"
        );
        return;
      }
      // Toggle from current state (default from config)
      const currentState = getRecallDisplayOverride() ?? config.recallDisplay;
      setRecallDisplayOverride(!currentState);
      ctx.ui.notify(`Recall display: ${!currentState ? "visible" : "hidden"}`, "info");
    },
  };
}

/**
 * Create the popup subcommand — show last recalled messages in an overlay.
 *
 * Displays an overlay with the full recall content if a recall has occurred this
 * session. Shows a simple notification if no recall has happened yet.
 */
export function createPopupSubcommand(
  getRecallDetails: () => RecallMessageDetails | null
): Subcommand {
  return {
    description: "Pop up last recalled messages in overlay",
    handler: async (_args: string, ctx: ExtensionContext) => {
      const recallDetails = getRecallDetails();
      if (recallDetails === null) {
        ctx.ui.notify("No recall this session", "info");
        return;
      }

      // Show recall in overlay popup
      await ctx.ui.custom<void>(
        (_tui, theme, _keybindings, done) =>
          new RecallOverlayComponent(theme, recallDetails, done, { maxHeight: 30 }),
        {
          overlay: true,
          overlayOptions: { anchor: "center", width: 80, maxHeight: 30 },
        }
      );
    },
  };
}
