export function formatPrice(value: number): string {
  return "$" + value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatVolume(value: number): string {
  if (value === 0) return "0";
  if (value >= 1_000_000_000) return (value / 1_000_000_000).toFixed(2) + "B";
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(2) + "M";
  if (value >= 1_000) return (value / 1_000).toFixed(2) + "K";
  return String(value);
}

export function formatChange(value: number): string {
  const formatted = Math.abs(value).toFixed(2);
  if (value > 0) return "+" + formatted + "%";
  if (value < 0) return "-" + formatted + "%";
  return formatted + "%";
}

export function getChangeColor(value: number): string {
  if (value > 0) return "text-accent";
  if (value < 0) return "text-severity-critical";
  return "text-text-muted";
}
