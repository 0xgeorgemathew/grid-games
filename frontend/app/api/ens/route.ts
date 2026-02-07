/**
 * ENS Registration API Route
 *
 * Handles ENS subdomain registration via sponsored transactions.
 * Follows the same pattern as claim-usdc.
 */

import { NextRequest, NextResponse } from 'next/server'
import { PrivyClient } from '@privy-io/node'
import { encodeFunctionData, keccak256, toHex, encodePacked, createPublicClient, http } from 'viem'
import { baseSepolia } from 'viem/chains'

export const runtime = 'nodejs'

const privy = new PrivyClient({
  appId: process.env.NEXT_PUBLIC_PRIVY_APP_ID || process.env.PRIVY_APP_ID!,
  appSecret: process.env.PRIVY_APP_SECRET!,
})

// Environment configuration (same as claim-usdc)
const AUTHORIZATION_KEY = process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY as string | undefined
const AUTHORIZATION_KEY_ID = (process.env.PRIVY_AUTHORIZATION_KEY_ID ||
  'dosot9g1wi7fhmdv349o7tw3') as string

// ENS Contract addresses on Base Sepolia
const L2_REGISTRAR = '0x85465BBfF2b825481E67A7F1C9eB309e693814E7' as `0x${string}`
const L2_REGISTRY = '0xef46c8e7876f8a84e4b4f7e1a641fa6497bd532d' as `0x${string}`

// ABIs
const REGISTRAR_ABI = [
  {
    name: 'register',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'label', type: 'string' },
      { name: 'owner', type: 'address' },
    ],
    outputs: [],
  },
] as const

const REGISTRY_ABI = [
  {
    name: 'setText',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
      { name: 'value', type: 'string' },
    ],
    outputs: [],
  },
] as const

// Leverage key for text records
const LEVERAGE_KEY = 'games.grid.leverage'
const TOTAL_GAMES_KEY = 'games.grid.total_games'
const STREAK_KEY = 'games.grid.streak'

// Public client for reading from ENS
const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http('https://sepolia.base.org'),
})

// Registry ABI for reading text records
const REGISTRY_READ_ABI = [
  {
    name: 'text',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
    ],
    outputs: [{ type: 'string' }],
  },
  {
    name: 'baseNode',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'bytes32' }],
  },
  {
    name: 'makeNode',
    type: 'function',
    stateMutability: 'pure',
    inputs: [
      { name: 'parentNode', type: 'bytes32' },
      { name: 'label', type: 'string' },
    ],
    outputs: [{ type: 'bytes32' }],
  },
] as const

// Registrar ABI for reverse lookup
const REGISTRAR_READ_ABI = [
  {
    name: 'getFullName',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [{ type: 'string' }],
  },
] as const

// Namehash constants for calculating node
const ETH_NODE =
  '0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae' as `0x${string}`

function getGridEthNode(): `0x${string}` {
  const gridHash = keccak256(toHex('grid'))
  return keccak256(encodePacked(['bytes32', 'bytes32'], [ETH_NODE, gridHash]))
}

function getSubdomainNode(label: string): `0x${string}` {
  const gridEthNode = getGridEthNode()
  const labelHash = keccak256(toHex(label.toLowerCase()))
  return keccak256(encodePacked(['bytes32', 'bytes32'], [gridEthNode, labelHash]))
}

// Cached sponsored wallet (singleton - same pattern as claim-usdc)
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
): Promise<string> {
  const rawKey = AUTHORIZATION_KEY?.replace(/^wallet-auth:/, '').trim()

  const params = {
    caip2: 'eip155:84532', // Base Sepolia
    params: {
      transaction: { to, data },
    },
    sponsor: true,
    ...(rawKey && {
      authorization_context: { authorization_private_keys: [rawKey] },
    }),
  }

  console.log('Sending sponsored transaction to:', to)

  const result = await privy.wallets().ethereum().sendTransaction(walletId, params)

  console.log('Privy sendTransaction result:', JSON.stringify(result, null, 2))

  // Extract hash from various possible response structures
  // Sponsored transactions use ERC-4337, so user_operation_hash is the identifier
  const hash =
    (result as { hash?: string }).hash ||
    (result as { user_operation_hash?: string }).user_operation_hash ||
    (result as { transaction_hash?: string }).transaction_hash ||
    (result as { transactionHash?: string }).transactionHash ||
    (result as { transaction_id?: string }).transaction_id ||
    ''

  if (!hash) {
    console.error('No transaction hash found in result:', result)
    throw new Error('Transaction submitted but no hash returned')
  }

  return hash
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const action = searchParams.get('action')

    if (action === 'getName') {
      // Reverse lookup: get ENS name from address
      const address = searchParams.get('address')
      if (!address) {
        return errorResponse('address is required for getName', 400)
      }

      try {
        // @ts-ignore - viem ABI type compatibility
        const name = (await publicClient.readContract({
          address: L2_REGISTRAR,
          abi: REGISTRAR_READ_ABI,
          functionName: 'getFullName',
          args: [address as `0x${string}`],
        })) as string

        return NextResponse.json({ name })
      } catch (err) {
        console.error('Error getting name from address:', err)
        return NextResponse.json({ name: null })
      }
    }

    if (action === 'getStats') {
      // Get player stats from ENS text records
      const label = searchParams.get('label')
      if (!label) {
        return errorResponse('label is required for getStats', 400)
      }

      try {
        // Get base node and make subdomain node
        // @ts-ignore - viem ABI type compatibility
        const baseNode = (await publicClient.readContract({
          address: L2_REGISTRY,
          abi: REGISTRY_READ_ABI,
          functionName: 'baseNode',
          args: [],
        })) as `0x${string}`

        // @ts-ignore - viem ABI type compatibility
        const node = (await publicClient.readContract({
          address: L2_REGISTRY,
          abi: REGISTRY_READ_ABI,
          functionName: 'makeNode',
          args: [baseNode, label.toLowerCase()],
        })) as `0x${string}`

        // Read both text records in parallel
        const [totalGamesStr, streakStr] = await Promise.all([
          // @ts-ignore
          publicClient.readContract({
            address: L2_REGISTRY,
            abi: REGISTRY_READ_ABI,
            functionName: 'text',
            args: [node, TOTAL_GAMES_KEY],
          }),
          // @ts-ignore
          publicClient.readContract({
            address: L2_REGISTRY,
            abi: REGISTRY_READ_ABI,
            functionName: 'text',
            args: [node, STREAK_KEY],
          }),
        ])

        return NextResponse.json({
          totalGames: totalGamesStr ? parseInt(totalGamesStr as string, 10) : 0,
          streak: streakStr ? parseInt(streakStr as string, 10) : 0,
        })
      } catch (err) {
        console.error('Error getting stats:', err)
        return NextResponse.json({ totalGames: 0, streak: 0 })
      }
    }

    return errorResponse('Invalid action. Use "getName" or "getStats"', 400)
  } catch (error) {
    console.error('ENS GET error:', error)
    return errorResponse('Request failed', 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const { action, userWalletAddress, userId, label, leverage } = await req.json()

    if (!userWalletAddress || !userId) {
      return errorResponse('userWalletAddress and userId are required', 400)
    }

    // Get or create the singleton sponsored wallet (exactly like claim-usdc)
    const { id: sponsoredWalletId } = await getSponsoredWallet()

    if (action === 'register') {
      // Register subdomain
      if (!label) {
        return errorResponse('label is required for registration', 400)
      }

      const normalizedLabel = label.toLowerCase()

      // Encode the register function call - owner is the USER's wallet
      const data = encodeFunctionData({
        abi: REGISTRAR_ABI,
        functionName: 'register',
        args: [normalizedLabel, userWalletAddress as `0x${string}`],
      })

      // Send sponsored transaction (gas paid by server)
      const txHash = await sendSponsoredTransaction(
        sponsoredWalletId,
        L2_REGISTRAR,
        data as `0x${string}`
      )

      return NextResponse.json({
        hash: txHash,
        label: normalizedLabel,
        userWalletAddress,
      })
    } else if (action === 'setLeverage') {
      // Set leverage text record
      if (!label || !leverage) {
        return errorResponse('label and leverage are required for setLeverage', 400)
      }

      const node = getSubdomainNode(label.toLowerCase())

      const data = encodeFunctionData({
        abi: REGISTRY_ABI,
        functionName: 'setText',
        args: [node, LEVERAGE_KEY, leverage],
      })

      // Send sponsored transaction (gas paid by server)
      const txHash = await sendSponsoredTransaction(
        sponsoredWalletId,
        L2_REGISTRY,
        data as `0x${string}`
      )

      return NextResponse.json({
        hash: txHash,
        leverage,
        userWalletAddress,
      })
    } else {
      return errorResponse('Invalid action. Use "register" or "setLeverage"', 400)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : ''

    if (message.includes('rate limit') || message.includes('too many requests')) {
      return errorResponse('Rate limited. Please try again later.', 429)
    }

    if (message.includes('insufficient') || message.includes('funds')) {
      return errorResponse('Server wallet has insufficient funds. Please contact support.', 503)
    }

    if (message.includes('not found') || message.includes('no wallet')) {
      return errorResponse('Wallet not found. Please login again.', 400)
    }

    if (message.includes('401') || message.includes('unauthorized')) {
      return errorResponse('Authorization failed. Please contact support.', 401)
    }

    console.error('ENS action error:', error)
    return errorResponse('Transaction failed. Please try again.', 500)
  }
}
