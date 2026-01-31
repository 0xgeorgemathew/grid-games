# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Grid Games is a monorepo containing a web-based game with real-time multiplayer and blockchain settlement. The project consists of two independent subprojects:

- **frontend/**: Next.js web app with Phaser game engine and embedded Socket.IO server (port 3001)
- **contracts/**: Foundry smart contracts for game liquidity and settlement
- ~~backend/**~~: *Removed - Socket.IO server now embedded in frontend*

## Master Directives

1. **Tone**: Concise, direct, engineering-focused. No conversational filler.
2. **Code Output**: Snippets only. No test files (`.spec.ts`, `.test.tsx`, `.t.sol`) or full boilerplate unless requested.
3. **Architecture**:
   - Frontend logic in `hooks/` or `stores/`; components are visual only
   - Phaser handles physics, React handles UI overlays. Never mix the two DOMs
4. **Problem Solving**: Default to simplest, fastest solution. Complexity requires justification.

## Development Commands

### Frontend (Next.js + Phaser)

```bash
cd frontend
npm run dev          # Start development server on localhost:3001
npm run build        # Production build
npm run start        # Start production server
npm run lint         # Run ESLint
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

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (Next.js:3001)                                     │
│  - React UI with SHADCN (dark/cyberpunk themes)            │
│  - Phaser game canvas (client-side arcade physics)          │
│  - Socket.IO server at /api/socket (embedded)               │
│  - ethers.js for wallet interaction                         │
└────────────────────┬────────────────────────────────────────┘
                     │ ethers.js
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  Smart Contracts (LiquidityVault)                           │
│  - USDT deposits into vault                                 │
│  - Game settlement with owner signature verification        │
│  - Owner-controlled withdrawals                             │
└─────────────────────────────────────────────────────────────┘
```

### Key Architectural Patterns

1. **HFT Battle**: Single-monolith architecture - Next.js App Router hosts both frontend and Socket.IO server at `/api/socket`
2. **Blockchain**: Frontend interacts directly with contracts via ethers.js for settlements
3. **Data Persistence**: Supabase for off-chain game data, blockchain for on-chain settlement

### Multiplayer Game Patterns (HFT Battle)

- **RoomManager class**: Centralized room and player management with cleanup
- **GameRoom class**: Encapsulates room state with timer tracking (prevents memory leaks)
- **Input validation**: Player name sanitization, coin type guards
- **Timer cleanup**: Track intervals/timeouts in GameRoom for proper disposal

## Technology Stack

| Layer     | Technology                                                                        |
| --------- | --------------------------------------------------------------------------------- |
| Frontend  | Next.js 16, React 19, Tailwind CSS v4, SHADCN, Phaser 3, Socket.IO, ethers.js, Framer Motion |
| Contracts | Foundry, Solidity ^0.8.20, OpenZeppelin v5.5                                      |

## Important File Locations

- `frontend/components/GameCanvas.tsx` - Phaser game wrapper (client-side only)
- `frontend/app/api/socket/route.ts` - Socket.IO server for HFT Battle multiplayer
- `contracts/src/LiquidityVault.sol` - Main contract for deposits/settlements
- `HFT_BATTLE_PLAN.md` - Implementation plan for HFT Battle trading game

## Configuration Notes

- **Frontend**: Path alias `@/*` maps to `./` in tsconfig.json
- **Contracts**: Foundry optimizer at 200 runs; OpenZeppelin and forge-std are git submodules
- **Infrastructure**: Cloudflare tunnels expose dev environment (config in `cloudflared/config.yml`, excluded from git)

## Smart Contract Status

`LiquidityVault.sol` contains TODOs:

- USDT deposit integration (currently accepts ETH/any token via `payable`)
- Signature verification in `settle()` function (currently only `onlyOwner`)
