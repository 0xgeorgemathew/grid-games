import { NextRequest, NextResponse } from 'next/server'
import { PrivyClient } from '@privy-io/node'
import { encodeFunctionData, parseAbi } from 'viem'

export const runtime = 'nodejs'

const privy = new PrivyClient({
  appId: process.env.NEXT_PUBLIC_PRIVY_APP_ID || process.env.PRIVY_APP_ID!,
  appSecret: process.env.PRIVY_APP_SECRET!,
})

// Environment configuration
const FAUCET_ADDRESS = (process.env.FAUCET_ADDRESS || process.env.NEXT_PUBLIC_FAUCET_ADDRESS) as `0x${string}`
const USDC_ADDRESS = (process.env.USDC_ADDRESS || process.env.NEXT_PUBLIC_USDC_ADDRESS) as `0x${string}`
const AUTHORIZATION_KEY = process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY as string | undefined
const AUTHORIZATION_KEY_ID = (process.env.PRIVY_AUTHORIZATION_KEY_ID || 'dosot9g1wi7fhmdv349o7tw3') as string

// ABIs
const FAUCET_ABI = parseAbi(['function claim() external'])
const USDC_ABI = parseAbi(['function transfer(address to, uint256 amount) external returns (bool)'])

// Claim amount: 10 USDC (6 decimals)
const CLAIM_AMOUNT = BigInt(10_000_000)

// Simple in-memory rate limiting (resets on server restart)
const claimHistory = new Map<string, { count: number; lastClaim: number }>()
const CLAIM_COOLDOWN_MS = 60 * 1000 // 1 minute between claims
const MAX_CLAIMS_PER_HOUR = 3

// State persistence for user claims (in-memory, resets on restart)
const userClaims = new Set<string>()

async function sendSponsoredTransaction(
  walletId: string,
  to: `0x${string}`,
  data: `0x${string}`
): Promise<{ hash: string }> {
  const rawKey = AUTHORIZATION_KEY?.replace(/^wallet-auth:/, '').trim()

  const params = {
    caip2: 'eip155:84532',
    params: {
      transaction: { to, data },
    },
    sponsor: true,
    ...(rawKey && {
      authorization_context: { authorization_private_keys: [rawKey] },
    }),
  }

  return await privy.wallets().ethereum().sendTransaction(walletId, params)
}

function errorResponse(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status })
}

export async function POST(req: NextRequest) {
  try {
    const { walletId, userWalletAddress, userId } = await req.json()

    if (!walletId || !userWalletAddress || !userId) {
      return errorResponse('walletId, userWalletAddress, and userId are required', 400)
    }

    // Rate limiting check
    const now = Date.now()
    const userHistory = claimHistory.get(userId)
    if (userHistory) {
      const timeSinceLastClaim = now - userHistory.lastClaim
      if (timeSinceLastClaim < CLAIM_COOLDOWN_MS) {
        const waitSeconds = Math.ceil((CLAIM_COOLDOWN_MS - timeSinceLastClaim) / 1000)
        return errorResponse(`Please wait ${waitSeconds} seconds before claiming again.`, 429)
      }
      // Check hourly limit
      const hourAgo = now - (60 * 60 * 1000)
      if (userHistory.count >= MAX_CLAIMS_PER_HOUR && userHistory.lastClaim > hourAgo) {
        return errorResponse('Hourly claim limit reached. Please try again later.', 429)
      }
    }

    // Check if user already claimed (for this server session)
    if (userClaims.has(userId)) {
      return errorResponse('You have already claimed USDC. Please log out and log back in to claim again.', 400)
    }

    // Verify sponsored wallet ownership
    const wallet = await privy.wallets().get(walletId)
    if (wallet.owner_id !== AUTHORIZATION_KEY_ID) {
      return errorResponse(
        'This wallet is not configured for sponsored transactions.',
        401,
        { needsSponsoredWallet: true, code: 'SPONSORED_WALLET_REQUIRED' }
      )
    }

    // Step 1: Claim USDC to sponsored wallet
    const claimCallData = encodeFunctionData({
      abi: FAUCET_ABI,
      functionName: 'claim',
    })

    const claimResult = await sendSponsoredTransaction(
      walletId,
      FAUCET_ADDRESS,
      claimCallData as `0x${string}`
    )

    // Step 2: Transfer USDC to user's wallet
    const transferCallData = encodeFunctionData({
      abi: USDC_ABI,
      functionName: 'transfer',
      args: [userWalletAddress as `0x${string}`, CLAIM_AMOUNT],
    })

    const transferResult = await sendSponsoredTransaction(
      walletId,
      USDC_ADDRESS,
      transferCallData as `0x${string}`
    )

    // Update rate limiting and claim state
    claimHistory.set(userId, {
      count: (userHistory?.count || 0) + 1,
      lastClaim: now,
    })
    userClaims.add(userId)

    return NextResponse.json({
      claimTx: { hash: claimResult.hash },
      transferTx: { hash: transferResult.hash },
      userWalletAddress,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : ''

    if (message.includes('rate limit') || message.includes('too many requests')) {
      return errorResponse('Rate limited. Please try again later.', 429)
    }

    if (message.includes('insufficient') || message.includes('funds')) {
      return errorResponse('Faucet is empty. Please try again later.', 503)
    }

    if (message.includes('not found') || message.includes('no wallet')) {
      return errorResponse('Wallet not found. Please login again.', 400)
    }

    if (message.includes('401') || message.includes('unauthorized')) {
      return errorResponse(
        'This wallet is not configured for sponsored transactions.',
        401,
        { needsSponsoredWallet: true, code: 'SPONSORED_WALLET_REQUIRED' }
      )
    }

    return errorResponse('Transaction failed. Please try again.', 500)
  }
}
