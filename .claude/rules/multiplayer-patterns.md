# Multiplayer Reliability Patterns

Phaser + Socket.IO patterns for preventing race conditions, memory leaks, and silent failures in real-time multiplayer games.

## 1. Race Condition Prevention

Use double-check guards to prevent duplicate operations when async callbacks execute after state changes.

```typescript
const timeoutId = setTimeout(() => {
  if (manager.hasRoom(room.id) && room.pendingOrders.has(order.id)) {
    settleOrder(io, room, order)
    checkGameOver(io, manager, room)
  }
}, 10000)

room.trackTimeout(timeoutId)
```

**Use with:** `setTimeout`/`setInterval`, async callbacks, event handlers that may fire after cleanup.

---

## 2. Memory Leak Prevention

Track all timers in GameRoom for cleanup. Never use global timers.

```typescript
class GameRoom {
  private intervals = new Set<NodeJS.Timeout>()
  private timeouts = new Set<NodeJS.Timeout>()

  trackTimeout(timeout: NodeJS.Timeout): void {
    this.timeouts.add(timeout)
  }

  trackInterval(interval: NodeJS.Timeout): void {
    this.intervals.add(interval)
  }

  cleanup(): void {
    this.intervals.forEach(clearInterval)
    this.timeouts.forEach(clearTimeout)
    this.intervals.clear()
    this.timeouts.clear()
  }
}

// In RoomManager.deleteRoom
deleteRoom(roomId: string): void {
  const room = this.rooms.get(roomId)
  if (!room) return
  room.cleanup()
  this.rooms.delete(roomId)
}
```

**Use with:** Game loops, spawning timers, settlement timers, any room-scoped `setInterval`/`setTimeout`.

---

## 3. Room Lifecycle Management

Settle all pending orders before room deletion to prevent data loss. Delay deletion to ensure events are sent.

```typescript
function checkGameOver(io: SocketIOServer, manager: RoomManager, room: GameRoom): void {
  if (room.hasDeadPlayer()) {
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

    setTimeout(() => manager.deleteRoom(room.id), 1000)
  }
}
```

**Use with:** Game over conditions (knockout, time limit), player disconnect, any state transition ending gameplay.

---

## 4. State Caching

Cache state at creation time, not during async operations. Player positions may change between order creation and settlement.

```typescript
function settleOrder(io: SocketIOServer, room: GameRoom, order: PendingOrder): void {
  const playerIds = room.getPlayerIds()

  // Cached at order creation, not settlement
  const isPlayer1 = order.playerId === playerIds[0]

  if (isCorrect) {
    room.tugOfWar += isPlayer1 ? -impact : impact
  } else {
    room.tugOfWar += isPlayer1 ? impact : -impact
  }

  room.removePendingOrder(order.id)
}
```

**Use with:** Order creation (player ID, position, timestamp), event emission, any async operation needing stable state.

---

## 5. Client-Side Fallbacks

Clean up orphaned state when server events are missed. Use cleanup intervals to handle network issues gracefully.

**Implementation (trading-store.ts):**

```typescript
cleanupOrphanedOrders: () => {
  const { activeOrders } = get()
  const now = Date.now()

  const newActiveOrders = new Map(activeOrders)
  for (const [orderId, order] of newActiveOrders) {
    if (now - order.settlesAt > 3000) { // Reduced buffer: 3s past settlement
      newActiveOrders.delete(orderId)
    }
  }

  if (newActiveOrders.size !== activeOrders.size) {
    set({ activeOrders: newActiveOrders })
  }
}
```

**Usage:** Called periodically from client-side effect or after connection events.

**Use with:** Pending orders (timeout + buffer), room state, connection state handling.

---

## 6. SettlementGuard Pattern (RAII)

Prevent duplicate settlement race conditions using RAII (Resource Acquisition Is Initialization) pattern. Ensures each order settles exactly once, even with multiple concurrent settlement attempts.

**Implementation (game-events.ts):**

```typescript
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
```

**Usage in settlement:**

```typescript
function settleOrder(io: SocketIOServer, room: GameRoom, order: PendingOrder): void {
  if (!settlementGuard.tryAcquire(order.id)) return // Already settling

  try {
    // Settlement logic...
  } finally {
    settlementGuard.release(order.id) // Always release
  }
}
```

**Use with:** Order settlement, any operation that must execute exactly once. Auto-cleanup of stale entries prevents memory leaks.

---

## 7. Price Feed Reconnection Pattern

WebSocket connections fail and recover gracefully. Pattern ensures continuous price feed with automatic reconnection.

**Implementation (game-events.ts):**

```typescript
class PriceFeedManager {
  private ws: WebSocket | null = null
  private reconnectTimeout: NodeJS.Timeout | null = null
  private isShutdown = false

  connect(symbol: string = 'btcusdt'): void {
    if (this.isShutdown) return

    // Clear pending reconnect
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }

    if (this.ws) this.ws.close()

    const url = `wss://stream.binance.com:9443/ws/${symbol}@aggTrade`
    this.ws = new WebSocket(url)

    this.ws.onclose = () => {
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

    // Clear reconnect timeout to prevent reconnection
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }

    // Close WebSocket without triggering onclose
    if (this.ws) {
      this.ws.onclose = null
      this.ws.close()
    }
  }
}
```

**Use with:** WebSocket connections, external APIs, any long-lived connection. Key: shutdown flag prevents reconnection loops.

---

## 8. React-Phaser Bridge Pattern

Communicate between React UI and Phaser game canvas across separate DOMs. Uses global event emitter for cross-DOM messaging.

**Implementation:**

```typescript
// Declare global event bridge (trading-store.ts)
declare global {
  interface Window {
    phaserEvents?: EventEmitter
  }
}

// Server → React → Phaser
socket.on('whale_2x_activated', (data) => {
  // Update React state
  set({ whale2XActive: true })

  // Bridge to Phaser
  if (window.phaserEvents) {
    window.phaserEvents.emit('whale_2x_activated', data)
  }
})

// Phaser receives bridge events
TradingScene.ts: create() {
  window.phaserEvents?.on('whale_2x_activated', (data) => {
    // Phaser visual effects
  })
}

// Phaser → Socket (direct)
handleCoinSlice(coinId: string) {
  socket.emit('slice_coin', { coinId })
}
```

**Architecture:**

```
┌─────────────┐     socket.io      ┌─────────────┐
│   React     │ ←────────────────→ │   Server    │
│   (Zustand) │                    │ (GameRoom)  │
└──────┬──────┘                    └─────────────┘
       │
       │ window.phaserEvents
       │ (EventEmitter bridge)
       ▼
┌─────────────┐
│   Phaser    │ (Game canvas, separate DOM)
│  (Scene)    │
└─────────────┘
```

**Use with:** Cross-DOM communication, React-Phaser integration, visual effects triggered by server events. Never mix React UI rendering with Phaser canvas.

---

## 9. Phaser Initialization Pattern

Singleton Phaser instance with React integration. Prevents multiple Phaser instances and ensures proper cleanup.

**Implementation (GameCanvasClient.tsx):**

```typescript
export default function GameCanvasClient({ scene = 'GridScene' }: GameCanvasClientProps) {
  const gameRef = useRef<Phaser.Game | null>(null)

  useEffect(() => {
    // Prevent duplicate initialization
    if (gameRef.current) return

    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      parent: 'phaser-container',
      // ... config
    }

    gameRef.current = new Phaser.Game(config)

    // Cleanup on unmount
    return () => {
      if (gameRef.current) {
        gameRef.current.destroy(true)
        gameRef.current = null
      }
    }
  }, [])

  return <div id="phaser-container" />
}
```

**Pattern:** Dynamic import with React lazy loading prevents SSR issues.

```typescript
// GameCanvas.tsx (wrapper)
const GameCanvasClient = dynamic(
  () => import('./GameCanvasClient').then((mod) => mod.default),
  { ssr: false }
)
```

**Use with:** Phaser integration, canvas-based games, any library requiring DOM access after mount.

---

## 10. Seeded RNG Pattern

Deterministic random number generation ensures all players see identical coin sequences regardless of device. Only screen positions differ.

**Implementation (game-events.ts:81-96):**

```typescript
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
```

**Usage:**
```typescript
const seed = hashCode(roomId + roundNumber)
const rng = new SeededRandom(seed)
const coinType = COIN_TYPES[rng.nextInt(0, COIN_TYPES.length - 1)]
```

**Use with:** Coin spawning, power-up timing, any game-randomness that must be identical across clients.

---

## 11. Wave-Based Spawn Configuration

Progressive difficulty through pre-configured spawn waves. Ensures fair gameplay with increasing intensity.

**Configuration (game-events.ts:661-683):**

```typescript
const SPAWN_WAVES = [
  { duration: 5000, spawnRate: 3000, burstChance: 0.10 },  // Warmup
  { duration: 10000, spawnRate: 2500, burstChance: 0.15 }, // Ramp
  { duration: 10000, spawnRate: 2000, burstChance: 0.25 }, // Intensity
  { duration: 5000, spawnRate: 1500, burstChance: 0.40 },  // Climax
]
```

**Features:**
- Time-based wave progression (5s warmup → 10s ramp → 10s intensity → 5s climax)
- Spawn rate decreases (intensity increases) over time
- Burst spawning: 1-3 coins with 100ms stagger (Fruit Ninja feel)
- Ensures both players face identical difficulty curves

**Use with:** Round-based gameplay, progressive difficulty, boss encounters.

---

## Key Principles

1. **Track everything:** Timers, orders, rooms for cleanup
2. **Double-check guards:** Verify state before async operations
3. **Cache at creation:** Store state when events occur
4. **Clean up first:** Settle pending operations before deleting
5. **Graceful degradation:** Show errors instead of crashing
6. **RAII patterns:** Resource acquisition equals initialization (SettlementGuard)
7. **Shutdown flags:** Prevent reconnection loops during cleanup
8. **Bridge carefully:** Use event emitters for cross-DOM communication

## Pattern Quick Reference

| Pattern | Purpose | File |
|---------|---------|------|
| Double-check guards | Race condition prevention | `game-events.ts:1432-1440` |
| Timer tracking | Memory leak prevention | `game-events.ts:313-314, 499-519` (GameRoom.cleanup) |
| Room lifecycle | Data loss prevention | `game-events.ts:1612-1744` (checkGameOver) |
| State caching | Async stability | `game-events.ts:289-298` |
| Client fallbacks | Network resilience | `trading-store.ts:737-752` |
| SettlementGuard | RAII duplicate prevention | `game-events.ts:33-72` |
| Price feed reconnect | WebSocket resilience | `game-events.ts:142-264` (PriceFeedManager) |
| React-Phaser bridge | Cross-DOM communication | `trading-store.ts:38-42, 419-425` |
| Phaser singleton | Instance management | `GameCanvasClient.tsx` |
| Seeded RNG | Deterministic coin sequences | `game-events.ts:81-96` (SeededRandom) |
| Wave-based spawning | Progressive difficulty | `game-events.ts:661-683` (CoinSequence) |

## See Also

- `.claude/rules/game-design.md` - Game mechanics and architecture
- `frontend/PRICE_SETTLEMENT_ARCHITECTURE.md` - Price feed data flow
