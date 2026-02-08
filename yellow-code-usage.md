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
| `USDC_ADDRESS` | `0x036CbD53842c542664e7929541eC2318f3dCF7e` | USDC on Base Sepolia |
| `ENTRY_STAKE` | `"10000000"` (10 USDC in cents) | Minimum balance to play |
| `PER_SLICE_AMOUNT` | `"100000"` (0.1 USDC in cents) | Per-settlement transfer |
| `SESSION_DURATION` | `3600` (1 hour) | Session timeout |

---

## Core Files

| File | Purpose | Lines |
|------|---------|-------|
| [frontend/lib/yellow/config.ts](frontend/lib/yellow/config.ts) | Network configuration constants | 15 |
| [frontend/lib/yellow/auth-privy.ts](frontend/lib/yellow/auth-privy.ts) | Privy authentication for Yellow | 173 |
| [frontend/lib/yellow/balance.ts](frontend/lib/yellow/balance.ts) | Offchain balance checking | 62 |
| [frontend/lib/yellow/session-manager.ts](frontend/lib/yellow/session-manager.ts) | WebSocket client & session lifecycle | 265 |
| [frontend/hooks/useYellow.ts](frontend/hooks/useYellow.ts) | React hook for Yellow operations (NOT CURRENTLY USED) | 228 |
| [frontend/hooks/useYellowGameplay.ts](frontend/hooks/useYellowGameplay.ts) | **NEW:** Gameplay-only signing hook | 63 |
| [frontend/game/stores/trading-store.ts](frontend/game/stores/trading-store.ts) | **UPDATED:** Yellow signing state + Socket.IO handlers | ~200 (Yellow sections) |
| [frontend/components/GameCanvasClient.tsx](frontend/components/GameCanvasClient.tsx) | **UPDATED:** Calls useYellowGameplay() | 5 |
| [frontend/app/api/socket/game-events.ts](frontend/app/api/socket/game-events.ts) | **UPDATED:** Server-driven signing orchestration | ~200 (Yellow sections) |

---

## Architecture

**GAMEPLAY-ONLY, SERVER-DRIVEN SIGNING:**

```
┌─────────────────────────────────────────────────────────────┐
│  MatchmakingScreen (NO Yellow initialization)                │
│  - Privy Authentication                                      │
│  - NO WebSocket connection                                    │
│  - NO session key generation                                 │
└────────────┬────────────────────────────────────────────────┘
             │ Player matched
             ▼
┌─────────────────────────────────────────────────────────────┐
│  GameCanvasClient mounts                                     │
│  - useYellowGameplay() hook runs                             │
│  - ONLY sets up signing capability (Privy signTypedData)     │
└────────────┬────────────────────────────────────────────────┘
             │ Server: yellow_session_init_request
             ▼
┌─────────────────────────────────────────────────────────────┐
│  Client signs via signYellowData()                           │
│  - Silent Privy signing (no UX interruption)                 │
│  - Emits yellow_session_init_signature                       │
└────────────┬────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│  Server submits to Yellow Network                            │
│  - Stores sessionId in GameRoom                              │
│  - Per-settlement: yellow_state_update_request               │
│  - Game over: yellow_close_request                           │
└─────────────────────────────────────────────────────────────┘
```

**Key Changes from Old Architecture:**
- **NO client-side WebSocket connection** during matchmaking
- **NO session key generation** until gameplay starts
- **SERVER-DRIVEN**: All Yellow operations orchestrated via Socket.IO events
- **CLIENT-ONLY SIGNING**: Silent Privy signing, no UX interruption
- **LAZY INITIALIZATION**: useYellowGameplay() only runs when GameCanvasClient mounts

---

## 1. Authentication Flow (Privy → Yellow)

**Flow:** Login → Gameplay starts → Set up signing → Server requests signatures

| Step | File | Lines |
|------|------|-------|
| Privy Authentication | [MatchmakingScreen.tsx](frontend/components/MatchmakingScreen.tsx) | All auth logic |
| GameCanvasClient mounts | [GameCanvasClient.tsx](frontend/components/GameCanvasClient.tsx) | [33](frontend/components/GameCanvasClient.tsx#L33) |
| Set up signing capability | [useYellowGameplay.ts](frontend/hooks/useYellowGameplay.ts) | [36-63](frontend/hooks/useYellowGameplay.ts#L36-L63) |
| Server requests signatures | [game-events.ts](frontend/app/api/socket/game-events.ts) | [1141-1389](frontend/app/api/socket/game-events.ts#L1141-L1389) |

```typescript
// useYellowGameplay() sets up Privy signing wrapper
const privyMessageSigner = async (data: any): Promise<`0x${string}`> => {
  console.log('[Yellow] Signing with Privy...')
  const result = await privySignTypedData(data)
  console.log('[Yellow] Signed successfully')
  return result.signature as `0x${string}`
}

setYellowMessageSigner(privyMessageSigner)
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

## 3. Session Management (Server-Driven Multi-Party Signatures)

**Three-Tier Signature Pattern** from `scripts/app_session_two_signers.ts`:

| Operation | Signatures Required | Timeout | Purpose |
|-----------|---------------------|---------|---------|
| Create Session | 2 (100% quorum) | 10s | Initialize game with escrow |
| Update State | 2 (100% quorum) | 5s | Per-settlement allocation |
| Close Session | 2 (100% quorum) | 30s | Final settlement |

### 3.1 Session Creation (Server-Driven)

| Function | File | Lines |
|----------|------|-------|
| `initYellowSession()` | [game-events.ts](frontend/app/api/socket/game-events.ts) | [1141-1199](frontend/app/api/socket/game-events.ts#L1141-L1199) |
| Server emits: `yellow_session_init_request` | [trading-store.ts](frontend/game/stores/trading-store.ts) | [480-494](frontend/game/stores/trading-store.ts#L480-L494) |
| Client responds: `yellow_session_init_signature` | [trading-store.ts](frontend/game/stores/trading-store.ts) | [490](frontend/game/stores/trading-store.ts#L490) |

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

// Server requests signatures via Socket.IO
io.to(room.id).emit('yellow_session_init_request', { appDefinition, allocations })
```

### 3.2 Per-Settlement Updates (Server-Driven)

**Called after EVERY order settlement** (not just round end).

| Function | File | Lines |
|----------|------|-------|
| `updateYellowSession()` | [game-events.ts](frontend/app/api/socket/game-events.ts) | [1204-1248](frontend/app/api/socket/game-events.ts#L1204-L1248) |
| After settlement | [game-events.ts](frontend/app/api/socket/game-events.ts) | [928-935](frontend/app/api/socket/game-events.ts#L928-L935) |
| Server emits: `yellow_state_update_request` | [trading-store.ts](frontend/game/stores/trading-store.ts) | [498-517](frontend/game/stores/trading-store.ts#L498-L517) |

```typescript
// Server requests state update signatures
io.to(room.id).emit('yellow_state_update_request', {
  appSessionId: room.sessionId,
  version: room.sessionVersion++,
  allocations: newAllocations
})

// Client signs silently (no UX interruption)
socket.on('yellow_state_update_request', async (data) => {
  const submitMessage = await createSubmitAppStateMessage(signYellowData, {
    appSessionId: data.appSessionId,
    version: data.version,
    allocations: data.allocations,
  })
  socket.emit('yellow_state_update_signature', { message: submitMessage })
})
```

### 3.3 Session Closure (Server-Driven)

| Function | File | Lines |
|----------|------|-------|
| `closeYellowSession()` | [game-events.ts](frontend/app/api/socket/game-events.ts) | [1252-1380](frontend/app/api/socket/game-events.ts#L1252-L1380) |
| Game over before emit | [game-events.ts](frontend/app/api/socket/game-events.ts) | [1688](frontend/app/api/socket/game-events.ts#L1688), [1795](frontend/app/api/socket/game-events.ts#L1795) |
| Server emits: `yellow_close_request` | [trading-store.ts](frontend/game/stores/trading-store.ts) | [523-538](frontend/game/stores/trading-store.ts#L523-L538) |

```typescript
// Final allocations based on game outcome
const finalAllocations = [
  { address: winnerAddress, amount: `${winnerDollars * 100000}` },
  { address: loserAddress, amount: `${loserDollars * 100000}` }
]

// Server requests close signatures
io.to(room.id).emit('yellow_close_request', {
  appSessionId: room.sessionId,
  allocations: finalAllocations
})
```

---

## 4. Client-Side Store Integration

**Zustand store** for Yellow signing state management.

### State Properties

| State | Type | Purpose | File | Lines |
|-------|------|---------|------|-------|
| `yellowMessageSigner` | Function \| null | Privy signTypedData wrapper | [trading-store.ts](frontend/game/stores/trading-store.ts) | [113](frontend/game/stores/trading-store.ts#L113), [298](frontend/game/stores/trading-store.ts#L298) |

### Actions

| Action | Purpose | File | Lines |
|--------|---------|------|-------|
| `signYellowData()` | Sign data using message signer | [trading-store.ts](frontend/game/stores/trading-store.ts) | [1067-1076](frontend/game/stores/trading-store.ts#L1067-L1076) |
| `setYellowMessageSigner()` | Set signer (called by useYellowGameplay) | [trading-store.ts](frontend/game/stores/trading-store.ts) | [1079-1082](frontend/game/stores/trading-store.ts#L1079-L1082) |

### Socket.IO Event Handlers

| Event | Purpose | File | Lines |
|-------|---------|------|-------|
| `yellow_session_init_request` | Sign session creation message | [trading-store.ts](frontend/game/stores/trading-store.ts) | [480-494](frontend/game/stores/trading-store.ts#L480-L494) |
| `yellow_state_update_request` | Sign state update message | [trading-store.ts](frontend/game/stores/trading-store.ts) | [498-517](frontend/game/stores/trading-store.ts#L498-L517) |
| `yellow_close_request` | Sign session close message | [trading-store.ts](frontend/game/stores/trading-store.ts) | [523-538](frontend/game/stores/trading-store.ts#L523-L538) |
| `yellow_session_create` | Submit session to Yellow Network | [trading-store.ts](frontend/game/stores/trading-store.ts) | [544-563](frontend/game/stores/trading-store.ts#L544-L563) |
| `yellow_state_submit` | Submit state update to Yellow Network | [trading-store.ts](frontend/game/stores/trading-store.ts) | [565-578](frontend/game/stores/trading-store.ts#L565-L578) |
| `yellow_close_submit` | Submit close to Yellow Network | [trading-store.ts](frontend/game/stores/trading-store.ts) | [584-597](frontend/game/stores/trading-store.ts#L584-L597) |

---

## 5. React Hook Integration

### useYellow - Full Operations Hook (NOT CURRENTLY USED)

**Purpose:** Complete Yellow Network session management (connect, authenticate, create session, update, close).

**Status:** NOT actively used - the server-driven signing pattern doesn't require this hook.

**File:** [frontend/hooks/useYellow.ts](frontend/hooks/useYellow.ts)

### useYellowGameplay - Gameplay-Only Signing Hook (ACTIVELY USED)

**Purpose:** Lazy hook that ONLY sets up Privy's signing capability when GameCanvasClient mounts.

**Key Principles:**
- **LAZY:** Only initialized when gameplay component mounts
- **TRANSIENT:** Cleaned up when gameplay ends
- **SERVER-DRIVEN:** Client only responds to signing requests

**File:** [frontend/hooks/useYellowGameplay.ts](frontend/hooks/useYellowGameplay.ts)

```typescript
// Auto-runs when GameCanvasClient mounts
useYellowGameplay()

// Implementation (lines 36-63):
export function useYellowGameplay() {
  const { setYellowMessageSigner } = useTradingStore()
  const { signTypedData: privySignTypedData } = useSignTypedData()

  useEffect(() => {
    // Create wrapper that adapts Privy's signTypedData to Nitrolite's format
    const privyMessageSigner = async (data: any): Promise<`0x${string}`> => {
      const result = await privySignTypedData(data)
      return result.signature as `0x${string}`
    }

    setYellowMessageSigner(privyMessageSigner)

    return () => {
      // Cleanup: reset signer when gameplay ends
      setYellowMessageSigner(null)
    }
  }, [privySignTypedData, setYellowMessageSigner])
}
```

---

## 6. Socket.IO Events for Yellow Signing

### Server → Client (Signing Requests)

| Event | Data | Purpose | When |
|-------|------|---------|------|
| `yellow_session_init_request` | `{ appDefinition, allocations }` | Request signatures for session creation | Game starts |
| `yellow_state_update_request` | `{ appSessionId, version, allocations }` | Request signatures for state update | After each settlement |
| `yellow_close_request` | `{ appSessionId, allocations }` | Request signatures for session close | Game over |
| `yellow_session_create` | `{ sessionMessage }` | Ask one client to submit to Yellow | After signatures collected |
| `yellow_state_submit` | `{ stateMessage, version }` | Ask one client to submit state update | After signatures collected |
| `yellow_close_submit` | `{ closeMessage }` | Ask one client to submit close | After signatures collected |

### Client → Server (Signature Responses)

| Event | Data | Purpose |
|-------|------|---------|
| `yellow_session_init_signature` | `{ message }` | Signed session creation message |
| `yellow_state_update_signature` | `{ message }` | Signed state update message |
| `yellow_close_signature` | `{ message }` | Signed close message |
| `yellow_session_created` | `{ appSessionId }` | Confirmation that session was created |
| `yellow_state_submitted` | `{ appSessionId, version }` | Confirmation that state was submitted |
| `yellow_closed` | `{ appSessionId }` | Confirmation that session was closed |

---

## 7. Server Integration (GameRoom)

**GameRoom state** for Yellow sessions:

| State | File | Lines |
|-------|------|-------|
| `sessionId`, `sessionVersion` | [game-events.ts](frontend/app/api/socket/game-events.ts) | [343-349](frontend/app/api/socket/game-events.ts#L343-L349) |
| `player1Address`, `player2Address` | [game-events.ts](frontend/app/api/socket/game-events.ts) | [347-348](frontend/app/api/socket/game-events.ts#L347-L348) |
| `addressToSocketId` | [game-events.ts](frontend/app/api/socket/game-events.ts) | [349](frontend/app/api/socket/game-events.ts#L349) |

**Three Core Functions:**

| Function | Lines | Purpose |
|----------|-------|---------|
| `initYellowSession()` | [1141-1199](frontend/app/api/socket/game-events.ts#L1141-L1199) | Create session when both wallets present |
| `updateYellowSession()` | [1204-1248](frontend/app/api/socket/game-events.ts#L1204-L1248) | Update allocations after settlement |
| `closeYellowSession()` | [1252-1380](frontend/app/api/socket/game-events.ts#L1252-L1380) | Final settlement on game over |

---

## Integration Flow

**Lobby → Gameplay → Settlement:**

```
1. User logs in with Privy
2. User joins lobby (NO Yellow initialization)
3. Two players matched → handleMatchFound
4. GameCanvasClient mounts → useYellowGameplay() runs
5. Signer capability ready (Privy signTypedData wrapper)
6. Server: initYellowSession (yellow_session_init_request event)
7. Client signs via signYellowData() (silent Privy signing)
8. Server collects 2 signatures, submits to Yellow Network
9. Game starts with session active
10. Per-settlement: updateYellowSession (yellow_state_update_request)
11. Game over: closeYellowSession (yellow_close_request)
12. GameCanvasClient unmounts → signer cleaned up
```

---

## Error Handling

**Graceful Degradation** pattern ensures game continues even if Yellow fails:

| Scenario | Behavior |
|----------|----------|
| Yellow init fails | Game continues normally without Yellow |
| Balance check error | Returns `hasEnough: false`, prevents game entry |
| Signature timeout | Settlement continues, Yellow update skipped |
| Signer not ready | Server logs warning, skips Yellow operation |
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

// Example: Signer not ready (trading-store.ts)
signYellowData: async (data: any): Promise<`0x${string}`> => {
  const { yellowMessageSigner } = get()
  if (!yellowMessageSigner) {
    throw new Error('[Yellow] Message signer not ready')
  }
  return await yellowMessageSigner(data)
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
| **Signing** | Silent Privy signing (no UX interruption) |

---

## Reference Scripts

Integration patterns from `frontend/scripts/`:

| Script | Purpose | Adapted By |
|--------|---------|------------|
| `scripts/auth.ts` | Yellow authentication flow | `auth-privy.ts` |
| `scripts/app_session_two_signers.ts` | Multi-party signature pattern | `session-manager.ts`, `game-events.ts` |
| `scripts/check-yellow-balance.ts` | Balance checking | `balance.ts` |

---

## Why This Gameplay-Only Architecture Matters

Grid Games demonstrates Yellow Network as a **server-driven, gameplay-only state channel system**. Unlike traditional payment channel implementations that require client-side channel management, our architecture delays ALL Yellow initialization until gameplay starts—zero overhead during matchmaking. The server orchestrates multi-party signatures via Socket.IO events while the client acts as a silent signature provider using Privy's embedded wallet. This pattern shows how L2 payment channels can power real-time gaming economies with clean separation: matchmaking (no Web3 overhead) → gameplay (instant settlements with cryptographic guarantees). The result: seamless UX where players never wait for blockchain operations, yet every settlement is cryptographically secured on Layer 2.
