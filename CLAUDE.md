# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## CRITICAL ISSUES

### Smart Contract TODOs (Severity: CRITICAL)

`contracts/src/LiquidityVault.sol` contains unimplemented critical features:

1. **USDT Deposit Integration (CRITICAL)**: `deposit()` currently accepts ETH/any token via `payable`. Does not validate USDT transfer.
   - File: `contracts/src/LiquidityVault.sol:13-17`
   - Impact: Security vulnerability - accepts any token, no USDT validation

2. **Signature Verification (CRITICAL)**: `settle()` function only uses `onlyOwner` modifier. TODO: Implement EIP-712 signature verification for game settlement authorization.
   - File: `contracts/src/LiquidityVault.sol:20-24`
   - Impact: Centralized settlement requires manual owner transactions, no game-server integration

### Known Issues

- **Performance**: `GridScanBackground.tsx` runs Three.js at 60fps continuously (no frame throttling)
- **Performance**: `PositionIndicator.tsx` filters pending orders every 16ms (RAF loop)
- **Security**: CORS wildcard in production (`*` origin)
- **Missing**: Rate limiting on Socket.IO endpoints
- **Types**: Several types not exported from `types/` directory (see `.claude/rules/types.md`)

## Project Overview

Grid Games is a monorepo containing a web-based game with real-time multiplayer and blockchain settlement. The project consists of two independent subprojects:

- **frontend/**: Next.js web app with Phaser game engine and embedded Socket.IO server (port 3000)
- **contracts/**: Foundry smart contracts for game liquidity and settlement
- ~~backend/**~~: *Removed - Socket.IO server now embedded in frontend*

## Master Directives

1. **Tone**: Concise, direct, engineering-focused. No conversational filler.
2. **Code Output**: Snippets only. No test files (`.spec.ts`, `.test.tsx`, `.t.sol`) or full boilerplate unless requested.
3. **Architecture**:
   - Frontend logic in `stores/` (Zustand); components are visual only
   - Phaser handles physics, React handles UI overlays. Never mix the two DOMs
4. **Problem Solving**: Default to simplest, fastest solution. Complexity requires justification.

## Development Commands

### Frontend (Next.js + Phaser)

```bash
bun install           # Install dependencies
bun run dev           # Start development server on localhost:3000
bun run types         # TypeScript type checking
bun run format        # Format code with Prettier
bun run build         # Production build
bun run start         # Start production server
bun run lint          # Run ESLint
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
│  Frontend (Next.js:3000)                                     │
│  - React UI with SHADCN (dark/cyberpunk themes)            │
│  - Phaser game canvas (client-side arcade physics)          │
│  - Three.js background (GridScanBackground - 60fps)         │
│  - Socket.IO server at /api/socket (embedded)               │
│  - ethers.js for wallet interaction                         │
│  - window.phaserEvents bridge (React ↔ Phaser)              │
└────────────────────┬────────────────────────────────────────┘
                     │ ethers.js
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  Smart Contracts (LiquidityVault)                           │
│  - USDT deposits into vault (TODO: USDT validation)         │
│  - Game settlement with owner signature (TODO: verify)      │
│  - Owner-controlled withdrawals                             │
└─────────────────────────────────────────────────────────────┘
```

### Current Game Mode: Best-of-Three Rounds

HFT Battle uses a best-of-three round system:

- **Round Duration**: 100 seconds per round
- **Starting Cash**: $10 per player, $20 total economy (zero-sum, $0 floor)
- **Round End**: Time limit or knockout ($0)
- **Game End**: First to 2 round wins
- **Sudden Death**: If tied 1-1 after 2 rounds, final round determines winner
- **Round Transitions**: Cash-at-start preserved from previous round's end

See `.claude/rules/game-design.md` for complete mechanics.

### Key Architectural Patterns

1. **HFT Battle**: Single-monolith architecture - Next.js App Router hosts both frontend and Socket.IO server at `/api/socket`
2. **Blockchain**: Frontend interacts directly with contracts via ethers.js for settlements
3. **Data Persistence**: In-memory room state (no external DB for multiplayer)

### Multiplayer Game Patterns (HFT Battle)

- **RoomManager class**: Centralized room and player management with cleanup
- **GameRoom class**: Encapsulates room state with timer tracking (prevents memory leaks)
- **SettlementGuard class**: RAII pattern preventing duplicate settlement (race condition guard)
- **Input validation**: Player name sanitization, coin type guards
- **Timer cleanup**: Track intervals/timeouts in GameRoom for proper disposal
- **React-Phaser bridge**: `window.phaserEvents` event emitter for cross-DOM communication
  - Server events → React store → `window.phaserEvents` → Phaser scene
  - Phaser input → Socket emit → Server
  - Pattern documented in `.claude/rules/multiplayer-patterns.md`

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

## Performance Considerations

### Known Performance Issues

1. **Three.js Background (GridScanBackground)**: Runs at 60fps continuously with no frame throttling
   - File: `frontend/components/GridScanBackground.tsx`
   - Impact: High CPU usage on mobile devices
   - Mitigation: Consider requestAnimationFrame throttling or conditional rendering

2. **PositionIndicator Filtering**: Filters pending orders every 16ms (RAF loop)
   - File: `frontend/components/PositionIndicator.tsx`
   - Impact: Unnecessary re-renders when orders haven't changed
   - Mitigation: Use memoization or reactive filtering

3. **CORS Wildcard**: Production uses `origin: "*"` for Socket.IO
   - Security concern: Open to any origin
   - Mitigation: Restrict to known domains in production

## Smart Contract Status

**`LiquidityVault.sol` contains CRITICAL TODOs:**

| TODO | Severity | Line | Description |
|------|----------|------|-------------|
| USDT deposit integration | **CRITICAL** | 13-17 | Currently accepts ETH/any token via `payable`. No USDT validation. |
| Signature verification | **CRITICAL** | 20-24 | `settle()` uses `onlyOwner` only. Needs EIP-712 verification for game-server auth. |

## Claude Code Automations

### MCP Servers
- **GitHub MCP**: Issue/PR management, CI workflow integration
- **context7**: Live documentation for Phaser, Socket.IO, ethers.js, Foundry

### Custom Skills
- `game-component`: Scaffold Phaser scenes with React integration

### Specialized Agents
- `game-logic-reviewer`: Multiplayer reliability (race conditions, memory leaks, performance)
- `web3-auditor`: Smart contract security (reentrancy, access control, gas optimization)

### Automation Hooks
- Auto-format: Prettier on every file edit
- Type-check: TypeScript validation after edits
- Security blocks: Prevent .env and lock file edits

### Workflow Integration
- All automations follow patterns from `.claude/rules/workflows.md`
- Agents use superpowers framework from `.claude/rules/skills.md`
- Frontend patterns follow conventions from `.claude/rules/frontend.md`
- ULTRATHINK directive applies to all automation execution
