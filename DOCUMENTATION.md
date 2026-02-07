# Grid Games - Complete Documentation (Non-Technical)

## Overview

Grid Games is a web-based competitive trading game called **HFT Battle**. Two players compete in real-time by predicting Bitcoin price movements. The game combines arcade-style coin slicing (like Fruit Ninja) with cryptocurrency trading concepts, running entirely in a web browser.

---

# Part 1: Game Mechanics

## The Player Experience

### Landing on the Site

When a player first arrives at grid.games, they see a striking visual:

- **"ENTER THE GRID"** title with an animated 3D grid background
- A clean, dark cyberpunk aesthetic with neon accents
- A single call-to-action button: **"LOGIN WITH GOOGLE"**

The background runs a continuous 60fps animation (Three.js) that creates an immersive "entering the matrix" feeling, setting the tone for a high-tech trading game.

### Authentication Flow

**First-Time Players:**

1. Click "LOGIN WITH GOOGLE"
2. Google authentication window appears (handled by Privy service)
3. Upon successful login, an embedded wallet is automatically created in the background (player doesn't need to understand crypto wallets)
4. Player is prompted to claim a **username** (e.g., "trader.eth")
5. Player selects **leverage** (1x, 2x, 5x, 10x, or 20x) - this multiplies their winnings/losses
6. Player receives **0.1 USDC** (play money) from a faucet to start playing

**Returning Players:**

1. Click "LOGIN WITH GOOGLE"
2. System recognizes their wallet and existing username
3. Their previous leverage setting is loaded
4. Any USDC balance from previous sessions is available
5. They're ready to play immediately

### Finding a Match

Players have two options to find an opponent:

**Option A: AUTO-MATCH**
- Click "AUTO-MATCH" button
- System searches for another player waiting for a game
- If someone is available, match begins immediately
- If not, player waits in a lobby until another player joins
- Shows "FINDING OPPONENT..." status while waiting

**Option B: SELECT OPPONENT**
- Click "SELECT OPPONENT" button
- See a list of all players currently waiting in the lobby
- Click on any player's username to challenge them directly
- Match begins immediately if they accept

### The Game Structure: Best-of-Three Rounds

HFT Battle uses a **best-of-three format** like tennis or boxing:

- **Round 1:** Both players start with $10
- **Round 2:** Players keep whatever cash they had at the end of Round 1
- **Round 3:** Players keep whatever cash they had at the end of Round 2
- **Game Over:** First player to win 2 rounds wins the entire game

**Sudden Death:**
If players are tied 1-1 after two rounds, Round 3 becomes "Sudden Death" with a lightning bolt indicator. Same rules apply, just higher stakes!

**Each Round:**
- Lasts **30 seconds**
- Ends immediately if one player reaches $0 (knockout)
- Winner is whoever has more dollars when time expires (or who didn't get knocked out)

### How a Round Plays Out

#### Phase 1: Round Start (0-30 seconds)

When a round begins, coins start falling from the top of the game canvas. There are four types of coins:

| Coin | Symbol | What It Does | How Often |
|------|--------|--------------|-----------|
| **Call** | ▲ (Green triangle) | "Bitcoin will go UP" | 33% of coins |
| **Put** | ▼ (Red triangle) | "Bitcoin will go DOWN" | 33% of coins |
| **Gas** | ⚡ (Yellow lightning) | Instant $1 penalty to YOU | 17% of coins |
| **Whale** | ★ (Purple star) | Activates 2X power for 10 seconds | 17% of coins |

**Spawning Pattern:**
- Coins fall every 1.2-1.8 seconds (varies randomly)
- Both players see the **same types of coins in the same sequence** (only positions differ)
- This ensures fairness - both players have equal opportunities
- Approximately 10-12 coins per round
- Spawning gets faster in the final 3 seconds for dramatic climax

**Coin Movement:**
- Coins fall from top to bottom with realistic physics (gravity, bounce)
- Players slice coins with mouse clicks or finger swipes (touch support)
- Sliced coins create particle effects and play satisfying sounds

#### Phase 2: Slicing and Order Creation

**When a player slices a Call or Put coin:**

1. The coin shatters with a visual effect
2. The current Bitcoin price is captured (e.g., $43,250.50)
3. A countdown timer appears on screen: **"Settles in 5...4...3..."**
4. This is an "active order" - like placing a bet that will resolve in 5 seconds
5. Players can have multiple active orders at once

**When a player slices a Gas coin:**

1. Immediate $1 penalty - $1 goes from slicer to opponent
2. No countdown, no waiting
3. Can trigger knockout if slicer reaches $0
4. Risk-reward: Gas coins are dangerous to slice

**When a player slices a Whale coin:**

1. Activates **2X mode** for the slicing player for 10 seconds
2. Any Call/Put orders placed during this time will have **double the impact**
3. The player's leverage setting (2x, 5x, 10x, 20x) is applied during 2X mode
4. Visual indicator: ⚡ 2X badge appears with countdown
5. Example: With 5x leverage and 2X active, each order is worth $10 instead of $1

#### Phase 3: Settlement (5 Seconds After Slicing)

After 5 seconds, each active order "settles" using the latest Bitcoin price:

**Example Settlement:**
- Player slices Call coin at $43,250
- 5 seconds pass
- Current Bitcoin price: $43,270 (went UP $20)
- Call prediction was CORRECT
- Player wins $1 (or more if Whale/leverage active)
- Opponent loses $1

**If Bitcoin went DOWN instead:**
- Call prediction was WRONG
- Player loses $1
- Opponent gains $1

**Zero-Sum Mechanics:**
- Total money in the game stays at $20 (minus gas fees)
- When one player gains, the other loses exactly the same amount
- Players can't go below $0 (floor)
- Creates intense tug-of-war dynamic

**Visual Feedback:**
- Green flash + cash register sound for winning orders
- Red flash + buzzer sound for losing orders
- Dollar amounts update in real-time
- "Tug of War" bar shifts back and forth showing who's winning

#### Phase 4: Round End

When 30 seconds expire OR a player reaches $0:

1. All pending orders settle immediately (no waiting)
2. **Round End Flash** appears for 7 seconds showing:
   - Who won the round
   - Final dollar amounts
   - Visual summary of what happened
3. Round is added to history (displayed at game over)
4. Players keep their ending dollar amount for next round

#### Phase 5: Next Round or Game Over

**If no one has won 2 rounds yet:**
- 3-second pause
- Next round begins with carried-over cash
- New coin sequence (still deterministic and fair)
- Repeat gameplay

**If someone has won 2 rounds:**
- Game over sequence triggers
- Yellow Network payment channel settles (converts game dollars to USDC)
- Game Over Modal appears showing complete round history
- ENS stats updated (games played, win streak)
- Player can click "PLAY AGAIN" to return to matchmaking

### The Complete Player Journey (Step by Step)

```
1. LAND ON grid.games
   └─ See animated 3D grid background

2. CLICK "LOGIN WITH GOOGLE"
   └─ Authenticate with Google

3. CLAIM USERNAME (first time only)
   └─ Choose "trader.eth" or similar

4. SELECT LEVERAGE (first time only)
   └─ Choose 2x, 5x, 10x, or 20x multiplier

5. CLAIM 0.1 USDC (play money)
   └─ Sponsored transaction, no gas fee

6. CLICK "AUTO-MATCH"
   └─ Wait for opponent

7. MATCH FOUND!
   └─ Game canvas appears

8. ROUND 1 STARTS
   └─ 30-second timer, coins begin falling

9. SLICE COINS
   ├─ Call/Put: Create 5-second order
   ├─ Gas: Immediate $1 penalty
   └─ Whale: Activate 2X power

10. ORDERS SETTLE
    ├─ BTC went up/down determines winner
    └─ $1 transfers between players

11. ROUND ENDS (30s or knockout)
    └─ Round End Flash shows results

12. ROUND 2 STARTS
    └─ Keep cash from Round 1

13. ROUND 2 ENDS
    └─ If tied 1-1: Sudden Death next

14. ROUND 3 (or SUDDEN DEATH)
    └─ Final round, winner takes all

15. GAME OVER
    ├─ Payment channel settles
    ├─ Round history displayed
    ├─ ENS stats updated
    └─ "PLAY AGAIN" button
```

---

# Part 2: ENS (Ethereum Name Service) Integration

## What is ENS?

ENS is like a "phonebook" for cryptocurrency addresses. Instead of seeing "0x1234...5678", players see friendly usernames like "trader.eth" or "hftmaster.grid.eth".

Grid Games uses ENS as the foundation of player identity, stats tracking, and game settings.

## Username System

### How Usernames Work

Grid Games operates on **Base Sepolia testnet** (a low-cost Ethereum network) and uses a **custom subdomain system**:

- All player usernames end in **`.grid.eth`**
- Example: "crypto-trader.grid.eth"
- Owned by the player's wallet address
- Permanent and transferable (like an NFT)

### Registration Process

**Step 1: Username Selection**
- After login, player sees "Claim Username" screen
- Types desired name (e.g., "king-of-hft")
- System validates in real-time:
  - 3-32 characters only
  - Letters, numbers, and hyphens only
  - Can't start or end with hyphen
  - Normalized to lowercase

**Step 2: Availability Check**
- As player types, system checks if username is taken
- Green checkmark = Available
- Red X = Taken
- Happens instantly (300ms delay to prevent excessive checks)

**Step 3: Claim**
- Player clicks "CLAIM USERNAME"
- **Sponsored transaction** = player pays no gas fees
- Server handles everything behind the scenes
- Username registered to player's wallet address
- Player now owns "king-of-hft.grid.eth"

### Username Validation

The system uses two validation methods:

**Forward Lookup (checking if name is taken):**
- Query: "Is 'king-of-hft' available?"
- Response: Yes/No
- Used during registration

**Reverse Lookup (finding existing username):**
- Query: "What username belongs to wallet 0x1234...?"
- Response: "king-of-hft.grid.eth" or "None"
- Used when returning players log in
- Automatically loads their username without asking

## Leverage System

### What is Leverage?

Leverage multiplies the impact of each winning or losing order. It's a risk/reward setting that players choose once.

**Example with 5x leverage:**
- Normal: Win/Lose $1 per order
- With 5x leverage: Win/Lose $5 per order
- Whale 2X + 5x leverage = Win/Lose $10 per order!

### Leverage Options

| Leverage | Impact | Risk Level |
|----------|--------|------------|
| 1x | $1 per order | Conservative |
| 2x | $2 per order | Low (default) |
| 5x | $5 per order | Medium |
| 10x | $10 per order | High |
| 20x | $20 per order | Extreme |

### How Leverage is Stored

Leverage is stored as a **text record** on the player's ENS name:

```
king-of-hft.grid.eth
├─ Owner: 0x1234...5678 (player wallet)
└─ Text Records:
    ├─ games.grid.leverage: "5x"
    ├─ games.grid.total_games: "42"
    └─ games.grid.streak: "7"
```

**Why store leverage on ENS?**
- Persistent across devices
- Survives browser cache clearing
- Can be used by other games in the future
- Player-owned data (not controlled by game server)

### Setting Leverage

**First-time players:**
- After claiming username, see "Set Leverage" screen
- Choose from buttons: [1x] [2x] [5x] [10x] [20x]
- Sponsored transaction = no gas fees
- Leverage saved to ENS text record

**Changing leverage:**
- Players can change leverage anytime from settings
- Requires sponsored transaction
- Updates ENS text record

### How Leverage Affects Gameplay

**Normal Order (no leverage):**
- Player slices Call coin, BTC goes up
- Player wins $1, opponent loses $1

**With 5x leverage (no Whale):**
- Player slices Call coin, BTC goes up
- Player wins $5, opponent loses $5

**With 5x leverage + Whale 2X active:**
- Player slices Call coin, BTC goes up
- Player wins $10, opponent loses $10

**The Risk:**
- Higher leverage means faster knockout
- One bad prediction at 20x = lose $20 instantly
- Players at 1x last longer but win less

## Statistics Tracking

### What Stats Are Tracked?

ENS stores two key statistics:

1. **Total Games:** How many games the player has played
2. **Win Streak:** Current consecutive wins (resets to 0 on loss)

### How Stats Update

**After each game:**
1. Game ends, winner determined
2. Silent sponsored transaction updates ENS
3. `total_games` increments by 1
4. `streak` increments by 1 (if win) or resets to 0 (if loss)
5. No UI blocking - happens in background

**Displaying Stats:**
- Stats shown in player profile
- Used for leaderboards (future feature)
- Visible to opponents during matchmaking
- Creates reputation and competition

### Why On-Chain Stats?

**Advantages:**
- Player-controlled (can't be faked by server)
- Portable to other games
- Verifiable by anyone
- Permanent (can't be deleted)

**Disadvantages:**
- Each stat update = transaction (even if sponsored)
- Public (anyone can see your leverage and stats)
- Slower than database updates

## ENS Integration Points

### Where Usernames Appear

1. **Matchmaking Lobby:** Player names shown in waiting list
2. **Game HUD:** Both players' names displayed during game
3. **Game Over Modal:** Winner's name highlighted
4. **Player Profile:** Stats and username display

### Player Name Component

The `PlayerName` component handles all username display:

```
If player has ENS:
  Display: "king-of-hft.grid.eth"
  Style: Holographic TRON effect (shiny gradient)

If player has no ENS:
  Display: "0x1234...5678" (truncated address)
  Style: Plain text
```

---

# Part 3: Blockchain Integration

## Wallet Connection

### What is a Wallet?

A cryptocurrency wallet is like a digital bank account. It:
- Stores money (USDC in this case)
- Holds unique identity (wallet address)
- Signs transactions (proves ownership)

### How Players Connect (Privy)

**The Problem:** Traditional crypto wallets are confusing
- Need to download browser extensions
- Require understanding of private keys
- Complicated for non-technical users

**The Solution: Privy Embedded Wallets**
- Login with Google (familiar)
- Wallet created automatically in background
- No browser extension needed
- No need to understand private keys

### Authentication Flow

```
Player clicks "LOGIN WITH GOOGLE"
        ↓
Google authentication popup
        ↓
Player authorizes with Google
        ↓
Privy creates embedded wallet (invisible)
        ↓
Wallet address generated: 0x1234...5678
        ↓
Player is logged in
        ↓
USDC balance checked
        ↓
Ready to play!
```

**Key Benefits:**
- No seed phrases to remember
- No browser extensions
- Works on mobile
- Cannot lose wallet (recoverable via Google)

## USDC and the Faucet

### What is USDC?

USDC is a **stablecoin** - a cryptocurrency pegged to the US Dollar:
- 1 USDC = $1 USD (always)
- Unlike Bitcoin, its value doesn't fluctuate
- Perfect for games where you want predictable stakes

### The Faucet System

New players need money to play. Grid Games uses a **faucet** system:

**Faucet Contract:**
- Smart contract that holds USDC
- Anyone can claim a small amount
- Rate limited to prevent abuse

**How It Works:**
1. New player logs in
2. System checks USDC balance
3. If balance < 10 USDC, show "CLAIM 0.1 USDC" button
4. Player clicks button
5. Sponsored transaction sends 0.1 USDC to player's wallet
6. Player can now enter matchmaking

**Rate Limits:**
- 1 minute cooldown between claims
- Max 3 claims per hour
- Prevents players from draining the faucet

**Why 0.1 USDC?**
- Each game requires 10 USDC stake
- Testnet USDC has no real value
- Small amount for testing purposes
- Mainnet will use different amounts

## Payment Channels (Yellow Network)

### The Challenge: Transaction Fees

**Problem:** Each game update on blockchain = gas fee
- Settling each round = transaction
- Updating player balances = transaction
- Multiple games per session = expensive and slow

**Solution: Payment Channels**
- Lock funds in a smart contract upfront
- Update game state off-chain (fast, free)
- Settle once at the end (single transaction)

### How Payment Channels Work

**Step 1: Channel Creation (Before Game)**
```
Two players matched
        ↓
Server creates payment channel
        ↓
Channel ID: 0xabc...123 (unique)
        ↓
Players deposit 10 USDC each
        ↓
Total locked: 20 USDC
        ↓
Status: ACTIVE
```

**Step 2: Game State Updates (During Game)**
```
Round 1 ends
        ↓
Server calculates: Player 1 has $15, Player 2 has $5
        ↓
Update channel state:
  Player 1 allocation: 15 USDC (75%)
  Player 2 allocation: 5 USDC (25%)
        ↓
Round 2 ends
        ↓
Update channel state again
        ↓
...
```

**Step 3: Settlement (After Game)**
```
Game over
        ↓
Final state signed by server
        ↓
Submit to Yellow Network contract
        ↓
Contract verifies signatures
        ↓
Players withdraw final amounts
        ↓
Channel closed
```

### Current Status: MVP Mode

**Important:** The Yellow Network integration is currently in **MVP mode**:
- Payment channels are created
- State is tracked in-memory (not on-chain)
- No actual blockchain settlement yet
- Returns mock transaction hash

**Why MVP Mode?**
- Faster development
- No real money at risk (testnet)
- Can test gameplay without gas costs
- Production settlement will be added later

## The Complete Blockchain Journey

### First-Time Player Blockchain Journey

```
1. LOGIN WITH GOOGLE
   └─ Privy creates embedded wallet
   └─ Wallet address: 0x1234...5678

2. CLAIM USERNAME
   └─ Sponsored transaction
   └─ Register "king-of-hft.grid.eth"
   └─ Owner: 0x1234...5678

3. SET LEVERAGE
   └─ Sponsored transaction
   └─ Set text record: games.grid.leverage = "5x"

4. CLAIM 0.1 USDC
   └─ Sponsored transaction
   └─ Faucet sends 0.1 USDC to wallet
   └─ Balance: 0.1 USDC

5. PLAY GAME
   └─ Payment channel created (20 USDC total)
   └─ Game state tracked off-chain

6. GAME OVER
   └─ Channel settles (MVP: in-memory)
   └─ Stats updated to ENS (sponsored)

7. PLAY AGAIN
   └─ Return to step 5
```

---

# Part 4: Fairness and Technical Details

## Deterministic Coin Spawning

### The Fairness Problem

In multiplayer games, both players must have equal opportunity. If Player 1 gets all Call coins and Player 2 gets all Put coins, it's unfair.

### The Solution: Seeded Randomness

**How It Works:**
1. When match is made, create a seed: `hash(roomId + roundNumber)`
2. Use this seed to generate a predetermined coin sequence
3. Send same sequence to both players
4. Both players see same coin types in same order
5. Only screen positions differ (random X coordinate)

**Example Sequence:**
```
Seed: "room123-round1"
└─ Generated sequence: [Call, Put, Gas, Whale, Call, Call, Put, ...]

Player 1 sees:
  Call (x=20%), Put (x=45%), Gas (x=70%), ...

Player 2 sees:
  Call (x=55%), Put (x=30%), Gas (x=15%), ...

Same types, different positions!
```

### Wave-Based Escalation

Spawning gets faster over time for dramatic effect:

| Time in Round | Spawn Interval | Burst Chance |
|---------------|----------------|--------------|
| 0-10 seconds | 1.2-1.8 seconds | 10% |
| 10-20 seconds | 1.4-1.8 seconds | 15% |
| 20-27 seconds | 1.0-1.4 seconds | 25% |
| 27-30 seconds | 0.7-1.1 seconds | 40% (climax) |

**Burst Spawns:**
- Sometimes 2-3 coins spawn close together
- Staggered by 100ms
- Creates "coin rain" effect
- Inspired by Fruit Ninja

## Real-Time Price Feed

### Bitcoin Price Source

The game uses **Binance WebSocket** for real-time Bitcoin prices:
- Connects to `wss://stream.binance.com:9443/ws/btcusdt@aggTrade`
- Receives price updates every few milliseconds
- Caches latest price for settlements

### Auto-Reconnection

If connection drops:
- Automatically reconnect after 5 seconds
- Shuts down cleanly if server restarts
- Prevents infinite reconnect loops
- Shows connection status in HUD (green/yellow/red dot)

### Settlement Price

Orders settle using the **latest price** when 5-second countdown expires:
- Price captured when coin is sliced
- Price checked again after 5 seconds
- Difference determines winner/loser
- No manipulation possible (real-time feed)

## Race Condition Prevention

### The Problem

In multiplayer games, things can happen in unexpected order:
- Player disconnects mid-settlement
- Round ends while order is settling
- Multiple things try to settle same order

### The Solution: Double-Check Guards

Before any critical operation, verify:
- Room still exists
- Order still pending
- Game still active

**Example:**
```typescript
function settleOrder(order) {
  if (room.isShutdown) return  // Room deleted
  if (!room.pendingOrders.has(order.id)) return  // Already settled

  // Proceed with settlement
}
```

### SettlementGuard Pattern

Prevents duplicate settlement:
- Each order marked "in progress" when settling starts
- Marked "complete" when done
- If settlement crashes, mark "complete" after 30s anyway
- Prevents infinite hanging

## Memory Leak Prevention

### The Problem

Browsers have limited memory. Leaked timers = crashed browser:
- Forgotten intervals
- Uncleared timeouts
- Unremoved event listeners

### The Solution: Timer Tracking

All timers tracked in GameRoom:
```typescript
class GameRoom {
  intervals = new Set()
  timeouts = new Set()

  cleanup() {
    this.intervals.forEach(clearInterval)
    this.timeouts.forEach(clearTimeout)
    this.intervals.clear()
    this.timeouts.clear()
  }
}
```

**When Room Deleted:**
- All intervals cleared
- All timeouts cleared
- All listeners removed
- No memory leaks

---

# Part 5: Visual Design and User Experience

## Design Philosophy

The game uses a **dark cyberpunk aesthetic** with:
- Dark backgrounds (#0a0a0a, #111111)
- Neon accent colors (indigo #6366f1, cyan, pink)
- Holographic effects on ENS names
- TRON-inspired glowing grids
- Smooth animations via Framer Motion

## Key Visual Components

### GridScanBackground
- Continuous 60fps Three.js animation
- Creates "entering the matrix" feeling
- Perspective grid moving toward camera
- Runs in background behind all UI

### PlayerName Component
- ENS names have holographic TRON effect
- Gradient background that shifts
- Glowing text shadow
- Falls back to plain address if no ENS

### RoundEndFlash
- Full-screen overlay for 7 seconds
- Shows round results with dramatic animation
- Who won, final dollars, gained/lost
- Smooth fade in/out

### GameOverModal
- Complete round history
- Round-by-round breakdown
- Winner announcement
- "PLAY AGAIN" button
- Updates ENS stats silently

### Game HUD
- Real-time timer (30-second countdown)
- Player health bars (dollars)
- Active orders with countdowns
- Tug of War indicator
- Bitcoin price display
- Connection status

## Sound Design

The game includes satisfying audio feedback:
- Coin slice sounds
- Settlement chimes (win) / buzzers (loss)
- Round end fanfare
- Game over music
- Whale activation sound
- Gas penalty sound

---

# Summary

## The Complete User Experience

1. **Land** on grid.games with stunning 3D background
2. **Login** with Google (wallet created automatically)
3. **Claim** unique username (e.g., "trader.grid.eth")
4. **Choose** leverage (1x-20x multiplier)
5. **Claim** 0.1 USDC play money from faucet
6. **Match** with opponent instantly or from lobby
7. **Play** best-of-three rounds of coin-slicing trading
8. **Predict** Bitcoin price movements by slicing coins
9. **Win** by having more dollars when time expires
10. **Settle** via payment channel (MVP: in-memory)
11. **Track** stats on ENS (games played, win streak)
12. **Play again** instantly with one click

## Key Innovations

1. **Embedded Wallets (Privy):** No crypto experience needed
2. **ENS Identity:** Portable, player-owned usernames and stats
3. **Payment Channels:** Fast gameplay without gas fees
4. **Deterministic Spawning:** Fair opportunities for both players
5. **Best-of-Three:** Competitive format with comeback potential
6. **Leverage System:** Customizable risk/reward
7. **Real-Time Prices:** Live Bitcoin integration
8. **Arcade Mechanics:** Coin slicing makes trading fun

## Technology Stack (Non-Technical Summary)

- **Frontend:** Next.js web framework
- **Game Engine:** Phaser 3 (physics, rendering)
- **Background:** Three.js (3D animation)
- **Auth:** Privy (embedded wallets)
- **Identity:** ENS (usernames, stats, leverage)
- **Payments:** Yellow Network (payment channels - MVP)
- **Real-time:** Socket.IO (multiplayer)
- **Prices:** Binance WebSocket (Bitcoin)
- **Blockchain:** Base Sepolia testnet (low fees)
- **Money:** USDC (stablecoin, $1 = $1)

## Target Audience

- Crypto-native traders (familiar with leverage, shorting)
- Web3 gamers (own wallets, NFTs)
- Competitive gamers (enjoy ranked matches)
- Casual players (arcade mechanics, easy entry)

## Future Possibilities

- Leaderboards based on ENS stats
- Tournament mode with entry fees
- Other trading pairs (ETH, SOL)
- Mobile app version
- Mainnet launch with real money
- Guild/clan system
- Spectator mode
- Replay system
- Achievement badges stored on ENS

---

*This documentation is designed for non-technical readers who want to understand how Grid Games works without needing to understand code or blockchain infrastructure.*
