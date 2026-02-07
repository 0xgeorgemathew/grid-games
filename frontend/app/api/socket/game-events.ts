import { Server as SocketIOServer } from 'socket.io'
import { Socket } from 'socket.io'
import { Player, RoundSummary } from '@/game/types/trading'
import { DEFAULT_BTC_PRICE } from '@/lib/formatPrice'
import { ENTRY_STAKE } from '@/lib/yellow/config'
import {
  initializeNitrolite,
  createGameChannel,
  updateChannelState,
  settleChannel,
} from '@/lib/yellow/nitrolite-client'
import { GAME_CONFIG } from '@/game/constants'
import { getLeverageForAddress } from '@/lib/ens'

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

// Pre-generated coin sequence per round (deterministic for both players)
class CoinSequence {
  private sequence: Array<{ type: 'call' | 'put' | 'gas' | 'whale'; xNormalized: number }> = []
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

    const estimatedSpawns = Math.ceil(durationMs / minIntervalMs) + 10 // Extra for burst spawns
    for (let i = 0; i < estimatedSpawns; i++) {
      this.sequence.push({
        type: types[rng.nextInt(0, types.length - 1)],
        xNormalized: 0.15 + rng.next() * 0.7, // 15%-85% screen width (avoid edges)
      })
    }
  }

  next(): { type: 'call' | 'put' | 'gas' | 'whale'; xNormalized: number } | null {
    if (this.index >= this.sequence.length) return null
    return this.sequence[this.index++]
  }

  hasNext(): boolean {
    return this.index < this.sequence.length
  }

  peek(): { type: 'call' | 'put' | 'gas' | 'whale'; xNormalized: number } | null {
    if (this.index >= this.sequence.length) return null
    return this.sequence[this.index]
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
  currentRound: number = 0 // Starts at 0, startNewRound() increments to 1 before first round
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
  // Now stores multiplier data: { expiresAt: timestamp, multiplier: number }
  private whale2XData = new Map<string, { expiresAt: number; multiplier: number }>()
  readonly WHALE_2X_DURATION = 10000 // 10 seconds

  // Cache player leverage from ENS (for whale power-up)
  private playerLeverageCache = new Map<string, number>() // playerId -> leverage

  // Yellow Network state channel
  channelId: string | null = null
  channelStatus: 'INITIAL' | 'ACTIVE' | 'FINAL' = 'INITIAL'
  player1Address: `0x${string}` | null = null
  player2Address: `0x${string}` | null = null
  // Track which socket ID corresponds to which wallet address
  addressToSocketId: Map<string, string> = new Map()

  // Client ready tracking - both clients must be ready before game starts
  clientsReady = new Set<string>()

  // Track if game loop is active (prevents duplicate startGameLoop calls)
  gameLoopActive = false

  // Round timeout tracker (for cleanup)
  roundTimeout: NodeJS.Timeout | null = null

  constructor(roomId: string) {
    this.id = roomId
    this.players = new Map()
    this.coins = new Map()
    this.pendingOrders = new Map()
    this.gameStartTime = Date.now()
  }

  // Check if player has active 2X mode
  hasWhale2X(playerId: string): boolean {
    const data = this.whale2XData.get(playerId)
    if (!data) return false
    if (Date.now() > data.expiresAt) {
      this.whale2XData.delete(playerId)
      return false
    }
    return true
  }

  // Activate whale mode for a player with their ENS leverage multiplier
  activateWhale2X(playerId: string, multiplier: number): void {
    const expiresAt = Date.now() + this.WHALE_2X_DURATION
    this.whale2XData.set(playerId, { expiresAt, multiplier })
  }

  // Get multiplier for a player (leverage from ENS if whale active, 1 if not)
  get2XMultiplier(playerId: string): number {
    const data = this.whale2XData.get(playerId)
    if (!data) return 1 // No whale active = 1x base
    if (Date.now() > data.expiresAt) {
      this.whale2XData.delete(playerId)
      return 1
    }
    return data.multiplier // Return ENS leverage (2, 5, 10, 20)
  }

  // Get player's leverage from ENS (with caching)
  async getPlayerLeverage(playerId: string): Promise<number> {
    // Check cache first
    if (this.playerLeverageCache.has(playerId)) {
      const cached = this.playerLeverageCache.get(playerId)!
      // console.log(
      //   `[GameRoom] Using cached leverage: playerId=${playerId.slice(0, 8)}, leverage=${cached}x`
      // )
      return cached
    }

    // Get wallet address from room
    const walletAddress = this.getWalletAddress(playerId)
    if (!walletAddress) {
      // console.log(
      //   `[GameRoom] No wallet address for player (using default 2x): playerId=${playerId.slice(0, 8)}`
      // )
      return 2 // Default to 2x
    }

    // Load from ENS
    const leverage = await getLeverageForAddress(walletAddress)
    const finalLeverage = leverage || 2 // Default to 2x

    // console.log(
    //   `[GameRoom] Loaded leverage from ENS: playerId=${playerId.slice(0, 8)}, address=${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}, leverage=${finalLeverage}x`
    // )

    // Cache for future use
    this.playerLeverageCache.set(playerId, finalLeverage)
    return finalLeverage
  }

  // Helper to get wallet address for player
  private getWalletAddress(playerId: string): string | undefined {
    if (
      this.player1Address &&
      this.addressToSocketId.get(this.player1Address.toLowerCase()) === playerId
    ) {
      return this.player1Address
    }
    if (
      this.player2Address &&
      this.addressToSocketId.get(this.player2Address.toLowerCase()) === playerId
    ) {
      return this.player2Address
    }
    return undefined
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

    // Clear round timeout
    if (this.roundTimeout) {
      clearTimeout(this.roundTimeout)
      this.roundTimeout = null
    }
  }

  // Mark client as ready and return if both clients are ready
  markClientReady(socketId: string): boolean {
    // Prevent duplicate entries from same socket (defense in depth)
    // Single client sending round_ready twice should not trigger "both ready"
    if (this.clientsReady.has(socketId)) {
      // console.log('[GameRoom] Duplicate round_ready from socket, ignoring:', {
      //   socketId: socketId.slice(0, 8),
      // })
      return this.clientsReady.size === 2
    }

    this.clientsReady.add(socketId)
    return this.clientsReady.size === 2
  }

  // Reset client ready state for next round
  resetClientsReady(): void {
    this.clientsReady.clear()
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
    // Increment round at START (simplifies logic, prevents edge cases)
    this.currentRound++

    const playerIds = this.getPlayerIds()
    const p1 = this.players.get(playerIds[0])
    const p2 = this.players.get(playerIds[1])

    // Validate zero-sum economy (defensive logging)
    if (p1 && p2) {
      const total = p1.dollars + p2.dollars
      if (total !== GAME_CONFIG.STARTING_CASH * 2) {
        console.error('[GameRoom] Cash validation failed:', {
          total,
          expected: GAME_CONFIG.STARTING_CASH * 2,
          p1: p1.dollars,
          p2: p2.dollars,
        })
      }
    }

    this.player1CashAtRoundStart = p1?.dollars || GAME_CONFIG.STARTING_CASH
    this.player2CashAtRoundStart = p2?.dollars || GAME_CONFIG.STARTING_CASH
  }

  // Determine round winner by cash gained (not absolute dollars)
  getRoundWinner(): { winnerId: string | null; isTie: boolean } {
    const playerIds = this.getPlayerIds()
    const p1 = this.players.get(playerIds[0])
    const p2 = this.players.get(playerIds[1])

    if (!p1 || !p2) return { winnerId: null, isTie: false }

    const p1Gained = p1.dollars - this.player1CashAtRoundStart
    const p2Gained = p2.dollars - this.player2CashAtRoundStart

    // 1. Direct positive gain (Standard Zero-Sum Win)
    if (p1Gained > 0 && p2Gained <= 0) return { winnerId: playerIds[0], isTie: false }
    if (p2Gained > 0 && p1Gained <= 0) return { winnerId: playerIds[1], isTie: false }

    // 2. Relative performance (needed if both lost money due to gas or external factors)
    // The player who lost LESS money performed better
    if (p1Gained > p2Gained) return { winnerId: playerIds[0], isTie: false }
    if (p2Gained > p1Gained) return { winnerId: playerIds[1], isTie: false }

    // 3. Exact tie
    return { winnerId: null, isTie: true }
  }

  // Check if game should end (2 wins OR 3 rounds played OR sudden-death winner)
  checkGameEndCondition(): boolean {
    // CRITICAL: Check sudden death FIRST (before round count)
    // In sudden death, max 3 rounds (round 3 is the final tiebreaker)
    // End if: someone wins OR we've reached round 3 (hard limit)
    if (this.isSuddenDeath) {
      return this.player1Wins !== this.player2Wins || this.currentRound >= 3
    }

    // Best-of-three: 2 wins ends game early
    if (this.player1Wins === 2 || this.player2Wins === 2) return true

    // Game ends after 3 rounds (max)
    return this.currentRound >= 3
  }

  // Determine overall game winner
  // Returns winner logic: First by wins, then by total dollars (Tie-Break)
  getGameWinner(): { winner: Player | undefined; reason: 'wins' | 'dollars' | 'knockout' } {
    const playerIds = this.getPlayerIds()
    const p1 = this.players.get(playerIds[0])
    const p2 = this.players.get(playerIds[1])

    if (!p1 || !p2) return { winner: undefined, reason: 'wins' }

    // 1. Primary Win Condition: Most Round Wins
    if (this.player1Wins > this.player2Wins) {
      return { winner: p1, reason: 'wins' }
    }
    if (this.player2Wins > this.player1Wins) {
      return { winner: p2, reason: 'wins' }
    }

    // 2. Tie-Breaker: Total Dollars
    // If wins are equal (e.g. 1-1 after 3 rounds), player with most money wins
    if (p1.dollars > p2.dollars) return { winner: p1, reason: 'dollars' }
    if (p2.dollars > p1.dollars) return { winner: p2, reason: 'dollars' }

    // Complete draw (unlikely in money game unless exact same trades)
    return { winner: undefined, reason: 'wins' }
  }

  // Closing state management
  getIsClosing(): boolean {
    return this.isClosing
  }

  setClosing(): void {
    this.isClosing = true
  }

  // Wave-based spawn intensity (Fruit Ninja escalation)
  // Returns spawn interval and burst chance based on elapsed time in round
  getSpawnInterval(elapsedMs: number = 0): { minMs: number; maxMs: number; burstChance: number } {
    // Wave configuration: warmup → ramp → intensity → climax
    const waves = [
      { endMs: 10000, intervalMs: { min: 1200, max: 1800 }, burstChance: 0.1 }, // Warmup: faster starts with small burst chance
      { endMs: 20000, intervalMs: { min: 1400, max: 1800 }, burstChance: 0.15 }, // Ramp: occasional doubles
      { endMs: 27000, intervalMs: { min: 1000, max: 1400 }, burstChance: 0.25 }, // Intensity: more doubles
      { endMs: 30000, intervalMs: { min: 700, max: 1100 }, burstChance: 0.4 }, // Climax: burst mode!
    ]

    for (const wave of waves) {
      if (elapsedMs < wave.endMs) {
        return {
          minMs: wave.intervalMs.min,
          maxMs: wave.intervalMs.max,
          burstChance: wave.burstChance,
        }
      }
    }

    // Final wave fallback
    const last = waves[waves.length - 1]
    return { minMs: last.intervalMs.min, maxMs: last.intervalMs.max, burstChance: last.burstChance }
  }

  // Initialize deterministic coin sequence for this round
  initCoinSequence(): void {
    const seed = this.hashString(`${this.id}-round${this.currentRound}`)
    const spawnConfig = this.getSpawnInterval(0) // Use initial spawn config for estimation
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

  // Get next coin from deterministic sequence (includes type + xNormalized)
  getNextCoinData(): { type: 'call' | 'put' | 'gas' | 'whale'; xNormalized: number } | null {
    return this.coinSequence?.next() ?? null
  }

  // Peek at next coin without consuming it from the sequence
  peekNextCoinData(): { type: 'call' | 'put' | 'gas' | 'whale'; xNormalized: number } | null {
    return this.coinSequence?.peek() ?? null
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

    const actualTransfer = transferFunds(
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
      amountTransferred: actualTransfer,
    })
  } finally {
    settlementGuard.release(order.id)
  }
}

// =============================================================================
// Game Logic - Coin Spawning
// =============================================================================

interface SpawnedCoin {
  id: string
  type: 'call' | 'put' | 'gas' | 'whale'
  xNormalized: number
}

function spawnCoin(room: GameRoom): SpawnedCoin | null {
  const coinData = room.getNextCoinData()
  if (!coinData) return null

  const coinId = `coin-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`

  const coin: SpawnedCoin = {
    id: coinId,
    type: coinData.type,
    xNormalized: coinData.xNormalized,
  }

  // Add to room's coin tracking (legacy compat - x/y not used)
  room.addCoin({ id: coinId, type: coinData.type, x: 0, y: 0 })
  return coin
}

// =============================================================================
// Game Logic - Game Loop
// =============================================================================

function startGameLoop(io: SocketIOServer, manager: RoomManager, room: GameRoom): void {
  // CRITICAL: Don't start game loop if room is closing or shut down
  // Prevents post-game-over game loop starts from queued round_ready events
  if (room.isShutdown || room.getIsClosing()) {
    // console.log('[Game Loop] Rejected - room is closing or shut down', {
    //   roomId: room.id,
    //   round: room.currentRound,
    //   isShutdown: room.isShutdown,
    //   isClosing: room.getIsClosing(),
    // })
    return
  }

  // Prevent duplicate game loops for the same round
  if (room.gameLoopActive) {
    // console.log('[Game Loop] Already active, skipping duplicate call')
    return
  }

  // console.log('[Game Loop] Starting game loop', {
  //   roomId: room.id,
  //   round: room.currentRound,
  //   gameLoopActive: room.gameLoopActive,
  // })

  room.gameLoopActive = true

  // Initialize deterministic coin sequence
  room.initCoinSequence()

  // Initialize round state and emit round_start event
  room.startNewRound()
  const roundStartTime = Date.now()

  io.to(room.id).emit('round_start', {
    roundNumber: room.currentRound,
    isSuddenDeath: room.isSuddenDeath,
    durationMs: room.ROUND_DURATION,
  })

  // Room broadcast (single emit, not per-player) - both players get same xNormalized
  const emitCoinSpawn = (coin: SpawnedCoin) => {
    io.to(room.id).emit('coin_spawn', {
      coinId: coin.id,
      coinType: coin.type,
      xNormalized: coin.xNormalized,
    })
  }

  // Helper function to spawn coin with wave-based delay and burst spawns
  const scheduleNextSpawn = () => {
    // Stop if room no longer exists, has fewer than 2 players, or is shutting down
    if (!manager.hasRoom(room.id) || room.players.size < 2 || room.isShutdown) {
      return
    }

    const elapsedMs = Date.now() - roundStartTime
    const spawnConfig = room.getSpawnInterval(elapsedMs)

    // Determine burst count (1-3 coins) based on wave's burstChance
    const rng = Math.random()
    let burstCount = 1
    if (rng < spawnConfig.burstChance) {
      burstCount = rng < spawnConfig.burstChance * 0.3 ? 3 : 2 // 30% of bursts are triples
    }

    // CRITICAL: Pre-check sequence has enough coins for the full burst
    // Use peek() to check without consuming from the sequence
    let actualBurstCount = burstCount
    for (let i = 0; i < burstCount; i++) {
      if (!room.peekNextCoinData()) {
        actualBurstCount = i
        break
      }
    }

    // Spawn burst with 100ms stagger for Fruit Ninja feel
    for (let i = 0; i < actualBurstCount; i++) {
      const coin = spawnCoin(room)
      if (!coin) return // Should never happen due to pre-check above

      // Stagger burst spawns by 100ms each
      if (i === 0) {
        emitCoinSpawn(coin)
      } else {
        const staggerTimeout = setTimeout(() => {
          // Double-check room state before delayed emit (prevents race conditions)
          // Pattern: Guards prevent operations on deleted rooms during async callbacks
          if (room.isShutdown || !manager.hasRoom(room.id)) return
          emitCoinSpawn(coin)
        }, i * 100)
        room.trackTimeout(staggerTimeout)
      }
    }

    // Schedule next spawn based on wave config
    const nextDelay =
      Math.floor(Math.random() * (spawnConfig.maxMs - spawnConfig.minMs + 1)) + spawnConfig.minMs
    const timeoutId = setTimeout(scheduleNextSpawn, nextDelay)
    room.trackTimeout(timeoutId)
  }

  // Start first spawn immediately
  scheduleNextSpawn()

  // Clear any existing round timeout (defensive)
  if (room.roundTimeout) {
    clearTimeout(room.roundTimeout)
  }

  // End ROUND after ROUND_DURATION (not full game)
  room.roundTimeout = setTimeout(() => {
    endRound(io, manager, room)
  }, room.ROUND_DURATION)

  room.trackTimeout(room.roundTimeout)
}

// Wait for both clients to be ready before starting game loop (first round only)
// This ensures both players see the full 30-second timer
function startGameWhenClientsReady(io: SocketIOServer, manager: RoomManager, room: GameRoom): void {
  // Check if already both ready (race condition: clients ready before this function called)
  if (room.clientsReady.size === 2) {
    // console.log('[Game Loop] Both clients already ready, starting immediately')
    startGameLoop(io, manager, room)
    return
  }

  // console.log('[Game Loop] Waiting for clients to be ready', {
  //   roomId: room.id,
  //   clientsReady: room.clientsReady.size,
  // })

  // Wait up to 10 seconds for clients (fallback: start anyway)
  // This handles edge cases where a client crashes or has network issues
  const timeoutId = setTimeout(() => {
    // console.log('[Game Loop] Timeout waiting for clients, starting anyway', {
    //   roomId: room.id,
    //   clientsReady: room.clientsReady.size,
    // })
    startGameLoop(io, manager, room)
  }, 10000)

  room.trackTimeout(timeoutId)
}

// =============================================================================
// Helper Functions
// =============================================================================

// Fund transfer helper - zero-sum with $0 floor
// Returns the actual amount transferred (capped at loser's balance)
function transferFunds(room: GameRoom, winnerId: string, loserId: string, amount: number): number {
  const winner = room.players.get(winnerId)
  const loser = room.players.get(loserId)

  // Cap transfer at loser's available balance (zero-sum: total always = 20)
  const actualTransfer = Math.min(amount, loser?.dollars || 0)

  if (winner) winner.dollars += actualTransfer
  if (loser) loser.dollars -= actualTransfer // Goes to 0, never negative

  return actualTransfer
}

// =============================================================================
// Yellow Network State Channel Integration
// =============================================================================

// Create Yellow state channel for the game using Nitrolite SDK
async function createYellowChannel(
  room: GameRoom,
  name1: string,
  name2: string,
  wallet1: string,
  wallet2: string
): Promise<void> {
  try {
    const channel = await createGameChannel({
      player1Address: wallet1,
      player2Address: wallet2,
      player1Name: name1,
      player2Name: name2,
    })

    room.channelId = channel.channelId
    room.channelStatus = channel.status as 'INITIAL' | 'ACTIVE' | 'FINAL'

    console.log('[Nitrolite] Channel created successfully:', {
      channelId: channel.channelId,
      participants: channel.participants,
      allocations: channel.allocations,
    })
  } catch (error) {
    // No mock fallback - throw to surface configuration issues
    throw new Error(
      `[Nitrolite] Channel creation failed: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

// Update Yellow channel state after round ends using Nitrolite
async function updateYellowChannel(room: GameRoom): Promise<void> {
  if (!room.channelId || !room.player1Address || !room.player2Address) return

  // CRITICAL: Get dollars by wallet address, not by socket ID order
  // This ensures correct mapping regardless of Map iteration order
  const player1Dollars = room.getDollarsByWalletAddress(room.player1Address)
  const player2Dollars = room.getDollarsByWalletAddress(room.player2Address)

  // console.log('[GameRoom] updateYellowChannel - player dollars:', {
  //   channelId: room.channelId,
  //   currentRound: room.currentRound,
  //   player1Address: room.player1Address,
  //   player2Address: room.player2Address,
  //   player1Dollars,
  //   player2Dollars,
  //   allPlayers: Array.from(room.players.entries()).map(([id, p]) => ({
  //     id,
  //     name: p.name,
  //     dollars: p.dollars,
  //   })),
  // })

  try {
    await updateChannelState({
      channelId: room.channelId,
      player1Address: room.player1Address,
      player2Address: room.player2Address,
      player1Dollars,
      player2Dollars,
      version: room.currentRound,
    })

    room.channelStatus = 'ACTIVE'
  } catch (error) {
    console.error('[Nitrolite] State update failed:', error)
  }
}

// Settle Yellow channel at game end using Nitrolite
async function settleYellowChannel(room: GameRoom): Promise<{
  channelId: string
  player1Payout: string
  player2Payout: string
} | null> {
  if (!room.channelId || !room.player1Address || !room.player2Address) return null

  // CRITICAL: Get dollars by wallet address, not by socket ID order
  // This ensures correct mapping regardless of Map iteration order
  const player1Dollars = room.getDollarsByWalletAddress(room.player1Address)
  const player2Dollars = room.getDollarsByWalletAddress(room.player2Address)

  // console.log('[GameRoom] settleYellowChannel - player dollars:', {
  //   channelId: room.channelId,
  //   player1Address: room.player1Address,
  //   player2Address: room.player2Address,
  //   player1Dollars,
  //   player2Dollars,
  //   allPlayers: Array.from(room.players.entries()).map(([id, p]) => ({
  //     id,
  //     name: p.name,
  //     dollars: p.dollars,
  //   })),
  // })

  try {
    const result = await settleChannel({
      channelId: room.channelId,
      player1Address: room.player1Address,
      player2Address: room.player2Address,
      player1Dollars,
      player2Dollars,
    })

    room.channelStatus = 'FINAL'

    return {
      channelId: room.channelId,
      player1Payout: result.player1Payout,
      player2Payout: result.player2Payout,
    }
  } catch (error) {
    // No mock fallback - throw to surface configuration issues
    throw new Error(
      `[Nitrolite] Settlement failed: ${error instanceof Error ? error.message : String(error)}`
    )
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

  // Broadcast lobby update after match is created
  const allWaitingPlayers = Array.from(manager.getWaitingPlayers().entries()).map(
    ([_id, player]) => ({
      socketId: player.socketId,
      name: player.name,
      joinedAt: player.joinedAt,
    })
  )
  io.emit('lobby_updated', { players: allWaitingPlayers })

  // Wait for both clients to be ready before starting (syncs timer)
  // This ensures both players see the full 30-second countdown
  startGameWhenClientsReady(io, manager, room)
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
    const actualTransfer = transferFunds(
      room,
      playerIds.find((id) => id !== playerId)!,
      playerId,
      1
    )
    room.tugOfWar += playerId === playerIds[0] ? 1 : -1
    io.to(room.id).emit('player_hit', { playerId, damage: actualTransfer, reason: 'gas' })

    // CRITICAL: Check knockout immediately after gas penalty
    if (room.hasDeadPlayer()) {
      await checkGameOver(io, manager, room)
    }
    return
  }

  if (data.coinType === 'whale') {
    // Load leverage from ENS (defaults to 2x if not set)
    const leverage = await room.getPlayerLeverage(playerId)

    room.activateWhale2X(playerId, leverage)
    io.to(room.id).emit('whale_2x_activated', {
      playerId,
      playerName: room.players.get(playerId)?.name || 'Unknown',
      durationMs: room.WHALE_2X_DURATION,
      multiplier: leverage, // Send actual leverage (2, 5, 10, 20)
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

    // console.log('[Round History] KO Recording:', {
    //   roundNumber: roundSummary.roundNumber,
    //   player1Dollars: roundSummary.player1Dollars,
    //   player2Dollars: roundSummary.player2Dollars,
    //   total: roundSummary.player1Dollars + roundSummary.player2Dollars,
    //   winnerId,
    // })

    room.roundHistory.push(roundSummary)

    // Settle Yellow channel before game over
    const settlement = await settleYellowChannel(room)

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

    // CRITICAL: Clear clientsReady to prevent post-game-over round_ready events
    // Guards in round_ready handler also block, but this ensures clean state
    room.resetClientsReady()

    setTimeout(() => manager.deleteRoom(room.id), 1000)
  }
}

// =============================================================================
// Round Management - End round and transition or end game
// =============================================================================

async function endRound(io: SocketIOServer, manager: RoomManager, room: GameRoom): Promise<void> {
  // Mark game loop as no longer active
  room.gameLoopActive = false

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
  await updateYellowChannel(room)

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

  // console.log('[Round History] Recording:', {
  //   roundNumber: roundSummary.roundNumber,
  //   player1Dollars: roundSummary.player1Dollars,
  //   player2Dollars: roundSummary.player2Dollars,
  //   total: roundSummary.player1Dollars + roundSummary.player2Dollars,
  //   winnerId,
  //   isTie,
  // })

  room.roundHistory.push(roundSummary)

  // Check if game should end
  if (room.checkGameEndCondition()) {
    // CRITICAL: Mark room as closing to prevent post-game-over round_ready events
    room.setClosing()

    // Settle Yellow channel before game over
    const settlement = await settleYellowChannel(room)

    // Game over - emit final results
    const { winner, reason } = room.getGameWinner()
    io.to(room.id).emit('game_over', {
      winnerId: winner?.id,
      winnerName: winner?.name,
      reason: reason === 'dollars' ? 'tie_break' : 'best_of_three_complete',
      player1Wins: room.player1Wins,
      player2Wins: room.player2Wins,
      rounds: room.roundHistory,
      yellowSettlement: settlement,
    })

    // CRITICAL: Clear clientsReady to prevent post-game-over round_ready events
    // Guards in round_ready handler also block, but this ensures clean state
    room.resetClientsReady()

    setTimeout(() => manager.deleteRoom(room.id), 1000)
  } else {
    // Reset client ready state for next round
    room.resetClientsReady()

    // Enable sudden death if tied 1-1 entering round 3
    // We check currentRound here (before increment) in startGameLoop
    if (room.currentRound === 2 && room.player1Wins === 1 && room.player2Wins === 1) {
      room.isSuddenDeath = true
    }
    // NOTE: startNewRound() is called in startGameLoop() when clients are ready
    // This prevents double-incrementation which was skipping rounds

    // Wait for both clients to be ready for next round
    // This ensures both players see full 30 seconds (no lost time to overlay processing)
    // console.log('[Round Transition] Waiting for clients to be ready for next round', {
    //   roomId: room.id,
    //   nextRound: room.currentRound + 1, // Will be incremented in startGameLoop
    // })

    // Wait up to 6 seconds for clients (fallback: start anyway)
    // Matches FLASH_DURATION (5s) + 1s buffer for smooth transitions
    const timeoutId = setTimeout(() => {
      // console.log('[Round Transition] Timeout waiting for clients, starting anyway', {
      //   roomId: room.id,
      //   round: room.currentRound,
      //   clientsReady: room.clientsReady.size,
      // })
      startGameLoop(io, manager, room)
    }, 6000)

    room.trackTimeout(timeoutId)
  }
}

// =============================================================================
// Main Export - Setup Game Events
// =============================================================================

export function setupGameEvents(io: SocketIOServer): {
  cleanup: () => void
  emergencyShutdown: () => void
} {
  // Initialize Nitrolite client for Yellow Network integration
  try {
    initializeNitrolite()
    console.log('[Yellow] Nitrolite client initialized successfully')
  } catch (error) {
    console.error('[Yellow] Failed to initialize Nitrolite:', error)
    console.warn('[Yellow] Continuing without Yellow integration - using mock mode')
  }

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

          // ADD TO POOL FIRST (before checking for opponents)
          // This ensures AUTO-MATCH players are visible in lobby briefly
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

          // Broadcast lobby update (now includes self)
          const allWaitingPlayers = Array.from(manager.getWaitingPlayers().entries()).map(
            ([_id, player]) => ({
              socketId: player.socketId,
              name: player.name,
              joinedAt: player.joinedAt,
            })
          )
          io.emit('lobby_updated', { players: allWaitingPlayers })

          // NOW CHECK FOR OPPONENT
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

                // Broadcast lobby update (both players removed after match)
                const remainingPlayers = Array.from(manager.getWaitingPlayers().entries())
                  .filter(([id]) => id !== socket.id && id !== waitingId)
                  .map(([_id, player]) => ({
                    socketId: player.socketId,
                    name: player.name,
                    joinedAt: player.joinedAt,
                  }))
                io.emit('lobby_updated', { players: remainingPlayers })

                return
              }
            }
          }

          // No opponent found, already in pool from above
          socket.emit('waiting_for_match')
        } catch (error) {
          socket.emit('error', { message: 'Failed to find match' })
        }
      }
    )

    // Join waiting pool without immediately matching (for lobby view)
    socket.on(
      'join_waiting_pool',
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

          // Check if already in waiting pool
          if (manager.getWaitingPlayer(socket.id)) {
            socket.emit('already_in_pool')
            return
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

          // Broadcast lobby update to all connected clients
          const allWaitingPlayers = Array.from(manager.getWaitingPlayers().entries()).map(
            ([_id, player]) => ({
              socketId: player.socketId,
              name: player.name,
              joinedAt: player.joinedAt,
            })
          )
          io.emit('lobby_updated', { players: allWaitingPlayers })

          socket.emit('joined_waiting_pool')
        } catch (error) {
          socket.emit('error', { message: 'Failed to join waiting pool' })
        }
      }
    )

    // Leave waiting pool (when exiting lobby view)
    socket.on('leave_waiting_pool', () => {
      manager.removeWaitingPlayer(socket.id)

      // Broadcast lobby update to all connected clients
      const allWaitingPlayers = Array.from(manager.getWaitingPlayers().entries()).map(
        ([_id, player]) => ({
          socketId: player.socketId,
          name: player.name,
          joinedAt: player.joinedAt,
        })
      )
      io.emit('lobby_updated', { players: allWaitingPlayers })
    })

    // Client signals Phaser scene is ready (syncs timer for both players)
    socket.on('scene_ready', () => {
      const roomId = manager.getPlayerRoomId(socket.id)
      if (!roomId) return

      const room = manager.getRoom(roomId)
      if (!room) return

      // console.log('[Client Ready]', {
      //   roomId: room.id,
      //   socketId: socket.id.slice(0, 8),
      //   clientsReady: room.clientsReady.size + 1,
      // })

      // Mark this client as ready
      const bothReady = room.markClientReady(socket.id)

      // If both clients are ready, start the game loop
      if (bothReady) {
        // console.log('[Game Loop] Both clients ready, starting game', {
        //   roomId: room.id,
        // })
        startGameLoop(io, manager, room)
      }
    })

    // Client signals ready for next round (after round end overlay)
    socket.on('round_ready', () => {
      const roomId = manager.getPlayerRoomId(socket.id)
      if (!roomId) return

      const room = manager.getRoom(roomId)
      if (!room) return

      // CRITICAL: Reject round_ready if game is over or round limit reached
      // Prevents post-game-over state leaks and rounds exceeding best-of-3
      if (room.isShutdown || room.getIsClosing() || room.currentRound >= 3) {
        // console.log('[Round Ready] Rejected - game over or round limit', {
        //   roomId: room.id,
        //   round: room.currentRound,
        //   isShutdown: room.isShutdown,
        //   isClosing: room.getIsClosing(),
        //   socketId: socket.id.slice(0, 8),
        // })
        return
      }

      // console.log('[Round Ready]', {
      //   roomId: room.id,
      //   round: room.currentRound,
      //   socketId: socket.id.slice(0, 8),
      //   clientsReady: room.clientsReady.size + 1,
      // })

      // Mark this client as ready for next round
      const bothReady = room.markClientReady(socket.id)

      // If both clients are ready, start the next round
      if (bothReady) {
        // console.log('[Game Loop] Both clients ready for next round, starting', {
        //   roomId: room.id,
        //   round: room.currentRound,
        // })
        startGameLoop(io, manager, room)
      }
    })

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

    // Get list of waiting players for lobby
    socket.on('get_lobby_players', () => {
      const players = Array.from(manager.getWaitingPlayers().entries())
        .filter(([id]) => id !== socket.id)
        .map(([_id, player]) => ({
          socketId: player.socketId,
          name: player.name,
          joinedAt: player.joinedAt,
        }))
      socket.emit('lobby_players', players)
    })

    // Manually select an opponent
    socket.on('select_opponent', ({ opponentSocketId }: { opponentSocketId: string }) => {
      const opponent = manager.getWaitingPlayer(opponentSocketId)
      if (!opponent) {
        socket.emit('error', { message: 'Opponent no longer available' })
        return
      }

      const opponentSocket = io.of('/').sockets.get(opponentSocketId)
      if (!opponentSocket?.connected) {
        socket.emit('error', { message: 'Opponent disconnected' })
        manager.removeWaitingPlayer(opponentSocketId)
        return
      }

      const localPlayer = manager.getWaitingPlayer(socket.id)
      if (!localPlayer) {
        socket.emit('error', { message: 'You must join waiting pool first' })
        return
      }

      createMatch(
        io,
        manager,
        socket.id,
        opponentSocketId,
        localPlayer.name,
        opponent.name,
        localPlayer.walletAddress,
        opponent.walletAddress,
        localPlayer.sceneWidth || 500,
        localPlayer.sceneHeight || 800,
        opponent.sceneWidth || 500,
        opponent.sceneHeight || 800
      ).catch((error) => {
        console.error('[Match] Failed to create selected match:', error)
        socket.emit('error', { message: 'Failed to start match' })
      })
    })

    socket.on('disconnect', () => {
      manager.removeWaitingPlayer(socket.id)

      // Broadcast lobby update after player leaves
      const allWaitingPlayers = Array.from(manager.getWaitingPlayers().entries()).map(
        ([_id, player]) => ({
          socketId: player.socketId,
          name: player.name,
          joinedAt: player.joinedAt,
        })
      )
      io.emit('lobby_updated', { players: allWaitingPlayers })

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
