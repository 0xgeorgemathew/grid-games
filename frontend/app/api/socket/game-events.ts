import { Server as SocketIOServer } from 'socket.io'
import { Socket } from 'socket.io'

// =============================================================================
// Type Definitions
// =============================================================================

interface PlayerState {
  id: string
  name: string
  health: number
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
    this.players.set(id, { id, name, health: 100, score: 0 })
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

  // Find winner (highest health, or first if tied)
  getWinner(): PlayerState | undefined {
    const players = Array.from(this.players.values())
    return players.reduce((a, b) => (a.health > b.health ? a : b), players[0])
  }

  // Check if any player is dead
  hasDeadPlayer(): boolean {
    return Array.from(this.players.values()).some((p) => p.health <= 0)
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
  const currentPrice = 3400 // TODO: Get from price feed
  const priceChange = (currentPrice - order.priceAtOrder) / order.priceAtOrder

  let isCorrect = false
  if (order.coinType === 'call') isCorrect = priceChange > 0
  else if (order.coinType === 'put') isCorrect = priceChange < 0
  else if (order.coinType === 'whale') isCorrect = Math.random() < 0.8

  const impact = order.coinType === 'whale' ? 20 : 10
  const playerIds = room.getPlayerIds()
  const isPlayer1 = order.playerId === playerIds[0]

  if (isCorrect) {
    const opponentId = playerIds.find((id) => id !== order.playerId)!
    const opponent = room.players.get(opponentId)
    if (opponent) opponent.health -= impact
    room.tugOfWar += isPlayer1 ? -impact : impact
  } else {
    const player = room.players.get(order.playerId)
    if (player) player.health -= impact
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
    finalPrice: currentPrice,
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
    x: 100 + Math.random() * 400,
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
  console.log(`[Room ${room.id}] Game loop started, spawning first coin in 1.5s...`)
  // Spawn coins every 1.5s
  const spawnInterval = setInterval(() => {
    // Stop if room no longer exists
    if (!manager.hasRoom(room.id)) {
      clearInterval(spawnInterval)
      return
    }

    const coin = spawnCoin(room)
    io.to(room.id).emit('coin_spawn', {
      coinId: coin.id,
      coinType: coin.type,
      x: coin.x,
      y: coin.y,
    })
  }, 1500)

  room.trackInterval(spawnInterval)

  // End game after 3 minutes
  const endGameTimeout = setTimeout(() => {
    const winner = room.getWinner()
    io.to(room.id).emit('game_over', {
      winnerId: winner?.id,
      winnerName: winner?.name,
      reason: 'time_limit',
    })
    // Note: RoomManager.deleteRoom() will call room.cleanup()
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
      { id: playerId1, name: name1 },
      { id: playerId2, name: name2 },
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
      player.health -= 10
      const playerIds = room.getPlayerIds()
      room.tugOfWar += playerId === playerIds[0] ? 10 : -10
    }
    io.to(room.id).emit('player_hit', { playerId, damage: 10, reason: 'gas' })
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
    settlesAt: Date.now() + 5000,
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
  }, 5000)

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
