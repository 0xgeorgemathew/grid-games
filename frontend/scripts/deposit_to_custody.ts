/**
 * Deposit USDC to Nitrolite Custody Contract on Base Sepolia
 * ===============================================================
 *
 * This script deposits USDC from your wallet to the Nitrolite custody contract
 * using the official Nitrolite SDK.
 *
 * Usage:
 * ```bash
 * bun run scripts/deposit_to_custody.ts 0.01
 * ```
 *
 * Prerequisites:
 * - WALLET_PRIVATE_KEY in .env (your wallet's private key)
 * - Wallet must have USDC on Base Sepolia
 * - Get test USDC: https://faucet.circle.com/ (Base Sepolia)
 */

import { NitroliteClient, WalletStateSigner } from '@erc7824/nitrolite'
import { config } from 'dotenv'
import { createWalletClient, createPublicClient, http, formatUnits, parseUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'

// USDC on Base Sepolia
const USDC_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const
const USDC_DECIMALS = 6

// Nitrolite contract addresses on Base Sepolia
const CONTRACT_ADDRESSES = {
  custody: '0x019B65A265EB3363822f2752141b3dF16131b262' as const,
  adjudicator: '0x7c7ccbc98469190849BCC6c926307794fDfB11F2' as const,
}

const BASE_SEPOLIA_CHAIN_ID = 84532

export async function main() {
  config()

  // Get amount from command line arg or env var
  const cliArg = process.argv[2]
  const envArg = process.env.DEPOSIT_AMOUNT
  const amount = cliArg || envArg || '0.01'

  const amountNum = parseFloat(amount)
  if (isNaN(amountNum) || amountNum <= 0) {
    console.error('Usage: bun run scripts/deposit_to_custody.ts <amount>')
    console.error('Example: bun run scripts/deposit_to_custody.ts 0.01')
    process.exit(1)
  }

  // Support WALLET_PRIVATE_KEY, or fall back to WALLET_1_PRIVATE_KEY
  const privateKey = process.env.WALLET_1_PRIVATE_KEY
  if (!privateKey) {
    throw new Error('WALLET_PRIVATE_KEY or WALLET_1_PRIVATE_KEY env variable is required')
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`)

  console.log(`\n═══════════════════════════════════════════════════════════`)
  console.log(`🟡 Deposit USDC to Nitrolite Custody (Base Sepolia)`)
  console.log(`═══════════════════════════════════════════════════════════\n`)

  console.log(`Wallet: ${account.address}`)
  console.log(`Chain: Base Sepolia (Chain ID: ${baseSepolia.id})`)
  console.log(`Custody: ${CONTRACT_ADDRESSES.custody}`)
  console.log(`Adjudicator: ${CONTRACT_ADDRESSES.adjudicator}\n`)

  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(),
  })

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(),
  })

  // Check USDC balance
  const balance = await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: [
      {
        name: 'balanceOf',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ name: '', type: 'uint256' }],
      },
    ],
    functionName: 'balanceOf',
    args: [account.address],
  } as any)

  console.log(`💰 USDC Balance: ${formatUnits(balance as bigint, USDC_DECIMALS)} USDC`)

  const depositAmount = parseUnits(amount, USDC_DECIMALS)

  if ((balance as bigint) < depositAmount) {
    throw new Error(
      `Insufficient USDC balance. Have ${formatUnits(balance as bigint, USDC_DECIMALS)}, need ${amount}`
    )
  }

  // Create Nitrolite client
  const nitroliteClient = new NitroliteClient({
    walletClient,
    publicClient: publicClient as any,
    stateSigner: new WalletStateSigner(walletClient),
    addresses: CONTRACT_ADDRESSES,
    chainId: BASE_SEPOLIA_CHAIN_ID,
    challengeDuration: BigInt(3600),
  })

  console.log(`\n📥 Depositing ${amount} USDC to custody...`)

  // The NitroliteClient.deposit() method handles approval and deposit
  const depositHash = await nitroliteClient.deposit(USDC_ADDRESS, depositAmount)

  console.log(`📝 Deposit TX: ${depositHash}`)

  const receipt = await publicClient.waitForTransactionReceipt({ hash: depositHash })

  console.log(`✅ Deposit confirmed in block ${receipt.blockNumber}`)

  // Check new balance
  const newBalance = await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: [
      {
        name: 'balanceOf',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ name: '', type: 'uint256' }],
      },
    ],
    functionName: 'balanceOf',
    args: [account.address],
  } as any)

  console.log(`💰 New USDC Balance: ${formatUnits(newBalance as bigint, USDC_DECIMALS)} USDC`)

  // Check custody ledger balance
  const ledgerBalances = await publicClient.readContract({
    address: CONTRACT_ADDRESSES.custody,
    abi: [
      {
        name: 'getAccountsBalances',
        type: 'function',
        stateMutability: 'view',
        inputs: [
          { name: 'accounts', type: 'address[]' },
          { name: 'tokens', type: 'address[]' },
        ],
        outputs: [{ name: '', type: 'uint256[][]' }],
      },
    ],
    functionName: 'getAccountsBalances',
    args: [[account.address], [USDC_ADDRESS]],
  } as any)

  console.log(
    `🏦 Custody Balance: ${formatUnits((ledgerBalances as any)[0][0] ?? BigInt(0), USDC_DECIMALS)} USDC`
  )

  console.log(`\n═══════════════════════════════════════════════════════════`)
  console.log(`✨ Deposit Complete!`)
  console.log(`═══════════════════════════════════════════════════════════\n`)
}

if (require.main === module) {
  main().catch((error) => {
    console.error('❌ Error:', error.message || error)
    process.exit(1)
  })
}
