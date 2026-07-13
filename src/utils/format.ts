const currencyFormatters = new Map<string, Intl.NumberFormat>();

function currencyFormatter(
  currency: string,
  fractionDigits?: number,
): Intl.NumberFormat {
  const normalized = currency.trim().toUpperCase() || "USD";
  const normalizedDigits =
    fractionDigits === undefined
      ? undefined
      : Math.max(0, Math.min(8, Math.trunc(fractionDigits)));
  const cacheKey = `${normalized}:${normalizedDigits ?? "default"}`;
  const cached = currencyFormatters.get(cacheKey);
  if (cached) return cached;

  let formatter: Intl.NumberFormat;
  try {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: normalized,
      maximumFractionDigits: normalizedDigits ?? 2,
      ...(normalizedDigits === undefined
        ? {}
        : { minimumFractionDigits: normalizedDigits }),
    });
  } catch {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: normalizedDigits ?? 2,
      ...(normalizedDigits === undefined
        ? {}
        : { minimumFractionDigits: normalizedDigits }),
    });
  }
  currencyFormatters.set(cacheKey, formatter);
  return formatter;
}

export function formatCurrency(
  value: number,
  currency = "USD",
  fractionDigits?: number,
): string {
  if (!Number.isFinite(value)) return "—";
  return currencyFormatter(currency, fractionDigits).format(value);
}

export function formatNumber(
  value: number,
  decimals = 2,
  minimumDecimals = Math.min(decimals, 2),
): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    maximumFractionDigits: decimals,
    minimumFractionDigits: Math.min(decimals, Math.max(0, minimumDecimals)),
  });
}

export function formatPct(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(decimals)}%`;
}

export function formatTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace("T", " ").slice(0, 16) + "Z";
}
