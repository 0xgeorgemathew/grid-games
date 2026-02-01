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

  // Room/Players
  roomId: string | null
  localPlayerId: string | null
  isPlayer1: boolean
  players: Player[]

  // Game state
  tugOfWar: number
  activeOrders: Map<string, OrderPlacedEvent> // Active orders (10s countdown)
  pendingOrders: Map<string, SettlementEvent> // Settlement history

  // Price feed
  priceSocket: WebSocket | null
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
  connectPriceFeed: (symbol: CryptoSymbol) => void
  disconnectPriceFeed: () => void
  manualReconnect: () => void
  resetGame: () => void
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

function getTargetPlayerId(settlement: SettlementEvent, players: Player[]): string | undefined {
  // Correct prediction damages opponent, incorrect damages self
  if (settlement.isCorrect) {
    return players.find((p) => p.id !== settlement.playerId)?.id
  }
  return settlement.playerId
}

export const useTradingStore = create<TradingState>((set, get) => ({
  socket: null,
  isConnected: false,
  isMatching: false,
  isPlaying: false,
  isSceneReady: false,
  roomId: null,
  localPlayerId: null,
  isPlayer1: false,
  players: [],
  tugOfWar: 0,
  activeOrders: new Map(),
  pendingOrders: new Map(),

  // Price feed state
  priceSocket: null,
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
    const socket = io({
      transports: ['websocket', 'polling'],
    })

    socket.on('connect', () => {
      set({ isConnected: true, localPlayerId: socket.id })
    })

    socket.on('disconnect', () => {
      set({ isConnected: false })
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

    set({ socket })
  },

  disconnect: () => {
    const { socket } = get()
    socket?.disconnect()
    get().resetGame()
    set({ socket: null, isConnected: false })
  },

  findMatch: (playerName: string) => {
    const { socket } = get()
    socket?.emit('find_match', { playerName })
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
    // Mutate the Map in place to avoid triggering unnecessary re-renders
    activeOrders.set(order.orderId, order)
    set({ activeOrders })
  },

  handleSettlement: (settlement) => {
    const { isPlayer1, players, pendingOrders, tugOfWar, activeOrders } = get()
    const damage = getDamageForCoinType(settlement.coinType)

    const tugOfWarDelta = calculateTugOfWarDelta(isPlayer1, settlement.isCorrect, damage)
    const targetPlayerId = getTargetPlayerId(settlement, players)

    // Remove from active orders and add to settlement history
    activeOrders.delete(settlement.orderId)
    pendingOrders.set(settlement.orderId, settlement)

    set({
      activeOrders,
      pendingOrders,
      tugOfWar: Math.max(TUG_OF_WAR_MIN, Math.min(TUG_OF_WAR_MAX, tugOfWar + tugOfWarDelta)),
      players: targetPlayerId ? applyDamageToPlayer(players, targetPlayerId, damage) : players,
    })
  },

  handlePlayerHit: (data) => {
    const { isPlayer1, players, tugOfWar } = get()
    const tugOfWarDelta = calculateTugOfWarDelta(isPlayer1, false, data.damage)

    set({
      players: applyDamageToPlayer(players, data.playerId, data.damage),
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
    activeOrders.delete(orderId)
    set({ activeOrders })
  },

  connectPriceFeed: (symbol: CryptoSymbol) => {
    const { priceSocket, reconnectAttempts, maxReconnectAttempts } = get()

    // Close existing connection if any
    if (priceSocket) {
      priceSocket.close()
    }

    set({
      selectedCrypto: symbol,
      isPriceConnected: false,
      priceData: null,
      priceError: null,
      firstPrice: null,
    })

    try {
      // Connect to Binance WebSocket with aggTrade stream
      const ws = new WebSocket(`${BINANCE_WS_URL}/${symbol}@aggTrade`)

      let firstPrice: number | null = null

      ws.onopen = () => {
        set({ isPriceConnected: true, priceSocket: ws, reconnectAttempts: 0, priceError: null })
      }

      let lastPriceUpdate = 0
      const PRICE_THROTTLE_MS = 500 // Update UI max 2x per second

      ws.onmessage = (event) => {
        const raw = JSON.parse(event.data)

        // Parse aggregate trade format
        const trade = {
          price: parseFloat(raw.p),
          size: parseFloat(raw.q),
          side: raw.m ? ('SELL' as const) : ('BUY' as const),
          timestamp: raw.T,
        }

        // Initialize firstPrice on first trade
        if (!firstPrice) {
          firstPrice = trade.price
          set({ firstPrice })
        }

        // Calculate change from first price of session
        const change = trade.price - firstPrice
        const changePercent = (change / trade.price) * 100

        const now = Date.now()

        // Always update priceData (needed for settlements), but throttle UI updates
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

      ws.onerror = (error) => {
        const errorContext = {
          type: 'WebSocket error',
          url: `${BINANCE_WS_URL}/${symbol}@aggTrade`,
          timestamp: new Date().toISOString(),
          readyState: ws.readyState,
        }
        console.error('[PriceFeed] WebSocket error:', errorContext)

        set({
          isPriceConnected: false,
          priceError: `Connection failed (${reconnectAttempts + 1}/${maxReconnectAttempts})`,
        })
      }

      ws.onclose = () => {
        set({ isPriceConnected: false, priceSocket: null })

        // Exponential backoff reconnection
        const baseDelay = 1000
        const maxDelay = 30000
        const delay = Math.min(maxDelay, baseDelay * Math.pow(2, reconnectAttempts))

        setTimeout(() => {
          const {
            selectedCrypto,
            isPlaying,
            reconnectAttempts: currentAttempts,
            maxReconnectAttempts: maxAttempts,
          } = get()
          if (isPlaying && currentAttempts < maxAttempts) {
            set({ reconnectAttempts: currentAttempts + 1 })
            get().connectPriceFeed(selectedCrypto)
          } else if (currentAttempts >= maxAttempts) {
            set({ priceError: 'Max retries reached. Manual reconnect required.' })
          }
        }, delay)
      }

      set({ priceSocket: ws })
    } catch (error) {
      console.error('[PriceFeed] Failed to connect:', error)
      set({ isPriceConnected: false, priceError: 'Connection failed' })
    }
  },

  disconnectPriceFeed: () => {
    const { priceSocket } = get()
    if (priceSocket) {
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
    })
  },

  manualReconnect: () => {
    const { selectedCrypto } = get()
    set({ reconnectAttempts: 0, priceError: null })
    get().connectPriceFeed(selectedCrypto)
  },
}))
