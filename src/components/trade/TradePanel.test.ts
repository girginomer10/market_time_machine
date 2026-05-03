import { describe, expect, it } from "vitest";
import { estimateOneWaySpreadCost } from "./costEstimates";

describe("estimateOneWaySpreadCost", () => {
  it("matches the broker's half-spread-per-side execution model", () => {
    expect(estimateOneWaySpreadCost(10_000, 8)).toBeCloseTo(4, 6);
  });
});
