/**
 * Check ENS Username API Route
 *
 * Checks if a wallet address has claimed a grid.eth subdomain
 * using registrar.getFullName(address) for reverse resolution.
 * Uses ethers.js for compatibility.
 */

import { NextRequest, NextResponse } from 'next/server'
import { ethers } from 'ethers'

export const runtime = 'nodejs'

// Base Sepolia RPC
const BASE_SEPOLIA_RPC = 'https://sepolia.base.org'

// ENS Contract on Base Sepolia (new registrar with getFullName)
const L2_REGISTRAR = '0x85465BBfF2b825481E67A7F1C9eB309e693814E7'

// Registrar ABI for reverse resolution
const REGISTRAR_ABI = ['function getFullName(address addr) view returns (string)']

// Create provider
function getProvider() {
  return new ethers.JsonRpcProvider(BASE_SEPOLIA_RPC)
}

interface CheckUsernameRequest {
  walletAddress: string
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CheckUsernameRequest
    const { walletAddress } = body

    if (!walletAddress) {
      return NextResponse.json({ error: 'Missing walletAddress' }, { status: 400 })
    }

    // Validate address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 })
    }

    try {
      const provider = getProvider()
      const contract = new ethers.Contract(L2_REGISTRAR, REGISTRAR_ABI, provider)

      // Call getFullName for reverse resolution
      const fullName = await contract.getFullName(walletAddress)

      // console.log(`getFullName(${walletAddress}) = "${fullName}"`)

      if (fullName && fullName.length > 0) {
        // Extract label from "player1.grid.eth" → "player1"
        const label = fullName.split('.')[0]

        return NextResponse.json({
          walletAddress,
          username: label,
          fullName,
          hasUsername: true,
        })
      }
    } catch (contractError) {
      console.error('Error calling getFullName:', contractError)
      // Continue - may not have a name
    }

    // No username found
    return NextResponse.json({
      walletAddress,
      username: null,
      fullName: null,
      hasUsername: false,
    })
  } catch (error) {
    console.error('Check username error:', error)
    return NextResponse.json(
      { error: 'Failed to check username', username: null, hasUsername: false },
      { status: 500 }
    )
  }
}
