/**
 * Multi-Party Application Session Tutorial
 * ========================================
 *
 * 📖 Complete Tutorial: https://github.com/stevenzeiler/yellow-sdk-tutorials/tree/main/scripts/app_sessions/README.md
 * 💻 Run this script: https://github.com/stevenzeiler/yellow-sdk-tutorials/blob/main/scripts/app_sessions/app_session_two_signers.ts
 *
 * To run this TypeScript SDK program:
 * ```bash
 * git clone https://github.com/stevenzeiler/yellow-sdk-tutorials.git
 * cd yellow-sdk-tutorials
 * npm install
 * # Add WALLET_1_PRIVATE_KEY and WALLET_2_PRIVATE_KEY to .env
 * npx tsx scripts/app_sessions/app_session_two_signers.ts
 * ```
 *
 * This script demonstrates how to create and manage a multi-party application session
 * using Nitrolite state channels on Base Sepolia testnet. An app session allows multiple
 * participants to interact within a shared off-chain context with cryptographically secured state updates.
 *
 * What You'll Learn:
 * -----------------
 * 1. Setting up multi-party authentication (2 wallets)
 * 2. Defining an application with multiple participants
 * 3. Creating an app session with initial allocations
 * 4. Updating session state (transferring value between participants)
 * 5. Closing a session with multi-party signatures
 *
 * Use Cases:
 * ----------
 * - Peer-to-peer payments and escrows
 * - Gaming with multiple players
 * - Collaborative applications (shared whiteboards, auctions)
 * - Multi-party negotiations and settlements
 *
 * Prerequisites:
 * --------------
 * - Two private keys in .env file:
 *   WALLET_1_PRIVATE_KEY="your first wallet private key"
 *   WALLET_2_PRIVATE_KEY="your second wallet private key"
 * - Both wallets should have USDC on Base Sepolia testnet
 * - Get test USDC from Circle faucet: https://faucet.circle.com/ (select Base Sepolia)
 *
 * Flow Overview:
 * --------------
 * 1. Connect to Yellow network
 * 2. Authenticate both participants' wallets
 * 3. Define app configuration (participants, weights, quorum)
 * 4. Create session with initial balance allocations
 * 5. Submit state update (demonstrating off-chain state changes)
 * 6. Close session with multi-party signatures
 */

import { Client } from 'yellow-ts'
import { authenticateWallet } from './auth'
import {
  createAppSessionMessage,
  createCloseAppSessionMessage,
  createECDSAMessageSigner,
  createSubmitAppStateMessage,
  RPCAppDefinition,
  RPCAppSessionAllocation,
  RPCAppStateIntent,
  RPCData,
  RPCProtocolVersion,
  RPCResponse,
} from '@erc7824/nitrolite'
import { createWalletClient, http, WalletClient } from 'viem'
import { baseSepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

export async function main() {
  // ============================================================================
  // STEP 1: Connect to Yellow Network
  // ============================================================================
  // Establish WebSocket connection to the Yellow clearnet endpoint
  const yellow = new Client({
    url: 'wss://clearnet-sandbox.yellow.com/ws',
  })

  await yellow.connect()
  console.log('🔌 Connected to Yellow clearnet')

  // Set up listener to log relevant messages for the tutorial
  yellow.listen(async (message: RPCResponse) => {
    // Only log errors (other messages are handled by application logic)
    if (message.method === 'error') {
      const error = (message.params as any).error
      // Suppress transient auth errors from concurrent authentication
      if (error !== 'invalid challenge or signature') {
        console.error('❌ Server error:', message.params)
      }
    }
  })

  // ============================================================================
  // STEP 2: Set Up Both Participants' Wallets
  // ============================================================================
  // Create wallet clients for both participants from their private keys on Base Sepolia
  // In a real application, each participant would control their own wallet
  const walletClient = createWalletClient({
    account: privateKeyToAccount(process.env.WALLET_1_PRIVATE_KEY as `0x${string}`),
    chain: baseSepolia, // Base Sepolia testnet
    transport: http(),
  })

  const wallet2Client = createWalletClient({
    account: privateKeyToAccount(process.env.WALLET_2_PRIVATE_KEY as `0x${string}`),
    chain: baseSepolia, // Base Sepolia testnet
    transport: http(),
  })

  // ============================================================================
  // STEP 3: Authenticate Both Participants (Sequential)
  // ============================================================================
  // Each participant must authenticate to create a session key for signing messages
  // This allows them to sign RPC messages without signing with their main wallet
  const sessionKey = await authenticateWallet(yellow, walletClient as WalletClient)
  console.log('🔑 Wallet 1 Session Key Address:', sessionKey.address)
  const messageSigner = createECDSAMessageSigner(sessionKey.privateKey)

  const sessionKey2 = await authenticateWallet(yellow, wallet2Client)
  console.log('🔑 Wallet 2 Session Key Address:', sessionKey2.address)
  const messageSigner2 = createECDSAMessageSigner(sessionKey2.privateKey)

  // Extract participant addresses for use in app definition
  const userAddress = walletClient.account?.address as `0x${string}`
  const partnerAddress = wallet2Client.account?.address as `0x${string}`

  // ============================================================================
  // STEP 4: Define Application Configuration
  // ============================================================================
  // The app definition specifies:
  // - participants: Array of participant addresses
  // - weights: Voting weights for each participant (50/50 here)
  // - quorum: Percentage required for decisions (100 = unanimous)
  // - challenge: Challenge period in seconds (0 = no challenge period)
  // - nonce: Unique identifier for this app instance
  const appDefinition: RPCAppDefinition = {
    protocol: RPCProtocolVersion.NitroRPC_0_4,
    participants: [userAddress, partnerAddress],
    weights: [50, 50], // Equal voting power
    quorum: 100, // Requires unanimous agreement
    challenge: 0, // No challenge period
    nonce: Date.now(), // Unique session identifier
    application: 'Grid app',
  }

  // ============================================================================
  // STEP 5: Set Initial Allocations
  // ============================================================================
  // Both participants start with 10.00 ytest.usd
  const allocations = [
    { participant: userAddress, asset: 'ytest.usd', amount: '10.00' },
    { participant: partnerAddress, asset: 'ytest.usd', amount: '10.00' },
  ] as RPCAppSessionAllocation[]

  // ============================================================================
  // STEP 6: Create and Submit App Session (Multi-Party Signatures)
  // ============================================================================
  // Create session message signed by first participant
  const sessionMessage = await createAppSessionMessage(messageSigner, {
    definition: appDefinition,
    allocations,
  })

  // Add second participant's signature (required for 100% quorum)
  const sessionJson = JSON.parse(sessionMessage)
  const sessionSig2 = await messageSigner2(sessionJson.req as RPCData)
  sessionJson.sig.push(sessionSig2)

  // Submit the fully-signed session creation
  const sessionResponse = await yellow.sendMessage(JSON.stringify(sessionJson))

  if ((sessionResponse as any).method === 'error') {
    console.error('❌ Session creation failed:', (sessionResponse as any).params)
    return
  }

  const appSessionId = (sessionResponse as any).params.appSessionId
  console.log('✅ Session created:', appSessionId)
  console.log('   Version: 1 | Status: open')
  console.log('   Initial balances: Wallet 1 = 10.00, Wallet 2 = 10.00')

  // ============================================================================
  // STEP 7: Helper Function for Multi-Party State Updates
  // ============================================================================
  async function submitStateUpdate(
    allocations: RPCAppSessionAllocation[],
    version: number,
    description: string
  ): Promise<void> {
    // Create state update message (signed by first participant)
    const submitMessage = await createSubmitAppStateMessage(messageSigner, {
      app_session_id: appSessionId,
      intent: RPCAppStateIntent.Operate,
      version,
      allocations,
    })

    // Parse and add second participant's signature
    const submitJson = JSON.parse(submitMessage)
    const sig2 = await messageSigner2(submitJson.req as RPCData)
    submitJson.sig.push(sig2)

    // Submit the fully-signed state update
    const response = await yellow.sendMessage(JSON.stringify(submitJson))

    if ((response as any).method === 'error') {
      console.error(`❌ Transfer failed: ${description}`)
      console.error('Error:', (response as any).params)
      throw new Error((response as any).params.error)
    }

    const w1Balance = allocations[0].amount
    const w2Balance = allocations[1].amount
    console.log(`✅ ${description}`)
    console.log(`   Version: ${version} | Balances: Wallet 1 = ${w1Balance}, Wallet 2 = ${w2Balance}`)
  }

  // ============================================================================
  // STEP 8: Execute Multiple State Transfers
  // ============================================================================
  let currentVersion = 2 // Session is at v1 after creation

  // Transfer 1: Wallet 1 → Wallet 2 ($1)
  await submitStateUpdate(
    [
      { participant: userAddress, asset: 'ytest.usd', amount: '9.00' },
      { participant: partnerAddress, asset: 'ytest.usd', amount: '11.00' },
    ] as RPCAppSessionAllocation[],
    currentVersion++,
    'Transfer 1: Wallet 1 → Wallet 2 ($1.00)'
  )

  // Transfer 2: Wallet 2 → Wallet 1 ($1)
  await submitStateUpdate(
    [
      { participant: userAddress, asset: 'ytest.usd', amount: '10.00' },
      { participant: partnerAddress, asset: 'ytest.usd', amount: '10.00' },
    ] as RPCAppSessionAllocation[],
    currentVersion++,
    'Transfer 2: Wallet 2 → Wallet 1 ($1.00)'
  )

  // Transfer 3: Wallet 2 → Wallet 1 ($1)
  const finalAllocations = [
    { participant: userAddress, asset: 'ytest.usd', amount: '11.00' },
    { participant: partnerAddress, asset: 'ytest.usd', amount: '9.00' },
  ] as RPCAppSessionAllocation[]

  await submitStateUpdate(
    finalAllocations,
    currentVersion++,
    'Transfer 3: Wallet 2 → Wallet 1 ($1.00)'
  )

  // ============================================================================
  // STEP 9: Close Session with Multi-Party Signatures
  // ============================================================================
  // Create close message signed by first participant
  const closeMessage = await createCloseAppSessionMessage(messageSigner, {
    app_session_id: appSessionId,
    allocations: finalAllocations,
  })

  // Add second participant's signature
  const closeJson = JSON.parse(closeMessage)
  const closeSig2 = await messageSigner2(closeJson.req as RPCData)
  closeJson.sig.push(closeSig2)

  // Submit the close request
  const closeResponse = await yellow.sendMessage(JSON.stringify(closeJson))

  if ((closeResponse as any).method === 'error') {
    console.error('❌ Close session failed:', (closeResponse as any).params)
    return
  }

  console.log('✅ Session closed successfully')
  console.log(`   Final Version: ${currentVersion} | Status: closed`)
  console.log(`   Final balances: Wallet 1 = 11.00, Wallet 2 = 9.00`)
  console.log('\n📊 Summary:')
  console.log('   - Started with: 10.00 each')
  console.log('   - Transfer 1: Wallet 1 → Wallet 2 ($1)')
  console.log('   - Transfer 2: Wallet 2 → Wallet 1 ($1)')
  console.log('   - Transfer 3: Wallet 2 → Wallet 1 ($1)')
  console.log('   - Result: Wallet 1 = +1, Wallet 2 = -1')

  // Wait to catch final server messages
  await new Promise((resolve) => setTimeout(resolve, 1000))
}

if (require.main === module) {
  main().catch((error) => {
    console.error('❌ Error:', error.message || error)
    process.exitCode = 1
  })
}
