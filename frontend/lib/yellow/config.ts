// Yellow Network configuration for HFT Battle

// Base Sepolia network
export const CHAIN_ID = 84532
export const CHAIN_NAME = 'Base Sepolia'

// USDC on Base Sepolia
export const USDC_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const
export const USDC_DECIMALS = 6

// Game economics
export const ENTRY_STAKE = '10000000' // 10 USDC (6 decimals)
export const PER_SLICE_AMOUNT = '100000' // 0.1 USDC per win/loss

// Channel configuration
export const CHANNEL_CONFIG = {
  challengeDuration: 24 * 60 * 60, // 24 hours in seconds (dispute window)
  stakeAmount: ENTRY_STAKE,
  token: USDC_ADDRESS,
} as const

// API endpoints
export const YELLOW_API = {
  createChannel: '/api/yellow/create-channel',
  deposit: '/api/yellow/deposit',
  stateUpdate: '/api/yellow/state-update',
  settle: '/api/yellow/settle',
  getChannel: '/api/yellow/channel',
} as const
