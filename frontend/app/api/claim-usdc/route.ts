import { NextRequest, NextResponse } from 'next/server'
import { PrivyClient } from '@privy-io/node'
import { encodeFunctionData, parseAbi } from 'viem'

export const runtime = 'nodejs'

const privy = new PrivyClient({
  appId: process.env.NEXT_PUBLIC_PRIVY_APP_ID || process.env.PRIVY_APP_ID!,
  appSecret: process.env.PRIVY_APP_SECRET!,
})

// Environment configuration
const FAUCET_ADDRESS = process.env.NEXT_PUBLIC_FAUCET_ADDRESS as `0x${string}`
const AUTHORIZATION_KEY = process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY as string | undefined
const AUTHORIZATION_KEY_ID = (process.env.PRIVY_AUTHORIZATION_KEY_ID ||
  'dosot9g1wi7fhmdv349o7tw3') as string

// ABIs
const FAUCET_ABI = parseAbi([
  'function claim() external',
  'function claimTo(address recipient) external',
])

// Simple in-memory rate limiting (resets on server restart)
const claimHistory = new Map<string, { count: number; lastClaim: number }>()
const CLAIM_COOLDOWN_MS = 60 * 1000 // 1 minute between claims
const MAX_CLAIMS_PER_HOUR = 3

// State persistence for user claims (in-memory, resets on restart)
const userClaims = new Set<string>()

// Cached sponsored wallet (singleton - created once per server session)
let sponsoredWallet: { id: string; address: string } | null = null

async function getSponsoredWallet(): Promise<{ id: string; address: string }> {
  if (sponsoredWallet) {
    return sponsoredWallet
  }

  // Create a single sponsored wallet owned by the authorization key
  const wallet = await privy.wallets().create({
    chain_type: 'ethereum',
    owner_id: AUTHORIZATION_KEY_ID,
  })

  sponsoredWallet = { id: wallet.id, address: wallet.address }
  return sponsoredWallet
}

function errorResponse(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status })
}

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

export async function POST(req: NextRequest) {
  try {
    const { userWalletAddress, userId } = await req.json()

    if (!userWalletAddress || !userId) {
      return errorResponse('userWalletAddress and userId are required', 400)
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
      const hourAgo = now - 60 * 60 * 1000
      if (userHistory.count >= MAX_CLAIMS_PER_HOUR && userHistory.lastClaim > hourAgo) {
        return errorResponse('Hourly claim limit reached. Please try again later.', 429)
      }
    }

    // Get or create the singleton sponsored wallet
    const { id: sponsoredWalletId } = await getSponsoredWallet()

    // Single transaction: claim directly to user's wallet using claimTo()
    const claimCallData = encodeFunctionData({
      abi: FAUCET_ABI,
      functionName: 'claimTo',
      args: [userWalletAddress as `0x${string}`],
    })

    const claimResult = await sendSponsoredTransaction(
      sponsoredWalletId,
      FAUCET_ADDRESS,
      claimCallData as `0x${string}`
    )

    // Update rate limiting and claim state
    claimHistory.set(userId, {
      count: (userHistory?.count || 0) + 1,
      lastClaim: now,
    })
    userClaims.add(userId)

    return NextResponse.json({
      claimTx: { hash: claimResult.hash },
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
      return errorResponse('Authorization failed. Please contact support.', 401)
    }

    console.error('Claim USDC error:', error)
    return errorResponse('Transaction failed. Please try again.', 500)
  }
}
