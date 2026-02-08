// Yellow Network configuration for HFT Battle with App Sessions

// Sepolia network (Yellow's sandbox uses Sepolia, not Base Sepolia)
export const CHAIN_ID = 11155111
export const CHAIN_NAME = 'Sepolia'

// Yellow Network asset identifier
// Sandbox uses 'ytest.usd', mainnet uses 'usdc'
export const YELLOW_TOKEN = 'ytest.usd' // Sandbox test token
export const TOKEN_DECIMALS = 6

// TRIAL FIX #5: ytest.usd contract address from Yellow's assets response
// Yellow's ClearNode may expect the contract address instead of the symbol
// CRITICAL FIX: Corrected the ending (was ...7Dc, should be ...2b32DEb)
// CRITICAL FIX: ALL LOWERCASE for signature verification to match!
export const YELLOW_TOKEN_ADDRESS = '0xdb9f293e3898c9e5536a3be1b0c56c89d2b32deb' as const

// NOTE: Base Sepolia USDC (0x036CbD53842c5426634e7929541eC2318f3dCF7e) is NOT supported by Yellow ClearNode
// Yellow's sandbox provides test USDC that uses 'ytest.usd' symbol
export const USDC_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const
export const USDC_DECIMALS = 6

// Game economics
// CRITICAL: Allocation amounts use HUMAN-READABLE format per Yellow spec (e.g., "10.0")
// NOT base units - the amount as a decimal number string
export const ENTRY_STAKE = '10.0' // 10 tokens (human-readable format)
export const PER_SLICE_AMOUNT = '0.1' // 0.1 token per win/loss

// App Session configuration
export const APP_SESSION_CONFIG = {
  stakeAmount: 10, // tokens per player
  protocol: 'NitroRPC/0.4' as const,
  sessionDuration: 60 * 60 * 1000, // 1 hour
  challengePeriod: 86400, // 24 hours
  allowances: [
    { asset: YELLOW_TOKEN, amount: '100.0' }, // 100 token spending limit - auth_request expects SYMBOL
  ],
} as const

// ClearNode endpoints
export const CLEARNODE_SANDBOX = 'wss://clearnet-sandbox.yellow.com/ws'
export const CLEARNODE_MAINNET = 'wss://clearnet.yellow.com/ws'

// Yellow Network application name
// CRITICAL: This must match the application name used in authentication flow
// Session keys are authorized for a specific application name
export const YELLOW_APPLICATION_NAME = 'grid-games-hft-battle' as const

// Get ClearNode URL based on environment
export function getClearNodeUrl(): string {
  if (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_CLEARNODE_URL) {
    return process.env.NEXT_PUBLIC_CLEARNODE_URL
  }
  return CLEARNODE_SANDBOX
}
