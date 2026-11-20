/** Format a stroop/decimal amount for display with locale-aware grouping. */
export function formatAmount(
  amount: string,
  options: { locale?: string; maxDecimals?: number; assetCode?: string } = {},
): string {
  const { locale = "en-US", maxDecimals = 7 } = options;
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return amount;
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  }).format(numeric);
  return options.assetCode ? `${formatted} ${formatAssetCode(options.assetCode)}` : formatted;
}

export function formatAssetCode(code: string): string {
  return code.trim().toUpperCase();
}