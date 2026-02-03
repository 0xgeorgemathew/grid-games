export type CoinType = 'call' | 'put' | 'gas' | 'whale'

/**
 * Player state in a game room
 * Tracks dollars (health), score, and scene dimensions for spawning
 */
export type Player = {
  id: string
  name: string
  dollars: number
  score: number
  sceneWidth: number // Player's device width for coin spawning
  sceneHeight: number // Player's device height for coin spawning
}

/**
 * Coin spawn event from server
 * Emitted when a new coin appears in the game
 */
export type CoinSpawnEvent = {
  coinId: string
  coinType: CoinType
  x: number
  y: number
}

/**
 * Slice event from server
 * Emitted when a player slices a coin
 */
export type SliceEvent = {
  playerId: string
  playerName: string
  coinType: CoinType
}

/**
 * Active order with 10-second countdown timer
 * Emitted by server in 'order_placed' event
 */
export type OrderPlacedEvent = {
  orderId: string
  playerId: string
  playerName: string
  coinType: CoinType
  priceAtOrder: number
  settlesAt: number
}

/**
 * Settlement result after 10-second timer expires
 * Emitted by server in 'order_settled' event
 */
export type SettlementEvent = {
  orderId: string
  playerId: string
  playerName: string
  coinType: CoinType
  isCorrect: boolean
  priceAtOrder: number
  finalPrice: number
}

/**
 * Match found event from server
 * Emitted when two players are matched
 */
export type MatchFoundEvent = {
  roomId: string
  players: Player[]
}

/**
 * Game over event from server
 * Emitted when game ends (time limit or knockout)
 */
export type GameOverEvent = {
  winnerId: string
  winnerName: string
  reason?: 'time_limit' | 'knockout'
}

/**
 * Binance price data
 * Real-time cryptocurrency price from Binance WebSocket
 */
export type PriceData = {
  symbol: string
  price: number
  change: number
  changePercent: number
  tradeSize?: number // Quantity traded (BTC)
  tradeSide?: 'BUY' | 'SELL' // Trade direction
  tradeTime?: number // Trade timestamp (ms)
}
