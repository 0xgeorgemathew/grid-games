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
  RoundStartEvent,
  RoundEndEvent,
  RoundSummary,
  CoinType,
  PriceData,
  LobbyPlayer,
  LobbyPlayersEvent,
  LobbyUpdatedEvent,
} from '../types/trading'
import type { Toast } from '@/components/ToastNotifications'
import type { LeverageOption } from '@/lib/ens'

// Debug logging control - set DEBUG_FUNDS=true in .env.local to enable
const DEBUG_FUNDS = typeof process !== 'undefined' && process.env?.DEBUG_FUNDS === 'true'

// Export CryptoSymbol type for use in components
export type CryptoSymbol = 'btcusdt' // BTC only - like test-stream.ts

// Event bridge interface for React ↔ Phaser communication
// Both Phaser.Events.EventEmitter and Node's EventEmitter implement this subset
export interface PhaserEventBridge {
  emit(event: string, ...args: unknown[]): void
  on(event: string, listener: (...args: unknown[]) => void): void
  off(event: string, listener: (...args: unknown[]) => void): void
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

interface TradingState {
  // Connection
  socket: Socket | null
  isConnected: boolean
  isMatching: boolean
  isPlaying: boolean
  isGameOver: boolean
  gameOverData: GameOverEvent | null
  isSceneReady: boolean // Phaser scene is ready to receive events
  socketCleanupFunctions: Array<() => void>

  // Lobby state
  lobbyPlayers: LobbyPlayer[]
  isRefreshingLobby: boolean

  // User leverage (from ENS)
  userLeverage: LeverageOption | null // User's selected leverage for whale texture

  // Room/Players
  roomId: string | null
  localPlayerId: string | null
  isPlayer1: boolean
  players: Player[]

  // Round state
  currentRound: number
  player1Wins: number
  player2Wins: number
  isSuddenDeath: boolean // Final round mode (tied 1-1 entering round 3)
  roundTimeRemaining: number
  roundTimerInterval: number | null
  hasEmittedReady: boolean // Track if we've emitted scene_ready (once per game session)
  roundHistory: RoundSummary[] // Client-side round history for in-game stats

  // Game state
  tugOfWar: number
  activeOrders: Map<string, OrderPlacedEvent> // Active orders (5s countdown)
  pendingOrders: Map<string, SettlementEvent> // Settlement history
  latestSettlement: SettlementEvent | null // Latest settlement for flash notification
  toasts: Toast[] // Toast notifications

  // 2x multiplier state (whale power-up)
  whale2XActivatedAt: number | null // Timestamp when 2x was activated for local player
  whale2XExpiresAt: number | null // Timestamp when 2x expires for local player
  whaleMultiplier: number // Active whale multiplier (from ENS)

  // Audio state
  isSoundMuted: boolean

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
  findMatch: (playerName: string, walletAddress?: string) => void
  spawnCoin: (coin: CoinSpawnEvent) => void
  sliceCoin: (coinId: string, coinType: CoinType) => void
  handleSlice: (slice: SliceEvent) => void
  handleOrderPlaced: (order: OrderPlacedEvent) => void
  handleSettlement: (settlement: SettlementEvent) => void
  handleRoundStart: (data: RoundStartEvent) => void
  handleRoundEnd: (data: RoundEndEvent) => void
  handleGameOver: (data: GameOverEvent) => void
  handlePlayerHit: (data: { playerId: string; damage: number; reason: string }) => void
  removeActiveOrder: (orderId: string) => void
  cleanupOrphanedOrders: () => void
  connectPriceFeed: (symbol: CryptoSymbol) => void
  disconnectPriceFeed: () => void
  manualReconnect: () => void
  resetGame: () => void
  clearLatestSettlement: () => void
  addToast: (toast: Omit<Toast, 'id'>) => void
  removeToast: (id: string) => void
  clearToasts: () => void
  playAgain: () => void

  // Leverage actions
  setUserLeverage: (leverage: LeverageOption) => void

  // Audio actions
  toggleSound: () => void

  // Lobby actions
  getLobbyPlayers: () => void
  joinWaitingPool: (playerName: string, walletAddress?: string) => void
  leaveWaitingPool: () => void
  selectOpponent: (opponentSocketId: string) => void
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
// CRITICAL: Cap transfer at loser's available balance to enforce zero-sum (total always = 20)
function transferFunds(
  players: Player[],
  winnerId: string,
  loserId: string,
  amount: number
): Player[] {
  // Find loser to cap transfer at available balance (zero-sum enforcement)
  const loser = players.find((p) => p.id === loserId)
  const actualTransfer = Math.min(amount, loser?.dollars || 0)

  return players.map((p) => {
    if (p.id === winnerId) {
      return { ...p, dollars: p.dollars + actualTransfer }
    }
    if (p.id === loserId) {
      return { ...p, dollars: p.dollars - actualTransfer } // Goes to 0, never negative
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
  isGameOver: false,
  gameOverData: null,
  isSceneReady: false,
  socketCleanupFunctions: [],
  roomId: null,
  localPlayerId: null,
  isPlayer1: false,
  players: [],

  // User leverage
  userLeverage: null,

  // Lobby state
  lobbyPlayers: [],
  isRefreshingLobby: false,

  // Round state
  currentRound: 0,
  player1Wins: 0,
  player2Wins: 0,
  isSuddenDeath: false,
  roundTimeRemaining: 0, // Initialize to 0 - actual value set by round_start event
  roundTimerInterval: null,
  hasEmittedReady: false,
  roundHistory: [] as RoundSummary[],

  tugOfWar: 0,
  activeOrders: new Map(),
  pendingOrders: new Map(),
  latestSettlement: null,
  toasts: [],

  // 2x multiplier state
  whale2XActivatedAt: null,
  whale2XExpiresAt: null,
  whaleMultiplier: 2, // Default to 2x

  // Audio state
  isSoundMuted: false,

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

    // Listen for price broadcasts from server (single source of truth)
    socket.on(
      'btc_price',
      (data: { price: number; change: number; changePercent: number; timestamp: number }) => {
        const { firstPrice: currentFirstPrice } = get()

        // Initialize firstPrice on first price broadcast
        if (!currentFirstPrice && data.price > 0) {
          set({ firstPrice: data.price, isPriceConnected: true, priceError: null })
          return
        }

        if (!currentFirstPrice) return

        set({
          priceData: {
            symbol: 'BTC',
            price: data.price,
            change: data.change,
            changePercent: data.changePercent,
            tradeSize: 0,
            tradeSide: 'BUY',
            tradeTime: data.timestamp,
          },
          lastPriceUpdate: data.timestamp,
          isPriceConnected: true,
          priceError: null,
        })
      }
    )

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

    socket.on('round_start', (data: RoundStartEvent) => {
      get().handleRoundStart(data)
    })

    socket.on('round_end', (data: RoundEndEvent) => {
      get().handleRoundEnd(data)
    })

    socket.on('game_over', (data: GameOverEvent) => {
      get().handleGameOver(data)
    })

    socket.on('player_hit', (data: { playerId: string; damage: number; reason: string }) => {
      get().handlePlayerHit(data)
    })

    socket.on('opponent_disconnected', () => {
      get().addToast({ message: 'Opponent disconnected.', type: 'warning', duration: 5000 })
      get().resetGame()
    })

    socket.on(
      'whale_2x_activated',
      (data: { playerId: string; playerName: string; durationMs: number; multiplier: number }) => {
        const { localPlayerId } = get()
        const isLocalPlayer = data.playerId === localPlayerId

        // Store 2x activation time, expiration and multiplier if local player activated it
        if (isLocalPlayer) {
          const now = Date.now()
          set({
            whale2XActivatedAt: now, // Track when whale was activated
            whale2XExpiresAt: now + data.durationMs,
            whaleMultiplier: data.multiplier, // Store actual multiplier from ENS
          })
        }

        // Forward to Phaser for visual feedback
        if (window.phaserEvents) {
          window.phaserEvents.emit('whale_2x_activated', {
            ...data,
            isLocalPlayer,
          })
        }
      }
    )

    socket.on('lobby_players', (players: LobbyPlayersEvent) => {
      set({ lobbyPlayers: players, isRefreshingLobby: false })
    })

    socket.on('lobby_updated', (data: LobbyUpdatedEvent) => {
      // Filter out self from the lobby list (defense in depth)
      const { localPlayerId } = get()
      const filteredPlayers = data.players.filter((p) => p.socketId !== localPlayerId)
      set({ lobbyPlayers: filteredPlayers })
    })

    socket.on('joined_waiting_pool', () => {
      // Successfully joined waiting pool
    })

    socket.on('already_in_pool', () => {
      // Already in pool, no action needed
    })

    socket.on('error', (error: { message: string }) => {
      console.error('[Socket] Server error:', error.message)
      get().addToast({ message: error.message, type: 'error', duration: 5000 })
      set({ isMatching: false })
    })

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

  findMatch: (playerName: string, walletAddress?: string) => {
    const { socket } = get()

    // Use actual Phaser scene dimensions if available, otherwise window dimensions
    const sceneWidth =
      (window as { sceneDimensions?: { width: number; height: number } }).sceneDimensions?.width ||
      window.innerWidth
    const sceneHeight =
      (window as { sceneDimensions?: { width: number; height: number } }).sceneDimensions?.height ||
      window.innerHeight

    socket?.emit('find_match', { playerName, sceneWidth, sceneHeight, walletAddress })
    set({ isMatching: true })
  },

  spawnCoin: (coin) => {
    if (get().isSceneReady && window.phaserEvents) {
      window.phaserEvents.emit('coin_spawn', coin)
    }
  },

  sliceCoin: (coinId, coinType) => {
    const { socket, localPlayerId } = get()
    if (!socket || !localPlayerId) return

    // Server uses its own price feed for order creation (single source of truth)
    socket.emit('slice_coin', {
      coinId,
      coinType,
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
    const { isPlayer1, players, pendingOrders, tugOfWar, activeOrders, localPlayerId } = get()
    // Use the actual amount transferred from server (includes 2x multiplier)
    const amount = settlement.amountTransferred ?? getDamageForCoinType(settlement.coinType)

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

  handleRoundStart: (data) => {
    const { roundTimerInterval } = get()

    // Clear previous round timer
    if (roundTimerInterval) {
      clearInterval(roundTimerInterval)
    }

    set({
      currentRound: data.roundNumber,
      isSuddenDeath: data.isSuddenDeath,
      roundTimeRemaining: data.durationMs,
    })

    // Start countdown timer (updates every 100ms)
    const interval = setInterval(() => {
      const { roundTimeRemaining: remaining } = get()
      const newRemaining = Math.max(0, remaining - 100)
      if (newRemaining === 0) {
        clearInterval(get().roundTimerInterval as unknown as number)
        set({ roundTimerInterval: null })
      }
      set({ roundTimeRemaining: newRemaining })
    }, 100) as unknown as number

    set({ roundTimerInterval: interval })
  },

  handleRoundEnd: (data) => {
    const { roundTimerInterval, roundHistory } = get()

    // Clear round timer
    if (roundTimerInterval) {
      clearInterval(roundTimerInterval)
      set({ roundTimerInterval: null })
    }

    // Build round summary for client-side tracking
    const p1Gained = data.player1Gained
    const p2Gained = data.player2Gained
    const winnerGained = data.isTie ? 0 : Math.max(p1Gained, p2Gained)

    const roundSummary: RoundSummary = {
      roundNumber: data.roundNumber,
      winnerId: data.winnerId,
      isTie: data.isTie,
      player1Dollars: data.player1Dollars,
      player2Dollars: data.player2Dollars,
      player1Gained: p1Gained,
      player2Gained: p2Gained,
      playerLost: winnerGained,
    }

    set({
      player1Wins: data.player1Wins,
      player2Wins: data.player2Wins,
      // CRITICAL: Clear order maps to prevent stale state
      activeOrders: new Map(),
      pendingOrders: new Map(),
      roundHistory: [...roundHistory, roundSummary],
    })

    // Emit custom event for RoundEndFlash component ONLY for intermediate rounds
    // Skip for final rounds (game over) to show GameOverModal immediately
    if (!data.isFinalRound) {
      window.dispatchEvent(
        new CustomEvent('round_end_flash', {
          detail: {
            roundNumber: data.roundNumber,
            winnerId: data.winnerId,
            isTie: data.isTie,
            player1Gained: data.player1Gained,
            player2Gained: data.player2Gained,
          },
        })
      )
    }

    // Clear coins from Phaser scene
    if (window.phaserEvents) {
      window.phaserEvents.emit('clear_coins')
    }

    // TOAST REMOVED: Redundant with RoundEndFlash and caused UI overlap
    // TOAST REMOVED: Redundant with RoundEndFlash and caused UI overlap

    // Update player dollars from server
    const { players } = get()
    // Need playerIds to map correctly - assuming players order matches or using explicit IDs if available
    // But data has player1Dollars and player2Dollars. We need to know who is who.
    // The previous code used playerIds[0] and [1].
    const playerIds = players.map((p) => p.id)

    const newPlayers = players.map((p) => {
      if (p.id === playerIds[0]) return { ...p, dollars: data.player1Dollars }
      if (p.id === playerIds[1]) return { ...p, dollars: data.player2Dollars }
      return p
    })

    set({ players: newPlayers })

    // Emit round_ready to signal we're ready for next round ONLY if game continues
    // Skip for final rounds (game over) to prevent post-game-over round starts
    if (!data.isFinalRound) {
      const { socket } = get()
      if (socket && socket.connected) {
        socket.emit('round_ready')
        // console.log('[Client] Emitted round_ready for next round')
      }
    }
  },

  handleGameOver: (data) => {
    // Clear coins immediately on game over
    if (window.phaserEvents) {
      window.phaserEvents.emit('clear_coins')
    }

    const { localPlayerId } = get()
    const isWinner = data.winnerId === localPlayerId
    get().addToast({
      message: isWinner ? '🎉 You WIN!' : `😢 ${data.winnerName} wins!`,
      type: isWinner ? 'success' : 'error',
      duration: 0, // No auto-dismiss - stays until user clicks Play Again
    })

    // Set game over state but DON'T reset yet - wait for user to click Play Again
    set({ isGameOver: true, gameOverData: data })
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
      if (now - order.settlesAt > 3000) {
        // Reduced from 15000 to 3000
        newActiveOrders.delete(orderId)
      }
    }

    if (newActiveOrders.size !== activeOrders.size) {
      set({ activeOrders: newActiveOrders })
    }
  },

  connectPriceFeed: (symbol: CryptoSymbol) => {
    // Price now comes from server via Socket.IO broadcasts (single source of truth)
    // No direct WebSocket connection needed
    set({ selectedCrypto: symbol })
  },

  disconnectPriceFeed: () => {
    // Price now comes from server via Socket.IO broadcasts (single source of truth)
    // No WebSocket to clean up - just clear state
    set({ priceData: null, isPriceConnected: false, firstPrice: null })
  },

  resetGame: () => {
    const { roundTimerInterval } = get()
    if (roundTimerInterval) {
      clearInterval(roundTimerInterval)
    }
    set({
      roomId: null,
      players: [],
      tugOfWar: 0,
      activeOrders: new Map(),
      pendingOrders: new Map(),
      isPlaying: false,
      isMatching: false,
      latestSettlement: null,
      whale2XActivatedAt: null, // Clear 2x activation time
      whale2XExpiresAt: null, // Clear 2x state
      whaleMultiplier: 2, // Reset to default
      // Round state reset
      currentRound: 0,
      player1Wins: 0,
      player2Wins: 0,
      isSuddenDeath: false,
      roundTimeRemaining: 0, // Reset to 0 instead of 100000
      roundTimerInterval: null,
      hasEmittedReady: false, // Reset ready flag for next game
      roundHistory: [], // Clear round history
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

  addToast: (toast) => {
    const id = Math.random().toString(36).substring(7)
    const newToast = { ...toast, id }
    set({ toasts: [...get().toasts, newToast] })

    // Auto-remove after duration (default 3s)
    const duration = toast.duration ?? 3000
    setTimeout(() => {
      get().removeToast(id)
    }, duration)
  },

  removeToast: (id) => {
    const { toasts } = get()
    set({ toasts: toasts.filter((t) => t.id !== id) })
  },

  clearToasts: () => set({ toasts: [] }),

  playAgain: () => {
    const { toasts } = get()
    // Clear the game-over toast specifically (or all toasts)
    set({ toasts: [] })
    get().resetGame()
    set({ isGameOver: false, gameOverData: null })
  },

  setUserLeverage: (leverage) => {
    set({ userLeverage: leverage })
  },

  // Lobby actions
  getLobbyPlayers: () => {
    const { socket } = get()
    if (!socket) return
    set({ isRefreshingLobby: true })
    socket.emit('get_lobby_players')
    // Safety timeout in case server doesn't respond
    setTimeout(() => set({ isRefreshingLobby: false }), 5000)
  },

  joinWaitingPool: (playerName: string, walletAddress?: string) => {
    const { socket } = get()
    if (!socket) return

    // Use actual Phaser scene dimensions if available, otherwise window dimensions
    const sceneWidth =
      (window as { sceneDimensions?: { width: number; height: number } }).sceneDimensions?.width ||
      window.innerWidth
    const sceneHeight =
      (window as { sceneDimensions?: { width: number; height: number } }).sceneDimensions?.height ||
      window.innerHeight

    socket.emit('join_waiting_pool', { playerName, sceneWidth, sceneHeight, walletAddress })
  },

  leaveWaitingPool: () => {
    const { socket } = get()
    if (!socket) return
    socket.emit('leave_waiting_pool')
  },

  selectOpponent: (opponentSocketId: string) => {
    const { socket } = get()
    if (!socket) return
    // Just emit select_opponent - we're already in the waiting pool from joinWaitingPool
    socket.emit('select_opponent', { opponentSocketId })
    set({ isMatching: true })
  },

  toggleSound: () => {
    const { isSoundMuted } = get()
    const newMutedState = !isSoundMuted
    set({ isSoundMuted: newMutedState })
    // Notify Phaser scene via bridge
    if (window.phaserEvents) {
      window.phaserEvents.emit('sound_muted', newMutedState)
    }
  },
}))
