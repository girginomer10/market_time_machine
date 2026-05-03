export function estimateOneWaySpreadCost(
  expectedNotional: number,
  spreadBps: number,
): number {
  return expectedNotional * (spreadBps / 2 / 10000);
}
