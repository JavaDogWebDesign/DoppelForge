import { describe, it, expect } from "vitest";
import { bestMatch, matchByUrl } from "./Matcher";
import type { EndpointSpec } from "./types";

function endpoint(
  id: string,
  required: string[],
  opts: {
    optional?: string[];
    path?: string;
    kind?: "response" | "webhook";
  } = {},
): EndpointSpec {
  return {
    id,
    providerId: "test",
    endpoint: {
      method: "GET",
      path: opts.path ?? `/${id}`,
      kind: opts.kind,
    },
    signature: { required_paths: required, optional_paths: opts.optional },
    fields: {},
  };
}

describe("bestMatch", () => {
  it("matches the endpoint whose required paths are all present", () => {
    const eps = [endpoint("orders", ["order_id", "line_items"])];
    const result = bestMatch({ order_id: 1, line_items: [] }, eps);
    expect(result?.endpoint.id).toBe("orders");
    expect(result?.matchedRequired).toBe(2);
  });

  it("returns null when no endpoint meets the threshold", () => {
    const eps = [endpoint("orders", ["a", "b", "c"])];
    expect(bestMatch({ a: 1, b: 2 }, eps)).toBeNull();
  });

  it("honors a lowered threshold", () => {
    const eps = [endpoint("orders", ["a", "b", "c"])];
    const result = bestMatch({ a: 1, b: 2 }, eps, 0.6);
    expect(result?.endpoint.id).toBe("orders");
  });

  it("normalizes array indices when matching signature paths", () => {
    const eps = [endpoint("list", ["data[].id"])];
    const result = bestMatch({ data: [{ id: 1 }, { id: 2 }] }, eps);
    expect(result?.endpoint.id).toBe("list");
  });

  it("prefers the more specific signature on a tie (specificity tiebreaker)", () => {
    const subset = endpoint("merchant-account", ["id", "status"]);
    const superset = endpoint("transaction", ["id", "status", "currency", "type"]);
    const input = { id: "x", status: "ok", currency: "USD", type: "sale" };
    // subset is listed first; without the tiebreaker it would win on iteration order.
    expect(bestMatch(input, [subset, superset])?.endpoint.id).toBe("transaction");
  });

  it("boosts score for matched optional paths", () => {
    const lean = endpoint("a", ["id"]);
    const rich = endpoint("b", ["id"], { optional: ["foo", "bar"] });
    const input = { id: "x", foo: 1, bar: 2 };
    expect(bestMatch(input, [lean, rich])?.endpoint.id).toBe("b");
  });

  it("skips endpoints with no required paths", () => {
    expect(bestMatch({ anything: 1 }, [endpoint("empty", [])])).toBeNull();
  });
});

describe("matchByUrl", () => {
  it("matches a path pattern with a placeholder segment", () => {
    const eps = [endpoint("customer", [], { path: "/v1/customers/{id}" })];
    expect(matchByUrl("/v1/customers/cus_123", eps)?.id).toBe("customer");
  });

  it("extracts the pathname from a full URL", () => {
    const eps = [endpoint("customer", [], { path: "/v1/customers/{id}" })];
    expect(
      matchByUrl("https://api.stripe.com/v1/customers/cus_123?expand=x", eps)?.id,
    ).toBe("customer");
  });

  it("never matches webhook endpoints (their path is an event name)", () => {
    const eps = [
      endpoint("hook", [], { path: "orders/create", kind: "webhook" }),
    ];
    expect(matchByUrl("orders/create", eps)).toBeNull();
  });

  it("treats regex metacharacters in a spec path as literals (no crash)", () => {
    const eps = [endpoint("weird", [], { path: "/api/(a+)+$" })];
    expect(() => matchByUrl("/something/else", eps)).not.toThrow();
    expect(matchByUrl("/something/else", eps)).toBeNull();
  });

  it("returns null for an empty url", () => {
    const eps = [endpoint("customer", [], { path: "/v1/customers/{id}" })];
    expect(matchByUrl("   ", eps)).toBeNull();
  });
});
