# HFT Battle Game Design

2-player competitive trading game. Slice coins to predict BTC price movement. Win by bankrupting your opponent ($0) or having the highest dollar amount after 3 minutes.

## Overview

**Objective:** Predict BTC price movement by slicing coins. Correct predictions transfer funds from opponent.

**Starting Conditions:**
- Each player: $10
- Total economy: $20 (zero-sum, $0 floor)
- Game duration: 3 minutes (180,000ms)
- Coin spawn rate: 800-1200ms (randomized)

## Coin Types

| Type | Spawn Rate | Symbol | Win Condition | Transfer |
|------|------------|--------|---------------|----------|
| Call | 33% (2/6) | ▲ | BTC price goes UP | $1 |
| Put | 33% (2/6) | ▼ | BTC price goes DOWN | $1 |
| Gas | 17% (1/6) | ⚡ | Immediate penalty | $1 (slicer to opponent) |
| Whale | 17% (1/6) | ★ | 80% win rate | $2 |

## Mechanics

### Settlement

Orders settle 10 seconds after slicing using the latest BTC price from Binance WebSocket feed. Gas coins settle immediately.

```typescript
const priceChange = (finalPrice - order.priceAtOrder) / order.priceAtOrder

const isCorrect = order.coinType === 'call' ? priceChange > 0
  : order.coinType === 'put' ? priceChange < 0
  : order.coinType === 'whale' ? Math.random() < 0.8
  : false

const transfer = order.coinType === 'whale' ? 2 : 1
```

### Zero-Sum Transfer

Winner gains transfer amount, loser loses same amount (floor at $0).

```typescript
const winnerId = isCorrect ? order.playerId : playerIds.find((id) => id !== order.playerId)
const loserId = isCorrect ? playerIds.find((id) => id !== order.playerId) : order.playerId

const winner = room.players.get(winnerId)
const loser = room.players.get(loserId)

if (winner) winner.dollars += transfer
if (loser) loser.dollars = Math.max(0, loser.dollars - transfer)
```

### Tug-of-War

Visual indicator of game state balance. Range: -100 to +100.

- Player 1: Positive = losing, Negative = winning
- Player 2: Positive = winning, Negative = losing
- Standard coins shift by ±1, Whale by ±2

```typescript
function calculateTugOfWarDelta(isPlayer1: boolean, isCorrect: boolean, transfer: number): number {
  const delta = isCorrect ? -transfer : transfer
  return isPlayer1 ? delta : -delta
}
```

### Special Coins

**Gas (⚡):** Settles immediately on slice. Slicer pays $1 to opponent.

```typescript
if (data.coinType === 'gas') {
  const player = room.players.get(playerId)
  const opponent = room.players.get(room.getPlayerIds().find((id) => id !== playerId) || '')

  if (player) player.dollars = Math.max(0, player.dollars - 1)
  if (opponent) opponent.dollars += 1
  room.tugOfWar += playerId === playerIds[0] ? 1 : -1
}
```

## Game Flow

1. Two players queue → RoomManager creates room → Both join Socket.IO room
2. 5-second delay for Phaser initialization → Game loop begins
3. Coins spawn every 800-1200ms with random types and X positions
4. Player slices coin → Order created with 10s countdown (Gas settles immediately)
5. After 10s, price checked → Winner/loser determined → Funds transferred
6. Knockout ($0) or time limit → All pending orders settled → Room deleted

## Win Conditions

1. **Knockout (Instant):** Opponent reaches $0
2. **Time Limit:** 3 minutes expire, highest dollar amount wins

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

    manager.deleteRoom(room.id)
  }
}
```

## Implementation Files

- `frontend/app/api/socket/game-events.ts` - Server-side logic (settlement, spawning, game loop)
- `frontend/game/stores/trading-store.ts` - Client state (orders, settlements, tug-of-war)
- `frontend/game/scenes/TradingScene.ts` - Phaser scene (rendering, input)

## See Also

- `.claude/rules/multiplayer-patterns.md` - Reliability patterns
- `frontend/PRICE_SETTLEMENT_ARCHITECTURE.md` - Price feed details
