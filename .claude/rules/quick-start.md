# Grid Games Quick Start

Get up and running with Grid Games in 5 minutes.

## Prerequisites

- Node.js 18+
- bun (package manager)
- Foundry (smart contracts only; optional for frontend-only work)

## Setup

```bash
bun install    # Install dependencies
bun run dev    # Start dev server at http://localhost:3000
```

Socket.IO server runs at `/api/socket`.

**Performance Note:** GridScanBackground (Three.js) runs at 60fps continuously. May impact mobile battery life.

## Commands

### Frontend

| Command | Purpose |
|---------|---------|
| `bun install` | Install dependencies |
| `bun run dev` | Start dev server (localhost:3000) |
| `bun run build` | Production build |
| `bun run start` | Start production server |
| `bun run lint` | Run ESLint |
| `bun run format` | Format with Prettier |
| `bun run types` | TypeScript type check |

### Contracts

| Command | Purpose |
|---------|---------|
| `forge build` | Compile contracts |
| `forge test` | Run tests |
| `forge fmt` | Format Solidity |
| `forge snapshot` | Capture gas snapshots |
| `anvil` | Start local Ethereum node |

## Project Structure

```
grid-games/
├── frontend/
│   ├── app/
│   │   ├── api/socket/      # Socket.IO server
│   │   └── page.tsx         # Main pages
│   ├── components/          # React UI (ShadCN)
│   ├── game/
│   │   ├── scenes/          # Phaser scenes
│   │   ├── stores/          # Zustand stores
│   │   └── types/           # TypeScript types
│   └── lib/                 # Utilities
├── contracts/
│   ├── src/                 # Solidity contracts
│   └── test/                # Contract tests
└── .claude/rules/           # Development patterns
```

## Workflows

### Add Game Feature

1. Read `.claude/rules/game-design.md` (best-of-three rounds, 100s each)
2. Read `.claude/rules/multiplayer-patterns.md`
3. Implement in `frontend/game/scenes/` or `frontend/app/api/socket/`
4. Type check: `bun run types`

### Fix Multiplayer Bug

1. Read `.claude/rules/multiplayer-patterns.md`
2. Add double-check guards and timer tracking
3. Test with 2 browser windows
4. Check Chrome DevTools Memory profiler

### Deploy Contracts

1. `forge build && forge test`
2. Deploy to testnet/mainnet
3. Verify on Etherscan
4. Extract ABI to frontend

## Troubleshooting

### Port 3000 in use

```bash
lsof -ti:3000 | xargs kill -9
# or
PORT=3001 bun run dev
```

### TypeScript errors

```bash
rm -rf .next node_modules bun.lockb
bun install
```

### Socket.IO issues

- Check browser console
- Verify server: `curl http://localhost:3000/api/socket`
- Check firewall (port 3000)

### Phaser not loading

- Check browser console for Phaser errors
- Verify game canvas is mounted
- Check `window.phaserEvents` bridge (React ↔ Phaser communication)
- Ensure GameCanvasClient is dynamically imported with `ssr: false`

### Forge build failures

```bash
foundryup    # Update Foundry
forge clean  # Clean artifacts
forge update # Reinstall dependencies
```

## References

- `CLAUDE.md` - Detailed project info (CRITICAL ISSUES at top)
- `.claude/rules/game-design.md` - Game mechanics (best-of-three rounds)
- `.claude/rules/multiplayer-patterns.md` - Reliability patterns (SettlementGuard, RAII)
- `.claude/rules/types.md` - Type system documentation and conventions
