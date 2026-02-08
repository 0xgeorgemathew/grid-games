# ENS Usage in Grid Games

**Base Sepolia** testnet - `.grid.eth` subdomains for player identity and matchmaking.

```
Player Identity:  {username}.grid.eth
L2 Registry:      0xef46c8e7876f8a84e4b4f7e1a641fa6497bd532d
L2 Registrar:     0x85465BBfF2b825481E67A7F1C9eB309e693814E7
```

---

## Text Records

| Key | Values | Purpose |
|-----|--------|---------|
| `games.grid.leverage` | "1", "2", "5", "10", "20" | Whale multiplier in-game |
| `games.grid.total_games` | Integer string | Games played |
| `games.grid.streak` | Integer string | Current win streak |

---

## Core Files

| File | Purpose |
|------|---------|
| [frontend/lib/ens.ts](frontend/lib/ens.ts) | Contract addresses, text record keys, leverage fetch |
| [frontend/hooks/useENS.ts](frontend/hooks/useENS.ts) | React hooks for ENS operations |
| [frontend/app/api/ens/route.ts](frontend/app/api/ens/route.ts) | Server API for registration/stats |
| [frontend/app/api/socket/game-events.ts](frontend/app/api/socket/game-events.ts) | Matchmaking with ENS leverage |

---

## 1. Matchmaking via ENS Subdomains

**Flow:** Login → Check ENS name → Claim if needed → Set leverage → Enter queue

| Step | File | Lines |
|------|------|-------|
| Reverse lookup (address → name) | [MatchmakingScreen.tsx](frontend/components/MatchmakingScreen.tsx) | [66-97](frontend/components/MatchmakingScreen.tsx#L66-L97) |
| Claim username | [ClaimUsername.tsx](frontend/components/ens/ClaimUsername.tsx) | All |
| Set leverage preference | [SetLeverage.tsx](frontend/components/ens/SetLeverage.tsx) | All |
| Load leverage into store | [MatchmakingScreen.tsx](frontend/components/MatchmakingScreen.tsx) | [99-108](frontend/components/MatchmakingScreen.tsx#L99-L108) |

---

## 2. Leverage for Gameplay Multiplier

Server fetches leverage from ENS at game start, uses for whale power-up.

| Function | File | Lines |
|----------|------|-------|
| `getLeverageForAddress()` | [lib/ens.ts](frontend/lib/ens.ts) | [167-232](frontend/lib/ens.ts#L167-L232) |
| `getLeverageForPlayer()` | [game-events.ts](frontend/app/api/socket/game-events.ts) | [390-427](frontend/app/api/socket/game-events.ts#L390-L427) |
| `activateWhale2X()` (uses leverage) | [game-events.ts](frontend/app/api/socket/game-events.ts) | [1367-1378](frontend/app/api/socket/game-events.ts#L1367-L1378) |

```typescript
// Whale power-up uses player's ENS leverage as multiplier
const leverage = player?.leverage ?? 2  // From ENS text record
const transfer = baseImpact * leverage  // 2x, 5x, 10x, or 20x
```

---

## 3. Stats for Matchmaking

Stats stored in ENS, updated after each game. Used for future: rank/streak matching.

| Step | File | Lines |
|------|------|-------|
| Fetch current stats | [GameOverModal.tsx](frontend/components/GameOverModal.tsx) | [72-76](frontend/components/GameOverModal.tsx#L72-L76) |
| Calculate new values | [GameOverModal.tsx](frontend/components/GameOverModal.tsx) | [78-80](frontend/components/GameOverModal.tsx#L78-L80) |
| Write to ENS | [useUpdatePlayerStats()](frontend/hooks/useENS.ts) | [462-555](frontend/hooks/useENS.ts#L462-L555) |

```typescript
// After game ends
totalGames = current + 1
streak = winner ? streak + 1 : 0
```

---

## API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/ens?action=getName&address={address}` | Reverse ENS lookup |
| `GET /api/ens?action=getStats&label={label}` | Read player stats |
| `POST /api/ens?action=register` | Register subdomain |
| `POST /api/ens?action=setLeverage` | Set leverage text record |

---

## Why This ENS Integration Matters

Grid Games demonstrates ENS as a **decentralized player identity layer** for competitive gaming. Rather than just human-readable names, we use ENS text records to store persistent player state (leverage preferences, stats, win streaks) that flows directly into gameplay mechanics and matchmaking. This pattern shows how ENS can serve as a zero-knowledge user profile system—enabling server-side reads without additional authentication while keeping players in full control of their data.
