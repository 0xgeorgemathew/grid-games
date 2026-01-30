# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Grid Games is a monorepo containing a web-based game with real-time multiplayer and blockchain settlement. The project consists of three independent subprojects:

- **frontend/**: Next.js web app with Phaser game engine (port 3001)
- **backend/**: NestJS API with WebSocket support (port 3000)
- **contracts/**: Foundry smart contracts for game liquidity and settlement

## Master Directives

1. **Tone**: Concise, direct, engineering-focused. No conversational filler.
2. **Code Output**: Snippets only. No test files (`.spec.ts`, `.test.tsx`, `.t.sol`) or full boilerplate unless requested.
3. **Architecture**:
   - Frontend logic in `hooks/` or `stores/`; components are visual only
   - Phaser handles physics, React handles UI overlays. Never mix the two DOMs
   - Backend (NestJS) handles heavy math with fixed-point precision
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

### Backend (NestJS + Socket.IO)
```bash
cd backend
npm run start:dev    # Watch mode with hot reload
npm run build        # Compile TypeScript to dist/
npm run start        # Start server (runs from dist/)
npm run format       # Format code with Prettier
npm run lint         # Run ESLint with auto-fix
npm run test         # Run unit tests
npm run test:e2e     # Run end-to-end tests
npm run test:cov     # Run tests with coverage
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
│  - React UI with DaisyUI (dark/cyberpunk themes)            │
│  - Phaser game canvas (client-side arcade physics)          │
│  - ethers.js for wallet interaction                         │
└────────────────────┬────────────────────────────────────────┘
                     │ WebSocket (Socket.IO)
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  Backend (NestJS:3000)                                       │
│  - REST API endpoints                                       │
│  - WebSocket gateway (GameGatewayGateway)                   │
│  - GameService (game state logic)                           │
│  - Supabase (off-chain data persistence)                    │
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

1. **Frontend-Backend**: WebSocket via Socket.IO for real-time game state updates
2. **Blockchain**: Backend signs settlement transactions; frontend interacts directly with contracts via ethers.js
3. **Data Persistence**: Supabase for off-chain game data, blockchain for on-chain settlement

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, Tailwind CSS v4, DaisyUI, Phaser 3, ethers.js, Framer Motion |
| Backend | NestJS 11, Socket.IO, Supabase SDK, ethers.js, Jest |
| Contracts | Foundry, Solidity ^0.8.20, OpenZeppelin v5.5 |

## Important File Locations

- `frontend/components/GameCanvas.tsx` - Phaser game wrapper (client-side only)
- `backend/src/game/game.gateway/` - WebSocket gateway for real-time communication
- `backend/src/game/game.service.ts` - Game state logic (currently empty)
- `contracts/src/LiquidityVault.sol` - Main contract for deposits/settlements

## Configuration Notes

- **Frontend**: Path alias `@/*` maps to `./` in tsconfig.json
- **Backend**: Uses decorators and NodeNext module resolution
- **Contracts**: Foundry optimizer at 200 runs; OpenZeppelin and forge-std are git submodules
- **Infrastructure**: Cloudflare tunnels expose dev environment (config in `cloudflared/config.yml`, excluded from git)

## Smart Contract Status

`LiquidityVault.sol` contains TODOs:
- USDT deposit integration (currently accepts ETH/any token via `payable`)
- Signature verification in `settle()` function (currently only `onlyOwner`)
