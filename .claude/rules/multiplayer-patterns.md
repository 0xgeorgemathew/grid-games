# Multiplayer Game Reliability Patterns

> Phaser + Socket.IO patterns to prevent race conditions, memory leaks, and silent failures in real-time multiplayer games.

## Pattern 1: Race Condition Prevention with Atomic Guards

Use Set/Map tracking and double-check guards to prevent duplicate settlements and race conditions in async operations.

**Problem:** Async operations (setTimeout, network calls) can execute after game state changes (room deleted, order already settled).

**Solution:** Double-check guards verify both room existence AND order pending status before executing.

```typescript
// Track pending orders in Map for O(1) lookup
class GameRoom {
  readonly pendingOrders: Map<string, PendingOrder>
}

// Schedule settlement with double-check guard
const timeoutId = setTimeout(() => {
  // CRITICAL: Check room exists AND order still pending
  if (manager.hasRoom(room.id) && room.pendingOrders.has(order.id)) {
    settleOrder(io, room, order)
    checkGameOver(io, manager, room)
  } else if (!manager.hasRoom(room.id)) {
    console.log(`[Settlement] Skipped order ${order.id} - room ${room.id} no longer exists`)
  }
}, 10000)

room.trackTimeout(timeoutId)
```

**When to use:**
- All setTimeout/setInterval operations that access game state
- Async callbacks that modify shared state
- Event handlers that may fire after cleanup

---

## Pattern 2: Memory Leak Prevention with Timer Tracking

Track all intervals/timeouts in GameRoom for cleanup. Never use global timers.

**Problem:** Uncleared timers persist after room deletion, causing memory leaks and zombie operations.

**Solution:** Track all timers in GameRoom, clear all during cleanup.

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

  room.cleanup() // Clear all tracked timers
  this.rooms.delete(roomId)
}
```

**When to use:**
- All game loops (spawning, settlement timers)
- Room-scoped timers (never global)
- Any setInterval/setTimeout tied to game state

---

## Pattern 3: Room Lifecycle Management

Settle all pending orders before room deletion. Use state flags to prevent operations on closing rooms.

**Problem:** Deleting rooms with pending orders causes data loss and inconsistent state.

**Solution:** Force settle all orders before deletion. Delay deletion by 1s to ensure events sent.

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

    // Delete room after all settlements are sent
    setTimeout(() => manager.deleteRoom(room.id), 1000)
  }
}
```

**When to use:**
- Game over conditions (knockout, time limit)
- Room cleanup (player disconnect, explicit close)
- Any state transition that ends gameplay

---

## Pattern 4: State Validation with Data Caching

Cache state at order creation to avoid lookup errors during settlement.

**Problem:** Settlement happens 10s after order creation. Player positions, room state may change or become unavailable.

**Solution:** Cache all necessary state at order creation. Never rely on live lookups during settlement.

```typescript
function settleOrder(io: SocketIOServer, room: GameRoom, order: PendingOrder): void {
  const playerIds = room.getPlayerIds()

  // Cache isPlayer1 at order creation (not during settlement)
  const isPlayer1 = order.playerId === playerIds[0]

  if (isCorrect) {
    room.tugOfWar += isPlayer1 ? -impact : impact
  } else {
    room.tugOfWar += isPlayer1 ? impact : -impact
  }

  room.removePendingOrder(order.id)
}
```

**When to use:**
- Order creation (cache player ID, position, timestamp)
- Event emission (cache room state, player state)
- Any async operation that needs stable state reference

---

## Pattern 5: Client-Side Fallbacks for Orphaned State

Clean up orphaned orders when server events are missed (e.g., reconnect after room deletion).

**Problem:** Network issues, reconnects, or race conditions can leave client state out of sync with server.

**Solution:** Client-side cleanup intervals remove orphaned state. Graceful degradation shows errors instead of crashing.

```typescript
// Client-side: Clean up orders that haven't settled after 15s
useEffect(() => {
  const cleanupInterval = setInterval(() => {
    const now = Date.now()
    setPendingOrders((prev) =>
      prev.filter((order) => now - order.settlesAt < 15000)
    )
  }, 5000)

  return () => clearInterval(cleanupInterval)
}, [])

// Graceful degradation - show error state, don't crash
{!latestSettlement ? (
  <div className="text-red-400">Waiting for settlement...</div>
) : (
  <SettlementFlash />
)}
```

**When to use:**
- Pending orders (cleanup after timeout + buffer)
- Room state (remove deleted rooms)
- Connection state (handle reconnects gracefully)

---

## Key Principles

1. **Track everything:** All timers, orders, rooms must be tracked for cleanup
2. **Double-check guards:** Verify state before async operations execute
3. **Cache at creation:** Store state when events occur, not when they settle
4. **Clean up first:** Settle pending operations before deleting game state
5. **Graceful degradation:** Show errors instead of crashing on state mismatches

## Related Documentation

- `.claude/rules/game-design.md` - HFT Battle game mechanics and architecture
- `frontend/PRICE_SETTLEMENT_ARCHITECTURE.md` - Price feed data flow
- `.claude/rules/workflows.md` - Multi-agent coordination patterns
