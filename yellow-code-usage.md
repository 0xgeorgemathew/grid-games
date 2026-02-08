# Yellow/Nitrolite Usage in Grid Games

**Yellow Network** on Base Sepolia - L2 payment channels for instant game settlements with multi-party signatures.

```
Player Stakes:     10 USDC per player (entry)
Per-Slice Amount:  0.1 USDC (per win/loss)
Network:           Base Sepolia (Chain ID: 84532)
Asset:             ytest.usd (testnet USDC)
WebSocket:         wss://clearnet-sandbox.yellow.com/ws
```

---

## Core Configuration

| Key | Value | Purpose |
|-----|-------|---------|
| `USDC_ADDRESS` | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | USDC on Base Sepolia |
| `ENTRY_STAKE` | `"10000000"` (10 USDC in cents) | Minimum balance to play |
| `PER_SLICE_AMOUNT` | `"100000"` (0.1 USDC in cents) | Per-settlement transfer |
| `SESSION_DURATION` | `3600` (1 hour) | Session timeout |

---

## Core Files

| File | Purpose | Lines |
|------|---------|-------|
| [frontend/lib/yellow/config.ts](frontend/lib/yellow/config.ts) | Network configuration constants | 15 |
| [frontend/lib/yellow/auth-privy.ts](frontend/lib/yellow/auth-privy.ts) | Privy authentication for Yellow | 164 |
| [frontend/lib/yellow/balance.ts](frontend/lib/yellow/balance.ts) | Offchain balance checking | 63 |
| [frontend/lib/yellow/session-manager.ts](frontend/lib/yellow/session-manager.ts) | WebSocket client & session lifecycle | 266 |
| [frontend/hooks/useYellow.ts](frontend/hooks/useYellow.ts) | React hook for Yellow operations | 118 |
| [frontend/app/api/socket/game-events.ts](frontend/app/api/socket/game-events.ts) | Server-side session management | 161 (1141-1301) |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  MatchmakingScreen (Client)                                 │
│  - Privy Authentication                                     │
│  - Yellow WebSocket Connection                              │
│  - Session Key Generation                                   │
└────────────┬────────────────────────────────────────────────┘
             │ signTypedData (EIP-712)
             ▼
┌─────────────────────────────────────────────────────────────┐
│  YellowSessionManager (Singleton)                           │
│  - WebSocket client (wss://clearnet-sandbox.yellow.com/ws)  │
│  - Message signer (ECDSA from session key)                  │
│  - Multi-party signature coordination                       │
└────────────┬────────────────────────────────────────────────┘
             │ Socket.IO events
             ▼
┌─────────────────────────────────────────────────────────────┐
│  Game Events Server (game-events.ts)                        │
│  - Session creation (initYellowSession)                     │
│  - Per-settlement updates (updateYellowSession)             │
│  - Session close (closeYellowSession)                       │
│  - Signature collection (collectSignatures)                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 1. Authentication Flow (Privy → Yellow)

**Flow:** Login → Generate session key → Sign auth challenge → WebSocket authenticated

| Step | File | Lines |
|------|------|-------|
| Store Privy signTypedData on window | [MatchmakingScreen.tsx](frontend/components/MatchmakingScreen.tsx) | [86-95](frontend/components/MatchmakingScreen.tsx#L86-L95) |
| Generate session key | [auth-privy.ts](frontend/lib/yellow/auth-privy.ts) | [16-35](frontend/lib/yellow/auth-privy.ts#L16-L35) |
| Create auth request | [auth-privy.ts](frontend/lib/yellow/auth-privy.ts) | [56-86](frontend/lib/yellow/auth-privy.ts#L56-L86) |
| Sign challenge with Privy | [auth-privy.ts](frontend/lib/yellow/auth-privy.ts) | [99-120](frontend/lib/yellow/auth-privy.ts#L99-L120) |
| Verify authentication | [auth-privy.ts](frontend/lib/yellow/auth-privy.ts) | [122-164](frontend/lib/yellow/auth-privy.ts#L122-L164) |

```typescript
// Privy signs EIP-712 typed data for Yellow authentication
const signature = await privyWallet.signTypedData({
  domain: AUTH_DOMAIN,
  types: { AuthRequest: AUTH_REQUEST_TYPES },
  message: { challenge, timestamp },
  primaryType: 'AuthRequest',
})
```

---

## 2. Balance Checking (Offchain)

Checks player's offchain balance on Yellow ledger before game entry.

| Step | File | Lines |
|------|------|-------|
| Create ledger query | [balance.ts](frontend/lib/yellow/balance.ts) | [11-35](frontend/lib/yellow/balance.ts#L11-L35) |
| Parse response | [balance.ts](frontend/lib/yellow/balance.ts) | [37-63](frontend/lib/yellow/balance.ts#L37-L63) |
| Before faucet claim | [MatchmakingScreen.tsx](frontend/components/MatchmakingScreen.tsx) | [177-186](frontend/components/MatchmakingScreen.tsx#L177-L186) |
| Before entering game | [MatchmakingScreen.tsx](frontend/components/MatchmakingScreen.tsx) | [257-269](frontend/components/MatchmakingScreen.tsx#L257-L269) |

```typescript
// Check if player has 10 USDC on Yellow ledger
const balance = await checkYellowBalance(sessionId)
const hasEnough = balance >= 10_000_000 // 10 USDC in cents
```

---

## 3. Session Management (Multi-Party Signatures)

**Three-Tier Signature Pattern** from `scripts/app_session_two_signers.ts`:

| Operation | Signatures Required | Timeout | Purpose |
|-----------|---------------------|---------|---------|
| Create Session | 2 (100% quorum) | 10s | Initialize game with escrow |
| Update State | 2 (100% quorum) | 5s | Per-settlement allocation |
| Close Session | 2 (100% quorum) | 30s | Final settlement |

### 3.1 Session Creation

| Function | File | Lines |
|----------|------|-------|
| `createAppSession()` | [session-manager.ts](frontend/lib/yellow/session-manager.ts) | [106-141](frontend/lib/yellow/session-manager.ts#L106-L141) |
| `initYellowSession()` | [game-events.ts](frontend/app/api/socket/game-events.ts) | [1141-1203](frontend/app/api/socket/game-events.ts#L1141-L1203) |

```typescript
// Server defines app configuration
const appConfig = {
  code: 0n, // App code
  quorum: 100n, // 100% agreement required
  weights: [50n, 50n], // Equal voting power
  assets: [{ asset_id: YTEST_USD, amount: ENTRY_STAKE }]
}

// Initial allocations (10 USDC each)
const allocations = [
  { address: player1Address, amount: '10000000' },
  { address: player2Address, amount: '10000000' }
]
```

### 3.2 Per-Settlement Updates

**Called after EVERY order settlement** (not just round end).

| Function | File | Lines |
|----------|------|-------|
| `submitAppState()` | [session-manager.ts](frontend/lib/yellow/session-manager.ts) | [147-183](frontend/lib/yellow/session-manager.ts#L147-L183) |
| `updateYellowSession()` | [game-events.ts](frontend/app/api/socket/game-events.ts) | [1205-1246](frontend/app/api/socket/game-events.ts#L1205-L1246) |
| After settlement | [game-events.ts](frontend/app/api/socket/game-events.ts) | [928-935](frontend/app/api/socket/game-events.ts#L928-L935) |

```typescript
// Silent signing with Privy (no UX interruption)
const newAllocations = [
  { address: player1Address, amount: `${player1.dollars * 100000}` },
  { address: player2Address, amount: `${player2.dollars * 100000}` }
]

await submitAppState(sessionId, newAllocations)
```

### 3.3 Session Closure

| Function | File | Lines |
|----------|------|-------|
| `closeAppSession()` | [session-manager.ts](frontend/lib/yellow/session-manager.ts) | [189-224](frontend/lib/yellow/session-manager.ts#L189-L224) |
| `closeYellowSession()` | [game-events.ts](frontend/app/api/socket/game-events.ts) | [1248-1301](frontend/app/api/socket/game-events.ts#L1248-L1301) |

```typescript
// Final allocations based on game outcome
const finalAllocations = [
  { address: winnerAddress, amount: `${winnerDollars * 100000}` },
  { address: loserAddress, amount: `${loserDollars * 100000}` }
]

await closeAppSession(sessionId, finalAllocations)
```

---

## 4. Client-Side Store Integration

**Zustand store** for Yellow state management.

| State | File | Lines |
|-------|------|-------|
| `yellowSessionId`, `yellowAuthenticated` | [trading-store.ts](frontend/game/stores/trading-store.ts) | [149-154](frontend/game/stores/trading-store.ts#L149-L154) |
| `initializeYellowSession()` | [trading-store.ts](frontend/game/stores/trading-store.ts) | [1026-1062](frontend/game/stores/trading-store.ts#L1026-L1062) |
| `signYellowData()` | [trading-store.ts](frontend/game/stores/trading-store.ts) | [1064-1091](frontend/game/stores/trading-store.ts#L1064-L1091) |

**Socket.IO Event Handlers** (Lines 473-566):

| Event | Purpose |
|-------|---------|
| `yellow_session_init_request` | Sign session creation |
| `yellow_state_update_request` | Sign state update |
| `yellow_close_request` | Sign session close |
| `yellow_session_created` | Session created confirmation |
| `yellow_state_updated` | State updated confirmation |
| `yellow_session_closed` | Session closed confirmation |

---

## 5. React Hook Integration

**`useYellow`** hook provides React-friendly interface to Yellow session manager.

| Hook | File | Lines |
|------|------|-------|
| `useYellow` | [hooks/useYellow.ts](frontend/hooks/useYellow.ts) | All |

```typescript
const {
  isConnected,
  isAuthenticated,
  sessionId,
  isReady,
  error,
  connect,
  authenticate,
  createSession,
  submitStateUpdate,
  closeSession,
  disconnect,
  signData,
} = useYellow()
```

---

## 6. Server Integration (GameRoom)

**GameRoom state** for Yellow sessions:

| State | File | Lines |
|-------|------|-------|
| `sessionId`, `sessionVersion` | [game-events.ts](frontend/app/api/socket/game-events.ts) | [343-349](frontend/app/api/socket/game-events.ts#L343-L349) |
| `player1Address`, `player2Address` | [game-events.ts](frontend/app/api/socket/game-events.ts) | [347-348](frontend/app/api/socket/game-events.ts#L347-L348) |
| `addressToSocketId` | [game-events.ts](frontend/app/api/socket/game-events.ts) | [349](frontend/app/api/socket/game-events.ts#L349) |

**Three Core Functions:**

| Function | Lines | Purpose |
|----------|-------|---------|
| `initYellowSession()` | [1141-1203](frontend/app/api/socket/game-events.ts#L1141-L1203) | Create session when both wallets present |
| `updateYellowSession()` | [1205-1246](frontend/app/api/socket/game-events.ts#L1205-L1246) | Update allocations after settlement |
| `closeYellowSession()` | [1248-1301](frontend/app/api/socket/game-events.ts#L1248-L1301) | Final settlement on game over |

---

## Integration Flow

**Lobby → Game → Settlement:**

```
1. User logs in with Privy
2. MatchmakingScreen stores signTypedData on window
3. initializeYellowSession() connects to Yellow WebSocket
4. authenticateWithPrivy() signs auth challenge
5. User claims faucet (if balance < 10 USDC)
6. Balance check ensures ≥10 USDC on Yellow ledger
7. User joins lobby
8. Two players matched → handleMatchFound
9. Server: initYellowSession (collects 2 signatures)
10. Client: Creates session on Yellow Network
11. Game starts with session active
12. Per-settlement: updateYellowSession (after every order)
13. Game over: closeYellowSession (final settlement)
```

---

## Error Handling

**Graceful Degradation** pattern ensures game continues even if Yellow fails:

| Scenario | Behavior |
|----------|----------|
| Yellow init fails | Game continues normally without Yellow |
| Balance check error | Returns `hasEnough: false`, prevents game entry |
| Signature timeout | Settlement continues, Yellow update skipped |
| WebSocket disconnect | Auto-reconnect after 5s |
| Session close fails | Game ends normally, settlement incomplete |

```typescript
// Example: Silent failure in balance checking
try {
  const balance = await checkYellowBalance(sessionId)
  return { hasEnough: balance >= 10_000_000, balance }
} catch (error) {
  console.error('[Yellow] Balance check failed:', error)
  return { hasEnough: false, balance: 0 }
}
```

---

## Security Considerations

| Aspect | Configuration |
|--------|---------------|
| **Session Key** | Generated client-side, expires after 1 hour |
| **Multi-Party Signatures** | Both players must sign all operations |
| **Quorum** | 100% (unanimous agreement required) |
| **Weights** | 50/50 (equal voting power) |
| **Challenge Period** | 0 (instant settlement) |
| **Asset** | ytest.usd (testnet USDC on Base Sepolia) |

---

## Reference Scripts

Integration patterns from `frontend/scripts/`:

| Script | Purpose | Adapted By |
|--------|---------|------------|
| `scripts/auth.ts` | Yellow authentication flow | `auth-privy.ts` |
| `scripts/app_session_two_signers.ts` | Multi-party signature pattern | `session-manager.ts`, `game-events.ts` |
| `scripts/check-yellow-balance.ts` | Balance checking | `balance.ts` |

---

## Why This Yellow Integration Matters

Grid Games demonstrates Yellow Network as a **high-frequency state channel system** for competitive gaming. Rather than blockchain transactions for every game action, we use offchain app sessions with multi-party signatures—enabling instant per-settlement updates (0.1 USDC transfers every 3-5 seconds) without gas fees. This pattern shows how L2 payment channels can power real-time gaming economies: players deposit 10 USDC escrow once, then execute dozens of micro-transactions per game with cryptographic guarantees and instant finality.
