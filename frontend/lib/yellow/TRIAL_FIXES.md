# Yellow App Session "Failed to Parse" Debug Guide

## Summary of Trial Fixes Implemented

Four trial fixes have been implemented to isolate the "failed to parse" error:

### Fix #1: application vs application_id Field

**File**: `frontend/lib/yellow/app-session-manager.ts`
**Flag**: `USE_APPLICATION_ID_FIELD` (line 103)

Yellow's documentation inconsistently uses `application` and `application_id`. The parser may expect one over the other.

**To test**: Set `const USE_APPLICATION_ID_FIELD = true` to try `application_id` instead of `application`.

### Fix #2: Larger Challenge Value

**File**: `frontend/lib/yellow/app-session-manager.ts`
**Changed**: `challenge: 60` (was 10)

Some Nitro implementations expect larger challenge windows (60s instead of 10s).

### Fix #3: Empty session_data

**File**: `frontend/lib/yellow/app-session-manager.ts`
**Line**: ~350
**Changed**: `session_data: '{}'` (was full game state JSON)

If the parser fails on the game state JSON (special chars, escaping, etc.), empty session_data should work.

### Fix #5: Asset Contract Address

**File**: `frontend/app/api/socket/game-events.ts`
**Line**: ~1043
**Changed**: `asset: '0xDB9F293e3898c9E5536A3be1b0C56c8F4A2717Dc'` (was `'ytest.usd'`)

Yellow's ClearNode may expect the actual contract address instead of the token symbol in allocations.

**To test**: Uses `ytest.usd` contract address `0xDB9F293e3898c9E5536A3be1b0C56c8F4A2717Dc` from Yellow's assets response.

### Fix #4: chain_id Field

**File**: `frontend/lib/yellow/app-session-manager.ts`
**Flag**: `INCLUDE_CHAIN_ID` (line 111)

Some Nitro implementations require `chain_id` or `network_id` in the definition for sandbox environments.

**To test**: Set `const INCLUDE_CHAIN_ID = true` to include `chain_id: 84532` (Base Sepolia).

## How to Test Each Fix

### Step 1: Run the app and trigger create_app_session

```bash
cd frontend
bun run dev
```

### Step 2: Check browser console for "CRITICAL DEBUG" logs

Look for:

```
[Yellow RPC] CRITICAL DEBUG - RAW JSON SENDING:
{"req":[...],"sig":[...]}

[Yellow RPC] CRITICAL DEBUG - PARAMS VALIDATION:
```

### Step 3: Copy the exact JSON and validate

Copy the RAW JSON SENDING output and paste into:

- https://jsonlint.com/ - to verify valid JSON
- Check for any `null` or `undefined` values

### Step 4: Check PARAMS VALIDATION output

The validation logs will show:

```
[Yellow RPC]   definition.application: grid-games-hft-battle
[Yellow RPC]   definition.participants: ["0x...", "0x..."]
[Yellow RPC]   definition.challenge (type): number 60
[Yellow RPC]   definition.nonce (type): number 123456
```

Any ERROR messages here indicate the specific field causing issues.

## Testing Matrix

| Fix         | Configuration                                        | Expected Result                                |
| ----------- | ---------------------------------------------------- | ---------------------------------------------- |
| Baseline    | All flags false, `session_data='{}'`, `challenge=60` | Current state - may still fail                 |
| Fix #1      | `USE_APPLICATION_ID_FIELD=true`                      | If succeeds, parser expects `application_id`   |
| Fix #3 full | `session_data=JSON.stringify(gameState)`             | If succeeds, full game state JSON works        |
| Fix #4      | `INCLUDE_CHAIN_ID=true`                              | If succeeds, parser requires `chain_id`        |
| Fix #5      | Asset as contract address                            | If succeeds, parser expects address not symbol |
| Combined    | All fixes enabled                                    | If succeeds, multiple issues were present      |

**CURRENT STATE (Feb 2025):** Fix #1 + Fix #3 + Fix #4 + Fix #5 (all fixes) are enabled in `game-events.ts`

## Potential Root Causes

### 1. session_data Escaping

The game state JSON may have problematic characters:

- Escaped quotes `\"` inside the string
- Special Unicode characters
- Numbers serialized as strings or vice versa

**Diagnostic**: If Fix #3 (empty session_data) works, the issue is in game state serialization.

### 2. Field Naming

Parser expects `application_id` but receives `application`.

**Diagnostic**: If Fix #1 works, toggle the field name.

### 3. Numeric Types

Parser expects strict number types for `challenge`, `nonce`, `quorum`.

**Diagnostic**: Check PARAMS VALIDATION logs for `(type): number`.

### 4. Asset Address vs Symbol

Parser may expect contract address instead of `ytest.usd`.

**Diagnostic**: If all above fail, try changing `YELLOW_TOKEN` from `'ytest.usd'` to actual contract address.

### 5. Participant Ordering

Signatures must match participant order exactly.

**Diagnostic**: Check "signatureArrayOrder" in logs to verify correct mapping.

### 6. chain_id or network_id Missing

Some Nitro implementations require chain identification in the definition.

**Diagnostic**: If Fix #4 works, include chain_id for all sandbox sessions.

## Next Steps After Testing

1. **If Fix #3 (empty session_data) works**: Gradually add back game state fields to find the problematic one
2. **If Fix #1 works**: Keep `application_id` and update documentation
3. **If all fail**: Contact Yellow support with the exact "RAW JSON SENDING" output

## Debug Log Locations

- **Frontend**: Browser console (Chrome DevTools)
- **Server**: Terminal running `bun run dev`
- **Key log prefix**: `[Yellow RPC] CRITICAL DEBUG`

## Contact Yellow Support

If none of the fixes work, provide:

1. Full "RAW JSON SENDING" output
2. Error response from ClearNode
3. NitroRPC version being used (`NitroRPC/0.4`)
4. ClearNode URL (`wss://clearnet-sandbox.yellow.com/ws`)
