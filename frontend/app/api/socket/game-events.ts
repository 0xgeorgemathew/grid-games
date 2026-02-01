import { Server as SocketIOServer } from 'socket.io'
import { Socket } from 'socket.io'
import { Player } from '@/game/types/trading'
import { DEFAULT_BTC_PRICE } from '@/lib/formatPrice'

// Debug logging control - set DEBUG_FUNDS=true in .env.local to enable
const DEBUG_FUNDS = process.env.DEBUG_FUNDS === 'true'

// =============================================================================
// Settlement Guard - Prevent duplicate settlement race conditions
// =============================================================================

const settlementsInProgress = new Set<string>()
const settlementsInProgressTimestamps = new Map<string, number>()

let settlementCleanupInterval: NodeJS.Timeout | null = null

// Cleanup old settlement entries (prevent memory leak)
const startSettlementCleanup = () => {
  if (settlementCleanupInterval) return // Already started

  settlementCleanupInterval = setInterval(() => {
    const now = Date.now()
    const STALE_THRESHOLD_MS = 30000 // 30 seconds

    for (const [orderId, timestamp] of settlementsInProgressTimestamps) {
      if (now - timestamp > STALE_THRESHOLD_MS) {
        settlementsInProgress.delete(orderId)
        settlementsInProgressTimestamps.delete(orderId)
      }
    }
  }, 60000) // Run every minute
}

const stopSettlementCleanup = () => {
  if (settlementCleanupInterval) {
    clearInterval(settlementCleanupInterval)
    settlementCleanupInterval = null
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
      console.error('[PriceFeed] Server WebSocket error:', error)
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

  constructor(roomId: string) {
    this.id = roomId
    this.players = new Map()
    this.coins = new Map()
    this.pendingOrders = new Map()
  }

  addPlayer(id: string, name: string): void {
    this.players.set(id, { id, name, dollars: 10, score: 0 })
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

  // Closing state management
  getIsClosing(): boolean {
    return this.isClosing
  }

  setClosing(): void {
    this.isClosing = true
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
    console.log('[RoomManager] Emergency shutdown - settling all pending orders...')

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
      })

      // Cleanup room timers
      room.cleanup()
    }

    // Clear manager state
    this.rooms.clear()
    this.waitingPlayers.clear()
    this.playerToRoom.clear()

    console.log('[RoomManager] Emergency shutdown complete - all orders settled')
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
  // Atomic guard: prevent double settlement
  if (settlementsInProgress.has(order.id)) {
    console.log(`[Settlement] Skipping ${order.id} - already in progress`)
    return
  }

  // Verify order still exists
  if (!room.pendingOrders.has(order.id)) {
    console.log(`[Settlement] Order ${order.id} already settled`)
    return
  }

  settlementsInProgress.add(order.id)
  settlementsInProgressTimestamps.set(order.id, Date.now())
  try {
    // Validate room state
    if (room.players.size === 0) {
      console.error(`[Settlement] ERROR: Room ${room.id} has no players`)
      return
    }

    const playerIds = room.getPlayerIds()
    if (playerIds.length < 2) {
      console.error(`[Settlement] ERROR: Room ${room.id} has only ${playerIds.length} player(s)`)
      return
    }

    const finalPrice = priceFeed.getLatestPrice()

    // Settlement always uses latest price for simplicity and reliability
    console.log(
      `[Settlement] Order ${order.id} - ${order.coinType.toUpperCase()}: $${order.priceAtOrder.toFixed(2)} → $${finalPrice.toFixed(2)}`
    )

    const priceChange = (finalPrice - order.priceAtOrder) / order.priceAtOrder

    let isCorrect = false
    if (order.coinType === 'call') isCorrect = priceChange > 0
    else if (order.coinType === 'put') isCorrect = priceChange < 0
    else if (order.coinType === 'whale') isCorrect = Math.random() < 0.8

    const impact = order.coinType === 'whale' ? 2 : 1
    // Use stored isPlayer1 from order creation time (not current playerIds lookup)
    const isPlayer1 = order.isPlayer1

    // === FUND TRACKING: Log state BEFORE transfer ===
    const playersBefore = Array.from(room.players.values()).map((p) => ({
      id: p.id.slice(-6),
      name: p.name,
      dollars: p.dollars,
    }))
    const totalBefore = playersBefore.reduce((sum, p) => sum + p.dollars, 0)

    let winnerId: string | null = null
    let winnerName: string | null = null
    let loserId: string | null = null
    let loserName: string | null = null

    // ZERO-SUM: Transfer funds from loser to winner
    if (isCorrect) {
      // Player who placed the order won
      winnerId = order.playerId
      winnerName = order.playerName
      loserId = playerIds.find((id) => id !== order.playerId) || null
      const loser = room.players.get(loserId || '')
      if (loser) loserName = loser?.name
    } else {
      // Player who placed the order lost
      loserId = order.playerId
      loserName = order.playerName
      winnerId = playerIds.find((id) => id !== order.playerId) || null
      const winner = room.players.get(winnerId || '')
      if (winner) winnerName = winner?.name
    }

    // Apply transfer: winner gains, loser loses
    const winner = room.players.get(winnerId || '')
    const loser = room.players.get(loserId || '')
    if (winner) winner.dollars += impact
    if (loser) loser.dollars = Math.max(0, loser.dollars - impact) // Loser can't go below 0

    room.tugOfWar += isPlayer1 ? -impact : impact

    // === FUND TRACKING: Log state AFTER transfer ===
    const playersAfter = Array.from(room.players.values()).map((p) => ({
      id: p.id.slice(-6),
      name: p.name,
      dollars: p.dollars,
    }))
    const totalAfter = playersAfter.reduce((sum, p) => sum + p.dollars, 0)

    // FUND CONSERVATION CHECK - total should always be 20 (unless capped at 0)
    if (totalAfter !== totalBefore) {
      const cappedLoss = totalBefore - totalAfter
      if (cappedLoss > 0) {
        console.warn(
          `[FUND CAP] Room ${room.id.slice(-6)}: ${cappedLoss} lost to zero-cap (loser went below 0)`
        )
      }
    }

    room.removePendingOrder(order.id)

    // Log settlement result for debugging (controlled by DEBUG_FUNDS env var)
    if (DEBUG_FUNDS) {
      console.log(
        `[Settlement] ${order.coinType.toUpperCase()} order ${order.id.slice(-8)}:`,
        `${order.playerName} ${isCorrect ? 'WON' : 'LOST'}`,
        `$${order.priceAtOrder.toFixed(2)} → $${finalPrice.toFixed(2)}`,
        `(${(priceChange * 100).toFixed(2)}%)`,
        `\n  BEFORE: ${playersBefore.map((p) => `${p.name}:${p.dollars}`).join(' | ')} (total: ${totalBefore})`,
        `\n  TRANSFER: $${impact} from ${loserName || 'Unknown'} → ${winnerName || 'Unknown'}`,
        `\n  AFTER:  ${playersAfter.map((p) => `${p.name}:${p.dollars}`).join(' | ')} (total: ${totalAfter})`
      )
    }

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
    settlementsInProgress.delete(order.id)
    settlementsInProgressTimestamps.delete(order.id)
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
    x: Math.random() * 500, // Spawns across full width (0-500)
    y: -50,
  }

  room.addCoin(coin)
  return coin
}

// =============================================================================
// Game Logic - Game Loop
// =============================================================================

function startGameLoop(io: SocketIOServer, manager: RoomManager, room: GameRoom): void {
  // Helper function to spawn coin with randomized delay
  const scheduleNextSpawn = () => {
    // Stop if room no longer exists or has fewer than 2 players
    if (!manager.hasRoom(room.id) || room.players.size < 2) {
      return
    }

    // Spawn coin
    const coin = spawnCoin(room)
    io.to(room.id).emit('coin_spawn', {
      coinId: coin.id,
      coinType: coin.type,
      x: coin.x,
      y: coin.y,
    })

    // Schedule next spawn with random interval (800-1200ms)
    const nextDelay = Math.floor(Math.random() * 401) + 800 // 800-1200ms
    const timeoutId = setTimeout(scheduleNextSpawn, nextDelay)
    room.trackTimeout(timeoutId)
  }

  // Start first spawn immediately
  scheduleNextSpawn()

  // End game after 3 minutes
  const endGameTimeout = setTimeout(() => {
    const winner = room.getWinner()
    io.to(room.id).emit('game_over', {
      winnerId: winner?.id,
      winnerName: winner?.name,
      reason: 'time_limit',
    })
  }, 180000)

  room.trackTimeout(endGameTimeout)
}

// =============================================================================
// Helper Functions
// =============================================================================

function createMatch(
  io: SocketIOServer,
  manager: RoomManager,
  playerId1: string,
  playerId2: string,
  name1: string,
  name2: string
): void {
  const roomId = `room-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
  const room = manager.createRoom(roomId)

  room.addPlayer(playerId1, name1)
  room.addPlayer(playerId2, name2)

  manager.setPlayerRoom(playerId1, roomId)
  manager.setPlayerRoom(playerId2, roomId)

  io.of('/').sockets.get(playerId1)?.join(roomId)
  io.of('/').sockets.get(playerId2)?.join(roomId)

  io.to(roomId).emit('match_found', {
    roomId,
    players: [
      { id: playerId1, name: name1, dollars: 10, score: 0 },
      { id: playerId2, name: name2, dollars: 10, score: 0 },
    ],
  })

  manager.removeWaitingPlayer(playerId2)
  // Delay game loop start to allow clients to initialize Phaser scenes
  const startGameTimeout = setTimeout(() => startGameLoop(io, manager, room), 5000)
  room.trackTimeout(startGameTimeout)
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
    // === FUND TRACKING: Log state BEFORE gas transfer ===
    const playersBefore = Array.from(room.players.values()).map((p) => ({
      id: p.id.slice(-6),
      name: p.name,
      dollars: p.dollars,
    }))
    const totalBefore = playersBefore.reduce((sum, p) => sum + p.dollars, 0)

    const player = room.players.get(playerId)
    const opponentId = room.getPlayerIds().find((id) => id !== playerId)
    const opponent = room.players.get(opponentId || '')

    // ZERO-SUM: Gas transfers $1 from slicer to opponent (penalty for slicing gas)
    if (player) {
      player.dollars = Math.max(0, player.dollars - 1)
    }
    if (opponent) {
      opponent.dollars += 1
    }
    const playerIds = room.getPlayerIds()
    room.tugOfWar += playerId === playerIds[0] ? 1 : -1

    // === FUND TRACKING: Log state AFTER gas transfer ===
    const playersAfter = Array.from(room.players.values()).map((p) => ({
      id: p.id.slice(-6),
      name: p.name,
      dollars: p.dollars,
    }))
    const totalAfter = playersAfter.reduce((sum, p) => sum + p.dollars, 0)

    // FUND CONSERVATION CHECK
    if (totalAfter !== totalBefore) {
      const cappedLoss = totalBefore - totalAfter
      if (cappedLoss > 0) {
        console.warn(
          `[FUND CAP] GAS: Room ${room.id.slice(-6)}: ${cappedLoss} lost to zero-cap`
        )
      }
    }

    if (DEBUG_FUNDS) {
      console.log(
        `[GAS] ${player?.name || 'Unknown'} sliced gas: $1 penalty`,
        `\n  BEFORE: ${playersBefore.map((p) => `${p.name}:${p.dollars}`).join(' | ')} (total: ${totalBefore})`,
        `\n  TRANSFER: $1 from ${player?.name || 'Unknown'} → ${opponent?.name || 'Unknown'}`,
        `\n  AFTER:  ${playersAfter.map((p) => `${p.name}:${p.dollars}`).join(' | ')} (total: ${totalAfter})`
      )
    }

    io.to(room.id).emit('player_hit', { playerId, damage: 1, reason: 'gas' })
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

  // Schedule settlement
  const timeoutId = setTimeout(() => {
    // Skip if room is shutdown or closing
    if (room.isShutdown) {
      console.log(`[Settlement] Skipped order ${order.id} - room ${room.id} is shutdown`)
      return
    }
    if (room.getIsClosing()) {
      console.log(`[Settlement] Skipped order ${order.id} - room ${room.id} is closing`)
      return
    }
    // Double-check: room exists AND order still pending (not already settled)
    if (manager.hasRoom(room.id) && room.pendingOrders.has(order.id)) {
      settleOrder(io, room, order)
      checkGameOver(io, manager, room)
    } else if (!manager.hasRoom(room.id)) {
      console.log(`[Settlement] Skipped order ${order.id} - room ${room.id} no longer exists`)
    }
  }, 10000) // 10 seconds

  room.trackTimeout(timeoutId)
}

function checkGameOver(io: SocketIOServer, manager: RoomManager, room: GameRoom): void {
  if (room.hasDeadPlayer()) {
    // Prevent new operations
    room.setClosing()

    const winner = room.getWinner()

    // CRITICAL: Settle all pending orders before deleting room
    for (const [orderId, order] of room.pendingOrders) {
      settleOrder(io, room, order)
    }

    io.to(room.id).emit('game_over', {
      winnerId: winner?.id,
      winnerName: winner?.name,
      roomId: room.id,
    })

    // Delete room immediately (all orders settled above)
    manager.deleteRoom(room.id)
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

  // Start settlement cleanup
  startSettlementCleanup()

  const manager = new RoomManager()

  // Periodic cleanup of stale waiting players (tracked for cleanup)
  const cleanupInterval = setInterval(() => manager.cleanupStaleWaitingPlayers(), 30000)

  // Cleanup function for graceful shutdown
  const cleanup = () => {
    clearInterval(cleanupInterval)
    stopSettlementCleanup()
    priceFeed.disconnect()
  }

  // Emergency shutdown - settles all pending orders before closing
  const emergencyShutdown = () => {
    manager.emergencyShutdown(io)
  }

  io.on('connection', (socket: Socket) => {
    socket.on('find_match', ({ playerName }: { playerName: string }) => {
      try {
        const validatedName = validatePlayerName(playerName)

        // Check for waiting player - double-check connection status before matching
        for (const [waitingId, waiting] of manager.getWaitingPlayers()) {
          if (waitingId !== socket.id) {
            const waitingSocket = io.of('/').sockets.get(waitingId)
            // CRITICAL: Verify socket is still connected AND is the same socket
            if (waitingSocket?.connected && waitingSocket.id === waitingId) {
              createMatch(io, manager, socket.id, waitingId, validatedName, waiting.name)
              return
            }
          }
        }

        // No match - add to waiting
        manager.addWaitingPlayer(socket.id, validatedName)
        socket.emit('waiting_for_match')
      } catch (error) {
        console.error('Error in find_match:', error)
        socket.emit('error', { message: 'Failed to find match' })
      }
    })

    socket.on('slice_coin', (data: { coinId: string; coinType: string; priceAtSlice: number }) => {
      try {
        const roomId = manager.getPlayerRoomId(socket.id)
        if (!roomId) {
          return
        }

        const room = manager.getRoom(roomId)
        if (!room) {
          manager.removePlayerFromRoom(socket.id)
          return
        }

        handleSlice(io, manager, room, socket.id, data)
      } catch (error) {
        console.error('Error in slice_coin:', error)
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

          // Only schedule room deletion if no pending orders
          // This prevents race condition where settlements are in progress
          const hasPendingOrders = room.pendingOrders.size > 0
          if (!hasPendingOrders) {
            setTimeout(() => manager.deleteRoom(roomId), 5000)
          } else {
            // If there are pending orders, let them settle naturally
            // Room will be cleaned up by checkGameOver when a player dies
            console.log(`[Disconnect] Room ${roomId} has pending orders, delaying deletion`)
          }
        }
      }
    })
  })

  return { cleanup, emergencyShutdown }
}
