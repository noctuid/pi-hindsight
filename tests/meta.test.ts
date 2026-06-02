/**
 * Unit tests for session metadata management.
 */

import { describe, expect, it } from "bun:test";
import {
  buildMetaUpdate,
  getHindsightMeta,
  hasExtraContext,
  shouldSessionBeRetained,
} from "../src/meta";

type MetaEntry = Parameters<typeof getHindsightMeta>[0][number];

describe("getHindsightMeta", () => {
  it("returns null when no hindsight-meta entries exist", () => {
    const entries: MetaEntry[] = [
      { type: "message" },
      { type: "custom", customType: "other-type", data: { foo: "bar" } },
    ];
    expect(getHindsightMeta(entries)).toBeNull();
  });

  it("returns the latest hindsight-meta entry data", () => {
    const entries: MetaEntry[] = [
      { type: "custom", customType: "hindsight-meta", data: { retained: true } },
      { type: "message" },
      { type: "custom", customType: "hindsight-meta", data: { retained: false } },
    ];
    expect(getHindsightMeta(entries)).toEqual({ retained: false });
  });

  it("returns single hindsight-meta entry", () => {
    const entries: MetaEntry[] = [
      { type: "custom", customType: "hindsight-meta", data: { retained: true, tags: ["test"] } },
    ];
    expect(getHindsightMeta(entries)).toEqual({ retained: true, tags: ["test"] });
  });

  it("returns null for hindsight-meta entry with undefined data", () => {
    const entries: MetaEntry[] = [
      { type: "custom", customType: "hindsight-meta", data: undefined },
    ];
    expect(getHindsightMeta(entries)).toBeNull();
  });

  it("returns null for empty entries array", () => {
    expect(getHindsightMeta([])).toBeNull();
  });

  it("returns meta with tags only", () => {
    const entries: MetaEntry[] = [
      { type: "custom", customType: "hindsight-meta", data: { tags: ["topic:ai"] } },
    ];
    expect(getHindsightMeta(entries)).toEqual({ tags: ["topic:ai"] });
  });

  it("returns meta with extraContext", () => {
    const entries: MetaEntry[] = [
      {
        type: "custom",
        customType: "hindsight-meta",
        data: { retained: true, extraContext: "This is fiction" },
      },
    ];
    expect(getHindsightMeta(entries)).toEqual({
      retained: true,
      extraContext: "This is fiction",
    });
  });

  it("returns latest meta with extraContext", () => {
    const entries: MetaEntry[] = [
      {
        type: "custom",
        customType: "hindsight-meta",
        data: { retained: true, extraContext: "old context" },
      },
      {
        type: "custom",
        customType: "hindsight-meta",
        data: { retained: true, extraContext: "new context" },
      },
    ];
    expect(getHindsightMeta(entries)).toEqual({
      retained: true,
      extraContext: "new context",
    });
  });
});

describe("shouldSessionBeRetained", () => {
  it("returns true by default when retainSessionsByDefault is true", () => {
    expect(shouldSessionBeRetained([], { retainSessionsByDefault: true })).toBe(true);
  });

  it("returns false by default when retainSessionsByDefault is false", () => {
    expect(shouldSessionBeRetained([], { retainSessionsByDefault: false })).toBe(false);
  });

  it("returns retained value from meta when present", () => {
    const entries: MetaEntry[] = [
      { type: "custom", customType: "hindsight-meta", data: { retained: false } },
    ];
    expect(shouldSessionBeRetained(entries, { retainSessionsByDefault: true })).toBe(false);
  });

  it("returns retained: true from meta even when default is false", () => {
    const entries: MetaEntry[] = [
      { type: "custom", customType: "hindsight-meta", data: { retained: true } },
    ];
    expect(shouldSessionBeRetained(entries, { retainSessionsByDefault: false })).toBe(true);
  });

  it("falls back to config when retained is undefined in meta", () => {
    const entries: MetaEntry[] = [
      { type: "custom", customType: "hindsight-meta", data: { tags: ["test"] } },
    ];
    expect(shouldSessionBeRetained(entries, { retainSessionsByDefault: false })).toBe(false);
  });

  it("uses latest meta entry when multiple exist", () => {
    const entries: MetaEntry[] = [
      { type: "custom", customType: "hindsight-meta", data: { retained: true } },
      { type: "custom", customType: "hindsight-meta", data: { retained: false } },
    ];
    expect(shouldSessionBeRetained(entries, { retainSessionsByDefault: true })).toBe(false);
  });
});

describe("hasExtraContext", () => {
  it("returns false for null meta", () => {
    expect(hasExtraContext(null)).toBe(false);
  });

  it("returns false when key is absent", () => {
    expect(hasExtraContext({ retained: true })).toBe(false);
  });

  it("returns false when only tags are set", () => {
    expect(hasExtraContext({ retained: true, tags: ["test"] })).toBe(false);
  });

  it("returns true for non-empty string", () => {
    expect(hasExtraContext({ extraContext: "Fiction session" })).toBe(true);
  });

  it("returns true for empty string (explicitly set to empty — satisfies flush guard)", () => {
    expect(hasExtraContext({ extraContext: "" })).toBe(true);
  });

  it("returns true for empty string alongside other fields", () => {
    expect(hasExtraContext({ retained: true, extraContext: "" })).toBe(true);
  });
});

describe("buildMetaUpdate", () => {
  it("sets retained from updates when no existing meta", () => {
    expect(buildMetaUpdate(null, { retained: true })).toEqual({ retained: true });
  });

  it("sets retained: false from updates when no existing meta", () => {
    expect(buildMetaUpdate(null, { retained: false })).toEqual({ retained: false });
  });

  it("preserves existing fields not overridden", () => {
    expect(buildMetaUpdate({ retained: true, tags: ["x"] }, { extraContext: "foo" })).toEqual({
      retained: true,
      tags: ["x"],
      extraContext: "foo",
    });
  });

  it("drops tags when updates has empty array", () => {
    expect(buildMetaUpdate({ retained: true, tags: ["x"] }, { tags: [] })).toEqual({
      retained: true,
    });
  });

  it("stores empty string extraContext (satisfies flush guard)", () => {
    expect(buildMetaUpdate(null, { extraContext: "" })).toEqual({ extraContext: "" });
  });

  it("preserves existing retained and tags when setting extraContext", () => {
    expect(
      buildMetaUpdate({ retained: false, tags: ["a", "b"] }, { extraContext: "fiction" })
    ).toEqual({ retained: false, tags: ["a", "b"], extraContext: "fiction" });
  });

  it("preserves existing extraContext when updating tags", () => {
    expect(buildMetaUpdate({ retained: true, extraContext: "old" }, { tags: ["new"] })).toEqual({
      retained: true,
      extraContext: "old",
      tags: ["new"],
    });
  });

  it("returns empty object when no existing meta and no updates set", () => {
    expect(buildMetaUpdate(null, {})).toEqual({});
  });

  it("overrides retained from existing with update", () => {
    expect(buildMetaUpdate({ retained: true }, { retained: false })).toEqual({ retained: false });
  });

  it("overrides extraContext from existing with update", () => {
    expect(buildMetaUpdate({ extraContext: "old" }, { extraContext: "new" })).toEqual({
      extraContext: "new",
    });
  });

  it("replaces tags from existing with update tags", () => {
    expect(buildMetaUpdate({ tags: ["old"] }, { tags: ["a", "b"] })).toEqual({
      tags: ["a", "b"],
    });
  });

  it("carries forward existing retained when updates has no retained", () => {
    expect(buildMetaUpdate({ retained: true }, { tags: ["x"] })).toEqual({
      retained: true,
      tags: ["x"],
    });
  });

  it("carries forward existing extraContext when updates has no extraContext", () => {
    expect(buildMetaUpdate({ extraContext: "fiction" }, { retained: false })).toEqual({
      retained: false,
      extraContext: "fiction",
    });
  });

  it("drops tags when existing has tags but updates has empty array", () => {
    expect(buildMetaUpdate({ retained: true, tags: ["x"] }, { tags: [], retained: true })).toEqual({
      retained: true,
    });
  });
});
