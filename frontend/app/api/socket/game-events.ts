import { Server as SocketIOServer } from 'socket.io'
import { Socket } from 'socket.io'
import { Player } from '@/game/types/trading'
import { DEFAULT_BTC_PRICE } from '@/lib/formatPrice'

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
}

// Round summary for game over display
interface RoundSummary {
  roundNumber: number
  winnerId: string | null
  isTie: boolean
  player1Dollars: number
  player2Dollars: number
  player1Gained: number
  player2Gained: number
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
  player1CashAtRoundStart: number = 10
  player2CashAtRoundStart: number = 10
  isSuddenDeath: boolean = false
  readonly ROUND_DURATION = 100000 // 100 seconds

  // Round history for game over summary
  roundHistory: RoundSummary[] = []

  // Per-player 2X mode tracking (whale power-up)
  private whale2XActive = new Map<string, number>() // playerId -> expiration timestamp
  readonly WHALE_2X_DURATION = 10000 // 10 seconds

  constructor(roomId: string) {
    this.id = roomId
    this.players = new Map()
    this.coins = new Map()
    this.pendingOrders = new Map()
    this.gameStartTime = Date.now()
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

  addPlayer(id: string, name: string, sceneWidth: number, sceneHeight: number): void {
    this.players.set(id, { id, name, dollars: 10, score: 0, sceneWidth, sceneHeight })
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
    this.player1CashAtRoundStart = this.players.get(playerIds[0])?.dollars || 10
    this.player2CashAtRoundStart = this.players.get(playerIds[1])?.dollars || 10
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

  // Check if game should end (2 wins or sudden-death winner)
  checkGameEndCondition(): boolean {
    if (this.isSuddenDeath) {
      // Game ends if there's a winner (not a tie)
      return this.player1Wins !== this.player2Wins
    }
    // Best-of-three: 2 wins ends game
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
    return undefined
  }

  // Closing state management
  getIsClosing(): boolean {
    return this.isClosing
  }

  setClosing(): void {
    this.isClosing = true
  }

  // Flat spawn rate matching design doc
  getSpawnInterval(): { minMs: number; maxMs: number } {
    return { minMs: 800, maxMs: 1200 }
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
    const impact = room.get2XMultiplier(order.playerId)

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
    })
  } finally {
    settlementGuard.release(order.id)
  }
}

// =============================================================================
// Game Logic - Coin Spawning
// =============================================================================

function spawnCoin(room: GameRoom): Coin {
  const types: Array<'call' | 'put' | 'gas' | 'whale'> = [
    'call',
    'call',
    'put',
    'put',
    'gas',
    'whale',
  ]
  const type = types[Math.floor(Math.random() * types.length)]
  const coinId = `coin-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`

  const coin: Coin = {
    id: coinId,
    type,
    x: 0, // Will be set per-player
    y: 0, // Will be set per-player
  }

  room.addCoin(coin)
  return coin
}

// =============================================================================
// Game Logic - Game Loop
// =============================================================================

function startGameLoop(io: SocketIOServer, manager: RoomManager, room: GameRoom): void {
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
  if (winner) winner.dollars += amount
  if (loser) loser.dollars = Math.max(0, loser.dollars - amount)
}

function createMatch(
  io: SocketIOServer,
  manager: RoomManager,
  playerId1: string,
  playerId2: string,
  name1: string,
  name2: string,
  sceneWidth1: number,
  sceneHeight1: number,
  sceneWidth2: number,
  sceneHeight2: number
): void {
  const roomId = `room-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
  const room = manager.createRoom(roomId)

  room.addPlayer(playerId1, name1, sceneWidth1, sceneHeight1)
  room.addPlayer(playerId2, name2, sceneWidth2, sceneHeight2)

  manager.setPlayerRoom(playerId1, roomId)
  manager.setPlayerRoom(playerId2, roomId)

  io.of('/').sockets.get(playerId1)?.join(roomId)
  io.of('/').sockets.get(playerId2)?.join(roomId)

  io.to(roomId).emit('match_found', {
    roomId,
    players: [
      {
        id: playerId1,
        name: name1,
        dollars: 10,
        score: 0,
        sceneWidth: sceneWidth1,
        sceneHeight: sceneHeight1,
      },
      {
        id: playerId2,
        name: name2,
        dollars: 10,
        score: 0,
        sceneWidth: sceneWidth2,
        sceneHeight: sceneHeight2,
      },
    ],
  })

  manager.removeWaitingPlayer(playerId2)
  // Start game loop immediately - client's isSceneReady guard handles timing
  startGameLoop(io, manager, room)
}

function handleSlice(
  io: SocketIOServer,
  manager: RoomManager,
  room: GameRoom,
  playerId: string,
  data: { coinId: string; coinType: string; priceAtSlice: number }
): void {
  room.removeCoin(data.coinId)

  // Handle gas immediately (penalty to slicer)
  if (data.coinType === 'gas') {
    const playerIds = room.getPlayerIds()
    transferFunds(room, playerIds.find((id) => id !== playerId)!, playerId, 1)
    room.tugOfWar += playerId === playerIds[0] ? 1 : -1
    io.to(room.id).emit('player_hit', { playerId, damage: 1, reason: 'gas' })
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

  const order: PendingOrder = {
    id: `order-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    playerId,
    playerName: room.players.get(playerId)?.name || 'Unknown',
    coinType: data.coinType,
    priceAtOrder: data.priceAtSlice,
    settlesAt: Date.now() + 10000, // 10 seconds
    isPlayer1, // Stored at creation to avoid lookup issues at settlement
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
  }, 10000)

  room.trackTimeout(timeoutId)
}

function checkGameOver(io: SocketIOServer, manager: RoomManager, room: GameRoom): void {
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
    io.to(room.id).emit('round_end', {
      roundNumber: room.currentRound,
      winnerId,
      isTie: false,
      player1Wins: room.player1Wins,
      player2Wins: room.player2Wins,
      player1Dollars: p1?.dollars,
      player2Dollars: p2?.dollars,
      player1Gained: (p1?.dollars || 10) - room.player1CashAtRoundStart,
      player2Gained: (p2?.dollars || 10) - room.player2CashAtRoundStart,
    })

    // Emit game_over with knockout reason
    const winner = room.players.get(winnerId || '')
    io.to(room.id).emit('game_over', {
      winnerId: winner?.id,
      winnerName: winner?.name,
      reason: 'knockout' as const,
      player1Wins: room.player1Wins,
      player2Wins: room.player2Wins,
      rounds: room.roundHistory,
    })

    setTimeout(() => manager.deleteRoom(room.id), 1000)
  }
}

// =============================================================================
// Round Management - End round and transition or end game
// =============================================================================

function endRound(io: SocketIOServer, manager: RoomManager, room: GameRoom): void {
  // CRITICAL: Settle all pending orders before round ends
  for (const [orderId, order] of room.pendingOrders) {
    settleOrder(io, room, order)
  }

  const { winnerId, isTie } = room.getRoundWinner()
  const playerIds = room.getPlayerIds()
  const p1 = room.players.get(playerIds[0])
  const p2 = room.players.get(playerIds[1])

  const p1Gained = (p1?.dollars || 10) - room.player1CashAtRoundStart
  const p2Gained = (p2?.dollars || 10) - room.player2CashAtRoundStart

  // Track round wins (except during sudden death ties)
  if (!room.isSuddenDeath || !isTie) {
    if (winnerId === playerIds[0]) room.player1Wins++
    else if (winnerId === playerIds[1]) room.player2Wins++
  }

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
  room.roundHistory.push({
    roundNumber: room.currentRound,
    winnerId,
    isTie,
    player1Dollars: p1?.dollars || 10,
    player2Dollars: p2?.dollars || 10,
    player1Gained: p1Gained,
    player2Gained: p2Gained,
  })

  // Check if game should end
  if (room.checkGameEndCondition()) {
    // Game over - emit final results
    const winner = room.getGameWinner()
    io.to(room.id).emit('game_over', {
      winnerId: winner?.id,
      winnerName: winner?.name,
      reason: 'best_of_three_complete' as const,
      player1Wins: room.player1Wins,
      player2Wins: room.player2Wins,
      rounds: room.roundHistory,
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
      }: {
        playerName: string
        sceneWidth?: number
        sceneHeight?: number
      }) => {
        try {
          const validatedName = validatePlayerName(playerName)

          // Default dimensions if not provided
          const p1Width = sceneWidth || 500
          const p1Height = sceneHeight || 800

          for (const [waitingId, waiting] of manager.getWaitingPlayers()) {
            if (waitingId !== socket.id) {
              const waitingSocket = io.of('/').sockets.get(waitingId)
              if (waitingSocket?.connected && waitingSocket.id === waitingId) {
                const p2Width = waiting.sceneWidth || 500
                const p2Height = waiting.sceneHeight || 800

                createMatch(
                  io,
                  manager,
                  socket.id,
                  waitingId,
                  validatedName,
                  waiting.name,
                  p1Width,
                  p1Height,
                  p2Width,
                  p2Height
                )
                return
              }
            }
          }

          manager.addWaitingPlayer(socket.id, validatedName)
          const waitingPlayer = manager.getWaitingPlayer(socket.id)
          if (waitingPlayer && sceneWidth && sceneHeight) {
            waitingPlayer.sceneWidth = sceneWidth
            waitingPlayer.sceneHeight = sceneHeight
          }
          socket.emit('waiting_for_match')
        } catch (error) {
          socket.emit('error', { message: 'Failed to find match' })
        }
      }
    )

    socket.on('slice_coin', (data: { coinId: string; coinType: string; priceAtSlice: number }) => {
      try {
        const roomId = manager.getPlayerRoomId(socket.id)
        if (!roomId) return

        const room = manager.getRoom(roomId)
        if (!room) {
          manager.removePlayerFromRoom(socket.id)
          return
        }

        handleSlice(io, manager, room, socket.id, data)
      } catch (error) {
        socket.emit('error', { message: 'Failed to slice coin' })
      }
    })

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
