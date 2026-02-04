# HFT Battle Game Design

2-player competitive trading game. Slice coins to predict BTC price movement. **Best-of-three round system. First to 2 round wins.**

## Overview

**Objective:** Predict BTC price movement by slicing coins. Correct predictions transfer funds from opponent.

**Starting Conditions:**
- Each player: $10
- Total economy: $20 (zero-sum, $0 floor)
- **Game Mode**: Best-of-three rounds
- **Round Duration**: 100 seconds per round
- Coin spawn rate: 800-1200ms (randomized)

## Round System

HFT Battle uses a **best-of-three** round format instead of single continuous gameplay.

### Round Structure

| Aspect | Value |
|--------|-------|
| Rounds per game | 3 (best-of-three) |
| Round duration | 100 seconds (100,000ms) |
| Starting cash per round | $10 each (first round only) |
| Subsequent rounds | Carry over cash from previous round end |
| Round end condition | Time limit (100s) OR knockout ($0) |
| Game end condition | First player to 2 round wins |

### Sudden Death

If players are tied 1-1 after two rounds:
- Third round is played as **sudden death** (⚡ FINAL ROUND)
- Same 100-second duration
- Winner takes all (no additional mechanics)

### Round Transitions

1. **Round End**: Time expires OR player reaches $0
2. **Settlement**: All pending orders settled immediately
3. **Summary Update**: Round results added to history
4. **Cash Carry-Over**: Players keep ending cash amount for next round
5. **Delay**: 3-second pause before next round starts
6. **Next Round**: New `round_start` event emitted

### Round History

Each round records:
- Round number
- Winner ID (null if tie)
- Player 1 and Player 2 ending dollars
- Gained/lost amounts per player

Displayed in game over modal via `GameOverEvent.rounds` array.

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

### Per Round
1. Two players queue → RoomManager creates room → Both join Socket.IO room
2. 5-second delay for Phaser initialization → Round 1 begins
3. `round_start` event emitted with round number and duration
4. Coins spawn every 800-1200ms with random types and X positions
5. Player slices coin:
   - **Call/Put**: Order created with 10s countdown
   - **Gas**: Immediate penalty ($1 from slicer to opponent)
   - **Whale**: 2X mode activated for slicing player (10 seconds)
6. After 10s, price checked → Winner/loser determined → Funds transferred (×2 if 2X active)

### Round End
1. Round time expires (100s) OR knockout ($0)
2. All pending orders settled immediately
3. `round_end` event emitted with round summary
4. If game continues: 3-second delay → Next round starts
5. If game over: `game_over` event emitted with full round history

### Game Over
1. **Best-of-three complete**: One player has 2 round wins
2. All pending orders settled
3. Room deleted after 1-second delay (events sent)

## Win Conditions

### Per Round (determines round winner)
1. **Knockout (Instant):** Opponent reaches $0
2. **Time Limit:** 100 seconds expire, highest dollar amount wins
3. **Tie:** Equal dollars when time expires (rare)

### Game Over (best-of-three)
1. **2-0 Sweep:** Player wins both rounds 1 and 2
2. **2-1 Victory:** Players split rounds 1 and 2, winner of round 3 takes game
3. **Forfeit:** Opponent disconnects (remaining player wins by default)

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
      reason: 'knockout',
      rounds: room.getRoundSummaries(), // Round history for game over modal
    })

    setTimeout(() => manager.deleteRoom(room.id), 1000)
  }
}

function checkBestOfThreeComplete(room: GameRoom): boolean {
  const { player1Wins, player2Wins } = room
  const maxWins = Math.max(player1Wins, player2Wins)
  const roundsPlayed = room.currentRound

  // Game over if someone has 2 wins, OR if round 3 complete
  return maxWins >= 2 || roundsPlayed >= 3
}
```

## Implementation Files

- `frontend/app/api/socket/game-events.ts` - Server-side logic (settlement, spawning, game loop)
- `frontend/game/stores/trading-store.ts` - Client state (orders, settlements, tug-of-war)
- `frontend/game/scenes/TradingScene.ts` - Phaser scene (rendering, input)

## See Also

- `.claude/rules/multiplayer-patterns.md` - Reliability patterns
- `frontend/PRICE_SETTLEMENT_ARCHITECTURE.md` - Price feed details
