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

// Text record key for leverage
export const LEVERAGE_KEY = 'games.grid.leverage'

// Leverage options
export const LEVERAGE_OPTIONS = ['1x', '2x', '5x', '10x', '20x'] as const
export type LeverageOption = typeof LEVERAGE_OPTIONS[number]

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
