/**
 * Unit tests for Hindsight server version compatibility utilities.
 */

import { describe, expect, it } from "bun:test";
import {
  compareVersions,
  getHindsightCompatibilityError,
  MIN_HINDSIGHT_VERSION,
} from "../src/version";

describe("compareVersions", () => {
  it("returns 0 for equal versions", () => {
    expect(compareVersions("0.8.2", "0.8.2")).toBe(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });

  it("returns negative when a < b", () => {
    expect(compareVersions("0.8.1", "0.8.2")).toBeLessThan(0);
    expect(compareVersions("0.7.0", "0.8.2")).toBeLessThan(0);
    expect(compareVersions("0.8.2", "0.8.10")).toBeLessThan(0);
  });

  it("returns positive when a > b", () => {
    expect(compareVersions("0.8.3", "0.8.2")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "0.8.2")).toBeGreaterThan(0);
    expect(compareVersions("0.9.0", "0.8.2")).toBeGreaterThan(0);
  });

  it("handles different segment lengths", () => {
    expect(compareVersions("0.8", "0.8.2")).toBeLessThan(0);
    expect(compareVersions("0.8.2", "0.8")).toBeGreaterThan(0);
  });

  it("treats malformed versions as less than well-formed versions", () => {
    expect(compareVersions("abc", "0.8.2")).toBeLessThan(0);
    expect(compareVersions("0.8.2", "abc")).toBeGreaterThan(0);
  });

  it("rejects partial-numeric segments without partial parsing", () => {
    // `parseInt` would accept these as 1 / 0 / 8; hardened parsing treats them
    // as malformed, so they compare as less than any well-formed version.
    expect(compareVersions("1x", "0.8.2")).toBeLessThan(0);
    expect(compareVersions("0.8x.2", "0.8.2")).toBeLessThan(0);
    expect(compareVersions("0.8.2x", "0.8.2")).toBeLessThan(0);
    expect(compareVersions("0.8.2", "1x")).toBeGreaterThan(0);
    expect(compareVersions("0.8.2", "0.8x.2")).toBeGreaterThan(0);
    expect(compareVersions("0.8.2", "0.8.2x")).toBeGreaterThan(0);
    // Two malformed versions with the same segments compare as equal (both invalid).
    expect(compareVersions("1x", "1x")).toBe(0);
    expect(compareVersions("0.8x.2", "0.8x.2")).toBe(0);
  });
});

describe("getHindsightCompatibilityError", () => {
  it("returns null for the minimum required version", () => {
    expect(getHindsightCompatibilityError(MIN_HINDSIGHT_VERSION)).toBeNull();
  });

  it("returns null for newer versions", () => {
    expect(getHindsightCompatibilityError("0.9.0")).toBeNull();
    expect(getHindsightCompatibilityError("1.0.0")).toBeNull();
  });

  it("returns error for older versions", () => {
    const error = getHindsightCompatibilityError("0.7.0");
    expect(error).toContain("0.7.0");
    expect(error).toContain(MIN_HINDSIGHT_VERSION);
  });

  it("returns error when version is unavailable", () => {
    expect(getHindsightCompatibilityError(undefined)).toBe("Hindsight server version unavailable");
  });

  it("returns error for invalid version strings", () => {
    const error = getHindsightCompatibilityError("not.a.version");
    expect(error).toContain("invalid version");
  });
});
