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

| Type | Spawn Rate | Symbol | Effect | Transfer |
|------|------------|--------|--------|----------|
| Call | 33% (2/6) | ▲ | BTC price goes UP | $1 (×2 with whale) |
| Put | 33% (2/6) | ▼ | BTC price goes DOWN | $1 (×2 with whale) |
| Gas | 17% (1/6) | ⚡ | Immediate penalty | $1 (slicer to opponent) |
| Whale | 17% (1/6) | ★ | 2X power-up for 10s | No transfer |

## Mechanics

### Settlement

Orders settle 10 seconds after slicing using the latest BTC price from Binance WebSocket feed. Gas and Whale coins settle immediately (Gas applies penalty, Whale activates 2X mode).

```typescript
const priceChange = (finalPrice - order.priceAtOrder) / order.priceAtOrder

const isCorrect = order.coinType === 'call' ? priceChange > 0
  : order.coinType === 'put' ? priceChange < 0
  : false

const baseImpact = 1
const multiplier = room.get2XMultiplier(order.playerId) // 2 if whale active, 1 otherwise
const impact = baseImpact * multiplier
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

**Whale (★):** Activates 2X mode for slicing player. Lasts 10 seconds. All call/put orders settled during this time have 2x transfer amount. Does not create a pending order (activates immediately).

```typescript
if (data.coinType === 'whale') {
  room.activateWhale2X(playerId)

  io.to(room.id).emit('whale_2x_activated', {
    playerId,
    playerName: room.players.get(playerId)?.name || 'Unknown',
    durationMs: room.WHALE_2X_DURATION,
  })

  return // Whale doesn't create an order
}
```

## Game Flow

1. Two players queue → RoomManager creates room → Both join Socket.IO room
2. 5-second delay for Phaser initialization → Game loop begins
3. Coins spawn every 800-1200ms with random types and X positions
4. Player slices coin:
   - **Call/Put**: Order created with 10s countdown
   - **Gas**: Immediate penalty ($1 from slicer to opponent)
   - **Whale**: 2X mode activated for slicing player (10 seconds)
5. After 10s, price checked → Winner/loser determined → Funds transferred (×2 if 2X active)
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
