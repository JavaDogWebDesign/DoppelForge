import { describe, it, expect } from "vitest";
import { normalizePath, pathTail } from "./paths";

describe("normalizePath", () => {
  it("collapses every array index to an empty bracket", () => {
    expect(normalizePath("data[0].items[12].id")).toBe("data[].items[].id");
  });

  it("leaves an index-free path unchanged", () => {
    expect(normalizePath("a.b.c")).toBe("a.b.c");
  });
});

describe("pathTail", () => {
  it("returns the final key of a dotted path", () => {
    expect(pathTail("a.b.c")).toBe("c");
  });

  it("strips a trailing array index from the final key", () => {
    expect(pathTail("data[3]")).toBe("data");
    expect(pathTail("a.b.items[0]")).toBe("items");
  });

  it("returns an empty string for an empty path", () => {
    expect(pathTail("")).toBe("");
  });
});
