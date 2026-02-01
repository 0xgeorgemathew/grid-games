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

```typescript
useEffect(() => {
  const cleanupInterval = setInterval(() => {
    const now = Date.now()
    setPendingOrders((prev) =>
      prev.filter((order) => now - order.settlesAt < 15000)
    )
  }, 5000)

  return () => clearInterval(cleanupInterval)
}, [])
```

**Use with:** Pending orders (timeout + buffer), room state, connection state handling.

---

## Key Principles

1. **Track everything:** Timers, orders, rooms for cleanup
2. **Double-check guards:** Verify state before async operations
3. **Cache at creation:** Store state when events occur
4. **Clean up first:** Settle pending operations before deleting
5. **Graceful degradation:** Show errors instead of crashing

## See Also

- `.claude/rules/game-design.md` - Game mechanics and architecture
- `frontend/PRICE_SETTLEMENT_ARCHITECTURE.md` - Price feed data flow
