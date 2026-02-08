import { Server as SocketIOServer } from 'socket.io'
import { Socket } from 'socket.io'
import { Player, RoundSummary } from '@/game/types/trading'
import { DEFAULT_BTC_PRICE } from '@/lib/formatPrice'
import { GAME_CONFIG } from '@/game/constants'

// Yellow App Sessions
import {
  createGameAppSession,
  updateGameRound,
  closeGameAppSession,
  createSessionKeySigner,
} from '@/lib/yellow/app-session-manager'
import type { CreateAppSessionParams } from '@/lib/yellow/rpc-client'
import type { Allocation } from '@/lib/yellow/rpc-client'
import type { SubmitAppStateResponse } from '@/lib/yellow/rpc-client'
import type { CloseAppSessionResponse } from '@/lib/yellow/rpc-client'
import { getRPCClient } from '@/lib/yellow/rpc-client'
import type { AuthenticatedSession } from '@/lib/yellow/authentication'
import { signWithSessionKey } from '@/lib/yellow/authentication'
import { YELLOW_APPLICATION_NAME, YELLOW_TOKEN } from '@/lib/yellow/config'

// Initialize RPC client
async function initializeYellowRPC() {
  try {
    const rpcClient = getRPCClient()
    if (!rpcClient.isConnected) {
      await rpcClient.connect()
    }
    console.log('[Yellow] RPC client initialized')
  } catch (error) {
    console.error('[Yellow] Failed to initialize RPC client:', error)
  }
}

// Order settlement duration - time between slice and settlement (5 seconds)
export const ORDER_SETTLEMENT_DURATION_MS = GAME_CONFIG.ORDER_SETTLEMENT_DURATION_MS

// Debug logging control - set DEBUG_FUNDS=true in .env.local to enable
const DEBUG_FUNDS = process.env.DEBUG_FUNDS === 'true'

// =============================================================================
// SettlementGuard - Prevent duplicate settlement race conditions
// =============================================================================

class SettlementGuard {
  private inProgress = new Set<string>()
  private timestamps = new Map<string, number>()
  private cleanupInterval: NodeJS.Timeout | null = null
  private readonly STALE_THRESHOLD_MS = 30000
  private readonly CLEANUP_INTERVAL_MS = 60000

  start(): void {
    if (this.cleanupInterval) return

    this.cleanupInterval = setInterval(() => {
      const now = Date.now()
      for (const [orderId, timestamp] of this.timestamps) {
        if (now - timestamp > this.STALE_THRESHOLD_MS) {
          this.inProgress.delete(orderId)
          this.timestamps.delete(orderId)
        }
      }
    }, this.CLEANUP_INTERVAL_MS)
  }

  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
  }

  tryAcquire(orderId: string): boolean {
    if (this.inProgress.has(orderId)) return false
    this.inProgress.add(orderId)
    this.timestamps.set(orderId, Date.now())
    return true
  }

  release(orderId: string): void {
    this.inProgress.delete(orderId)
    this.timestamps.delete(orderId)
  }
}

const settlementGuard = new SettlementGuard()

// =============================================================================
// Seeded RNG - Deterministic coin sequences for fair play
// =============================================================================

// Seeded random number generator for deterministic sequences
class SeededRandom {
  private seed: number

  constructor(seed: number) {
    this.seed = seed
  }

  next(): number {
    this.seed = (this.seed * 1664525 + 1013904223) % 4294967296
    return this.seed / 4294967296
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min
  }
}

// Pre-generated coin sequence per round
class CoinSequence {
  private sequence: Array<'call' | 'put' | 'gas' | 'whale'> = []
  private index = 0

  constructor(durationMs: number, minIntervalMs: number, maxIntervalMs: number, seed: number) {
    const rng = new SeededRandom(seed)
    const types: Array<'call' | 'put' | 'gas' | 'whale'> = [
      'call',
      'call',
      'put',
      'put',
      'gas',
      'whale',
    ]

    const estimatedSpawns = Math.ceil(durationMs / minIntervalMs) + 5
    for (let i = 0; i < estimatedSpawns; i++) {
      this.sequence.push(types[rng.nextInt(0, types.length - 1)])
    }
  }

  next(): 'call' | 'put' | 'gas' | 'whale' | null {
    if (this.index >= this.sequence.length) return null
    return this.sequence[this.index++]
  }

  hasNext(): boolean {
    return this.index < this.sequence.length
  }
}

// =============================================================================
// Price Feed Manager - Real-time Binance WebSocket
// =============================================================================

class PriceFeedManager {
  private ws: WebSocket | null = null
  private latestPrice: number = DEFAULT_BTC_PRICE
  private subscribers: Set<(price: number) => void> = new Set()
  private reconnectTimeout: NodeJS.Timeout | null = null
  private symbol: string = 'btcusdt'
  private isShutdown = false

  connect(symbol: string = 'btcusdt'): void {
    // Exit if shutdown
    if (this.isShutdown) return

    this.symbol = symbol

    // Clear any pending reconnect timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }

    if (this.ws) {
      this.ws.close()
    }

    const url = `wss://stream.binance.com:9443/ws/${symbol}@aggTrade`
    this.ws = new WebSocket(url)

    this.ws.onmessage = (event) => {
      if (this.isShutdown) return
      const raw = JSON.parse(event.data.toString())
      const price = parseFloat(raw.p)

      // Update latest price
      this.latestPrice = price
      this.subscribers.forEach((cb) => cb(price))
    }

    this.ws.onerror = (error) => {
      if (this.isShutdown) return
      // console.error('[PriceFeed] Server WebSocket error:', error)
    }

    this.ws.onclose = () => {
      // Exit if shutdown
      if (this.isShutdown) return

      // Auto-reconnect after 5s
      this.reconnectTimeout = setTimeout(() => {
        if (!this.isShutdown) {
          this.connect(this.symbol)
        }
      }, 5000)
    }
  }

  disconnect(): void {
    this.isShutdown = true

    // Clear reconnect timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }

    // Close WebSocket
    if (this.ws) {
      this.ws.onclose = null // Prevent reconnect trigger
      this.ws.onerror = null
      this.ws.onmessage = null
      this.ws.close()
      this.ws = null
    }

    // Clear subscribers
    this.subscribers.clear()
  }

  getLatestPrice(): number {
    return this.latestPrice
  }

  subscribe(callback: (price: number) => void): () => void {
    this.subscribers.add(callback)
    return () => this.subscribers.delete(callback)
  }
}

const priceFeed = new PriceFeedManager()

// =============================================================================
// Type Definitions
// =============================================================================

interface WaitingPlayer {
  name: string
  socketId: string
  joinedAt: number
  sceneWidth?: number
  sceneHeight?: number
  walletAddress?: string
}

interface Coin {
  id: string
  type: 'call' | 'put' | 'gas' | 'whale'
  x: number
  y: number
}

// Server-side order type (same structure as client OrderPlacedEvent)
interface PendingOrder {
  id: string
  playerId: string
  playerName: string
  coinType: 'call' | 'put' | 'whale'
  priceAtOrder: number
  settlesAt: number
  isPlayer1: boolean // Stored at order creation to avoid lookup issues at settlement
  multiplier: number // Stored at order creation - 2 if 2x was active when placed, 1 otherwise
}

// =============================================================================
// GameRoom Class - Encapsulates room state and lifecycle
// =============================================================================

class GameRoom {
  readonly id: string
  readonly players: Map<string, Player>
  readonly coins: Map<string, Coin>
  readonly pendingOrders: Map<string, PendingOrder>
  tugOfWar = 0
  private isClosing = false
  isShutdown = false // Prevents settlement timeouts from operating on deleted rooms

  private intervals = new Set<NodeJS.Timeout>()
  private timeouts = new Set<NodeJS.Timeout>()

  // Fruit Ninja-style spawn mechanics
  readonly gameStartTime: number
  readonly GAME_DURATION = 180000 // 3 minutes (legacy, not used in round-based play)

  // Round-based game state
  currentRound: number = 1
  player1Wins: number = 0
  player2Wins: number = 0
  player1CashAtRoundStart: number = GAME_CONFIG.STARTING_CASH
  player2CashAtRoundStart: number = GAME_CONFIG.STARTING_CASH
  isSuddenDeath: boolean = false
  readonly ROUND_DURATION = GAME_CONFIG.ROUND_DURATION_MS // 30 seconds

  // Deterministic coin sequence
  private coinSequence: CoinSequence | null = null

  // Round history for game over summary
  roundHistory: RoundSummary[] = []

  // Per-player 2X mode tracking (whale power-up)
  private whale2XActive = new Map<string, number>() // playerId -> expiration timestamp
  readonly WHALE_2X_DURATION = 10000 // 10 seconds

  // Yellow Network state channel
  channelId: string | null = null // Legacy: for backward compatibility
  channelStatus: 'INITIAL' | 'ACTIVE' | 'FINAL' = 'INITIAL'
  player1Address: `0x${string}` | null = null
  player2Address: `0x${string}` | null = null
  channelNonce: bigint | null = null // Store nonce for channel creation
  initialState: any = null // Store server-signed initial state
  channelCreatedOnChain: boolean = false // Track if on-chain channel creation completed

  // Yellow App Sessions (NEW)
  appSessionId: string | null = null // App session ID
  appSession: any = null // Full app session data
  appSessionVersion: number = 1 // Current version for state updates
  appSessionAllocations: any[] = [] // Current allocations
  // App session creation params (for collecting signatures before RPC call)
  yellowAppSessionParams: {
    createParams: any
    nonce: number
    sortedAddresses: string[] // Wallet addresses (for participants array)
    sortedSessionKeyAddresses: string[] // Session key addresses (for signature lookup)
    signatures: Array<{ walletAddress: string; signature: string }>
    // Track requestId and timestamp used for signing
    requestId: number
    timestamp: number
  } | null = null
  // Track app session signatures separately from state signatures
  yellowAppSessionSignatures: Map<string, string> = new Map() // walletAddress -> signature
  // Track requestId and timestamp from first participant
  yellowAppSessionRequestId: number = 0
  yellowAppSessionTimestamp: number = 0

  // Track which socket ID corresponds to which wallet address
  addressToSocketId: Map<string, string> = new Map()
  // Track player deposit status (wallet address -> deposited)
  yellowDeposits: Map<string, boolean> = new Map()
  yellowApprovals: Map<string, boolean> = new Map()
  // Track signatures for initial state (wallet address -> signature)
  yellowSignatures: Map<string, string> = new Map()

  // Track wallet signatures for submit_app_state and close_app_session
  // These are MAIN WALLET signatures (not session key signatures) because
  // Yellow Network's app session participants are wallet addresses
  yellowWalletSignatureRequests: Map<
    string,
    {
      method: 'submit_app_state' | 'close_app_session'
      submitParams?: any
      closeParams?: any
      requestId: number
      timestamp: number
      sortedAddresses: string[]
      signatures: Map<string, string> // walletAddress -> signature
      resolve: (result: { signatures: string[]; requestId: number; timestamp: number }) => void
      reject: (error: Error) => void
      timeout?: NodeJS.Timeout
    }
  > = new Map()

  constructor(roomId: string) {
    this.id = roomId
    this.players = new Map()
    this.coins = new Map()
    this.pendingOrders = new Map()
    this.gameStartTime = Date.now()
  }

  // Convenience getters for player IDs
  get player1Id(): string | undefined {
    return this.getPlayerIds()[0]
  }

  get player2Id(): string | undefined {
    return this.getPlayerIds()[1]
  }

  // Check if player has active 2X mode
  hasWhale2X(playerId: string): boolean {
    const expiresAt = this.whale2XActive.get(playerId)
    if (!expiresAt) return false
    if (Date.now() > expiresAt) {
      this.whale2XActive.delete(playerId)
      return false
    }
    return true
  }

  // Activate 2X mode for a player
  activateWhale2X(playerId: string): void {
    const expiresAt = Date.now() + this.WHALE_2X_DURATION
    this.whale2XActive.set(playerId, expiresAt)
  }

  // Get 2X multiplier for a player (2 if active, 1 if not)
  get2XMultiplier(playerId: string): number {
    return this.hasWhale2X(playerId) ? 2 : 1
  }

  // Get player dollars by wallet address (for Yellow channel settlements)
  getDollarsByWalletAddress(walletAddress: string): number {
    const socketId = this.addressToSocketId.get(walletAddress.toLowerCase())
    if (!socketId) return GAME_CONFIG.STARTING_CASH // fallback to starting amount
    const player = this.players.get(socketId)
    return player?.dollars ?? GAME_CONFIG.STARTING_CASH
  }

  addPlayer(id: string, name: string, sceneWidth: number, sceneHeight: number): void {
    this.players.set(id, {
      id,
      name,
      dollars: GAME_CONFIG.STARTING_CASH,
      score: 0,
      sceneWidth,
      sceneHeight,
    })
  }

  removePlayer(id: string): void {
    this.players.delete(id)
  }

  hasPlayer(id: string): boolean {
    return this.players.has(id)
  }

  getPlayerIds(): string[] {
    return Array.from(this.players.keys())
  }

  isEmpty(): boolean {
    return this.players.size === 0
  }

  addCoin(coin: Coin): void {
    this.coins.set(coin.id, coin)
  }

  removeCoin(coinId: string): void {
    this.coins.delete(coinId)
  }

  addPendingOrder(order: PendingOrder): void {
    this.pendingOrders.set(order.id, order)
  }

  removePendingOrder(orderId: string): void {
    this.pendingOrders.delete(orderId)
  }

  // Track intervals/timeout for cleanup
  trackTimeout(timeout: NodeJS.Timeout): void {
    this.timeouts.add(timeout)
  }

  trackInterval(interval: NodeJS.Timeout): void {
    this.intervals.add(interval)
  }

  // Clear all tracked timers
  cleanup(): void {
    this.intervals.forEach(clearInterval)
    this.timeouts.forEach(clearTimeout)
    this.intervals.clear()
    this.timeouts.clear()
  }

  // Find winner (highest dollars, or first if tied)
  getWinner(): Player | undefined {
    const players = Array.from(this.players.values())
    if (players.length === 0) {
      return undefined
    }
    return players.reduce((a, b) => (a.dollars > b.dollars ? a : b), players[0])
  }

  // Check if any player is dead
  hasDeadPlayer(): boolean {
    return Array.from(this.players.values()).some((p) => p.dollars <= 0)
  }

  // =============================================================================
  // Round Management Methods
  // =============================================================================

  // Track cash at round start for determining round winner by dollars gained
  startNewRound(): void {
    const playerIds = this.getPlayerIds()
    this.player1CashAtRoundStart =
      this.players.get(playerIds[0])?.dollars || GAME_CONFIG.STARTING_CASH
    this.player2CashAtRoundStart =
      this.players.get(playerIds[1])?.dollars || GAME_CONFIG.STARTING_CASH
  }

  // Determine round winner by cash gained (not absolute dollars)
  getRoundWinner(): { winnerId: string | null; isTie: boolean } {
    const playerIds = this.getPlayerIds()
    const p1 = this.players.get(playerIds[0])
    const p2 = this.players.get(playerIds[1])

    if (!p1 || !p2) return { winnerId: null, isTie: false }

    const p1Gained = p1.dollars - this.player1CashAtRoundStart
    const p2Gained = p2.dollars - this.player2CashAtRoundStart

    if (p1Gained > p2Gained) return { winnerId: playerIds[0], isTie: false }
    if (p2Gained > p1Gained) return { winnerId: playerIds[1], isTie: false }
    return { winnerId: null, isTie: true }
  }

  // Check if game should end (2 wins OR 3 rounds played OR sudden-death winner)
  checkGameEndCondition(): boolean {
    // CRITICAL: Best-of-three means max 3 rounds - game ends after Round 3
    if (this.currentRound >= 3) return true

    if (this.isSuddenDeath) {
      // In sudden death, game ends if there's a winner (not a tie)
      return this.player1Wins !== this.player2Wins
    }
    // Best-of-three: 2 wins ends game early
    return this.player1Wins === 2 || this.player2Wins === 2
  }

  // Determine overall game winner
  getGameWinner(): Player | undefined {
    if (this.player1Wins > this.player2Wins) {
      return this.players.get(this.getPlayerIds()[0])
    }
    if (this.player2Wins > this.player1Wins) {
      return this.players.get(this.getPlayerIds()[1])
    }
    // Tie-breaker: if wins are equal (e.g., 1-1 after 3 rounds), winner is player with more dollars
    const playerIds = this.getPlayerIds()
    const p1 = this.players.get(playerIds[0])
    const p2 = this.players.get(playerIds[1])
    if (!p1 || !p2) return undefined
    return p1.dollars > p2.dollars ? p1 : p2.dollars > p1.dollars ? p2 : undefined
  }

  // Closing state management
  getIsClosing(): boolean {
    return this.isClosing
  }

  setClosing(): void {
    this.isClosing = true
  }

  // Fruit Ninja-style spawn rate
  getSpawnInterval(): { minMs: number; maxMs: number } {
    return { minMs: 2000, maxMs: 3000 }
  }

  // Initialize deterministic coin sequence for this round
  initCoinSequence(): void {
    const seed = this.hashString(`${this.id}-round${this.currentRound}`)
    const spawnConfig = this.getSpawnInterval()
    this.coinSequence = new CoinSequence(
      this.ROUND_DURATION,
      spawnConfig.minMs,
      spawnConfig.maxMs,
      seed
    )
  }

  // Hash string to number for seeding
  private hashString(str: string): number {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash
    }
    return Math.abs(hash)
  }

  // Get next coin type from deterministic sequence
  getNextCoinType(): 'call' | 'put' | 'gas' | 'whale' | null {
    return this.coinSequence?.next() ?? null
  }
}

// =============================================================================
// RoomManager - Manages all rooms and waiting players
// =============================================================================

class RoomManager {
  private rooms = new Map<string, GameRoom>()
  private waitingPlayers = new Map<string, WaitingPlayer>()
  private playerToRoom = new Map<string, string>()

  // Room operations
  createRoom(roomId: string): GameRoom {
    const room = new GameRoom(roomId)
    this.rooms.set(roomId, room)
    return room
  }

  getRoom(roomId: string): GameRoom | undefined {
    return this.rooms.get(roomId)
  }

  hasRoom(roomId: string): boolean {
    return this.rooms.has(roomId)
  }

  deleteRoom(roomId: string): void {
    const room = this.rooms.get(roomId)
    if (!room) return

    // Mark room as shutdown BEFORE cleanup (prevents settlement timeouts from operating)
    room.isShutdown = true

    // Clear player mappings
    for (const playerId of room.getPlayerIds()) {
      this.playerToRoom.delete(playerId)
    }

    // Cleanup room timers
    room.cleanup()

    // Delete room
    this.rooms.delete(roomId)
  }

  // Player-to-room lookup
  setPlayerRoom(playerId: string, roomId: string): void {
    this.playerToRoom.set(playerId, roomId)
  }

  getPlayerRoomId(playerId: string): string | undefined {
    return this.playerToRoom.get(playerId)
  }

  removePlayerFromRoom(playerId: string): void {
    const roomId = this.playerToRoom.get(playerId)
    if (roomId) {
      const room = this.rooms.get(roomId)
      room?.removePlayer(playerId)
      if (room?.isEmpty()) {
        this.deleteRoom(roomId)
      }
    }
    this.playerToRoom.delete(playerId)
  }

  // Waiting players
  addWaitingPlayer(socketId: string, name: string): void {
    this.waitingPlayers.set(socketId, {
      name,
      socketId,
      joinedAt: Date.now(),
    })
  }

  getWaitingPlayer(socketId: string): WaitingPlayer | undefined {
    return this.waitingPlayers.get(socketId)
  }

  removeWaitingPlayer(socketId: string): void {
    this.waitingPlayers.delete(socketId)
  }

  getWaitingPlayers(): Map<string, WaitingPlayer> {
    return this.waitingPlayers
  }

  // Cleanup stale waiting players (older than 30s)
  cleanupStaleWaitingPlayers(): void {
    const now = Date.now()
    for (const [id, player] of this.waitingPlayers) {
      if (now - player.joinedAt > 30000) {
        this.waitingPlayers.delete(id)
      }
    }
  }

  // Emergency shutdown - settles all pending orders and clears all state
  emergencyShutdown(io: SocketIOServer): void {
    // console.log('[RoomManager] Emergency shutdown - settling all pending orders...')

    // Settle all pending orders in all rooms
    for (const [roomId, room] of this.rooms) {
      // Mark room as shutdown to prevent new events
      room.isShutdown = true

      // Settle all pending orders immediately
      for (const [orderId, order] of room.pendingOrders) {
        settleOrder(io, room, order)
      }

      // Notify players of shutdown
      const winner = room.getWinner()
      io.to(roomId).emit('game_over', {
        winnerId: winner?.id,
        winnerName: winner?.name,
        roomId,
        reason: 'server_shutdown',
        rounds: room.roundHistory,
      })

      // Cleanup room timers
      room.cleanup()
    }

    // Clear manager state
    this.rooms.clear()
    this.waitingPlayers.clear()
    this.playerToRoom.clear()

    // console.log('[RoomManager] Emergency shutdown complete - all orders settled')
  }
}

// =============================================================================
// Input Validation
// =============================================================================

function validatePlayerName(name: unknown): string {
  if (typeof name !== 'string' || name.length < 1 || name.length > 20) {
    throw new Error('Invalid player name')
  }
  return name.replace(/[^a-zA-Z0-9_-]/g, '')
}

function validateCoinType(coinType: string): coinType is 'call' | 'put' | 'whale' {
  return coinType === 'call' || coinType === 'put' || coinType === 'whale'
}

// =============================================================================
// Game Logic - Order Settlement
// =============================================================================

function settleOrder(io: SocketIOServer, room: GameRoom, order: PendingOrder): void {
  if (!settlementGuard.tryAcquire(order.id)) return
  if (!room.pendingOrders.has(order.id)) {
    settlementGuard.release(order.id)
    return
  }

  try {
    if (room.players.size === 0) return
    const playerIds = room.getPlayerIds()
    if (playerIds.length < 2) return

    const finalPrice = priceFeed.getLatestPrice()
    const priceChange = (finalPrice - order.priceAtOrder) / order.priceAtOrder

    const isCorrect = order.coinType === 'call' ? priceChange > 0 : priceChange < 0
    // Use the multiplier stored at order creation time (not current 2x state)
    // This ensures orders placed during 2x window get 2x even if they settle after 2x expires
    const impact = order.multiplier

    transferFunds(
      room,
      isCorrect ? order.playerId : playerIds.find((id) => id !== order.playerId)!,
      isCorrect ? playerIds.find((id) => id !== order.playerId)! : order.playerId,
      impact
    )

    room.tugOfWar += order.isPlayer1 ? -impact : impact
    room.removePendingOrder(order.id)

    io.to(room.id).emit('order_settled', {
      orderId: order.id,
      playerId: order.playerId,
      playerName: order.playerName,
      coinType: order.coinType,
      isCorrect,
      priceAtOrder: order.priceAtOrder,
      finalPrice: finalPrice,
      amountTransferred: impact,
    })
  } finally {
    settlementGuard.release(order.id)
  }
}

// =============================================================================
// Game Logic - Coin Spawning
// =============================================================================

function spawnCoin(room: GameRoom): Coin | null {
  const coinType = room.getNextCoinType()
  if (!coinType) return null

  const coinId = `coin-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`

  const coin: Coin = {
    id: coinId,
    type: coinType,
    x: 0,
    y: 0,
  }

  room.addCoin(coin)
  return coin
}

// =============================================================================
// Game Logic - Game Loop
// =============================================================================

function startGameLoop(io: SocketIOServer, manager: RoomManager, room: GameRoom): void {
  // Initialize deterministic coin sequence
  room.initCoinSequence()

  // Initialize round state and emit round_start event
  room.startNewRound()
  io.to(room.id).emit('round_start', {
    roundNumber: room.currentRound,
    isSuddenDeath: room.isSuddenDeath,
    durationMs: room.ROUND_DURATION,
  })

  const emitCoinSpawn = (coin: Coin) => {
    for (const [playerId, player] of room.players) {
      const spawnX = Math.random() * player.sceneWidth
      const spawnY = player.sceneHeight + 100

      io.to(playerId).emit('coin_spawn', {
        coinId: coin.id,
        coinType: coin.type,
        x: spawnX,
        y: spawnY,
      })
    }
  }

  // Helper function to spawn coin with randomized delay
  const scheduleNextSpawn = () => {
    // Stop if room no longer exists or has fewer than 2 players
    if (!manager.hasRoom(room.id) || room.players.size < 2) {
      return
    }

    const spawnConfig = room.getSpawnInterval()

    // Single coin spawn (no burst)
    const coin = spawnCoin(room)
    if (!coin) return // Sequence exhausted

    emitCoinSpawn(coin)

    // Schedule next spawn
    const nextDelay =
      Math.floor(Math.random() * (spawnConfig.maxMs - spawnConfig.minMs + 1)) + spawnConfig.minMs
    const timeoutId = setTimeout(scheduleNextSpawn, nextDelay)
    room.trackTimeout(timeoutId)
  }

  // Start first spawn immediately
  scheduleNextSpawn()

  // End ROUND after ROUND_DURATION (not full game)
  const roundTimeout = setTimeout(() => {
    endRound(io, manager, room)
  }, room.ROUND_DURATION)

  room.trackTimeout(roundTimeout)
}

// =============================================================================
// Helper Functions
// =============================================================================

// Fund transfer helper - zero-sum with $0 floor
function transferFunds(room: GameRoom, winnerId: string, loserId: string, amount: number): void {
  const winner = room.players.get(winnerId)
  const loser = room.players.get(loserId)

  // Cap transfer at loser's available balance (zero-sum: total always = 20)
  const actualTransfer = Math.min(amount, loser?.dollars || 0)

  if (winner) winner.dollars += actualTransfer
  if (loser) loser.dollars -= actualTransfer // Goes to 0, never negative
}

// =============================================================================
// Yellow Network App Session Integration
// =============================================================================

// Track authenticated sessions for each player
const playerAuthSessions = new Map<string, AuthenticatedSession>()

// Store auth session for a player
export function storePlayerAuthSession(socketId: string, authData: AuthenticatedSession): void {
  playerAuthSessions.set(socketId, authData)
  console.log('[Yellow] Stored auth session for:', {
    socketId,
    walletAddress: authData.address,
    sessionKey: authData.sessionKeyAddress.slice(0, 10) + '...',
  })
}

// Get auth session for a player
export function getPlayerAuthSession(socketId: string): AuthenticatedSession | undefined {
  return playerAuthSessions.get(socketId)
}

// Clear auth session
export function clearPlayerAuthSession(socketId: string): void {
  playerAuthSessions.delete(socketId)
}

/**
 * Request client-side signatures for app session creation
 *
 * NEW APPROACH: Instead of signing server-side (where session keys aren't registered),
 * we request signatures from each client. Each client signs on their own WebSocket connection
 * where their session key is properly authenticated.
 *
 * @param io - Socket.IO server instance
 * @param room - Game room containing both players
 * @param auth1 - Player 1's auth session
 * @param auth2 - Player 2's auth session
 */
async function requestClientSignaturesForAppSession(
  io: SocketIOServer,
  room: GameRoom,
  auth1: AuthenticatedSession,
  auth2: AuthenticatedSession
): Promise<void> {
  // CRITICAL FIX: Force lowercase from the start for JSON consistency
  const wallet1 = room.player1Address!.toLowerCase()
  const wallet2 = room.player2Address!.toLowerCase()

  // CRITICAL: Look up auth sessions by socket ID (via addressToSocketId map)
  // This ensures we get the correct auth session for each player
  const socketId0 = room.addressToSocketId.get(wallet1)
  const socketId1 = room.addressToSocketId.get(wallet2)

  if (!socketId0 || !socketId1) {
    console.error('[Yellow] Missing socket ID for address:', {
      wallet1,
      wallet2,
      socketId0,
      socketId1,
      addressToSocketId: Array.from(room.addressToSocketId.entries()),
    })
    throw new Error('Cannot find socket IDs for both players')
  }

  const authSession0 = getPlayerAuthSession(socketId0)
  const authSession1 = getPlayerAuthSession(socketId1)

  if (!authSession0 || !authSession1) {
    console.error('[Yellow] Missing auth session for socket:', {
      socketId0,
      socketId1,
      authSession0: !!authSession0,
      authSession1: !!authSession1,
    })
    throw new Error('Cannot find auth sessions for both players')
  }

  // CRITICAL FIX (per Yellow official docs): Participants array must use MAIN WALLET ADDRESSES
  // Per https://docs.yellow.org/docs/protocol/off-chain/app-sessions:
  // > "Array of all participant wallet addresses"
  //
  // The multi-party guide shows:
  // participants: [wallet1Client.account.address, wallet2Client.account.address]
  //
  // Session keys still sign the requests, but the app definition references wallet addresses.
  // Yellow's ClearNode links session keys to their parent wallets via the auth_request registration.
  const sessionKeyAddress0 = authSession0.sessionKeyAddress.toLowerCase()
  const sessionKeyAddress1 = authSession1.sessionKeyAddress.toLowerCase()

  // Sort MAIN WALLET addresses for participants array (per Yellow spec)
  const sortedWalletAddresses = [wallet1, wallet2].sort()

  // Also keep track of session key addresses for signature collection
  // Session keys sign, but their signatures are linked to parent wallets via auth_request
  const sortedSessionKeyAddresses = [
    sessionKeyAddress0,
    sessionKeyAddress1,
  ].sort() as `0x${string}`[]

  console.log(
    '[Yellow] CRITICAL FIX: Using MAIN WALLET addresses as participants (per Yellow spec):',
    {
      walletParticipants: sortedWalletAddresses,
      sessionKeyAddresses: sortedSessionKeyAddresses,
      sessionKey0Address: sessionKeyAddress0,
      sessionKey1Address: sessionKeyAddress1,
      note: 'Session keys sign, but participants array uses wallet addresses',
    }
  )

  // CRITICAL: Use sortedWalletAddresses for participants (per Yellow official docs)
  // Session key signatures will be linked to parent wallets via auth_request registration
  const sortedAddresses = sortedWalletAddresses // Main wallet addresses!

  // Create mapping from session key address to main wallet address (for signature collection)
  // CRITICAL: We still collect session key signatures, but they're linked to wallet addresses
  const sessionKeyToWallet = new Map<string, string>([
    [sessionKeyAddress0, wallet1],
    [sessionKeyAddress1, wallet2],
  ])

  // CRITICAL FIX: Use a smaller random integer for nonce (not timestamp!)
  // Yellow's NitroRPC/0.4 parser expects nonce to be a 32-bit integer
  // Large 64-bit timestamps cause "failed to parse parameters" error
  const nonce = Math.floor(Math.random() * 1_000_000) // 6-digit random integer

  // CRITICAL: requestId and timestamp should be different from nonce
  // They are used for request tracking and don't have the same size constraints
  const requestId = Date.now()
  const timestamp = requestId

  // CRITICAL FIX: Use normalized weights [1, 1] and quorum 2 for Yellow's ClearNode
  // The weights must sum to the number of participants, and quorum must equal the sum
  // CRITICAL FIX: Use 'application' field, not 'application_id'
  // CRITICAL FIX: Use full hex address for asset field (not 'ytest.usd' symbol)
  // TRIAL FIX REMOVED: chain_id field removed (may have been causing parse errors)
  const ASSET_HEX = '0xdb9f293e3898c9e5536a3be1b0c56c89d2b32deb' // Full contract address for ytest.usd

  // CRITICAL FIX: Use 'nitroliterpc' protocol instead of 'NitroRPC/0.4'
  // This is the protocol that Liquium's working implementation uses
  // Key differences: quorum: 100 (not 2), challenge: 0 (not 60), weights: [50, 50] (not [1, 1])
  const definition = {
    protocol: 'nitroliterpc' as const, // CRITICAL: Changed from 'NitroRPC/0.4' to 'nitroliterpc'
    participants: sortedAddresses, // Main wallet addresses (sorted, lowercase) - per Yellow spec
    weights: [50, 50], // CRITICAL: Equal voting as percentages (sum = 100)
    quorum: 100, // CRITICAL: Requires 100% agreement (not 2)
    challenge: 0, // CRITICAL: No challenge period for immediate finalization
    nonce, // Small 6-digit integer for parser compatibility
    application_id: YELLOW_APPLICATION_NAME,
  }

  // CRITICAL: Verify participants are lowercase for Yellow Network compatibility
  console.log('[Yellow] App session participants (main wallet addresses per Yellow spec):', {
    participants: sortedAddresses,
    areAllLowercase: sortedAddresses.every((addr) => addr === addr.toLowerCase()),
    walletAddresses: sortedWalletAddresses,
    sessionKeyAddresses: sortedSessionKeyAddresses,
    nonce: nonce, // Log the small nonce value
    nonceType: typeof nonce,
  })

  // CRITICAL FIXES ACTIVE
  console.log('[Yellow] CRITICAL FIXES ACTIVE:', {
    protocol: 'nitroliterpc (changed from NitroRPC/0.4)',
    weights: '[50, 50] (equal voting as percentages)',
    quorum: 100, // Requires 100% agreement
    challenge: 0, // Immediate finalization
    using_wallet_addresses_in_participants: true,
    empty_session_data: true,
    note: 'Using nitroliterpc protocol per Liquium working implementation',
  })

  // CRITICAL: Allocations MUST be in the same order as participants array!
  // CRITICAL FIX: Use full hex address for asset (not 'ytest.usd' symbol)
  // CRITICAL FIX #2: Use HUMAN-READABLE amount format per Yellow official docs
  // The docs specify: "Amount in human-readable format (e.g., '100.0')"
  // NOT base units - just the token amount as a decimal string
  // Yellow's ClearNode expects Ethereum Address type for asset field
  const allocations = sortedAddresses.map((participant) => ({
    participant, // Already lowercase from sortedAddresses
    asset: ASSET_HEX, // CRITICAL: Full contract address, not 'ytest.usd' symbol
    amount: '10.0', // 10 USDC in HUMAN-READABLE format (per Yellow docs)
  }))

  // CRITICAL FIX: ALL addresses must be lowercase for signature verification
  // wallet1 and wallet2 are already lowercased above
  const gameState = {
    game: 'hft-battle',
    mode: 'best-of-three',
    round: 0,
    player1Address: wallet1, // Already lowercased
    player2Address: wallet2, // Already lowercased
    player1Wins: 0,
    player2Wins: 0,
    player1Score: 10,
    player2Score: 10,
    status: 'active' as const,
    lastMove: Date.now(),
  }

  // CRITICAL: Parameter key order MUST be: definition → allocations → session_data
  // Yellow's NitroRPC parser requires this specific order
  console.log('[Yellow] CRITICAL FIXES ACTIVE:')
  console.log('[Yellow]   protocol: nitroliterpc (changed from NitroRPC/0.4)')
  console.log('[Yellow]   weights: [50, 50] (equal voting as percentages)')
  console.log('[Yellow]   quorum: 100 (requires 100% agreement)')
  console.log('[Yellow]   challenge: 0 (immediate finalization, no dispute period)')
  console.log('[Yellow]   participants: MAIN WALLET ADDRESSES (per Yellow spec)')
  console.log('[Yellow]   asset: FULL HEX ADDRESS ' + ASSET_HEX + ' (not ytest.usd symbol)')
  console.log('[Yellow]   session_data: empty object to rule out state issues')

  // CRITICAL: Use empty session_data to rule out JSON serialization issues
  const createParams = {
    definition,
    allocations,
    session_data: '{}', // Minimal JSON to isolate parsing issues
  }

  // CRITICAL: Log the exact createParams for debugging
  console.log('[Yellow] ════════════════════════════════════════════════════════════════')
  console.log('[Yellow] CREATE PARAMS (what client will sign and send):')
  console.log('[Yellow] definition:', JSON.stringify(definition, null, 2))
  console.log('[Yellow] allocations:', JSON.stringify(allocations, null, 2))
  console.log('[Yellow] session_data:', createParams.session_data)
  console.log('[Yellow] FULL createParams JSON:', JSON.stringify(createParams, null, 2))
  console.log('[Yellow] ════════════════════════════════════════════════════════════════')

  console.log('[Yellow] Requesting client app session creation:', {
    walletAddressParticipants: sortedWalletAddresses, // Main wallet addresses (for participants)
    sessionKeyAddresses: sortedSessionKeyAddresses, // Session key addresses (for signing)
    wallet1,
    wallet2,
    sessionKey0Address: authSession0.sessionKeyAddress,
    sessionKey1Address: authSession1.sessionKeyAddress,
    requestId,
    timestamp,
    note: 'Session keys sign, participants array uses wallet addresses (per Yellow spec)',
  })

  // Store the create params in the room for later use when we have both signatures
  // CRITICAL: Store both wallet addresses (for participants) and session key addresses (for signature lookup)
  room.yellowAppSessionParams = {
    createParams,
    nonce,
    sortedAddresses, // Wallet addresses (participants)
    sortedSessionKeyAddresses, // Session key addresses (for signature/socket lookup)
    signatures: [], // Will be filled as clients submit signatures
    requestId,
    timestamp,
  }

  // CRITICAL: Verify that createParams.definition.participants matches wallet addresses
  const participantsMatch =
    JSON.stringify(sortedAddresses) === JSON.stringify(createParams.definition.participants)
  console.log('[Yellow] CRITICAL CHECK: Participants (wallets) match definition.participants?', {
    participantsMatch,
    walletAddresses: sortedAddresses,
    sessionKeyAddresses: sortedSessionKeyAddresses,
    definitionParticipants: createParams.definition.participants,
  })

  if (!participantsMatch) {
    console.error(
      '[Yellow] ERROR: Wallet participants do NOT match definition.participants! This will cause signature verification to fail!'
    )
  }

  // Initialize requestId and timestamp on room
  room.yellowAppSessionRequestId = requestId
  room.yellowAppSessionTimestamp = timestamp

  // CRITICAL: Determine which player is at which position in the sorted array
  // The sorted array contains MAIN WALLET addresses (per Yellow spec)
  // Session keys will sign, but we need to tell each player their correct position
  const player0Index = sortedWalletAddresses.indexOf(wallet1) // 0 or 1
  const player1Index = sortedWalletAddresses.indexOf(wallet2) // 0 or 1

  console.log('[Yellow] Sending sign requests to sockets:', {
    sortedWalletAddresses,
    sortedSessionKeyAddresses,
    socketId0,
    socketId1,
    sessionKeyAddress0,
    sessionKeyAddress1,
    player0Index,
    player1Index,
    auth0Address: authSession0.address,
    auth1Address: authSession1.address,
    note: 'player0Index is the position of wallet1 in sorted wallet array',
  })

  // CRITICAL: Map each socket to their correct position in the sorted array
  // Send to wallet1's socket (player0 in game room, but may be at any position in sorted array)
  io.to(socketId0).emit('yellow_sign_app_session', {
    role: player0Index === 0 ? 'first_participant' : 'second_participant',
    walletAddress: sortedWalletAddresses[player0Index], // Main wallet at this position
    sessionKeyAddress: sortedSessionKeyAddresses[player0Index], // Session key at this position
    createParams,
    nonce,
    requestId,
    timestamp,
    yourAddress: authSession0.address,
    yourSessionKeyAddress: authSession0.sessionKeyAddress,
    isFirstParticipant: player0Index === 0, // TRUE if this player's wallet is first
    note: 'Sign this payload with your SESSION KEY and send back the signature',
  })

  // Send to wallet2's socket (player1 in game room, but may be at any position in sorted array)
  io.to(socketId1).emit('yellow_sign_app_session', {
    role: player1Index === 0 ? 'first_participant' : 'second_participant',
    walletAddress: sortedWalletAddresses[player1Index], // Main wallet at this position
    sessionKeyAddress: sortedSessionKeyAddresses[player1Index], // Session key at this position
    createParams,
    nonce,
    requestId,
    timestamp,
    yourAddress: authSession1.address,
    yourSessionKeyAddress: authSession1.sessionKeyAddress,
    isFirstParticipant: player1Index === 0, // TRUE if this player's wallet is first
    note: 'Sign this payload with your SESSION KEY and send back the signature',
  })
}

/**
 * Create Yellow App Session for the game
 * Both players must be authenticated before this can proceed
 */
async function createYellowAppSession(
  room: GameRoom,
  name1: string,
  name2: string,
  wallet1: string,
  wallet2: string
): Promise<void> {
  try {
    // Check if both players are authenticated
    const auth1 = getPlayerAuthSession(room.player1Id)
    const auth2 = getPlayerAuthSession(room.player2Id)

    if (!auth1 || !auth2) {
      console.warn('[Yellow] Both players must be authenticated to create app session')
      room.channelId = 'pending-auth'
      return
    }

    console.log('[Yellow] Creating app session:', {
      player1: wallet1,
      player2: wallet2,
      player1Auth: !!auth1,
      player2Auth: !!auth2,
    })

    // NOTE: The server-side WebSocket connection is shared across all requests.
    // The session key authentication from client-side doesn't automatically transfer.
    // We need each player's session key to be registered on this connection.
    //
    // However, auth_verify with JWT might not properly set up the session key for signing.
    // Let's skip server-side auth for now and require client-side signatures.

    // // TODO: Investigate why server-side session key signing doesn't work
    // const rpcClient = getRPCClient()
    // const authVerifyResponse1 = await rpcClient.call<AuthSessionResponse>(
    //   'auth_verify',
    //   { jwt: auth1.jwtToken }
    // )
    // const authVerifyResponse2 = await rpcClient.call<AuthSessionResponse>(
    //   'auth_verify',
    //   { jwt: auth2.jwtToken }
    // )

    // Get sorted addresses to determine signer order
    const sortedAddresses = [wallet1.toLowerCase(), wallet2.toLowerCase()].sort()

    console.log('[Yellow] Signer setup (client-side signing):', {
      wallet1,
      wallet2,
      sortedAddresses,
      auth1Address: auth1.address,
      auth2Address: auth2.address,
    })

    // Determine which auth session corresponds to each sorted position
    const isFirstPlayer = sortedAddresses[0] === auth1.address.toLowerCase()
    const firstAuth = isFirstPlayer ? auth1 : auth2
    const secondAuth = isFirstPlayer ? auth2 : auth1

    console.log('[Yellow] Signer order:', {
      isFirstPlayer,
      firstAuthAddress: firstAuth.address,
      secondAuthAddress: secondAuth.address,
      firstSessionKey: firstAuth.sessionKeyAddress,
      secondSessionKey: secondAuth.sessionKeyAddress,
      note: 'Signatures will be collected from clients via socket events',
    })

    // Create signer functions for each player (in sorted order)
    // The RPC client will call these signers with the actual request to sign
    const signers = [createSessionKeySigner(firstAuth), createSessionKeySigner(secondAuth)]

    // Create app session with signer functions
    // The RPC client handles building the request and collecting signatures
    const appSession = await createGameAppSession(
      {
        player1Address: wallet1 as `0x${string}`,
        player2Address: wallet2 as `0x${string}`,
        player1Name: name1,
        player2Name: name2,
        stakeAmount: 10, // 10 USDC per player
      },
      signers // Signer functions in correct order (sorted by address)
    )

    // Store app session data in room
    room.appSessionId = appSession.appSessionId
    room.appSession = appSession
    room.appSessionVersion = appSession.version

    console.log('[Yellow] App session created successfully:', {
      appSessionId: appSession.appSessionId,
      version: appSession.version,
      gameState: appSession.gameState,
    })
  } catch (error) {
    console.error('[Yellow] App session creation failed:', error)
    throw new Error(
      `[Yellow] App session creation failed: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * Create app session with pre-collected signatures from clients
 *
 * This function is called after both players have submitted their signatures.
 * It makes a single RPC call to Yellow's create_app_session with both signatures.
 *
 * @param io - Socket.IO server instance
 * @param room - Game room
 * @param signatures - Array of signatures in the same order as sortedAddresses
 */
async function createAppSessionWithSignatures(
  io: SocketIOServer,
  room: GameRoom,
  signatures: string[]
): Promise<void> {
  try {
    if (!room.yellowAppSessionParams) {
      throw new Error('No app session params found')
    }

    const { createParams, sortedAddresses } = room.yellowAppSessionParams

    console.log('[Yellow] Creating app session with collected signatures:', {
      appSessionId: room.appSessionId,
      signatureCount: signatures.length,
      sortedAddresses,
    })

    // Get RPC client and ensure connected
    const rpcClient = getRPCClient()
    if (!rpcClient.isConnected) {
      await rpcClient.connect()
    }

    // CRITICAL: Force re-authentication with server's private key
    // The singleton RPC client may have a player's JWT from client-side authentication
    // create_app_session REQUIRES a JWT, but it must be from the server (YELLOW_PRIVATE_KEY),
    // not from a player. The participant signatures are still required in the sig array.
    console.log('[Yellow] Force re-authenticating with server private key before create_app_session...')
    await rpcClient.forceReauthenticate()
    console.log('[Yellow] ✓ Server authenticated, JWT is now from server not player')

    // Build the request payload (for logging/debugging - to match what clients signed)
    // CRITICAL: Use the SAME requestId and timestamp that clients signed
    // Generating new values here would cause signature verification to fail
    const id = room.yellowAppSessionParams.requestId
    const timestamp = room.yellowAppSessionParams.timestamp
    // NOTE: This payload represents what CLIENTS signed, which had [createParams] wrapping
    // The actual rpcClient.call() handles wrapping internally, so we pass createParams directly
    const payload = [id, 'create_app_session', [createParams], timestamp] as [
      number,
      string,
      any,
      number,
    ]
    const payloadString = JSON.stringify(payload)

    console.log('[Yellow] Payload for signing:', {
      method: 'create_app_session',
      requestId: id,
      timestamp,
      timestampAsDate: new Date(timestamp).toISOString(),
      payloadString,
      payloadLength: payloadString.length,
      note: 'Using stored requestId/timestamp from signature collection',
    })

    // The signatures we received are already signed payloads from clients
    // We need to send them in the sig array in the correct order
    const request = {
      req: payload,
      sig: signatures, // Both signatures in sorted order
    }

    console.log('[Yellow] Sending create_app_session request:', {
      requestId: id,
      signatureCount: signatures.length,
      signaturePrefixes: signatures.map((s) => s.slice(0, 10) + '...'),
    })

    // SMOKING GUN DEBUG: Log the exact JSON being sent to Yellow ClearNode
    const requestJson = JSON.stringify({
      req: [id, 'create_app_session', [createParams], timestamp],
      sig: signatures,
    })
    console.log('[Yellow] ════════════════════════════════════════════════════════════════')
    console.log('[Yellow] CRITICAL DEBUG - RAW JSON SENDING TO YELLOW CLEARNODE:')
    console.log(requestJson)
    console.log('[Yellow] ════════════════════════════════════════════════════════════════')

    // Log the params for debugging
    console.log('[Yellow] CRITICAL DEBUG - CREATE PARAMS:')
    console.log(JSON.stringify(createParams, null, 2))

    // Validate critical fields
    console.log('[Yellow] CRITICAL DEBUG - PARAMS VALIDATION:')
    console.log('[Yellow]   definition.protocol:', createParams.definition.protocol)
    console.log('[Yellow]   definition.application:', createParams.definition.application)
    console.log('[Yellow]   definition.participants:', createParams.definition.participants)
    console.log(
      '[Yellow]   definition.challenge (type):',
      typeof createParams.definition.challenge,
      createParams.definition.challenge
    )
    console.log(
      '[Yellow]   definition.nonce (type):',
      typeof createParams.definition.nonce,
      createParams.definition.nonce
    )
    console.log(
      '[Yellow]   definition.quorum (type):',
      typeof createParams.definition.quorum,
      createParams.definition.quorum
    )
    console.log('[Yellow]   definition.weights:', createParams.definition.weights)
    console.log('[Yellow]   allocations:', createParams.allocations)
    console.log('[Yellow]   session_data:', createParams.session_data)
    console.log('[Yellow]   session_data length:', createParams.session_data?.length)

    // Check for undefined/null critical fields
    if (!createParams.definition.application) {
      console.error('[Yellow] ERROR: definition.application is MISSING or undefined!')
    }
    if (
      !createParams.definition.participants ||
      createParams.definition.participants.length !== 2
    ) {
      console.error('[Yellow] ERROR: definition.participants is INVALID!', {
        length: createParams.definition.participants?.length,
        participants: createParams.definition.participants,
      })
    }

    // Make the RPC call
    // CRITICAL FIX: RPC client no longer auto-wraps, so we wrap params here
    const response = await rpcClient.call<any>('create_app_session', [createParams], signatures)

    console.log('[Yellow] ✓ App session created with client signatures!', {
      appSessionId: response.app_session_id,
      status: response.status,
      version: response.version,
    })

    // Store app session data in room
    room.appSessionId = response.app_session_id
    room.appSession = {
      appSessionId: response.app_session_id,
      definition: createParams.definition,
      allocations: createParams.allocations,
      gameState: JSON.parse(createParams.session_data),
      status: response.status,
      version: response.version,
      createdAt: Date.now(),
    }
    room.appSessionVersion = response.version
    room.appSessionAllocations = createParams.allocations

    // Clean up
    room.yellowAppSessionParams = null
    room.yellowAppSessionSignatures.clear()

    // Notify both players that app session is ready
    io.to(room.id).emit('yellow_app_session_ready', {
      appSessionId: response.app_session_id,
      gameState: room.appSession.gameState,
      canStart: true,
    })

    // Also emit to each player individually
    if (room.player1Id) {
      io.to(room.player1Id).emit('yellow_app_session_created', {
        appSessionId: response.app_session_id,
        gameState: room.appSession.gameState,
        youAre: 'player1',
      })
    }
    if (room.player2Id) {
      io.to(room.player2Id).emit('yellow_app_session_created', {
        appSessionId: response.app_session_id,
        gameState: room.appSession.gameState,
        youAre: 'player2',
      })
    }
  } catch (error) {
    console.error('[Yellow] App session creation with signatures failed:', error)

    // Notify players of failure
    io.to(room.id).emit('yellow_app_session_error', {
      error: error instanceof Error ? error.message : 'Failed to create app session',
    })

    throw new Error(
      `[Yellow] App session creation failed: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * Request session key signatures from clients for submit_app_state or close_app_session
 *
 * Yellow Network uses session key signatures for app state operations.
 * The server sends the payload to clients, who auto-sign with their session keys
 * (no user interaction needed).
 *
 * @param io - Socket.IO server instance
 * @param room - Game room
 * @param method - The RPC method being called
 * @param params - The parameters for the RPC call
 * @returns Promise that resolves with both session key signatures
 */
async function requestSessionKeySignaturesForUpdate(
  io: SocketIOServer,
  room: GameRoom,
  method: 'submit_app_state' | 'close_app_session',
  params: any
): Promise<{ signatures: string[]; requestId: number; timestamp: number }> {
  const requestId = Date.now()
  const timestamp = requestId
  const sortedAddresses = [
    room.player1Address!.toLowerCase(),
    room.player2Address!.toLowerCase(),
  ].sort()

  console.log('[Yellow] Requesting session key signatures from clients:', {
    method,
    requestId,
    timestamp,
    sortedAddresses,
  })

  // Create a promise that resolves when both clients submit their signatures
  return new Promise((resolve, reject) => {
    // Store the request in the room
    const requestKey = `${method}_${requestId}`
    room.yellowWalletSignatureRequests.set(requestKey, {
      method,
      submitParams: method === 'submit_app_state' ? params : undefined,
      closeParams: method === 'close_app_session' ? params : undefined,
      requestId,
      timestamp,
      sortedAddresses,
      signatures: new Map(),
      resolve,
      reject,
    })

    // Set a timeout in case clients don't respond
    const timeout = setTimeout(() => {
      room.yellowWalletSignatureRequests.delete(requestKey)
      reject(new Error(`Timeout waiting for session key signatures for ${method}`))
    }, 10000) // 10 seconds - auto-signing should be fast

    // Build the payload string that clients will sign with their session keys
    // Format: [requestId, method, params, timestamp]
    const payload = [requestId, method, params, timestamp] as [number, string, any, number]
    const payloadString = JSON.stringify(payload)

    console.log('[Yellow] Sending signing request to clients:', {
      method,
      payloadLength: payloadString.length,
      payloadPrefix: payloadString.slice(0, 100) + '...',
      hasJwt: !!(params as any).jwt,
      jwtPrefix: (params as any).jwt
        ? ((params as any).jwt as string).slice(0, 20) + '...'
        : 'none',
    })

    // Request signatures from both players via their socket IDs
    for (const address of sortedAddresses) {
      const socketId = room.addressToSocketId.get(address.toLowerCase())
      console.log('[Yellow] Looking up socket for address:', {
        address,
        socketId,
        hasSocketId: !!socketId,
        mappingSize: room.addressToSocketId.size,
        allMappings: Array.from(room.addressToSocketId.entries()),
      })
      if (socketId) {
        console.log('[Yellow] Emitting to socket:', socketId)
        io.to(socketId).emit('yellow_request_session_key_signature', {
          method,
          requestId,
          timestamp,
          payloadString, // Pre-built JSON string for client to sign
        })
      } else {
        console.warn('[Yellow] No socket ID found for address:', address)
      }
    }

    // Store timeout for cleanup
    ;(room.yellowWalletSignatureRequests.get(requestKey) as any).timeout = timeout
  })
}

// Legacy compatibility - redirect to app sessions
async function createYellowChannel(
  room: GameRoom,
  name1: string,
  name2: string,
  wallet1: string,
  wallet2: string
): Promise<void> {
  await createYellowAppSession(room, name1, name2, wallet1, wallet2)
}

// Update app session state after round ends
async function updateYellowChannel(io: SocketIOServer, room: GameRoom): Promise<void> {
  if (!room.appSessionId || !room.player1Address || !room.player2Address) {
    console.warn('[Yellow] No app session to update')
    return
  }

  // Get auth sessions (for JWT token)
  const auth1 = getPlayerAuthSession(room.player1Id)
  const auth2 = getPlayerAuthSession(room.player2Id)

  if (!auth1 || !auth2) {
    console.warn('[Yellow] Missing auth sessions for update')
    return
  }

  // Get dollars by wallet address
  const player1Dollars = room.getDollarsByWalletAddress(room.player1Address)
  const player2Dollars = room.getDollarsByWalletAddress(room.player2Address)

  console.log('[Yellow] Updating app session after round:', {
    appSessionId: room.appSessionId,
    currentRound: room.currentRound,
    player1Score: player1Dollars,
    player2Score: player2Dollars,
    player1Wins: room.player1Wins,
    player2Wins: room.player2Wins,
  })

  try {
    const rpcClient = getRPCClient()

    // CRITICAL: Set JWT token in RPC client before authenticated call
    if (auth1.jwtToken) {
      rpcClient.setAuthToken(auth1.jwtToken)
      console.log('[Yellow] JWT token set in RPC client for submit_app_state')
    }

    // Sort addresses for deterministic ordering
    const sortedAddresses = [
      room.player1Address.toLowerCase(),
      room.player2Address.toLowerCase(),
    ].sort()
    const isPlayer1First = sortedAddresses[0].toLowerCase() === room.player1Address.toLowerCase()

    // Calculate USDC allocations based on game scores
    const totalScore = player1Dollars + player2Dollars
    const totalPot = 20 // 20 USDC

    const player1Payout = (player1Dollars / totalScore) * totalPot
    const player2Payout = (player2Dollars / totalScore) * totalPot

    // Yellow Network uses fixed-point integers in base units
    const YELLOW_DECIMALS = 6
    const player1PayoutBaseUnits = Math.round(player1Payout * 10 ** YELLOW_DECIMALS)
    const player2PayoutBaseUnits = Math.round(player2Payout * 10 ** YELLOW_DECIMALS)

    const allocations: Allocation[] = [
      {
        participant: sortedAddresses[0],
        asset: YELLOW_TOKEN,
        amount: String(isPlayer1First ? player1PayoutBaseUnits : player2PayoutBaseUnits),
      },
      {
        participant: sortedAddresses[1],
        asset: YELLOW_TOKEN,
        amount: String(isPlayer1First ? player2PayoutBaseUnits : player1PayoutBaseUnits),
      },
    ]

    // Build game state
    const gameState = {
      game: 'hft-battle' as const,
      mode: room.currentRound >= 3 ? ('sudden-death' as const) : ('best-of-three' as const),
      round: room.currentRound,
      player1Address: room.player1Address,
      player2Address: room.player2Address,
      player1Wins: room.player1Wins,
      player2Wins: room.player2Wins,
      player1Score: player1Dollars,
      player2Score: player2Dollars,
      status: room.player1Wins >= 2 || room.player2Wins >= 2 ? 'completed' : 'active',
      lastMove: Date.now(),
    }

    // Build submit params
    const submitParams = {
      app_session_id: room.appSessionId,
      intent: 'operate' as const,
      version: (room.appSessionVersion || 1) + 1,
      allocations,
      session_data: JSON.stringify(gameState),
    }

    // Request session key signatures from clients for submit_app_state
    console.log('[Yellow] Requesting session key signatures from clients for submit_app_state')

    const {
      signatures: sessionKeySignatures,
      requestId,
      timestamp,
    } = await requestSessionKeySignaturesForUpdate(
      io as SocketIOServer,
      room,
      'submit_app_state',
      submitParams
    )

    console.log('[Yellow] Using requestId and timestamp from client signatures:', {
      requestId,
      timestamp,
      timestampAsDate: new Date(timestamp).toISOString(),
    })

    const result = await rpcClient.call<SubmitAppStateResponse>(
      'submit_app_state',
      submitParams,
      sessionKeySignatures,
      { requestId, timestamp }
    )

    // Update version
    room.appSessionVersion = result.version
    room.appSessionAllocations = allocations

    console.log('[Yellow] ✓ App session updated:', {
      newVersion: result.version,
      allocations,
    })
  } catch (error) {
    console.error('[Yellow] App session update failed:', error)
  }
}

// Settle Yellow app session at game end
async function settleYellowChannel(
  io: SocketIOServer,
  room: GameRoom
): Promise<{
  appSessionId: string
  winnerAddress: string
  loserAddress: string
  winnerPayout: string
  loserPayout: string
} | null> {
  if (!room.appSessionId || !room.player1Address || !room.player2Address) return null

  // Get auth sessions (these contain the session key private keys)
  const auth1 = getPlayerAuthSession(room.player1Id)
  const auth2 = getPlayerAuthSession(room.player2Id)

  if (!auth1 || !auth2) {
    console.warn('[Yellow] Missing auth sessions for settlement')
    return null
  }

  // Get dollars by wallet address
  const player1Dollars = room.getDollarsByWalletAddress(room.player1Address)
  const player2Dollars = room.getDollarsByWalletAddress(room.player2Address)

  console.log('[Yellow] Closing app session - final scores:', {
    appSessionId: room.appSessionId,
    player1Dollars,
    player2Dollars,
    player1Wins: room.player1Wins,
    player2Wins: room.player2Wins,
  })

  try {
    const rpcClient = getRPCClient()

    // CRITICAL: Set JWT token in RPC client before authenticated call
    if (auth1.jwtToken) {
      rpcClient.setAuthToken(auth1.jwtToken)
      console.log('[Yellow] JWT token set in RPC client for close_app_session')
    }

    // Determine winner
    const player1Won = room.player1Wins > room.player2Wins
    const winnerAddress = player1Won ? room.player1Address : room.player2Address
    const loserAddress = player1Won ? room.player2Address : room.player1Address

    // Sort addresses for deterministic ordering
    const sortedAddresses = [
      room.player1Address.toLowerCase(),
      room.player2Address.toLowerCase(),
    ].sort()
    const isPlayer1First = sortedAddresses[0].toLowerCase() === room.player1Address.toLowerCase()

    // Final allocations (winner takes all)
    const YELLOW_DECIMALS = 6
    const totalPot = 20 // 20 USDC
    const totalPotBaseUnits = totalPot * 10 ** YELLOW_DECIMALS

    const allocations: Allocation[] = [
      {
        participant: sortedAddresses[0],
        asset: YELLOW_TOKEN,
        amount: String(
          (player1Won && isPlayer1First) || (!player1Won && !isPlayer1First) ? totalPotBaseUnits : 0
        ),
      },
      {
        participant: sortedAddresses[1],
        asset: YELLOW_TOKEN,
        amount: String(
          (player1Won && !isPlayer1First) || (!player1Won && isPlayer1First) ? totalPotBaseUnits : 0
        ),
      },
    ]

    // Build final game state
    const gameState = {
      game: 'hft-battle' as const,
      mode: room.isSuddenDeath ? ('sudden-death' as const) : ('best-of-three' as const),
      round: room.currentRound,
      player1Address: room.player1Address,
      player2Address: room.player2Address,
      player1Wins: room.player1Wins,
      player2Wins: room.player2Wins,
      player1Score: player1Dollars,
      player2Score: player2Dollars,
      status: 'completed' as const,
      lastMove: Date.now(),
    }

    const closeParams = {
      app_session_id: room.appSessionId,
      allocations,
      session_data: JSON.stringify(gameState),
    }

    // Request session key signatures from clients for close_app_session
    console.log('[Yellow] Requesting session key signatures from clients for close_app_session')

    const {
      signatures: sessionKeySignatures,
      requestId,
      timestamp,
    } = await requestSessionKeySignaturesForUpdate(
      io as SocketIOServer,
      room,
      'close_app_session',
      closeParams
    )

    console.log('[Yellow] Using requestId and timestamp from client signatures:', {
      requestId,
      timestamp,
      timestampAsDate: new Date(timestamp).toISOString(),
    })

    const result = await rpcClient.call<CloseAppSessionResponse>(
      'close_app_session',
      closeParams,
      sessionKeySignatures,
      { requestId, timestamp }
    )

    console.log('[Yellow] ✓ App session closed:', {
      appSessionId: result.app_session_id,
      status: result.status,
      winnerAddress,
      winnerPayout: totalPot.toFixed(2),
    })

    return {
      appSessionId: room.appSessionId,
      winnerAddress,
      loserAddress,
      winnerPayout: totalPot.toFixed(2),
      loserPayout: '0.00',
    }
  } catch (error) {
    console.error('[Yellow] App session close failed:', error)
    return null
  }
}

async function createMatch(
  io: SocketIOServer,
  manager: RoomManager,
  playerId1: string,
  playerId2: string,
  name1: string,
  name2: string,
  wallet1: string | undefined,
  wallet2: string | undefined,
  sceneWidth1: number,
  sceneHeight1: number,
  sceneWidth2: number,
  sceneHeight2: number
): Promise<void> {
  const roomId = `room-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
  const room = manager.createRoom(roomId)

  room.addPlayer(playerId1, name1, sceneWidth1, sceneHeight1)
  room.addPlayer(playerId2, name2, sceneWidth2, sceneHeight2)

  // Store wallet addresses for Yellow channel AND create address → socket ID mapping
  if (wallet1 && wallet1.startsWith('0x')) {
    room.player1Address = wallet1 as `0x${string}`
    room.addressToSocketId.set(wallet1.toLowerCase(), playerId1)
  }
  if (wallet2 && wallet2.startsWith('0x')) {
    room.player2Address = wallet2 as `0x${string}`
    room.addressToSocketId.set(wallet2.toLowerCase(), playerId2)
  }

  // Create Yellow channel if both wallets present
  if (wallet1 && wallet2) {
    await createYellowChannel(room, name1, name2, wallet1, wallet2)
  }

  manager.setPlayerRoom(playerId1, roomId)
  manager.setPlayerRoom(playerId2, roomId)

  io.of('/').sockets.get(playerId1)?.join(roomId)
  io.of('/').sockets.get(playerId2)?.join(roomId)

  io.to(roomId).emit('match_found', {
    roomId,
    channelId: room.channelId,
    players: [
      {
        id: playerId1,
        name: name1,
        dollars: GAME_CONFIG.STARTING_CASH,
        score: 0,
        sceneWidth: sceneWidth1,
        sceneHeight: sceneHeight1,
      },
      {
        id: playerId2,
        name: name2,
        dollars: GAME_CONFIG.STARTING_CASH,
        score: 0,
        sceneWidth: sceneWidth2,
        sceneHeight: sceneHeight2,
      },
    ],
  })

  manager.removeWaitingPlayer(playerId2)

  // Only start game loop immediately if NOT using Yellow channels
  // For Yellow channels, game starts after both players deposit and channel is created
  if (!wallet1 || !wallet2) {
    // No wallets - start immediately (non-Yellow mode)
    startGameLoop(io, manager, room)
  } else {
    // Yellow mode - wait for deposits before starting game
    console.log('[Yellow] Waiting for both players to deposit before starting game')
  }
}

async function handleSlice(
  io: SocketIOServer,
  manager: RoomManager,
  room: GameRoom,
  playerId: string,
  data: { coinId: string; coinType: string; priceAtSlice: number }
): Promise<void> {
  room.removeCoin(data.coinId)

  // Handle gas immediately (penalty to slicer)
  if (data.coinType === 'gas') {
    const playerIds = room.getPlayerIds()
    transferFunds(room, playerIds.find((id) => id !== playerId)!, playerId, 1)
    room.tugOfWar += playerId === playerIds[0] ? 1 : -1
    io.to(room.id).emit('player_hit', { playerId, damage: 1, reason: 'gas' })

    // CRITICAL: Check knockout immediately after gas penalty
    if (room.hasDeadPlayer()) {
      await checkGameOver(io, manager, room)
    }
    return
  }

  if (data.coinType === 'whale') {
    room.activateWhale2X(playerId)
    io.to(room.id).emit('whale_2x_activated', {
      playerId,
      playerName: room.players.get(playerId)?.name || 'Unknown',
      durationMs: room.WHALE_2X_DURATION,
    })
    io.to(room.id).emit('coin_sliced', {
      playerId,
      playerName: room.players.get(playerId)?.name,
      coinType: data.coinType,
    })
    return
  }

  if (!validateCoinType(data.coinType)) {
    return
  }

  // Determine if this player is player 1 (for tug-of-war calculation at settlement)
  const playerIds = room.getPlayerIds()
  const isPlayer1 = playerId === playerIds[0]

  // Store the 2x multiplier at order creation time (not settlement time)
  // This ensures orders placed during 2x window get 2x even if they settle after 2x expires
  const multiplier = room.get2XMultiplier(playerId)

  const order: PendingOrder = {
    id: `order-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    playerId,
    playerName: room.players.get(playerId)?.name || 'Unknown',
    coinType: data.coinType,
    priceAtOrder: data.priceAtSlice,
    settlesAt: Date.now() + ORDER_SETTLEMENT_DURATION_MS, // 5 seconds
    isPlayer1, // Stored at creation to avoid lookup issues at settlement
    multiplier, // Stored at creation - 2 if 2x was active when placed
  }

  room.addPendingOrder(order)

  // Emit order_placed event for client-side pending orders tracking
  io.to(room.id).emit('order_placed', {
    orderId: order.id,
    playerId: order.playerId,
    playerName: order.playerName,
    coinType: order.coinType,
    priceAtOrder: order.priceAtOrder,
    settlesAt: order.settlesAt,
  })

  io.to(room.id).emit('coin_sliced', {
    playerId,
    playerName: room.players.get(playerId)?.name,
    coinType: data.coinType,
  })

  const timeoutId = setTimeout(() => {
    if (room.isShutdown || room.getIsClosing()) return
    if (manager.hasRoom(room.id) && room.pendingOrders.has(order.id)) {
      settleOrder(io, room, order)
      checkGameOver(io, manager, room)
    }
  }, ORDER_SETTLEMENT_DURATION_MS)

  room.trackTimeout(timeoutId)
}

async function checkGameOver(
  io: SocketIOServer,
  manager: RoomManager,
  room: GameRoom
): Promise<void> {
  // Knockout ends the game immediately (instant game over, not just round end)
  if (room.hasDeadPlayer()) {
    room.setClosing()

    // CRITICAL: Settle all pending orders first
    for (const [orderId, order] of room.pendingOrders) {
      settleOrder(io, room, order)
    }

    // Determine round winner and increment win count
    const { winnerId } = room.getRoundWinner()
    const playerIds = room.getPlayerIds()
    if (winnerId === playerIds[0]) room.player1Wins++
    else if (winnerId === playerIds[1]) room.player2Wins++

    // Emit round_end so clients see the updated win count
    const p1 = room.players.get(playerIds[0])
    const p2 = room.players.get(playerIds[1])
    const p1Gained = (p1?.dollars || GAME_CONFIG.STARTING_CASH) - room.player1CashAtRoundStart
    const p2Gained = (p2?.dollars || GAME_CONFIG.STARTING_CASH) - room.player2CashAtRoundStart

    io.to(room.id).emit('round_end', {
      roundNumber: room.currentRound,
      winnerId,
      isTie: false,
      player1Wins: room.player1Wins,
      player2Wins: room.player2Wins,
      player1Dollars: p1?.dollars,
      player2Dollars: p2?.dollars,
      player1Gained: p1Gained,
      player2Gained: p2Gained,
    })

    // CRITICAL FIX: Check if last recorded round has the same number as currentRound
    // If so, we're in a NEW round that wasn't recorded yet - increment before recording
    const lastRound = room.roundHistory[room.roundHistory.length - 1]
    if (lastRound && lastRound.roundNumber === room.currentRound) {
      room.currentRound++
    }

    // Record round summary before game_over (same as endRound)
    const roundSummary = {
      roundNumber: room.currentRound,
      winnerId,
      isTie: false,
      player1Dollars: p1?.dollars || GAME_CONFIG.STARTING_CASH,
      player2Dollars: p2?.dollars || GAME_CONFIG.STARTING_CASH,
      player1Gained: p1Gained,
      player2Gained: p2Gained,
      playerLost:
        winnerId === playerIds[0]
          ? Math.max(0, p1Gained)
          : winnerId === playerIds[1]
            ? Math.max(0, p2Gained)
            : undefined,
    }

    console.log('[Round History] KO Recording:', {
      roundNumber: roundSummary.roundNumber,
      player1Dollars: roundSummary.player1Dollars,
      player2Dollars: roundSummary.player2Dollars,
      total: roundSummary.player1Dollars + roundSummary.player2Dollars,
      winnerId,
    })

    room.roundHistory.push(roundSummary)

    // Settle Yellow channel before game over
    const settlement = await settleYellowChannel(io, room)

    // Emit game_over with knockout reason
    const winner = room.players.get(winnerId || '')
    io.to(room.id).emit('game_over', {
      winnerId: winner?.id,
      winnerName: winner?.name,
      reason: 'knockout' as const,
      player1Wins: room.player1Wins,
      player2Wins: room.player2Wins,
      rounds: room.roundHistory,
      yellowSettlement: settlement,
    })

    setTimeout(() => manager.deleteRoom(room.id), 1000)
  }
}

// =============================================================================
// Round Management - End round and transition or end game
// =============================================================================

async function endRound(io: SocketIOServer, manager: RoomManager, room: GameRoom): Promise<void> {
  // CRITICAL: Settle all pending orders before round ends
  for (const [orderId, order] of room.pendingOrders) {
    settleOrder(io, room, order)
  }

  // CRITICAL: Check if knockout occurred during settlement - game ends immediately
  if (room.hasDeadPlayer()) {
    await checkGameOver(io, manager, room)
    return
  }

  const { winnerId, isTie } = room.getRoundWinner()
  const playerIds = room.getPlayerIds()
  const p1 = room.players.get(playerIds[0])
  const p2 = room.players.get(playerIds[1])

  const p1Gained = (p1?.dollars || GAME_CONFIG.STARTING_CASH) - room.player1CashAtRoundStart
  const p2Gained = (p2?.dollars || GAME_CONFIG.STARTING_CASH) - room.player2CashAtRoundStart

  // Track round wins (except during sudden death ties)
  if (!room.isSuddenDeath || !isTie) {
    if (winnerId === playerIds[0]) room.player1Wins++
    else if (winnerId === playerIds[1]) room.player2Wins++
  }

  // Update Yellow channel state after round
  await updateYellowChannel(io, room)

  // Emit round_end event
  io.to(room.id).emit('round_end', {
    roundNumber: room.currentRound,
    winnerId,
    isTie,
    player1Wins: room.player1Wins,
    player2Wins: room.player2Wins,
    player1Dollars: p1?.dollars,
    player2Dollars: p2?.dollars,
    player1Gained: p1Gained,
    player2Gained: p2Gained,
  })

  // Record round summary for game over display
  const roundSummary = {
    roundNumber: room.currentRound,
    winnerId,
    isTie,
    player1Dollars: p1?.dollars || GAME_CONFIG.STARTING_CASH,
    player2Dollars: p2?.dollars || GAME_CONFIG.STARTING_CASH,
    player1Gained: p1Gained,
    player2Gained: p2Gained,
    // Amount the winner gained (positive value, equal to loser's loss in zero-sum)
    playerLost:
      winnerId === playerIds[0]
        ? Math.max(0, p1Gained)
        : winnerId === playerIds[1]
          ? Math.max(0, p2Gained)
          : undefined,
  }

  console.log('[Round History] Recording:', {
    roundNumber: roundSummary.roundNumber,
    player1Dollars: roundSummary.player1Dollars,
    player2Dollars: roundSummary.player2Dollars,
    total: roundSummary.player1Dollars + roundSummary.player2Dollars,
    winnerId,
    isTie,
  })

  room.roundHistory.push(roundSummary)

  // Check if game should end
  if (room.checkGameEndCondition()) {
    // Settle Yellow channel before game over
    const settlement = await settleYellowChannel(io, room)

    // Game over - emit final results
    const winner = room.getGameWinner()
    io.to(room.id).emit('game_over', {
      winnerId: winner?.id,
      winnerName: winner?.name,
      reason: 'best_of_three_complete' as const,
      player1Wins: room.player1Wins,
      player2Wins: room.player2Wins,
      rounds: room.roundHistory,
      yellowSettlement: settlement,
    })
    setTimeout(() => manager.deleteRoom(room.id), 1000)
  } else {
    // Start next round after brief delay
    room.currentRound++
    // Enable sudden death if tied 1-1 entering round 3
    if (room.currentRound === 3 && room.player1Wins === 1 && room.player2Wins === 1) {
      room.isSuddenDeath = true
    }
    room.startNewRound()

    setTimeout(() => {
      startGameLoop(io, manager, room)
    }, 3000) // 3 second intermission
  }
}

// =============================================================================
// Main Export - Setup Game Events
// =============================================================================

export function setupGameEvents(io: SocketIOServer): {
  cleanup: () => void
  emergencyShutdown: () => void
} {
  // Initialize Yellow RPC client
  initializeYellowRPC().catch((err) => {
    console.warn('[Yellow] RPC client initialization failed:', err)
  })

  // Start price feed
  priceFeed.connect('btcusdt')

  // Start settlement guard cleanup
  settlementGuard.start()

  const manager = new RoomManager()

  // Periodic cleanup of stale waiting players (tracked for cleanup)
  const cleanupInterval = setInterval(() => manager.cleanupStaleWaitingPlayers(), 30000)

  // Cleanup function for graceful shutdown
  const cleanup = () => {
    clearInterval(cleanupInterval)
    settlementGuard.stop()
    priceFeed.disconnect()
  }

  // Emergency shutdown - settles all pending orders before closing
  const emergencyShutdown = () => {
    manager.emergencyShutdown(io)
  }

  io.on('connection', (socket: Socket) => {
    socket.on(
      'find_match',
      ({
        playerName,
        sceneWidth,
        sceneHeight,
        walletAddress,
      }: {
        playerName: string
        sceneWidth?: number
        sceneHeight?: number
        walletAddress?: string
      }) => {
        try {
          const validatedName = validatePlayerName(playerName)

          // Default dimensions if not provided
          const p1Width = sceneWidth || 500
          const p1Height = sceneHeight || 800
          const p1Wallet = walletAddress

          for (const [waitingId, waiting] of manager.getWaitingPlayers()) {
            if (waitingId !== socket.id) {
              const waitingSocket = io.of('/').sockets.get(waitingId)
              if (waitingSocket?.connected && waitingSocket.id === waitingId) {
                const p2Width = waiting.sceneWidth || 500
                const p2Height = waiting.sceneHeight || 800
                const p2Wallet = waiting.walletAddress

                // Await async channel creation
                createMatch(
                  io,
                  manager,
                  socket.id,
                  waitingId,
                  validatedName,
                  waiting.name,
                  p1Wallet,
                  p2Wallet,
                  p1Width,
                  p1Height,
                  p2Width,
                  p2Height
                ).catch((error) => {
                  console.error('[Match] Failed to create match:', error)
                })
                return
              }
            }
          }

          manager.addWaitingPlayer(socket.id, validatedName)
          const waitingPlayer = manager.getWaitingPlayer(socket.id)
          if (waitingPlayer) {
            if (sceneWidth && sceneHeight) {
              waitingPlayer.sceneWidth = sceneWidth
              waitingPlayer.sceneHeight = sceneHeight
            }
            if (walletAddress) {
              waitingPlayer.walletAddress = walletAddress
            }
          }
          socket.emit('waiting_for_match')
        } catch (error) {
          socket.emit('error', { message: 'Failed to find match' })
        }
      }
    )

    // =============================================================================
    // Yellow Network: App Session Authentication (NEW)
    // =============================================================================

    // Player completes authentication via YellowAuthFlow
    socket.on(
      'yellow_auth_complete',
      async (data: {
        walletAddress: string
        jwtToken: string
        sessionKey: string
        sessionKeyPrivate: string
        expiresAt: number
      }) => {
        try {
          console.log('[Yellow] Player authenticated:', {
            socketId: socket.id,
            walletAddress: data.walletAddress.slice(0, 10) + '...',
            sessionKey: data.sessionKey.slice(0, 10) + '...',
          })

          // Store the full auth session including private key for signing
          storePlayerAuthSession(socket.id, {
            address: data.walletAddress as `0x${string}`,
            sessionKeyAddress: data.sessionKey as `0x${string}`,
            sessionKeyPrivate: data.sessionKeyPrivate as `0x${string}`,
            jwtToken: data.jwtToken,
            expiresAt: data.expiresAt,
          })

          // CRITICAL: Set JWT token in RPC client for authenticated calls
          // submit_app_session, close_app_session require JWT token in request params
          const rpcClient = getRPCClient()
          rpcClient.setAuthToken(data.jwtToken)
          console.log('[Yellow] JWT token stored in RPC client for authenticated calls')

          // Check if this player is in a room waiting for auth
          const roomId = manager.getPlayerRoomId(socket.id)
          if (roomId) {
            const room = manager.getRoom(roomId)
            if (room) {
              console.log('[Yellow] Player authenticated in room:', roomId)

              // CRITICAL: Also map session key address to socket ID for signature routing
              // When sending yellow_both_signatures_ready, we need to find the socket by session key address
              const sessionKeyAddress = data.sessionKey.toLowerCase() as `0x${string}`
              room.addressToSocketId.set(sessionKeyAddress, socket.id)
              console.log('[Yellow] Mapped session key to socket:', {
                sessionKeyAddress: sessionKeyAddress.slice(0, 10) + '...',
                socketId: socket.id,
              })

              // Check if both players are now authenticated
              const auth1 = getPlayerAuthSession(room.player1Id)
              const auth2 = getPlayerAuthSession(room.player2Id)

              if (auth1 && auth2 && room.player1Address && room.player2Address) {
                console.log(
                  '[Yellow] Both players authenticated! Requesting client signatures for app session creation...'
                )

                // NEW APPROACH: Have clients sign the app session request
                // This ensures signatures are created on the connection where the session key is registered
                await requestClientSignaturesForAppSession(io, room, auth1, auth2)
              }
            }
          }

          // Echo back auth complete to client so it can store session key for auto-signing
          socket.emit('yellow_auth_complete', {
            walletAddress: data.walletAddress,
            sessionKey: data.sessionKey,
            sessionKeyPrivate: data.sessionKeyPrivate,
            jwtToken: data.jwtToken,
            expiresAt: data.expiresAt,
          })

          socket.emit('yellow_auth_success', {
            walletAddress: data.walletAddress,
            authenticated: true,
          })
        } catch (error) {
          console.error('[Yellow] Auth complete error:', error)
          socket.emit('yellow_auth_error', {
            error: error instanceof Error ? error.message : 'Authentication failed',
          })
        }
      }
    )

    // =============================================================================
    // Yellow App Session Creation (client-side RPC calls)
    // =============================================================================

    // Player reports app session creation result (success or failure)
    socket.on(
      'yellow_app_session_result',
      async (data: {
        success: boolean
        appSessionId?: string
        appSession?: any
        error?: string
      }) => {
        try {
          const roomId = manager.getPlayerRoomId(socket.id)
          if (!roomId) {
            console.log('[Yellow] App session result but no room for player:', socket.id)
            return
          }

          const room = manager.getRoom(roomId)
          if (!room) return

          // If session already created, ignore
          if (room.appSessionId) {
            console.log('[Yellow] App session already exists, ignoring result')
            return
          }

          if (data.success && data.appSessionId && data.appSession) {
            console.log('[Yellow] App session created by client:', {
              appSessionId: data.appSessionId,
              status: data.appSession.status,
            })

            // Store app session data
            room.appSessionId = data.appSessionId
            room.appSession = data.appSession
            room.appSessionVersion = data.appSession.version
            room.appSessionAllocations = data.appSession.allocations

            // Notify all players that app session is ready
            io.to(room.id).emit('yellow_app_session_ready', {
              appSessionId: room.appSessionId,
              gameState: room.appSession.gameState,
              canStart: true,
            })

            // CRITICAL: Start the game loop immediately after app session is created
            // The server has received success confirmation from client, no need to wait for additional confirmation
            console.log(
              '[Yellow] App session created by client, starting game loop for room:',
              room.id
            )
            startGameLoop(io, manager, room)
          } else if (data.error && !data.error.includes('already_exists')) {
            // Log non-duplicate errors
            console.error('[Yellow] App session creation failed:', data.error)
          }
        } catch (error) {
          console.error('[Yellow] Error handling app session result:', error)
        }
      }
    )

    // =============================================================================
    // END: Yellow App Session Creation
    // =============================================================================

    // Yellow Network: Player submits their signature for the initial state
    socket.on(
      'yellow_signature_submit',
      async (data: { walletAddress: string; signature: string }) => {
        try {
          const roomId = manager.getPlayerRoomId(socket.id)
          if (!roomId) {
            console.log('[Yellow] Signature submit but no room for player:', socket.id)
            return
          }

          const room = manager.getRoom(roomId)
          if (!room) return

          // Track signature by wallet address
          const walletAddress = data.walletAddress.toLowerCase()
          room.yellowSignatures = room.yellowSignatures || new Map<string, string>()
          room.yellowSignatures.set(walletAddress, data.signature)

          console.log('[Yellow] Player signed initial state:', {
            roomId,
            walletAddress,
            signatureLength: data.signature.length,
            totalSignatures: room.yellowSignatures.size,
            expected: 2,
          })

          // Check if both players have signed
          const sorted = [room.player1Address, room.player2Address].sort() as (
            | `0x${string}`
            | null
          )[]
          const p1Signed = sorted[0] ? room.yellowSignatures.has(sorted[0].toLowerCase()) : false
          const p2Signed = sorted[1] ? room.yellowSignatures.has(sorted[1].toLowerCase()) : false

          if (p1Signed && p2Signed) {
            console.log(
              '[Yellow] Both players signed! Emitting yellow_both_signed to participant[0]'
            )

            // Get both signatures in participant order
            const sig0 = room.yellowSignatures.get(sorted[0]!.toLowerCase())
            const sig1 = room.yellowSignatures.get(sorted[1]!.toLowerCase())

            // Notify participant[0] to proceed with depositAndCreate
            const p0SocketId = room.addressToSocketId.get(sorted[0]!.toLowerCase())
            if (p0SocketId && sig0 && sig1) {
              io.to(p0SocketId).emit('yellow_both_signed', {
                channelId: room.channelId,
                signatures: [sig0, sig1], // Both signatures in participant order
              })
            }
          }
        } catch (error) {
          console.error('[Yellow] Error handling signature_submit:', error)
        }
      }
    )

    // =============================================================================
    // Yellow App Session Signature Collection
    // =============================================================================

    // Player submits their signature for app session creation
    socket.on(
      'yellow_app_session_signature',
      async (data: {
        walletAddress: string
        sessionKeyAddress?: string // CRITICAL: Session key signs payload, so signature recovers to this address
        signature: string
        nonce: number
        requestId?: number
        timestamp?: number
      }) => {
        try {
          console.log('[Yellow] Received app session signature from:', {
            socketId: socket.id,
            walletAddress: data.walletAddress.slice(0, 10) + '...',
            signaturePrefix: data.signature.slice(0, 10) + '...',
            nonce: data.nonce,
            requestId: data.requestId,
            timestamp: data.timestamp,
          })

          const roomId = manager.getPlayerRoomId(socket.id)
          if (!roomId) {
            console.log('[Yellow] App session signature but no room for player:', socket.id)
            return
          }

          const room = manager.getRoom(roomId)
          if (!room) {
            console.log('[Yellow] Room not found:', roomId)
            return
          }

          // Check if we're expecting app session signatures
          if (!room.yellowAppSessionParams) {
            console.log('[Yellow] Not expecting app session signatures for this room')
            return
          }

          // Verify nonce matches
          if (room.yellowAppSessionParams.nonce !== data.nonce) {
            console.error('[Yellow] Nonce mismatch:', {
              expected: room.yellowAppSessionParams.nonce,
              received: data.nonce,
            })
            return
          }

          // CRITICAL FIX: Store signature by WALLET ADDRESS (not session key address)
          // The signature is now created by the main wallet (not session key)
          // so it recovers to the wallet address. This matches the participants array
          // which contains wallet addresses per Yellow's spec.
          const walletAddress = data.walletAddress.toLowerCase()
          room.yellowAppSessionSignatures.set(walletAddress, data.signature)

          console.log('[Yellow] App session signature stored:', {
            walletAddress,
            sessionKeyAddress: data.sessionKeyAddress?.toLowerCase() || 'N/A',
            totalSignatures: room.yellowAppSessionSignatures.size,
            expected: 2,
            currentRequestId: room.yellowAppSessionRequestId,
            currentTimestamp: room.yellowAppSessionTimestamp,
            note: 'Signatures stored by WALLET address - main wallet signs, participants use wallet addresses',
          })

          // Update requestId and timestamp if provided (first participant provides these)
          if (data.requestId !== undefined) {
            room.yellowAppSessionRequestId = data.requestId
          }
          if (data.timestamp !== undefined) {
            room.yellowAppSessionTimestamp = data.timestamp
          }

          // Check if we have both signatures
          // CRITICAL FIX: Use sortedWalletAddresses for BOTH signature lookup AND participants array
          // Since signatures are now from main wallets, they recover to wallet addresses
          const { sortedAddresses: sortedWalletAddresses, sortedSessionKeyAddresses } =
            room.yellowAppSessionParams
          const hasSig0 = room.yellowAppSessionSignatures.has(
            sortedWalletAddresses[0].toLowerCase()
          )
          const hasSig1 = room.yellowAppSessionSignatures.has(
            sortedWalletAddresses[1].toLowerCase()
          )

          if (hasSig0 && hasSig1) {
            console.log(
              '[Yellow] ✓ Both app session signatures received! Creating app session with nitroliterpc protocol...'
            )

            // Get signatures in the correct order (matching wallet addresses)
            const sig0 = room.yellowAppSessionSignatures.get(
              sortedWalletAddresses[0].toLowerCase()
            )!
            const sig1 = room.yellowAppSessionSignatures.get(
              sortedWalletAddresses[1].toLowerCase()
            )!

            if (!sig0 || !sig1) {
              console.error('[Yellow] MISSING SIGNATURE! Cannot proceed.')
              return
            }

            // Create app session with collected signatures
            // This uses the updated nitroliterpc protocol from app-session-manager.ts
            await createAppSessionWithSignatures(io, room, [sig0, sig1])

            // Start the game loop after app session is created
            startGameLoop(io, manager, room)
          } else {
            console.log('[Yellow] Waiting for more signatures...', {
              has: [hasSig0, hasSig1],
              missing: sortedWalletAddresses.filter((_addr, i) => !(i === 0 ? hasSig0 : hasSig1)),
              note: 'Waiting for main wallet signatures',
            })
          }
        } catch (error) {
          console.error('[Yellow] Error handling app session signature:', error)
        }
      }
    )

    // Yellow Network: Player notifies server when approval is complete (ready to deposit)
    socket.on('yellow_approval_complete', async (data: { walletAddress: string }) => {
      try {
        const roomId = manager.getPlayerRoomId(socket.id)
        if (!roomId) {
          console.log('[Yellow] Approval complete but no room for player:', socket.id)
          return
        }

        const room = manager.getRoom(roomId)
        if (!room) return

        // Track approval status by wallet address
        const walletAddress = data.walletAddress.toLowerCase()
        room.yellowApprovals = room.yellowApprovals || new Map<string, boolean>()
        room.yellowApprovals.set(walletAddress, true)

        console.log('[Yellow] Player approved USDC:', {
          roomId,
          walletAddress,
          totalApprovals: room.yellowApprovals.size,
          expected: 2,
        })

        // Check if both players have approved
        const p1Approved = room.player1Address
          ? room.yellowApprovals.has(room.player1Address.toLowerCase())
          : false
        const p2Approved = room.player2Address
          ? room.yellowApprovals.has(room.player2Address.toLowerCase())
          : false

        if (p1Approved && p2Approved) {
          console.log('[Yellow] Both players approved, telling participant[1] to deposit first...')

          // CRITICAL: With AA, participant[0] will use depositAndCreate (one tx)
          // Participant[1] deposits separately, then joins
          // We need to tell participant[1] to deposit, and participant[0] to wait
          const sorted = [room.player1Address, room.player2Address].sort() as `0x${string}`[]

          // Emit targeted messages to each player based on their position in sorted array
          // participant[0] (alphabetically first) will wait for channel_ready then depositAndCreate
          // participant[1] (alphabetically second) should deposit immediately
          for (const walletAddress of [room.player1Address, room.player2Address]) {
            if (!walletAddress) continue

            const socketId = room.addressToSocketId.get(walletAddress.toLowerCase())
            if (!socketId) {
              console.log('[Yellow] No socket ID found for wallet:', walletAddress)
              continue
            }

            const isFirstParticipant = walletAddress.toLowerCase() === sorted[0].toLowerCase()

            console.log('[Yellow] Sending yellow_both_approved to:', {
              walletAddress,
              isFirstParticipant,
              socketId,
            })

            io.to(socketId).emit('yellow_both_approved', {
              channelId: room.channelId,
              youAreP1: isFirstParticipant, // true for participant[0], false for participant[1]
            })
          }
        }
      } catch (error) {
        console.error('[Yellow] Error handling approval_complete:', error)
      }
    })

    // ============================================================================
    // OLD: Yellow Network deposit flow (deprecated - using App Sessions instead)
    // ============================================================================
    /*
    // Yellow Network: Player notifies server when deposit is complete
    socket.on('yellow_deposit_complete', async (data: { walletAddress: string }) => {
      try {
        const roomId = manager.getPlayerRoomId(socket.id)
        if (!roomId) {
          console.log('[Yellow] Deposit complete but no room for player:', socket.id)
          return
        }

        const room = manager.getRoom(roomId)
        if (!room) return

        // Track deposit status by wallet address
        const walletAddress = data.walletAddress.toLowerCase()
        room.yellowDeposits = room.yellowDeposits || new Map<string, boolean>()
        room.yellowDeposits.set(walletAddress, true)

        console.log('[Yellow] Player deposited:', {
          roomId,
          walletAddress,
          totalDeposits: room.yellowDeposits.size,
          expected: room.player1Address && room.player2Address ? 2 : 0,
        })

        // Notify opponent that this player deposited
        socket.to(roomId).emit('yellow_opponent_deposited', {
          channelId: room.channelId,
          playerAddress: walletAddress,
        })

        // CRITICAL: With AA flow, when participant[1] deposits, emit channel_ready
        // so participant[0] can do depositAndCreate in one transaction
        const sorted = [room.player1Address, room.player2Address].sort()
        const isFirstParticipant = walletAddress.toLowerCase() === sorted[0].toLowerCase()

        console.log('[Yellow] Deposit from participant:', {
          walletAddress,
          isFirstParticipant,
        })

        // If this is participant[1] (second in sorted order), emit channel_ready
        // Participant[0] will then do depositAndCreate
        if (!isFirstParticipant && room.channelId && room.initialState) {
          console.log('[Yellow] Participant[1] deposited, emitting channel_ready for participant[0]')

          const channelNonce = room.channelNonce || BigInt(Math.floor(Date.now() / 1000))
          const channelParams = {
            channelId: room.channelId,
            channel: {
              participants: sorted as `0x${string}`[],
              adjudicator: YELLOW_CONFIG.addresses.adjudicator,
              challenge: YELLOW_CONFIG.challengeDuration.toString(),
              nonce: channelNonce.toString(),
            },
            initialState: {
              intent: room.initialState.intent,
              version: room.initialState.version?.toString() || '0',
              data: room.initialState.data,
              allocations: room.initialState.allocations?.map((a: any) => ({
                destination: a.destination,
                token: a.token,
                amount: a.amount?.toString() || '0',
              })) || [],
              sigs: room.initialState.sigs || [],
            },
          }

          io.to(roomId).emit('yellow_channel_ready', channelParams)
          return
        }

        // Check if both players have deposited (original logic for safety)
        const p1Deposited = room.player1Address ? room.yellowDeposits.has(room.player1Address.toLowerCase()) : false
        const p2Deposited = room.player2Address ? room.yellowDeposits.has(room.player2Address.toLowerCase()) : false

        if (p1Deposited && p2Deposited && room.channelId) {
          console.log('[Yellow] Both players deposited, emitting channel_ready')

          // Both deposited - emit channel ready event with creation parameters
          // Note: Convert ALL BigInt to string for JSON serialization (Socket.IO uses JSON.stringify)
          const channelNonce = room.channelNonce || BigInt(Math.floor(Date.now() / 1000))
          const channelParams = {
            channelId: room.channelId,
            channel: {
              participants: [
                room.player1Address,
                room.player2Address,
              ].sort() as `0x${string}`[],
              adjudicator: YELLOW_CONFIG.addresses.adjudicator,
              challenge: YELLOW_CONFIG.challengeDuration.toString(), // Convert BigInt to string
              nonce: channelNonce.toString(),
            },
            initialState: room.initialState ? {
              intent: room.initialState.intent,
              version: room.initialState.version?.toString() || '0',
              data: room.initialState.data,
              allocations: room.initialState.allocations?.map((a: any) => ({
                destination: a.destination,
                token: a.token,
                amount: a.amount?.toString() || '0',
              })) || [],
              sigs: room.initialState.sigs || [],
            } : null,
          }

          console.log('[Yellow] Emitting channel_ready with params:', {
            ...channelParams,
            allocations: channelParams.initialState?.allocations,
          })

          io.to(roomId).emit('yellow_channel_ready', channelParams)
        }
      } catch (error) {
        console.error('[Yellow] Error handling deposit_complete:', error)
      }
    })

    // Yellow Network: Client notifies server when on-chain channel creation is complete
    socket.on('yellow_channel_created', async (data: { channelId: string; txHash?: string }) => {
      try {
        const roomId = manager.getPlayerRoomId(socket.id)
        if (!roomId) {
          console.log('[Yellow] Channel created but no room for player:', socket.id)
          return
        }

        const room = manager.getRoom(roomId)
        if (!room) return

        console.log('[Yellow] On-chain channel created, starting game:', {
          roomId,
          channelId: data.channelId,
          txHash: data.txHash,
        })

        // Mark that channel was created on-chain (only start game once)
        if (room.channelCreatedOnChain) {
          console.log('[Yellow] Game already started, ignoring duplicate channel_created')
          return
        }
        room.channelCreatedOnChain = true

        // Notify the other player that the channel was created so they can join
        // CRITICAL: Convert all BigInt values to strings for Socket.IO serialization
        io.to(roomId).emit('yellow_channel_created', {
          channelId: data.channelId,
          creatorAddress: room.player1Address, // Player who called create()
          initialState: room.initialState ? {
            intent: room.initialState.intent,
            version: room.initialState.version?.toString() || '0',
            data: room.initialState.data,
            allocations: room.initialState.allocations?.map((a: any) => ({
              destination: a.destination,
              token: a.token,
              amount: a.amount?.toString() || '0',
            })) || [],
            sigs: room.initialState.sigs || [],
          } : null,
        })

        // Start the game loop now that channel is created
        startGameLoop(io, manager, room)
      } catch (error) {
        console.error('[Yellow] Error handling channel_created:', error)
      }
    })
    */

    // ============================================================================
    // Yellow Session Key Signature Collection for submit_app_state and close_app_session
    // ============================================================================

    // Player submits their session key signature for app session updates
    // Session keys auto-sign without user interaction
    socket.on(
      'yellow_session_key_signature_submit',
      async (data: {
        method: 'submit_app_state' | 'close_app_session'
        signature: string
        requestId: number
        timestamp: number
      }) => {
        try {
          console.log('[Yellow] Received session key signature from client:', {
            socketId: socket.id,
            method: data.method,
            signaturePrefix: data.signature.slice(0, 10) + '...',
            requestId: data.requestId,
            timestamp: data.timestamp,
          })

          const roomId = manager.getPlayerRoomId(socket.id)
          if (!roomId) {
            console.log('[Yellow] Session key signature but no room for player:', socket.id)
            return
          }

          const room = manager.getRoom(roomId)
          if (!room) {
            console.log('[Yellow] Room not found:', roomId)
            return
          }

          // Find the matching signature request
          const requestKey = `${data.method}_${data.requestId}`
          const request = room.yellowWalletSignatureRequests.get(requestKey)

          if (!request) {
            console.log('[Yellow] No matching signature request found:', requestKey)
            return
          }

          // Verify the request ID matches
          if (request.requestId !== data.requestId) {
            console.error('[Yellow] Request ID mismatch:', {
              expected: request.requestId,
              received: data.requestId,
            })
            return
          }

          // Get the player's wallet address from socket ID
          // We need to find which address this socket corresponds to
          let playerAddress: string | null = null
          if (room.player1Id === socket.id && room.player1Address) {
            playerAddress = room.player1Address.toLowerCase()
          } else if (room.player2Id === socket.id && room.player2Address) {
            playerAddress = room.player2Address.toLowerCase()
          }

          if (!playerAddress) {
            console.error('[Yellow] Could not determine player address for socket:', socket.id)
            return
          }

          // Store signature by player address
          request.signatures.set(playerAddress, data.signature)

          console.log('[Yellow] Session key signature stored:', {
            method: data.method,
            playerAddress,
            totalSignatures: request.signatures.size,
            expected: 2,
          })

          // Check if both players have submitted signatures
          if (request.signatures.size === 2) {
            console.log('[Yellow] Both session key signatures received for:', data.method)

            // Get signatures in sorted order
            const sig0 = request.signatures.get(request.sortedAddresses[0].toLowerCase())
            const sig1 = request.signatures.get(request.sortedAddresses[1].toLowerCase())

            if (!sig0 || !sig1) {
              console.error('[Yellow] Missing signature after all collected')
              return
            }

            // Resolve the promise with both signatures AND the requestId/timestamp used for signing
            // CRITICAL: The RPC call must use the exact same requestId and timestamp that clients signed
            request.resolve({
              signatures: [sig0, sig1],
              requestId: request.requestId,
              timestamp: request.timestamp,
            })

            // Clean up
            if (request.timeout) {
              clearTimeout(request.timeout)
            }
            room.yellowWalletSignatureRequests.delete(requestKey)
          }
        } catch (error) {
          console.error('[Yellow] Error handling session key signature submit:', error)
        }
      }
    )

    socket.on(
      'slice_coin',
      async (data: { coinId: string; coinType: string; priceAtSlice: number }) => {
        try {
          const roomId = manager.getPlayerRoomId(socket.id)
          if (!roomId) return

          const room = manager.getRoom(roomId)
          if (!room) {
            manager.removePlayerFromRoom(socket.id)
            return
          }

          await handleSlice(io, manager, room, socket.id, data)
        } catch (error) {
          socket.emit('error', { message: 'Failed to slice coin' })
        }
      }
    )

    socket.on('disconnect', () => {
      manager.removeWaitingPlayer(socket.id)

      const roomId = manager.getPlayerRoomId(socket.id)
      if (roomId) {
        const room = manager.getRoom(roomId)
        if (room?.hasPlayer(socket.id)) {
          io.to(roomId).emit('opponent_disconnected')

          if (room.pendingOrders.size === 0) {
            setTimeout(() => manager.deleteRoom(roomId), 5000)
          }
        }
      }
    })
  })

  return { cleanup, emergencyShutdown }
}
