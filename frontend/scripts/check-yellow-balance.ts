/**
 * Check Yellow Offchain Balance
 * ==============================
 *
 * Run this script to check your Yellow Network offchain balance.
 *
 * Usage:
 * ```bash
 * npx tsx frontend/scripts/check-yellow-balance.ts
 * ```
 *
 * Prerequisites:
 * - WALLET_PRIVATE_KEY or WALLET_1_PRIVATE_KEY environment variable set in .env
 * - Wallet must have requested tokens from faucet
 *
 * What it does:
 * 1. Connects to Yellow Network via WebSocket
 * 2. Authenticates using your wallet private key
 * 3. Queries your offchain ledger balance
 * 4. Displays all asset balances (ytest.usd, etc.)
 */

import { Client } from 'yellow-ts'
import { createECDSAMessageSigner, createGetLedgerBalancesMessage, RPCResponse, RPCMethod } from '@erc7824/nitrolite'
import { authenticateWallet } from './auth'
import { createWalletClient, http, WalletClient } from 'viem'
import { baseSepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { config } from 'dotenv'

// Load .env from scripts directory (fallback to project root)
config({ path: require('path').resolve(__dirname, '.env') })
if (!process.env.WALLET_PRIVATE_KEY && !process.env.WALLET_1_PRIVATE_KEY) {
  config({ path: require('path').resolve(__dirname, '../../.env') })
}

interface LedgerBalance {
  asset: string
  amount: string
}

interface BalanceResponse {
  ledgerBalances: LedgerBalance[]
}

async function main() {
  console.log('🟡 Yellow Offchain Balance Checker\n')

  // ==========================================================================
  // STEP 1: Connect to Yellow Network
  // ==========================================================================
  const yellow = new Client({
    url: 'wss://clearnet-sandbox.yellow.com/ws',
  })

  await yellow.connect()
  console.log('🔌 Connected to Yellow clearnet\n')

  // ==========================================================================
  // STEP 2: Create Wallet Client from Private Key
  // ==========================================================================
  // Support both WALLET_PRIVATE_KEY and WALLET_1_PRIVATE_KEY for compatibility
  const privateKey = (process.env.WALLET_PRIVATE_KEY || process.env.WALLET_1_PRIVATE_KEY) as `0x${string}`
  if (!privateKey) {
    throw new Error('WALLET_PRIVATE_KEY or WALLET_1_PRIVATE_KEY must be set in .env')
  }

  const walletClient = createWalletClient({
    account: privateKeyToAccount(privateKey),
    chain: baseSepolia,
    transport: http(),
  })

  // ==========================================================================
  // STEP 3: Authenticate
  // ==========================================================================
  const walletAddress = walletClient.account?.address as `0x${string}`
  const sessionKey = await authenticateWallet(yellow, walletClient as WalletClient)
  console.log(`🔑 Session Key: ${sessionKey.address}`)
  console.log(`🔑 Has privateKey: ${!!sessionKey.privateKey}`)
  console.log()

  // Create message signer for balance query
  if (!sessionKey.privateKey) {
    throw new Error('Session key privateKey is undefined!')
  }
  const messageSigner = createECDSAMessageSigner(sessionKey.privateKey)

  // ==========================================================================
  // STEP 4: Query Ledger Balance
  // ==========================================================================
  console.log('💰 Fetching offchain balance...\n')

  // Create the balance query message with wallet address
  const balanceMessage = await createGetLedgerBalancesMessage(messageSigner, walletAddress)

  // Set up a Promise to wait for the balance response
  const balancePromise = new Promise<BalanceResponse>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Balance query timeout'))
    }, 10000)

    // Listen for the response
    yellow.listen((message: RPCResponse) => {
      if (message.method === RPCMethod.GetLedgerBalances) {
        clearTimeout(timeout)
        // Transform snake_case response to camelCase interface
        const params = message.params as any
        resolve({
          ledgerBalances: params.ledger_balances || params.ledgerBalances || []
        })
      }
    })

    // Send the request
    yellow.sendMessage(balanceMessage).catch((error) => {
      clearTimeout(timeout)
      reject(error)
    })
  })

  // ==========================================================================
  // STEP 5: Display Results
  // ==========================================================================
  try {
    const response = await balancePromise
    const balances = response.ledgerBalances

    if (balances.length === 0) {
      console.log('⚠️  No balances found')
      console.log('   Request test tokens: curl -XPOST https://clearnet-sandbox.yellow.com/faucet/requestTokens \\')
      console.log('     -H "Content-Type: application/json" \\')
      console.log('     -d \'{"userAddress":"YOUR_ADDRESS"}\'\n')
    } else {
      console.log('✅ Offchain Balances:')
      console.log('─'.repeat(50))

      for (const balance of balances) {
        const asset = balance.asset.toUpperCase().padEnd(12)
        const amount = balance.amount.padStart(20)
        console.log(`   ${asset} : ${amount}`)
      }

      console.log('─'.repeat(50))
      console.log()
    }
  } catch (error) {
    console.error('❌ Failed to fetch balance:', error)
  } finally {
    // Disconnect
    yellow.disconnect()
    console.log('🔌 Disconnected from Yellow')
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('❌ Error:', error.message || error)
    process.exitCode = 1
  })
}
