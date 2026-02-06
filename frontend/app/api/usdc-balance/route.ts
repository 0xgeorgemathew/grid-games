import { NextRequest, NextResponse } from 'next/server'
import { createPublicClient, http } from 'viem'
import { baseSepolia } from 'viem/chains'
import { USDC_ADDRESS } from '@/lib/yellow/config'

export const runtime = 'nodejs'

// Public client for Base Sepolia
const client = createPublicClient({
  chain: baseSepolia,
  transport: http(),
})

interface BalanceRequest {
  walletAddress: string
}

// ERC20 balanceOf function signature: balanceOf(address) returns uint256
const BALANCE_OF_SELECTOR = '0x70a08231' // First 4 bytes of keccak256("balanceOf(address)")

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as BalanceRequest
    const { walletAddress } = body

    if (!walletAddress) {
      return NextResponse.json({ error: 'Missing walletAddress' }, { status: 400 })
    }

    // Validate address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 })
    }

    // Encode call data for balanceOf(address)
    // Remove 0x and pad to 64 characters (32 bytes)
    const cleanAddress = walletAddress.toLowerCase().replace('0x', '').padStart(64, '0')
    const callData = `${BALANCE_OF_SELECTOR}${cleanAddress}` as `0x${string}`

    // Call USDC contract
    const result = await client.call({
      account: USDC_ADDRESS,
      data: callData,
      to: USDC_ADDRESS,
    })

    // Convert hex to bigint
    const balanceBigInt = BigInt(result.data as `0x${string}`)

    return NextResponse.json({
      walletAddress,
      balance: balanceBigInt.toString(),
      formatted: (Number(balanceBigInt) / 1_000_000).toFixed(2), // 6 decimals
      symbol: 'USDC',
    })
  } catch (error) {
    console.error('Balance check error:', error)
    return NextResponse.json({ error: 'Failed to check balance', balance: '0' }, { status: 500 })
  }
}
