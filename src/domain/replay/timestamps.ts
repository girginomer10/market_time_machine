export function timestampMs(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function compareTimestamps(a: string, b: string): number {
  const aMs = timestampMs(a);
  const bMs = timestampMs(b);
  if (aMs !== undefined && bMs !== undefined) return aMs - bMs;
  if (aMs !== undefined) return -1;
  if (bMs !== undefined) return 1;
  return a.localeCompare(b);
}

export function timestampAtOrBefore(
  candidate: string,
  currentTime: string,
): boolean {
  const candidateMs = timestampMs(candidate);
  const currentMs = timestampMs(currentTime);
  return (
    candidateMs !== undefined &&
    currentMs !== undefined &&
    candidateMs <= currentMs
  );
}
