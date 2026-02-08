# Yellow Network Transfer POC Scripts

This directory contains proof-of-concept scripts for interacting with Yellow Network's ClearNode API.

## Scripts

### yellow-transfer-poc.ts

Demonstrates unified balance transfers using Yellow Network's ClearNode WebSocket API.

**Features:**
- WebSocket connection to ClearNode sandbox
- 3-step authentication flow (auth_request → auth_challenge → auth_verify)
- Unified balance queries (get_ledger_balances)
- Off-chain fund transfers (transfer)

## Prerequisites

### 1. Get Test Tokens

Both sender and recipient must have test tokens from the Yellow faucet:

```bash
# Get tokens for sender
curl -XPOST https://clearnet-sandbox.yellow.com/faucet/requestTokens \
  -H "Content-Type: application/json" \
  -d '{"userAddress":"0xYOUR_SENDER_ADDRESS"}'

# Get tokens for recipient
curl -XPOST https://clearnet-sandbox.yellow.com/faucet/requestTokens \
  -H "Content-Type: application/json" \
  -d '{"userAddress":"0xYOUR_RECIPIENT_ADDRESS"}'
```

### 2. Install Dependencies

```bash
# From project root
bun install
```

## Usage

### Method 1: Using `.env` File (Recommended)

Create a `.env` file in the `scripts/` directory:

```bash
cp scripts/.env.example scripts/.env
```

Edit `scripts/.env` with your values:

```env
YELLOW_PRIVATE_KEY=0x...
YELLOW_RECIPIENT=0x...
```

Then run:

```bash
npx tsx scripts/yellow-transfer-poc.ts
```

### Method 2: Environment Variables

```bash
YELLOW_PRIVATE_KEY=0x... YELLOW_RECIPIENT=0x... npx tsx scripts/yellow-transfer-poc.ts
```

### Method 3: Legacy Environment Variables

The script also supports legacy variable names:

```bash
PRIVATE_KEY=0x... RECIPIENT=0x... npx tsx scripts/yellow-transfer-poc.ts
```

### Auto-Generated Wallet

Omit the private key to generate a new wallet (remember to fund it!):

```bash
YELLOW_RECIPIENT=0x... npx tsx scripts/yellow-transfer-poc.ts
```

### Example Output

```
════════════════════════════════════════════════════════════════
🟡 Yellow Network Unified Balance Transfer POC
════════════════════════════════════════════════════════════════

🔌 Connecting to wss://clearnet-sandbox.yellow.com/ws...
   ✓ Connected

🔐 Starting authentication...
   Main address: 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb
   Session key: 0x9876543210fedcba9876543210fedcba98765432
   Step 1: Sending auth_request...
   ✓ Received auth_challenge
   Step 2: Sending auth_verify...
   ✓ Authentication successful!

📊 Fetching unified balance...
   ✓ USDC balance: 10.0

💸 Transferring 1.0 USDC to 0x123...
   ✓ Transfer successful! TX ID: 0xabc...

════════════════════════════════════════════════════════════════
📈 Transfer Summary
════════════════════════════════════════════════════════════════
Sender:       0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb
Recipient:    0x123...
Amount:       1.0 USDC
Before:       10.0 USDC
After:        9.0 USDC
TX ID:        0xabc...
════════════════════════════════════════════════════════════════
```

## Important Notes

⚠️ **Recipient must have existing balance** - Cannot send to empty addresses in sandbox

⚠️ **No channel balances** - Transfer fails if user has non-zero channel amounts

⚠️ **Session key expiration** - Root access keys (`application: "clearnode"`) expire after 1 hour

## Troubleshooting

### "Invalid YELLOW_PRIVATE_KEY format" Error

The private key must be exactly 32 bytes (64 hex characters) with the `0x` prefix:

```bash
# Valid (66 chars total):
YELLOW_PRIVATE_KEY=0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef

# Invalid - too short (less than 64 hex chars after 0x):
YELLOW_PRIVATE_KEY=0x1234

# Invalid - too long (more than 64 hex chars after 0x):
YELLOW_PRIVATE_KEY=0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1

# Invalid - missing 0x prefix:
YELLOW_PRIVATE_KEY=1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
```

**Quick fix:** Generate a new private key:
```bash
npx tsx scripts/yellow-transfer-poc.ts
# The script will generate a new key and display it if YELLOW_PRIVATE_KEY is not set
```

### "YELLOW_RECIPIENT environment variable not set" Error

Make sure you've created the `.env` file in the `scripts/` directory:

```bash
# From project root
cp scripts/.env.example scripts/.env

# Edit the file with your values
nano scripts/.env
```

### Connection Errors

- **WebSocket connection failed**: Ensure you can reach `wss://clearnet-sandbox.yellow.com/ws`
- **Authentication failed**: Check that your wallet has test tokens from the faucet
- **Transfer failed**: Ensure the recipient address also has test tokens

## API Reference

### Authentication Flow

```typescript
// Step 1: auth_request → auth_challenge
{
  "req": [1, "auth_request", {
    "address": "0xYourWallet",
    "session_key": "0xGeneratedSessionKey",
    "application": "clearnode",
    "allowances": [],
    "scope": "app.create",
    "expires_at": 1735689600000
  }, timestamp],
  "sig": ["0x..."]
}

// Step 2: auth_challenge (response from server)

// Step 3: auth_verify (sign challenge with main wallet)
{
  "req": [2, "auth_verify", {
    "address": "0xYourWallet",
    "session_key": "0xGeneratedSessionKey",
    "challenge_response": "0x..."
  }, timestamp],
  "sig": ["0x..."]
}
```

### Transfer Request

```typescript
{
  "req": [3, "transfer", {
    "destination": "0xRecipientAddress",
    "allocations": [{
      "asset": "usdc",
      "amount": "1.0"
    }]
  }, timestamp],
  "sig": ["0x..."]  // signed by session key
}
```

### Get Balance Request

```typescript
{
  "req": [4, "get_ledger_balances", {}, timestamp],
  "sig": ["0x..."]  // signed by session key
}
```

## See Also

- [Yellow Network Documentation](https://docs.yellow.org/)
- [API Reference](https://docs.yellow.org/docs/api-reference/)
- [Off-Chain RPC Protocol](https://docs.yellow.org/docs/protocol/off-chain/overview/)
