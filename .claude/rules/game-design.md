# HFT Battle Game Design

> 2-player competitive trading game. Slice coins to predict BTC price movement. Win by bankrupting your opponent ($0) or having the highest dollar amount after 3 minutes.

## Game Overview

**Objective:** Predict BTC price movement by slicing coins. Correct predictions transfer funds from opponent. Force opponent to $0 (knockout) or have highest amount when time expires.

**Starting Conditions:**
- Each player: $10
- Total economy: $20 (zero-sum, capped at $0 floor)
- Game duration: 3 minutes (180,000ms)
- Coin spawn rate: Every 800-1200ms (randomized)

## Coin Types

Four coin types spawn with different probabilities and effects:

| Coin Type | Spawn Rate | Symbol | Win Condition | Special Effect |
|-----------|------------|--------|---------------|----------------|
| Call (▲) | 33% (2/6) | ▲ | BTC price goes UP | Standard $1 transfer |
| Put (▼) | 33% (2/6) | ▼ | BTC price goes DOWN | Standard $1 transfer |
| Gas (⚡) | 17% (1/6) | ⚡ | Immediate penalty | $1 penalty to slicer (opponent gains $1) |
| Whale (★) | 17% (1/6) | ★ | 80% win rate | 2x impact ($2 transfer) |

## Core Mechanics

### Settlement System

Orders settle 10 seconds after slicing the coin. Settlement uses the latest BTC price from Binance WebSocket feed (no historical price lookups).

**Settlement Logic:**
```typescript
// From game-events.ts:413-420
const priceChange = (finalPrice - order.priceAtOrder) / order.priceAtOrder

let isCorrect = false
if (order.coinType === 'call') isCorrect = priceChange > 0
else if (order.coinType === 'put') isCorrect = priceChange < 0
else if (order.coinType === 'whale') isCorrect = Math.random() < 0.8

const impact = order.coinType === 'whale' ? 2 : 1
```

### Damage & Scoring (Zero-Sum Economy)

Winner gains impact amount, loser loses same amount (floor at $0). Tug-of-war shifts based on winner and player position.

**Transfer Logic:**
```typescript
// From game-events.ts:438-458
// Determine winner/loser
if (isCorrect) {
  winnerId = order.playerId  // Player who placed order won
  loserId = playerIds.find((id) => id !== order.playerId)
} else {
  loserId = order.playerId   // Player who placed order lost
  winnerId = playerIds.find((id) => id !== order.playerId)
}

// Apply transfer: winner gains, loser loses (zero-sum)
const winner = room.players.get(winnerId)
const loser = room.players.get(loserId)
if (winner) winner.dollars += impact
if (loser) loser.dollars = Math.max(0, loser.dollars - impact) // Floor at $0
```

### Special Coins

**Gas (⚡) - Immediate Settlement:**
Gas coins settle immediately when sliced (no 10s wait). The slicer pays a $1 penalty to their opponent.

```typescript
// From game-events.ts:627-649
if (data.coinType === 'gas') {
  const player = room.players.get(playerId)
  const opponentId = room.getPlayerIds().find((id) => id !== playerId)
  const opponent = room.players.get(opponentId || '')

  // ZERO-SUM: Gas transfers $1 from slicer to opponent
  if (player) player.dollars = Math.max(0, player.dollars - 1)
  if (opponent) opponent.dollars += 1

  // Tug-of-war shifts AGAINST slicer (penalty)
  const playerIds = room.getPlayerIds()
  room.tugOfWar += playerId === playerIds[0] ? 1 : -1
}
```

**Whale (★) - High Risk/Reward:**
- 80% win rate (determined at settlement)
- 2x impact ($2 transfer instead of $1)
- Tug-of-war shifts by ±2 instead of ±1

### Tug-of-War System

Visual indicator showing game state balance. Range: -100 to +100.

```typescript
// From trading-store.ts:105-109
function calculateTugOfWarDelta(isPlayer1: boolean, isCorrect: boolean, damage: number): number {
  const delta = isCorrect ? -damage : damage
  return isPlayer1 ? delta : -delta
}
```

- **Player 1**: Positive = losing, Negative = winning
- **Player 2**: Positive = winning, Negative = losing
- **Impact**: Standard coins shift by ±1, Whale coins shift by ±2

## Game Flow

**Complete lifecycle from match finding to game over:**

1. **Match Finding**: Two players queue → RoomManager creates room → Both join Socket.IO room
2. **Game Start**: 5-second delay for Phaser scene initialization → Game loop begins
3. **Coin Spawning**: Coins spawn every 800-1200ms with random types and X positions
4. **Slice**: Player slices coin → Order created with 10s countdown
5. **Settlement**: After 10s, price checked → Winner/loser determined → Funds transferred
6. **Game Over**: Knockout ($0) or time limit (3min) → All pending orders settled → Room deleted

## Order Lifecycle

```
Slice Coin → Create Order (priceAtOrder, settlesAt, isPlayer1)
           ↓
Wait 10 Seconds (countdown shown in HUD)
           ↓
Settlement (finalPrice vs priceAtOrder)
           ↓
Transfer Funds (winner +impact, loser -impact, floor at 0)
           ↓
Update Tug-of-War (±1 or ±2 based on winner/impact)
           ↓
Emit Settlement Event (order_settled to all clients)
           ↓
Remove Order (delete from pendingOrders)
```

## Win Conditions

Two ways to win:

1. **Knockout (Instant)**: Opponent reaches $0 → game over immediately
2. **Time Limit**: 3 minutes expire → player with highest dollar amount wins

**Game Over Check:**
```typescript
// From game-events.ts:741-761
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

## Price Feed Architecture

For detailed price flow, Binance WebSocket integration, and settlement resolution, see `.claude/rules/frontend.md` and `frontend/PRICE_SETTLEMENT_ARCHITECTURE.md`.

## Implementation Files

**Game Logic:**
- `frontend/app/api/socket/game-events.ts` - Server-side game logic (settlement, spawning, game loop)
- `frontend/game/stores/trading-store.ts` - Client state management (orders, settlements, tug-of-war)
- `frontend/game/scenes/TradingScene.ts` - Phaser scene (coin rendering, input handling)
