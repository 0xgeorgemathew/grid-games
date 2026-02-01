# Grid Games Quick Start

> Get up and running with Grid Games in 5 minutes.

## Prerequisites

**Required:**
- **Node.js** 18+ (frontend)
- **bun** (package manager, recommended)
- **Foundry** (smart contracts, optional for frontend-only work)

**Optional:**
- **Git** (for version control)
- **VS Code** (recommended IDE)

## 5-Minute Setup

### 1. Install Dependencies

```bash
# Frontend dependencies
bun install

# Contracts dependencies (optional)
cd contracts
forge install
```

### 2. Start Development Server

```bash
# Terminal 1: Start Next.js + Socket.IO server
bun run dev

# Server runs on http://localhost:3000
# Socket.IO server available at /api/socket
```

### 3. Run Tests

```bash
# Frontend type checking
bun run types

# Frontend linting
bun run lint

# Contract tests (optional)
cd contracts
forge test
```

### 4. View Game

Open browser to `http://localhost:3000`

- Main page shows game lobby
- Queue for multiplayer match
- Game runs in Phaser canvas
- Real-time multiplayer via Socket.IO

### 5. Make Changes

**Frontend (hot reload enabled):**
- Edit React components in `frontend/components/`
- Edit game logic in `frontend/game/`
- Edit Socket.IO server in `frontend/app/api/socket/`

**Contracts:**
- Edit contracts in `contracts/src/`
- Run `forge build` to compile
- Run `forge test` to verify

## Development Commands

### Frontend (Next.js + Phaser)

```bash
bun install           # Install dependencies
bun run dev           # Start development server on localhost:3000
bun run build         # Production build
bun run start         # Start production server
bun run lint          # Run ESLint
bun run format        # Format code with Prettier
bun run types         # TypeScript type checking
```

### Contracts (Foundry)

```bash
cd contracts
forge build          # Compile contracts
forge test           # Run tests
forge fmt            # Format Solidity code
forge snapshot       # Capture gas snapshots
anvil                # Start local Ethereum node
```

## Project Structure

```
grid-games/
├── frontend/                 # Next.js web app
│   ├── app/                 # Next.js App Router
│   │   ├── api/socket/      # Socket.IO server (multiplayer)
│   │   └── page.tsx         # Main pages
│   ├── components/          # React UI components (ShadCN)
│   ├── game/                # Game logic
│   │   ├── scenes/          # Phaser scenes (TradingScene)
│   │   ├── stores/          # Zustand state stores
│   │   └── types/           # TypeScript types
│   └── lib/                 # Utilities (formatPrice, helpers)
├── contracts/               # Foundry smart contracts
│   ├── src/                 # Solidity contracts
│   │   └── LiquidityVault.sol
│   └── test/                # Contract tests
├── CLAUDE.md                # Project instructions for Claude Code
├── HFT_BATTLE_DESIGN.md     # Game rules and mechanics
├── MULTIPLAYER_PATTERNS.md  # Reliability patterns
└── QUICK_START.md           # This file
```

## Testing Strategy

**Frontend:**
- **Type checking**: `bun run types` (catches type errors)
- **Linting**: `bun run lint` (code quality)
- **Manual testing**: Play game in dev server

**Contracts:**
- **Unit tests**: `forge test` (Solidity tests)
- **Gas snapshots**: `forge snapshot` (optimization tracking)
- **Integration**: Deploy to testnet for E2E

## Common Workflows

**Add new game feature:**
1. Read `HFT_BATTLE_DESIGN.md` for game rules
2. Read `MULTIPLAYER_PATTERNS.md` for reliability patterns
3. Implement in `frontend/game/scenes/` or `frontend/app/api/socket/`
4. Test with `bun run dev`
5. Type check with `bun run types`

**Fix multiplayer bug:**
1. Read `MULTIPLAYER_PATTERNS.md` for race condition patterns
2. Add double-check guards, timer tracking
3. Test with 2 browser windows (local multiplayer)
4. Verify no memory leaks (check Chrome DevTools Memory profiler)

**Deploy contracts:**
1. Run `forge build` to compile
2. Run `forge test` to verify
3. Deploy to testnet/mainnet
4. Verify on Etherscan
5. Extract ABI to frontend

## Troubleshooting

**Port already in use (3000):**
```bash
# Kill process on port 3000
lsof -ti:3000 | xargs kill -9

# Or use different port
PORT=3001 bun run dev
```

**TypeScript errors:**
```bash
# Clear build cache
rm -rf .next

# Reinstall dependencies
rm -rf node_modules bun.lockb
bun install
```

**Socket.IO connection issues:**
- Check browser console for errors
- Verify server running: `curl http://localhost:3000/api/socket`
- Check firewall settings (port 3000)

**Phaser game not loading:**
- Check browser console for Phaser errors
- Verify game canvas mounted in React components
- Check `window.phaserEvents` bridge setup

**Forge build failures:**
```bash
# Update Foundry
foundryup

# Clean build artifacts
forge clean

# Reinstall dependencies
forge update
```

## Next Steps

- **Learn game mechanics:** Read `HFT_BATTLE_DESIGN.md`
- **Understand architecture:** Read `CLAUDE.md`
- **Master multiplayer patterns:** Read `MULTIPLAYER_PATTERNS.md`
- **Contribute:** Check GitHub issues for open tasks

## Support

- **Documentation:** See `CLAUDE.md` for detailed project info
- **Issues:** Report bugs on GitHub
- **Patterns:** See `.claude/rules/` for development workflows
