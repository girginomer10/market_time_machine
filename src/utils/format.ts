const currencyFormatters = new Map<string, Intl.NumberFormat>();

function currencyFormatter(currency: string): Intl.NumberFormat {
  const normalized = currency.trim().toUpperCase() || "USD";
  const cached = currencyFormatters.get(normalized);
  if (cached) return cached;

  let formatter: Intl.NumberFormat;
  try {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: normalized,
      maximumFractionDigits: 2,
    });
  } catch {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    });
  }
  currencyFormatters.set(normalized, formatter);
  return formatter;
}

export function formatCurrency(value: number, currency = "USD"): string {
  if (!Number.isFinite(value)) return "—";
  return currencyFormatter(currency).format(value);
}

export function formatNumber(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    maximumFractionDigits: decimals,
    minimumFractionDigits: Math.min(decimals, 2),
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
