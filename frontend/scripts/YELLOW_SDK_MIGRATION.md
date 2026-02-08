# Yellow Network SDK Migration Guide

## Overview

This document compares the manual WebSocket implementation with the official `yellow-ts` SDK approach for Yellow Network integration.

## Manual WebSocket vs SDK

| Aspect | Manual WebSocket | yellow-ts SDK |
|--------|-----------------|---------------|
| **Authentication** | Manual EIP-712 signing and message construction | `createAuthVerifyMessageFromChallenge()` handles signing |
| **Message Signing** | Custom `canonicalStringify` function | `createECDSAMessageSigner()` from Nitrolite SDK |
| **Message Format** | Manual JSON array construction | Automatic via SDK message creators |
| **Error Handling** | Manual try/catch with custom logic | Built-in error types and reconnection logic |
| **Maintenance** | High (protocol changes require updates) | Low (SDK updates handle protocol changes) |
| **Code Lines** | ~200+ lines for basic operations | ~150 lines for same functionality |

## Code Comparison

### Authentication

**Manual Approach:**
```typescript
// Manual EIP-712 domain construction
const domain = {
  name: 'Yellow',
  version: '1',
  chainId: 1337,
  verifyingContract: '0x0000000000000000000000000000000000000000' as `0x${string}`,
}

// Manual types construction
const types = {
  Auth: [
    { name: 'challenge', type: 'string' },
    { name: 'timestamp', type: 'uint256' },
  ],
}

// Manual signing
const signature = await walletClient.signTypedData({ domain, types, message })
```

**SDK Approach:**
```typescript
const messageSigner = createECDSAMessageSigner(privateKey)
const signedAuth = await createAuthVerifyMessageFromChallenge(
  messageSigner,
  challengeMessage
)
await yellow.request({ command: 'auth_verify', message: signedAuth })
```

### Transfer

**Manual Approach:**
```typescript
// Manual message construction
const message = [
  'transfer',
  {
    destination: recipient,
    allocations: [{ asset: 'usdc', amount: '1.0' }],
    id: generateId(),
    timestamp: Date.now(),
  }
]

// Manual canonical stringify
const canonical = canonicalStringify(message[1])
const signature = await signMessage(canonical)
```

**SDK Approach:**
```typescript
const messageSigner = createECDSAMessageSigner(privateKey)
const signedTransfer = await createTransferMessage(messageSigner, {
  destination: recipient,
  allocations: [{ asset: 'usdc', amount: '1.0' }],
})
await yellow.request({ command: 'transfer', message: signedTransfer })
```

### Getting Balances

**Manual Approach:**
```typescript
const message = [
  'get_ledger_balances',
  {
    account: address,
    id: generateId(),
    timestamp: Date.now(),
  }
]
ws.send(JSON.stringify(message))
// Manual response parsing...
```

**SDK Approach:**
```typescript
const messageSigner = createECDSAMessageSigner(privateKey)
const balanceRequest = await createGetLedgerBalancesMessage(messageSigner, address)
const response = await yellow.request({
  command: 'get_ledger_balances',
  message: balanceRequest,
})
```

## Key Benefits of SDK

1. **Type Safety**: Full TypeScript support with proper types for all messages
2. **Less Code**: ~25% reduction in code for same functionality
3. **Reliability**: Officially maintained by Yellow Network team
4. **Updates**: Automatic handling of protocol changes via SDK updates
5. **Error Handling**: Built-in error types and reconnection logic
6. **Testing**: SDK comes with its own test suite

## Installation

```bash
bun add yellow-ts @erc7824/nitrolite viem
```

## Quick Start

```typescript
import { Client } from 'yellow-ts'
import { createECDSAMessageSigner, createAuthVerifyMessageFromChallenge } from '@erc7824/nitrolite'

// Connect
const yellow = new Client({ url: 'wss://clearnet-sandbox.yellow.com/ws' })
await yellow.connect()

// Authenticate
const messageSigner = createECDSAMessageSigner(privateKey)
const signedAuth = await createAuthVerifyMessageFromChallenge(messageSigner, challenge)
await yellow.request({ command: 'auth_verify', message: signedAuth })
```

## References

- [yellow-ts NPM](https://www.npmjs.com/package/yellow-ts)
- [Nitrolite SDK](https://www.npmjs.com/package/@erc7824/nitrolite)
- [Yellow Documentation](https://docs.yellow.org/)
- [ERC-7824 Specification](https://ethereum-magicians.org/t/erc-7824-state-channels-framework/22566)

## Migration Checklist

- [ ] Install `yellow-ts` and `@erc7824/nitrolite`
- [ ] Replace WebSocket connection with `Client` from SDK
- [ ] Replace manual EIP-712 signing with `createECDSAMessageSigner`
- [ ] Replace manual message construction with SDK message creators
- [ ] Update response handling to work with SDK response format
- [ ] Test authentication flow
- [ ] Test transfer flow
- [ ] Test balance fetching
- [ ] Remove custom `canonicalStringify` function
- [ ] Update error handling for SDK error types
