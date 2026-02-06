/**
 * ENS L2 Integration Library for Grid Games
 *
 * Contract addresses and ABIs for Base Sepolia ENS L2
 */

import { createPublicClient, http, encodeFunctionData, type Address } from 'viem'
import { baseSepolia } from 'viem/chains'

// Contract addresses on Base Sepolia
export const L2_REGISTRY = '0xef46c8e7876f8a84e4b4f7e1a641fa6497bd532d' as const
export const L2_REGISTRAR = '0x85465BBfF2b825481E67A7F1C9eB309e693814E7' as const

// Public client for reading
export const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http('https://sepolia.base.org'),
})

// L2 Registrar ABI - includes reverse resolution
export const registrarAbi = [
  {
    name: 'getFullName',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [{ type: 'string' }],
  },
  {
    name: 'getName',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [{ type: 'string' }],
  },
  {
    name: 'available',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'label', type: 'string' }],
    outputs: [{ type: 'bool' }],
  },
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

// L2 Registry ABI - for text records
export const registryAbi = [
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

// Text record keys
export const LEVERAGE_KEY = 'games.grid.leverage'
export const TOTAL_GAMES_KEY = 'games.grid.total_games'
export const STREAK_KEY = 'games.grid.streak'

// Leverage options
export const LEVERAGE_OPTIONS = ['1x', '2x', '5x', '10x', '20x'] as const
export type LeverageOption = (typeof LEVERAGE_OPTIONS)[number]

// Validate username format
export function validateUsername(label: string): { isValid: boolean; error?: string } {
  if (!label) return { isValid: false, error: 'Username is required' }
  if (label.length < 3) return { isValid: false, error: 'Username must be at least 3 characters' }
  if (label.length > 32) return { isValid: false, error: 'Username must be 32 characters or less' }
  if (!/^[a-zA-Z0-9-]+$/.test(label)) {
    return { isValid: false, error: 'Username can only contain letters, numbers, and hyphens' }
  }
  if (label.startsWith('-') || label.endsWith('-')) {
    return { isValid: false, error: 'Username cannot start or end with a hyphen' }
  }
  return { isValid: true }
}

// Format ENS name for display
export function formatENSName(label: string): string {
  return `${label}.grid.eth`
}

// Encode register function call
export function encodeRegisterCall(label: string, owner: Address): `0x${string}` {
  return encodeFunctionData({
    abi: registrarAbi,
    functionName: 'register',
    args: [label.toLowerCase(), owner],
  })
}

// Encode setText function call (for leverage)
export function encodeSetTextCall(node: `0x${string}`, key: string, value: string): `0x${string}` {
  return encodeFunctionData({
    abi: registryAbi,
    functionName: 'setText',
    args: [node, key, value],
  })
}

/**
 * Encode batch setText calls for multiple text records
 * Returns array of encoded function data for use with multicall
 */
export function encodeBatchSetTextCalls(
  node: `0x${string}`,
  records: Array<{ key: string; value: string }>
): `0x${string}`[] {
  return records.map(({ key, value }) =>
    encodeFunctionData({
      abi: registryAbi,
      functionName: 'setText',
      args: [node, key, value],
    })
  )
}

/**
 * Get leverage for a wallet address from ENS text record
 * Returns numeric leverage (1, 2, 5, 10, 20) or undefined
 *
 * This function performs on-chain reads directly from the ENS registry.
 * The server uses this to determine a player's whale power-up multiplier.
 */
export async function getLeverageForAddress(address: string): Promise<number | undefined> {
  try {
    // Get ENS name from reverse resolution using the registrar
    // @ts-ignore - viem ABI type compatibility issue with readonly arrays
    const name = (await publicClient.readContract({
      address: L2_REGISTRAR,
      abi: registrarAbi,
      functionName: 'getFullName',
      args: [address as Address],
    })) as string

    if (!name) return undefined

    // Extract label from "username.grid.eth"
    const match = name.match(/^([^.]+)\.grid\.eth$/i)
    if (!match) return undefined
    const label = match[1]

    // Get base node first
    // @ts-ignore - viem ABI type compatibility issue with readonly arrays
    const baseNode = (await publicClient.readContract({
      address: L2_REGISTRY,
      abi: registryAbi,
      functionName: 'baseNode',
      args: [],
    })) as `0x${string}`

    // Make node for the label
    // @ts-ignore - viem ABI type compatibility issue with readonly arrays
    const labelNode = (await publicClient.readContract({
      address: L2_REGISTRY,
      abi: registryAbi,
      functionName: 'makeNode',
      args: [baseNode, label.toLowerCase()],
    })) as `0x${string}`

    // Get leverage text record
    // @ts-ignore - viem ABI type compatibility issue with readonly arrays
    const leverageStr = (await publicClient.readContract({
      address: L2_REGISTRY,
      abi: registryAbi,
      functionName: 'text',
      args: [labelNode, LEVERAGE_KEY],
    })) as string

    if (!leverageStr) {
      console.log(
        `[ENS] No leverage set in ENS (using default 2x): address=${address.slice(0, 6)}...${address.slice(-4)}, name=${name}`
      )
      return undefined
    }

    // Parse "5x" → 5
    const value = parseInt(leverageStr.replace('x', ''), 10)
    const finalLeverage = [1, 2, 5, 10, 20].includes(value) ? value : 2

    console.log(
      `[ENS] Leverage fetched successfully: address=${address.slice(0, 6)}...${address.slice(-4)}, name=${name}, leverage=${finalLeverage}x`
    )

    return finalLeverage
  } catch (error) {
    console.error('[ENS] Failed to get leverage:', error)
    return undefined // Default fallback handled elsewhere
  }
}
