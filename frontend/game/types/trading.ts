export type CoinType = 'call' | 'put' | 'gas' | 'whale'

export type Player = {
  id: string
  name: string
  health: number
  score: number
}

export type CoinSpawnEvent = {
  coinId: string
  coinType: CoinType
  x: number
  y: number
}

export type SliceEvent = {
  playerId: string
  playerName: string
  coinType: CoinType
}

export type OrderPlacedEvent = {
  orderId: string
  playerId: string
  playerName: string
  coinType: CoinType
  priceAtOrder: number
  settlesAt: number
}

export type SettlementEvent = {
  orderId: string
  playerId: string
  playerName: string
  coinType: CoinType
  isCorrect: boolean
  priceAtOrder: number
  finalPrice: number
}

export type MatchFoundEvent = {
  roomId: string
  players: Player[]
}

export type GameOverEvent = {
  winnerId: string
  winnerName: string
  reason?: 'time_limit' | 'knockout'
}

// Binance price data
export type PriceData = {
  symbol: string
  price: number
  change: number
  changePercent: number
}
