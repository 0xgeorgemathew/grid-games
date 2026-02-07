export type CoinType = 'call' | 'put' | 'gas' | 'whale'

/**
 * Coin visual and physics configuration
 * Used for rendering and hitbox calculation
 */
export type CoinConfig = {
  color: number // Main coin color
  edgeColor: number // Darker shade for milled edge/rim
  radius: number // Visual radius in pixels
  hitboxMultiplier?: number // Hitbox size multiplier (default 1.0)
  innerColor?: number // Optional gradient center (gas coins only)
  rotationSpeed?: number // Radians per second (unused in config, set dynamically)
  jitterAmount?: number // For gas coins (unused in config, set dynamically)
  hasTrail?: boolean // For whale coins (unused in config, set dynamically)
}

/**
 * Round summary for game over display
 * Shows results for each completed round
 */
export type RoundSummary = {
  roundNumber: number
  winnerId: string | null
  isTie: boolean
  player1Dollars: number
  player2Dollars: number
  player1Gained: number
  player2Gained: number
  playerLost?: number // Amount the winner gained (positive value)
}

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
 * Uses normalized X position (0.0-1.0) for deterministic sync between players
 */
export type CoinSpawnEvent = {
  coinId: string
  coinType: CoinType
  xNormalized: number // 0.0 to 1.0 (relative screen position, synced between players)
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
 * Active order with 5-second countdown timer
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
 * Settlement result after 5-second timer expires
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
  amountTransferred: number // Actual amount transferred (1 or 2 with 2x multiplier)
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
 * Round start event from server
 * Emitted at the start of each round
 */
export type RoundStartEvent = {
  roundNumber: number
  isSuddenDeath: boolean
  durationMs: number
}

/**
 * Round end event from server
 * Emitted when a round ends (time limit or knockout)
 */
export type RoundEndEvent = {
  roundNumber: number
  winnerId: string | null
  isTie: boolean
  player1Wins: number
  player2Wins: number
  player1Dollars: number
  player2Dollars: number
  player1Gained: number
  player2Gained: number
}

/**
 * Game over event from server
 * Emitted when game ends (time limit or knockout)
 */
export type GameOverEvent = {
  winnerId: string
  winnerName: string
  reason?: 'time_limit' | 'knockout' | 'best_of_three_complete' | 'tie_break'
  player1Wins: number
  player2Wins: number
  rounds: RoundSummary[]
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

/**
 * Lobby player for matchmaking selection
 * Represents a waiting player available for challenge
 */
export type LobbyPlayer = {
  socketId: string
  name: string
  joinedAt: number
}

/**
 * Lobby players event from server
 * Emitted when requesting the current list of waiting players
 */
export type LobbyPlayersEvent = LobbyPlayer[]

/**
 * Lobby updated event from server
 * Broadcast when players join/leave the waiting pool
 */
export type LobbyUpdatedEvent = {
  players: LobbyPlayer[]
}
