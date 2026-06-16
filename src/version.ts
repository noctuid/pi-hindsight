/**
 * Hindsight server version compatibility utilities.
 */

/** Minimum Hindsight server version required by this extension. */
export const MIN_HINDSIGHT_VERSION = "0.8.3";

const VERSION_RE = /^\d+(\.\d+)*$/;

/**
 * Parse a version string into numeric segments.
 * Each segment must be a full non-negative integer (no partial parsing like
 * `parseInt("1x") -> 1`). Malformed segments become NaN.
 */
function parseVersion(version: string): number[] {
  return version.split(".").map((part) => {
    if (!/^\d+$/.test(part)) return NaN;
    return Number(part);
  });
}

/**
 * Compare two dotted-numeric version strings.
 * Returns < 0 if a < b, > 0 if a > b, 0 if equal.
 * Treats malformed versions as less than any well-formed version.
 */
export function compareVersions(a: string, b: string): number {
  const av = parseVersion(a);
  const bv = parseVersion(b);
  const len = Math.max(av.length, bv.length);

  for (let i = 0; i < len; i++) {
    const an = av[i] ?? 0;
    const bn = bv[i] ?? 0;

    const aValid = Number.isFinite(an);
    const bValid = Number.isFinite(bn);
    if (!aValid && bValid) return -1;
    if (aValid && !bValid) return 1;
    if (!aValid && !bValid) continue;

    if (an < bn) return -1;
    if (an > bn) return 1;
  }

  return 0;
}

/**
 * Check whether a Hindsight server version is compatible.
 * Returns a human-readable error string if incompatible or unavailable,
 * otherwise null.
 */
export function getHindsightCompatibilityError(version: string | undefined): string | null {
  if (!version) {
    return "Hindsight server version unavailable";
  }
  if (!VERSION_RE.test(version)) {
    return `Hindsight server returned invalid version: ${version}`;
  }
  if (compareVersions(version, MIN_HINDSIGHT_VERSION) < 0) {
    return `Hindsight server version ${version} is too old (minimum required ${MIN_HINDSIGHT_VERSION})`;
  }
  return null;
}
