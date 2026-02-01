/**
 * Default fallback price for BTC/USDT when price feed is unavailable
 * Used for development/testing - prevents game from breaking on WebSocket errors
 */
export const DEFAULT_BTC_PRICE = 95000

/**
 * Format price with appropriate decimal places based on magnitude
 * Matches crypto industry standards
 */
export function formatPrice(price: number): string {
  if (price < 1) return price.toFixed(6)
  if (price < 100) return price.toFixed(4)
  return price.toFixed(2)
}

/**
 * Format price change with sign and decimal places
 */
export function formatPriceChange(change: number): string {
  const sign = change >= 0 ? '+' : ''
  return `${sign}${change.toFixed(2)}`
}
