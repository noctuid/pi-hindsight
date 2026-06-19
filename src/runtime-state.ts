/**
 * Tiny runtime-state module shared across event handlers, tools, and slash
 * commands without threading callbacks through every subcommand creator.
 *
 * Currently holds only {@link startupReady}; the recall-display override / last
 * recall details remain in index.ts (they need index-local getters/setters that
 * tests already mock). Keeping this module minimal avoids a larger refactor.
 *
 * `startupReady` is a **latch**: it starts `false` and flips to `true` after
 * the first successful health check + version compatibility check. That probe
 * is normally triggered by `session_start`, but first-turn auto-recall can also
 * trigger it from `before_agent_start` when that event races ahead of startup
 * readiness. It is never flipped back to `false` by later failures; a later
 * health failure still sets the status-bar indicator unhealthy, but does not
 * re-disable operational handlers or re-hide tools.
 *
 * Before the first successful readiness probe, operational handlers
 * (auto-retain, auto-recall, auto-flush) and operational subcommands gate on
 * this so no operational side effects occur while startup hasn't succeeded.
 * Hindsight tools are related but separate: they are registered lazily by the
 * first healthy `session_start` (not by `before_agent_start` and not at
 * extension init), so session-specific setup remains owned by the session
 * lifecycle. The recall filter and renderer are always active regardless of
 * readiness.
 *
 * index.ts's `_resetState()` is the single reset entrypoint and calls
 * {@link resetStartupReady}(); tests already invoke `_resetState()`.
 */

let startupReady = false;

/** Whether at least one health + version readiness probe has succeeded. */
export function isStartupReady(): boolean {
  return startupReady;
}

/**
 * Mark startup as ready (true). This is a one-way latch: callers only ever set
 * it to true after a successful health + version readiness check. To
 * reset (tests / module reset), use {@link resetStartupReady}.
 */
export function markStartupReady(): void {
  startupReady = true;
}

/** Reset the startup-ready latch to false. Exported for testing/reset only. */
export function resetStartupReady(): void {
  startupReady = false;
}
