import { Server as SocketIOServer } from 'socket.io'
import { Socket } from 'socket.io'

// =============================================================================
// Price Feed Manager - Real-time Binance WebSocket
// =============================================================================

class PriceFeedManager {
  private ws: WebSocket | null = null
  private currentPrice: number = 3400
  private subscribers: Set<(price: number) => void> = new Set()
  private MAX_BUFFER_SIZE = 10000 // Store ~10s of trades
  private priceBuffer: Array<{
    price: number
    size: number
    side: 'BUY' | 'SELL'
    timestamp: number
    tradeId: number
  }> = []

  connect(symbol: string = 'btcusdt'): void {
    if (this.ws) {
      this.ws.close()
    }

    const url = `wss://stream.binance.com:9443/ws/${symbol}@aggTrade`
    this.ws = new WebSocket(url)

    this.ws.onmessage = (event) => {
      const raw = JSON.parse(event.data.toString())

      // Parse aggregate trade format
      const trade = {
        price: parseFloat(raw.p), // Trade price
        size: parseFloat(raw.q), // Trade quantity
        side: raw.m ? ('SELL' as const) : ('BUY' as const), // Trade direction
        timestamp: raw.T, // Trade time (ms)
        tradeId: raw.a, // Aggregate trade ID
      }

      // Store in circular buffer for settlement resolution
      this.priceBuffer.push(trade)
      if (this.priceBuffer.length > this.MAX_BUFFER_SIZE) {
        this.priceBuffer.shift()
      }

      // Update current price for backward compatibility
      this.currentPrice = trade.price
      this.subscribers.forEach((cb) => cb(trade.price))
    }

    this.ws.onerror = (error) => {
      console.error('[PriceFeed] Server WebSocket error:', error)
    }

    this.ws.onclose = () => {
      // Auto-reconnect after 5s
      setTimeout(() => this.connect(symbol), 5000)
    }
  }

  getPrice(): number {
    return this.currentPrice
  }

  getPriceAtTimestamp(targetTimestamp: number): number | null {
    if (this.priceBuffer.length === 0) return null

    // Find the trade with timestamp closest to targetTimestamp
    let closestTrade = this.priceBuffer[0]
    let minDiff = Math.abs(this.priceBuffer[0].timestamp - targetTimestamp)

    for (const trade of this.priceBuffer) {
      const diff = Math.abs(trade.timestamp - targetTimestamp)
      if (diff < minDiff) {
        minDiff = diff
        closestTrade = trade
      }
    }

    // Only return if within 100ms of target time
    if (minDiff <= 100) {
      return closestTrade.price
    }
    return null
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

interface PlayerState {
  id: string
  name: string
  dollars: number
  score: number
}

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

interface PendingOrder {
  id: string
  playerId: string
  playerName: string
  coinType: 'call' | 'put' | 'whale'
  priceAtOrder: number
  settlesAt: number
}

// =============================================================================
// GameRoom Class - Encapsulates room state and lifecycle
// =============================================================================

class GameRoom {
  readonly id: string
  readonly players: Map<string, PlayerState>
  readonly coins: Map<string, Coin>
  readonly pendingOrders: Map<string, PendingOrder>
  tugOfWar = 0
  currentSymbol = 'ethusdt'

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
  getWinner(): PlayerState | undefined {
    const players = Array.from(this.players.values())
    return players.reduce((a, b) => (a.dollars > b.dollars ? a : b), players[0])
  }

  // Check if any player is dead
  hasDeadPlayer(): boolean {
    return Array.from(this.players.values()).some((p) => p.dollars <= 0)
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

    // Clear player mappings
    for (const playerId of room.getPlayerIds()) {
      this.playerToRoom.delete(playerId)
    }

    // Cleanup room timers
    room.cleanup()

    // Delete room
    this.rooms.delete(roomId)
    console.log(`Room ${roomId} cleaned up`)
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
        console.log(`Removed stale waiting player: ${id}`)
      }
    }
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
  const finalPrice = priceFeed.getPriceAtTimestamp(order.settlesAt)

  if (finalPrice === null) {
    console.error(`[Settlement] No price found for timestamp ${order.settlesAt}`)
    return // Skip settlement if no price data available
  }

  const priceChange = (finalPrice - order.priceAtOrder) / order.priceAtOrder

  let isCorrect = false
  if (order.coinType === 'call') isCorrect = priceChange > 0
  else if (order.coinType === 'put') isCorrect = priceChange < 0
  else if (order.coinType === 'whale') isCorrect = Math.random() < 0.8

  const impact = order.coinType === 'whale' ? 2 : 1
  const playerIds = room.getPlayerIds()
  const isPlayer1 = order.playerId === playerIds[0]

  if (isCorrect) {
    const opponentId = playerIds.find((id) => id !== order.playerId)!
    const opponent = room.players.get(opponentId)
    if (opponent) opponent.dollars -= impact
    room.tugOfWar += isPlayer1 ? -impact : impact
  } else {
    const player = room.players.get(order.playerId)
    if (player) player.dollars -= impact
    room.tugOfWar += isPlayer1 ? impact : -impact
  }

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
  console.log(
    `[Room] Spawned coin: ${coin.id} (${coin.type}) at (${coin.x.toFixed(0)}, ${coin.y.toFixed(0)})`
  )
  return coin
}

// =============================================================================
// Game Logic - Game Loop
// =============================================================================

function startGameLoop(io: SocketIOServer, manager: RoomManager, room: GameRoom): void {
  console.log(`[Room ${room.id}] Game loop started, spawning first coin soon...`)

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
  setTimeout(() => startGameLoop(io, manager, room), 5000)
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
    const player = room.players.get(playerId)
    if (player) {
      player.dollars -= 1
      const playerIds = room.getPlayerIds()
      room.tugOfWar += playerId === playerIds[0] ? 1 : -1
    }
    io.to(room.id).emit('player_hit', { playerId, damage: 1, reason: 'gas' })
    return
  }

  if (!validateCoinType(data.coinType)) {
    console.warn(`Invalid coin type: ${data.coinType}`)
    return
  }

  const order: PendingOrder = {
    id: `order-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    playerId,
    playerName: room.players.get(playerId)?.name || 'Unknown',
    coinType: data.coinType,
    priceAtOrder: data.priceAtSlice,
    settlesAt: Date.now() + 10000, // 10 seconds
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
    if (manager.hasRoom(room.id)) {
      settleOrder(io, room, order)
      checkGameOver(io, manager, room)
    }
  }, 10000) // 10 seconds

  room.trackTimeout(timeoutId)
}

function checkGameOver(io: SocketIOServer, manager: RoomManager, room: GameRoom): void {
  if (room.hasDeadPlayer()) {
    const winner = room.getWinner()
    io.to(room.id).emit('game_over', {
      winnerId: winner?.id,
      winnerName: winner?.name,
      roomId: room.id,
    })
    setTimeout(() => manager.deleteRoom(room.id), 5000)
  }
}

// =============================================================================
// Main Export - Setup Game Events
// =============================================================================

export function setupGameEvents(io: SocketIOServer): void {
  // Start price feed
  priceFeed.connect('btcusdt')

  const manager = new RoomManager()

  // Periodic cleanup of stale waiting players
  setInterval(() => manager.cleanupStaleWaitingPlayers(), 30000)

  io.on('connection', (socket: Socket) => {
    console.log(`Client connected: ${socket.id}`)

    socket.on('find_match', ({ playerName }: { playerName: string }) => {
      try {
        const validatedName = validatePlayerName(playerName)

        // Check for waiting player
        for (const [waitingId, waiting] of manager.getWaitingPlayers()) {
          if (waitingId !== socket.id && io.of('/').sockets.get(waitingId)?.connected) {
            createMatch(io, manager, socket.id, waitingId, validatedName, waiting.name)
            return
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
          console.warn(`No room found for player ${socket.id}`)
          return
        }

        const room = manager.getRoom(roomId)
        if (!room) {
          console.warn(`Room ${roomId} not found`)
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
      console.log(`Client disconnected: ${socket.id}`)
      manager.removeWaitingPlayer(socket.id)

      const roomId = manager.getPlayerRoomId(socket.id)
      if (roomId) {
        const room = manager.getRoom(roomId)
        if (room?.hasPlayer(socket.id)) {
          io.to(roomId).emit('opponent_disconnected')
          setTimeout(() => manager.deleteRoom(roomId), 5000)
        }
      }
    })
  })
}
