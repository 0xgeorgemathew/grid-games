import { create } from 'zustand'
import { io, Socket } from 'socket.io-client'
import type {
  Player,
  CoinSpawnEvent,
  SliceEvent,
  OrderPlacedEvent,
  SettlementEvent,
  MatchFoundEvent,
  GameOverEvent,
  CoinType,
  PriceData,
} from '../types/trading'

// Debug logging control - set DEBUG_FUNDS=true in .env.local to enable
const DEBUG_FUNDS = typeof process !== 'undefined' && process.env?.DEBUG_FUNDS === 'true'

// Export CryptoSymbol type for use in components
export type CryptoSymbol = 'btcusdt' // BTC only - like test-stream.ts

// Event bridge interface for React ↔ Phaser communication
// Both Phaser.Events.EventEmitter and Node's EventEmitter implement this subset
export interface PhaserEventBridge {
  emit(event: string, ...args: unknown[]): void
  on(event: string, listener: (...args: unknown[]) => void): void
  destroy?(): void
}

declare global {
  interface Window {
    phaserEvents?: PhaserEventBridge
  }
}

// Game constants
const STANDARD_DAMAGE = 1
const WHALE_DAMAGE = 2
const TUG_OF_WAR_MIN = -100
const TUG_OF_WAR_MAX = 100

// Binance WebSocket configuration
const BINANCE_WS_URL = 'wss://stream.binance.com:9443/ws'
const CRYPTO_SYMBOLS: Record<CryptoSymbol, string> = {
  btcusdt: 'BTC/USD',
}

interface TradingState {
  // Connection
  socket: Socket | null
  isConnected: boolean
  isMatching: boolean
  isPlaying: boolean
  isSceneReady: boolean // Phaser scene is ready to receive events
  socketCleanupFunctions: Array<() => void>

  // Room/Players
  roomId: string | null
  localPlayerId: string | null
  isPlayer1: boolean
  players: Player[]

  // Game state
  tugOfWar: number
  activeOrders: Map<string, OrderPlacedEvent> // Active orders (10s countdown)
  pendingOrders: Map<string, SettlementEvent> // Settlement history
  latestSettlement: SettlementEvent | null // Latest settlement for flash notification

  // Price feed
  priceSocket: WebSocket | null
  priceReconnectTimer: NodeJS.Timeout | null // Track reconnection timer for cleanup
  priceData: PriceData | null
  isPriceConnected: boolean
  selectedCrypto: CryptoSymbol
  reconnectAttempts: number
  maxReconnectAttempts: number
  reconnectDelay: number
  priceError: string | null
  lastPriceUpdate: number
  firstPrice: number | null // Track first price for change calculation

  // Actions
  connect: () => void
  disconnect: () => void
  findMatch: (playerName: string) => void
  spawnCoin: (coin: CoinSpawnEvent) => void
  sliceCoin: (coinId: string, coinType: CoinType, priceAtSlice: number) => void
  handleSlice: (slice: SliceEvent) => void
  handleOrderPlaced: (order: OrderPlacedEvent) => void
  handleSettlement: (settlement: SettlementEvent) => void
  handleGameOver: (data: GameOverEvent) => void
  handlePlayerHit: (data: { playerId: string; damage: number; reason: string }) => void
  removeActiveOrder: (orderId: string) => void
  cleanupOrphanedOrders: () => void
  connectPriceFeed: (symbol: CryptoSymbol) => void
  disconnectPriceFeed: () => void
  manualReconnect: () => void
  resetGame: () => void
  clearLatestSettlement: () => void
}

function getDamageForCoinType(coinType: CoinType): number {
  return coinType === 'whale' ? WHALE_DAMAGE : STANDARD_DAMAGE
}

function calculateTugOfWarDelta(isPlayer1: boolean, isCorrect: boolean, damage: number): number {
  // Tug of war: correct = beneficial for this player, incorrect = harmful
  const delta = isCorrect ? -damage : damage
  return isPlayer1 ? delta : -delta
}

function applyDamageToPlayer(players: Player[], playerId: string, damage: number): Player[] {
  return players.map((p) =>
    p.id === playerId ? { ...p, dollars: Math.max(0, p.dollars - damage) } : p
  )
}

// ZERO-SUM: Transfer funds from loser to winner (loser capped at 0)
function transferFunds(
  players: Player[],
  winnerId: string,
  loserId: string,
  amount: number
): Player[] {
  return players.map((p) => {
    if (p.id === winnerId) {
      return { ...p, dollars: p.dollars + amount }
    }
    if (p.id === loserId) {
      return { ...p, dollars: Math.max(0, p.dollars - amount) }
    }
    return p
  })
}

function getTargetPlayerId(settlement: SettlementEvent, players: Player[]): string | undefined {
  // Correct prediction damages opponent, incorrect damages self
  if (settlement.isCorrect) {
    return players.find((p) => p.id !== settlement.playerId)?.id
  }
  return settlement.playerId
}

// Helper for DEBUG_FUNDS logging - tracks fund transfers with conservation check
function logFundTransfer(
  playersBefore: Player[],
  playersAfter: Player[],
  winnerId: string,
  loserId: string,
  amount: number,
  description: string,
  details?: string // Optional prefix for custom logging context
): void {
  if (!DEBUG_FUNDS) return

  const totalBefore = playersBefore.reduce((sum, p) => sum + p.dollars, 0)
  const playersBeforeStr = playersBefore.map((p) => `${p.name}:${p.dollars}`).join(' | ')
  const totalAfter = playersAfter.reduce((sum, p) => sum + p.dollars, 0)
  const playersAfterStr = playersAfter.map((p) => `${p.name}:${p.dollars}`).join(' | ')
  const winner = playersAfter.find((p) => p.id === winnerId)
  const loser = playersAfter.find((p) => p.id === loserId)

  // FUND CONSERVATION CHECK - total should stay same (unless capped at 0)
  if (totalAfter !== totalBefore) {
    const cappedLoss = totalBefore - totalAfter
    if (cappedLoss > 0) {
      // console.warn(`[CLIENT FUND CAP] ${description}: ${cappedLoss} lost to zero-cap`)
    }
  }

  // console.log(
  //   `[CLIENT ${description}]${details ? ` ${details}` : ''}`,
  //   `\n  BEFORE: ${playersBeforeStr} (total: ${totalBefore})`,
  //   `\n  TRANSFER: $${amount} from ${loser?.name || 'Unknown'} → ${winner?.name || 'Unknown'}`,
  //   `\n  AFTER:  ${playersAfterStr} (total: ${totalAfter})`
  // )
}

export const useTradingStore = create<TradingState>((set, get) => ({
  socket: null,
  isConnected: false,
  isMatching: false,
  isPlaying: false,
  isSceneReady: false,
  socketCleanupFunctions: [],
  roomId: null,
  localPlayerId: null,
  isPlayer1: false,
  players: [],
  tugOfWar: 0,
  activeOrders: new Map(),
  pendingOrders: new Map(),
  latestSettlement: null,

  // Price feed state
  priceSocket: null,
  priceReconnectTimer: null,
  priceData: null,
  isPriceConnected: false,
  selectedCrypto: 'btcusdt',
  reconnectAttempts: 0,
  maxReconnectAttempts: 10,
  reconnectDelay: 1000,
  priceError: null,
  lastPriceUpdate: 0,
  firstPrice: null,

  connect: () => {
    // Cleanup previous connection first
    const { socketCleanupFunctions } = get()
    socketCleanupFunctions.forEach((fn) => fn())

    const socket = io({
      transports: ['websocket', 'polling'],
    })

    const newCleanupFunctions: Array<() => void> = []

    socket.on('connect', () => {
      set({ isConnected: true, localPlayerId: socket.id })

      // Run orphaned order cleanup every 5 seconds
      const cleanupInterval = setInterval(() => {
        get().cleanupOrphanedOrders()
      }, 5000)

      newCleanupFunctions.push(() => clearInterval(cleanupInterval))
    })

    socket.on('disconnect', () => {
      set({ isConnected: false })
      const { socketCleanupFunctions } = get()
      socketCleanupFunctions.forEach((fn) => fn())
      set({ socketCleanupFunctions: [] })
    })

    socket.on('waiting_for_match', () => {
      set({ isMatching: true })
    })

    socket.on('match_found', (data: MatchFoundEvent) => {
      const isPlayer1 = data.players[0]?.id === socket.id || false
      set({
        isMatching: false,
        isPlaying: true,
        roomId: data.roomId,
        players: data.players,
        isPlayer1,
      })
    })

    socket.on('coin_spawn', (coin: CoinSpawnEvent) => {
      get().spawnCoin(coin)
    })

    socket.on('coin_sliced', (slice: SliceEvent) => {
      get().handleSlice(slice)
    })

    socket.on('order_placed', (order: OrderPlacedEvent) => {
      get().handleOrderPlaced(order)
    })

    socket.on('order_settled', (settlement: SettlementEvent) => {
      get().handleSettlement(settlement)
    })

    socket.on('game_over', (data: GameOverEvent) => {
      get().handleGameOver(data)
    })

    socket.on('player_hit', (data: { playerId: string; damage: number; reason: string }) => {
      get().handlePlayerHit(data)
    })

    socket.on('opponent_disconnected', () => {
      alert('Opponent disconnected. Returning to lobby...')
      get().resetGame()
    })

    socket.on(
      'whale_2x_activated',
      (data: { playerId: string; playerName: string; durationMs: number }) => {
        const { localPlayerId } = get()
        const isLocalPlayer = data.playerId === localPlayerId

        // Forward to Phaser for visual feedback
        if (window.phaserEvents) {
          window.phaserEvents.emit('whale_2x_activated', {
            ...data,
            isLocalPlayer,
          })
        }
      }
    )

    set({ socket, socketCleanupFunctions: newCleanupFunctions })
  },

  disconnect: () => {
    const { socket, socketCleanupFunctions } = get()

    // Run cleanup BEFORE removing listeners
    socketCleanupFunctions.forEach((fn) => fn())
    set({ socketCleanupFunctions: [] })

    // Remove all event listeners before disconnecting
    if (socket) {
      socket.removeAllListeners()
      socket.disconnect()
    }
    get().resetGame()
    set({ socket: null, isConnected: false })
  },

  findMatch: (playerName: string) => {
    const { socket } = get()

    const sceneWidth = window.innerWidth
    const sceneHeight = window.innerHeight

    socket?.emit('find_match', { playerName, sceneWidth, sceneHeight })
    set({ isMatching: true })
  },

  spawnCoin: (coin) => {
    if (get().isSceneReady && window.phaserEvents) {
      window.phaserEvents.emit('coin_spawn', coin)
    }
  },

  sliceCoin: (coinId, coinType, priceAtSlice) => {
    const { socket, localPlayerId } = get()
    if (!socket || !localPlayerId) return

    socket.emit('slice_coin', {
      coinId,
      coinType,
      priceAtSlice,
    })
  },

  handleSlice: (slice) => {
    const { localPlayerId } = get()
    if (slice.playerId === localPlayerId) return

    window.phaserEvents?.emit('opponent_slice', slice)
  },

  handleOrderPlaced: (order) => {
    const { activeOrders } = get()
    // Create new Map to trigger re-render (Zustand doesn't detect Map mutations)
    const newActiveOrders = new Map(activeOrders)
    newActiveOrders.set(order.orderId, order)
    set({ activeOrders: newActiveOrders })
  },

  handleSettlement: (settlement) => {
    const { isPlayer1, players, pendingOrders, tugOfWar, activeOrders } = get()
    const amount = getDamageForCoinType(settlement.coinType)

    const winnerId = settlement.isCorrect
      ? settlement.playerId
      : players.find((p) => p.id !== settlement.playerId)?.id
    const loserId = settlement.isCorrect
      ? players.find((p) => p.id !== settlement.playerId)?.id
      : settlement.playerId

    const newPlayers =
      winnerId && loserId ? transferFunds(players, winnerId, loserId, amount) : players

    if (winnerId && loserId) {
      logFundTransfer(
        players,
        newPlayers,
        winnerId,
        loserId,
        amount,
        'Settlement',
        `${settlement.coinType.toUpperCase()} ${settlement.playerName} ${settlement.isCorrect ? 'WON' : 'LOST'}`
      )
    }

    const tugOfWarDelta = calculateTugOfWarDelta(isPlayer1, settlement.isCorrect, amount)

    const newActiveOrders = new Map(activeOrders)
    const newPendingOrders = new Map(pendingOrders)
    newActiveOrders.delete(settlement.orderId)
    newPendingOrders.set(settlement.orderId, settlement)

    const MAX_SETTLEMENT_HISTORY = 50
    if (newPendingOrders.size > MAX_SETTLEMENT_HISTORY) {
      newPendingOrders.delete(newPendingOrders.keys().next().value)
    }

    set({
      activeOrders: newActiveOrders,
      pendingOrders: newPendingOrders,
      tugOfWar: Math.max(TUG_OF_WAR_MIN, Math.min(TUG_OF_WAR_MAX, tugOfWar + tugOfWarDelta)),
      players: newPlayers,
      latestSettlement: settlement,
    })
  },

  handlePlayerHit: (data) => {
    const { isPlayer1, players, tugOfWar } = get()

    const loserId = data.playerId
    const winnerId = players.find((p) => p.id !== data.playerId)?.id

    const newPlayers =
      winnerId && loserId ? transferFunds(players, winnerId, loserId, data.damage) : players

    if (winnerId && loserId) {
      const loser = newPlayers.find((p) => p.id === loserId)
      logFundTransfer(
        players,
        newPlayers,
        winnerId,
        loserId,
        data.damage,
        'PlayerHit',
        `${loser?.name || 'Unknown'} hit by ${data.reason}: $${data.damage} penalty`
      )
    }

    const tugOfWarDelta = calculateTugOfWarDelta(isPlayer1, false, data.damage)

    set({
      players: newPlayers,
      tugOfWar: Math.max(TUG_OF_WAR_MIN, Math.min(TUG_OF_WAR_MAX, tugOfWar + tugOfWarDelta)),
    })
  },

  handleGameOver: (data) => {
    const { localPlayerId } = get()
    const isWinner = data.winnerId === localPlayerId
    alert(isWinner ? '🎉 You WIN!' : `😢 ${data.winnerName} wins! Better luck next time.`)
    get().resetGame()
  },

  removeActiveOrder: (orderId) => {
    const { activeOrders } = get()
    const newActiveOrders = new Map(activeOrders)
    newActiveOrders.delete(orderId)
    set({ activeOrders: newActiveOrders })
  },

  cleanupOrphanedOrders: () => {
    const { activeOrders } = get()
    const now = Date.now()

    const newActiveOrders = new Map(activeOrders)
    for (const [orderId, order] of newActiveOrders) {
      if (now - order.settlesAt > 15000) {
        newActiveOrders.delete(orderId)
      }
    }

    if (newActiveOrders.size !== activeOrders.size) {
      set({ activeOrders: newActiveOrders })
    }
  },

  connectPriceFeed: (symbol: CryptoSymbol) => {
    const { priceSocket, priceReconnectTimer, reconnectAttempts, maxReconnectAttempts } = get()

    if (priceReconnectTimer) {
      clearTimeout(priceReconnectTimer)
      set({ priceReconnectTimer: null })
    }

    if (priceSocket) {
      priceSocket.onclose = null
      priceSocket.close()
    }

    set({ selectedCrypto: symbol, isPriceConnected: false, priceData: null, priceError: null })

    try {
      const ws = new WebSocket(`${BINANCE_WS_URL}/${symbol}@aggTrade`)
      let lastPriceUpdate = 0
      const PRICE_THROTTLE_MS = 500

      ws.onopen = () => {
        set({ isPriceConnected: true, priceSocket: ws, reconnectAttempts: 0, priceError: null })
      }

      ws.onmessage = (event) => {
        const raw = JSON.parse(event.data)
        const trade = {
          price: parseFloat(raw.p),
          size: parseFloat(raw.q),
          side: raw.m ? ('SELL' as const) : ('BUY' as const),
          timestamp: raw.T,
        }

        const { firstPrice: currentFirstPrice } = get()

        if (!currentFirstPrice && trade.price > 0) {
          set({ firstPrice: trade.price })
          return
        }

        if (!currentFirstPrice) return

        const change = trade.price - currentFirstPrice
        const changePercent = (change / currentFirstPrice) * 100

        const now = Date.now()
        if (now - lastPriceUpdate < PRICE_THROTTLE_MS) return

        lastPriceUpdate = now

        set({
          priceData: {
            symbol: symbol.toUpperCase(),
            price: trade.price,
            change,
            changePercent,
            tradeSize: trade.size,
            tradeSide: trade.side,
            tradeTime: trade.timestamp,
          },
          lastPriceUpdate: now,
        })
      }

      ws.onerror = () => {
        set({
          isPriceConnected: false,
          priceError: `Connection failed (${reconnectAttempts + 1}/${maxReconnectAttempts})`,
        })
      }

      ws.onclose = () => {
        set({ isPriceConnected: false, priceSocket: null })

        const timerId = setTimeout(() => {
          const {
            selectedCrypto: currentSymbol,
            isPlaying,
            reconnectAttempts: currentAttempts,
            maxReconnectAttempts: maxAttempts,
          } = get()

          if (isPlaying && currentAttempts < maxAttempts) {
            set({ reconnectAttempts: currentAttempts + 1 })
            get().connectPriceFeed(currentSymbol)
          } else if (currentAttempts >= maxAttempts) {
            set({ priceError: 'Max retries reached. Manual reconnect required.' })
          }
        }, 1)

        set({ priceReconnectTimer: timerId as unknown as NodeJS.Timeout })
      }
    } catch (error) {
      set({ isPriceConnected: false, priceError: 'Connection failed' })
    }
  },

  disconnectPriceFeed: () => {
    const { priceSocket, priceReconnectTimer } = get()

    // Clear reconnection timer
    if (priceReconnectTimer) {
      clearTimeout(priceReconnectTimer)
      set({ priceReconnectTimer: null })
    }

    // Close WebSocket
    if (priceSocket) {
      // Clear onclose handler to prevent reconnection trigger
      priceSocket.onclose = null
      priceSocket.onerror = null
      priceSocket.onmessage = null
      priceSocket.close()
      set({ priceSocket: null, isPriceConnected: false, priceData: null })
    }
  },

  resetGame: () => {
    set({
      roomId: null,
      players: [],
      tugOfWar: 0,
      activeOrders: new Map(),
      pendingOrders: new Map(),
      isPlaying: false,
      isMatching: false,
      latestSettlement: null,
    })
  },

  clearLatestSettlement: () => {
    set({ latestSettlement: null })
  },

  manualReconnect: () => {
    const { selectedCrypto } = get()
    set({ reconnectAttempts: 0, priceError: null })
    get().connectPriceFeed(selectedCrypto)
  },
}))
