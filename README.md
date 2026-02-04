<div align="center">

# **⚡ Grid Games - HyperSwiper** ⚡

### *High-Speed PvP Coin Swiping on the Blockchain*

---

[**▶ PLAY LIVE**](https://grid-games-production.up.railway.app/)

*Enter the grid. Slice coins. Predict the market.*

</div>

---

## ★ The Game

**Grid Games - HyperSwiper** is a high-speed multiplayer trading game where two players compete by predicting Bitcoin price movements. Slice falling coins to place orders—correct predictions transfer funds from your opponent in real-time.

**Best-of-three rounds. 30 seconds per round. Zero-sum economy.**

```
┌──────────────────────────────────────────────────────────────┐
│  Player 1 ($10)  ──●──>  <──●──  ($10) Player 2             │
│                     │                                        │
│              Coins fall from top                            │
│              Slice to place orders                          │
│              10s settlement countdown                        │
│                     │                                        │
│              Correct prediction = +$1                        │
│              Wrong prediction = -$1                          │
│                     │                                        │
│              First to $0 = KO                                │
│              Most $ after 30s = wins round                  │
│              Best of 3 rounds = wins game                    │
└──────────────────────────────────────────────────────────────┘
```

---

## ★ Features

<div align="center">

`▲ REAL-TIME PVP`  `▼ ZERO-SUM ECONOMY`  `⚡ INSTANT SETTLEMENT`  `★ BLOCKCHAIN VERIFIED`

</div>

### Core Mechanics

- **Deterministic Coin Spawning** — Both players see identical coin sequences for fair play
- **10-Second Settlement** — Orders resolve using live Binance BTC price feed
- **Whale 2X Mode** — Activate multiplier power-up for double transfers
- **Gas Penalty Coins** — Immediate $1 penalty for失误
- **Best-of-Three Rounds** — First to 2 round wins takes the game
- **Tug-of-War Indicator** — Visual representation of game state balance

### Coin Types

| Coin | Symbol | Effect | Transfer |
|------|--------|--------|----------|
| **Call** | ▲ | BTC goes UP | +$1 / -$1 |
| **Put** | ▼ | BTC goes DOWN | +$1 / -$1 |
| **Gas** | ⚡ | Immediate penalty | +$1 to opponent |
| **Whale** | ★ | 2X power-up (10s) | No transfer |

---

## ★ Tech Stack

```
┌─────────────────────────────────────────────────────────────┐
│                    FRONTEND LAYER                            │
├─────────────────────────────────────────────────────────────┤
│  Next.js 16  │  React 19  │  Tailwind CSS v4  │  SHADCN    │
├─────────────────────────────────────────────────────────────┤
│  Phaser 3   │  Socket.IO   │  ethers.js   │  Framer Motion │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    BLOCKCHAIN LAYER                          │
├─────────────────────────────────────────────────────────────┤
│     Foundry  │  Solidity ^0.8.20  │  OpenZeppelin v5.5      │
│                      LiquidityVault.sol                      │
└─────────────────────────────────────────────────────────────┘
```

**Architecture**: Single-monolith design — Next.js App Router hosts both frontend and embedded Socket.IO server at `/api/socket`. Direct contract interaction via ethers.js.

---

## ★ Quick Start

```bash
# Clone the grid
git clone https://github.com/yourusername/grid-games.git
cd grid-games

# Install dependencies
bun install

# Start development server
bun run dev
```

Open `http://localhost:3000` in your browser.

---

## ★ Development

### Frontend Commands

| Command | Purpose |
|---------|---------|
| `bun install` | Install dependencies |
| `bun run dev` | Start dev server (localhost:3000) |
| `bun run build` | Production build |
| `bun run start` | Start production server |
| `bun run lint` | Run ESLint |
| `bun run format` | Format with Prettier |
| `bun run types` | TypeScript type check |

### Smart Contracts (Foundry)

```bash
cd contracts

forge build          # Compile contracts
forge test           # Run tests
forge fmt            # Format Solidity
forge snapshot       # Capture gas snapshots
anvil                # Start local Ethereum node
```

---

## ★ Project Structure

```
grid-games/
├── frontend/
│   ├── app/
│   │   ├── api/socket/          # Socket.IO server (game logic)
│   │   └── page.tsx             # Main pages
│   ├── components/              # React UI (ShadCN)
│   ├── game/
│   │   ├── scenes/              # Phaser scenes
│   │   │   └── TradingScene.ts  # Main game scene
│   │   ├── stores/              # Zustand stores
│   │   │   └── trading-store.ts # Game state management
│   │   └── types/               # TypeScript types
│   └── lib/                     # Utilities
├── contracts/
│   ├── src/
│   │   └── LiquidityVault.sol   # Main settlement contract
│   └── test/                    # Contract tests
└── .claude/rules/               # Development patterns
```

---

## ★ Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (Next.js:3000)                                     │
│  ─────────────────────────────────────                        │
│  • React UI (SHADCN) — Dark/cyberpunk themes                │
│  • Phaser Canvas — Client-side arcade physics               │
│  • Three.js Background — GridScan animation (60fps)         │
│  • Socket.IO Server — /api/socket (embedded)                │
│  • ethers.js — Wallet interaction                           │
│  • window.phaserEvents — React ↔ Phaser bridge              │
└────────────────────┬────────────────────────────────────────┘
                     │ ethers.js (Direct)
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  Smart Contracts (LiquidityVault)                           │
│  ─────────────────────────────────────                        │
│  • USDT deposits into vault                                 │
│  • Game settlement with owner signature                     │
│  • Owner-controlled withdrawals                             │
└─────────────────────────────────────────────────────────────┘
```

---

## ★ Game Flow

```
MATCHMAKING → ROUND 1 → ROUND 2 → ROUND 3 → GAME OVER
     │           │         │         │          │
     ▼           ▼         ▼         ▼          ▼
  Queue     30s or   30s or   30s or   Best of 3
  Match     KO       KO       KO       Winner
     │
     ├─→ 5s delay for Phaser init
     ├─→ round_start event
     ├─→ Coins spawn (2000-3000ms interval)
     ├─→ Slice coin → Place order
     ├─→ 10s countdown → Settlement
     ├─→ BTC price check (Binance WebSocket)
     ├─→ Transfer funds (zero-sum)
     ├─→ round_end event → 3s delay
     └─→ Repeat until best-of-three complete
```

---

## ★ Contributing

Contributions welcome! Please read our development patterns first:

- `.claude/rules/game-design.md` — Game mechanics and round system
- `.claude/rules/multiplayer-patterns.md` — Reliability patterns and race condition prevention
- `.claude/rules/frontend.md` — Frontend architecture conventions

---

## ★ License

MIT License — see LICENSE file for details

---

<div align="center">

**Built for the grid. Built for speed. Built for you.**

<pre>
   ▲ ▼ ▲ ▼ ⚡ ★
  ENTER THE GRID
   ▲ ▼ ▲ ▼ ⚡ ★
</pre>

</div>
