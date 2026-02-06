// Game economy constants (centralized, no Phaser imports for server-side compatibility)
export const GAME_CONFIG = {
  STARTING_CASH: 10,
  ROUND_DURATION_MS: 30000,
  ORDER_SETTLEMENT_DURATION_MS: 5000,
} as const
