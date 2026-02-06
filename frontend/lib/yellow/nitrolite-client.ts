// Yellow Network Nitrolite integration

import { createPublicClient, http, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { defineChain } from 'viem'
import {
  getChannelId,
  getStateHash,
  type Channel,
  type UnsignedState,
  type State,
  type Allocation,
  type ChannelId,
  Signature,
  StateIntent,
} from '@erc7824/nitrolite'
import { ENTRY_STAKE as CONFIG_ENTRY_STAKE } from './config'

// ERC20 ABI (minimal - only what we need)
const ERC20_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

// ============================================================================
// Configuration
// ============================================================================

export const YELLOW_CONFIG = {
  chainId: 84532, // Base Sepolia
  rpcUrl: process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org',
  challengeDuration: BigInt(24 * 60 * 60), // 24 hours in seconds

  // Deployed contracts from https://github.com/erc7824/nitrolite
  addresses: {
    custody: (process.env.YELLOW_CUSTODY_ADDRESS ||
      '0x019B65A265EB3363822f2752141b3dF16131b262') as Address,
    adjudicator: (process.env.YELLOW_ADJUDICATOR_ADDRESS ||
      '0x7c7ccbc98469190849BCC6c926307794fDfB11F2') as Address,
  },

  // Server private key for signing states (use environment variable in production)
  serverPrivateKey: (process.env.YELLOW_SERVER_PRIVATE_KEY ||
    '0x0000000000000000000000000000000000000000000000000000000000000000') as Hex,
} as const

// USDC on Base Sepolia
export const USDC_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const
export const USDC_DECIMALS = 6

// Entry stake from config (10 USDC = 10_000_000 with 6 decimals)
export const ENTRY_STAKE = BigInt(CONFIG_ENTRY_STAKE)

// ============================================================================
// Nitrolite Client Manager (Singleton)
// ============================================================================

let publicClient: ReturnType<typeof createPublicClient> | null = null
let serverAccount: ReturnType<typeof privateKeyToAccount> | null = null

/**
 * Initialize Nitrolite client for server-side operations
 * Call this once during server startup
 */
export function initializeNitrolite(): {
  publicClient: ReturnType<typeof createPublicClient> | null
  serverAccount: ReturnType<typeof privateKeyToAccount> | null
  configured: boolean
} {
  if (publicClient) {
    return { publicClient, serverAccount, configured: true }
  }

  // Create viem public client for Base Sepolia
  // Define chain manually to avoid type incompatibilities
  const baseSepoliaCustom = defineChain({
    id: YELLOW_CONFIG.chainId,
    name: 'Base Sepolia',
    nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      default: {
        http: [YELLOW_CONFIG.rpcUrl],
      },
    },
    blockExplorers: {
      default: { name: 'BaseScan', url: 'https://sepolia.basescan.org' },
    },
    testnet: true,
  })

  publicClient = createPublicClient({
    chain: baseSepoliaCustom,
    transport: http(),
  })

  // Create server account for signing states
  if (
    YELLOW_CONFIG.serverPrivateKey !==
    '0x0000000000000000000000000000000000000000000000000000000000000000'
  ) {
    serverAccount = privateKeyToAccount(YELLOW_CONFIG.serverPrivateKey)
  }

  const configured = isNitroliteConfigured()

  console.log('[Nitrolite] Client initialized', {
    configured,
    custody: YELLOW_CONFIG.addresses.custody,
    adjudicator: YELLOW_CONFIG.addresses.adjudicator,
    chainId: YELLOW_CONFIG.chainId,
    serverAddress: serverAccount?.address,
  })

  return { publicClient, serverAccount, configured }
}

/**
 * Get the public client instance
 */
export function getPublicClient(): ReturnType<typeof createPublicClient> | null {
  return publicClient
}

/**
 * Get the server account
 */
export function getServerAccount(): ReturnType<typeof privateKeyToAccount> | null {
  return serverAccount
}

/**
 * Check if Nitrolite is properly configured
 */
export function isNitroliteConfigured(): boolean {
  const hasRealAddresses =
    YELLOW_CONFIG.addresses.custody !== '0x0000000000000000000000000000000000000000' &&
    YELLOW_CONFIG.addresses.adjudicator !== '0x0000000000000000000000000000000000000000'

  const hasServerKey =
    YELLOW_CONFIG.serverPrivateKey !==
    '0x0000000000000000000000000000000000000000000000000000000000000000'

  return hasRealAddresses && hasServerKey
}

// ============================================================================
// Channel Operations
// ============================================================================

export interface CreateGameChannelParams {
  player1Address: string
  player2Address: string
  player1Name: string
  player2Name: string
}

export interface GameChannel {
  channelId: string
  nonce: bigint
  status: 'INITIAL' | 'ACTIVE' | 'FINAL'
  participants: string[]
  allocations: Array<{
    destination: string
    token: string
    amount: string
  }>
  version: number
  initialState: State // Server-signed initial state (per Nitrolite docs)
}

/**
 * Generate a unique nonce for channel creation.
 * Per Nitrolite docs: "nonce - a unique number to distinguish channels
 * with the same participants and adjudicator"
 *
 * Using timestamp ensures Alice & Bob get a new channel ID each game.
 */
function generateNonce(): bigint {
  return BigInt(Math.floor(Date.now() / 1000))
}

/**
 * Generate a channel ID for the game using Nitrolite's getChannelId function
 *
 * Channel ID = keccak256(participants, adjudicator, challenge, nonce, chainId)
 * - Sorted addresses ensure determinism
 * - Unique nonce ensures different channels for same participants
 */
function generateChannelId(
  player1: Address,
  player2: Address,
  adjudicator: Address,
  challengeDuration: bigint,
  nonce: bigint
): ChannelId {
  // Sort addresses for deterministic channel ID
  const sorted = [player1.toLowerCase() as Address, player2.toLowerCase() as Address].sort()

  const channel: Channel = {
    participants: sorted,
    adjudicator: adjudicator as Address,
    challenge: challengeDuration,
    nonce,
  }

  return getChannelId(channel, YELLOW_CONFIG.chainId)
}

/**
 * Sign a state with the server's private key
 */
async function signState(channelId: ChannelId, state: UnsignedState): Promise<Signature> {
  if (!serverAccount) {
    throw new Error('Server account not initialized. Set YELLOW_SERVER_PRIVATE_KEY.')
  }

  // Get the state hash
  const stateHash = getStateHash(channelId, state)

  // Sign the hash with server's private key
  const signature = await serverAccount.signMessage({
    message: { raw: stateHash },
  })

  return signature as Signature
}

/**
 * Create a new Yellow state channel for the game
 *
 * This follows the Nitrolite channel lifecycle:
 * 1. Generate unique nonce for channel ID
 * 2. Create initial state with INITIALIZE intent
 * 3. Sign the initial state with server key
 * 4. Return signed state for later verification
 *
 * Per Nitrolite docs: "Sign initial state" and "Return initial state + signature"
 */
export async function createGameChannel(params: CreateGameChannelParams): Promise<GameChannel> {
  const { player1Address, player2Address, player1Name, player2Name } = params

  if (!isNitroliteConfigured()) {
    throw new Error('Nitrolite not configured. Set YELLOW_SERVER_PRIVATE_KEY.')
  }

  // Sort addresses for deterministic ordering (required by Nitrolite)
  const sorted = [player1Address.toLowerCase(), player2Address.toLowerCase()].sort() as [
    Address,
    Address,
  ]

  // Generate unique nonce for this channel
  // Per docs: "nonce - a unique number to distinguish channels with the same participants"
  const nonce = generateNonce()

  // Generate channel ID using Nitrolite's getChannelId
  // Channel ID = keccak256(participants, adjudicator, challenge, nonce, chainId)
  const channelId = generateChannelId(
    sorted[0],
    sorted[1],
    YELLOW_CONFIG.addresses.adjudicator,
    YELLOW_CONFIG.challengeDuration,
    nonce
  )

  console.log('[Nitrolite] Channel ID generated:', {
    channelId,
    nonce,
    player1: { name: player1Name, address: sorted[0] },
    player2: { name: player2Name, address: sorted[1] },
    stakeAmount: ENTRY_STAKE.toString(),
  })

  // Create initial state with INITIALIZE intent (per Nitrolite protocol)
  const initialState: UnsignedState = {
    intent: StateIntent.INITIALIZE, // 1 = INITIALIZE (replaces CHANOPEN magic number)
    version: BigInt(0),
    data: '0x' as Hex,
    allocations: [
      {
        destination: sorted[0],
        token: USDC_ADDRESS,
        amount: ENTRY_STAKE, // 0.1 USDC each
      },
      {
        destination: sorted[1],
        token: USDC_ADDRESS,
        amount: ENTRY_STAKE,
      },
    ],
  }

  // Sign the initial state with server's private key
  // Per Nitrolite docs: "Sign initial state" is required
  const signature = await signState(channelId, initialState)

  const signedInitialState: State = {
    ...initialState,
    sigs: [signature],
  }

  console.log('[Nitrolite] Initial state signed:', {
    channelId,
    signature,
    allocations: [
      { player: sorted[0], usdc: ENTRY_STAKE.toString() },
      { player: sorted[1], usdc: ENTRY_STAKE.toString() },
    ],
  })

  return {
    channelId,
    nonce,
    status: 'INITIAL',
    participants: sorted,
    allocations: [
      {
        destination: sorted[0],
        token: USDC_ADDRESS,
        amount: ENTRY_STAKE.toString(),
      },
      {
        destination: sorted[1],
        token: USDC_ADDRESS,
        amount: ENTRY_STAKE.toString(),
      },
    ],
    version: 0,
    initialState: signedInitialState, // Server-signed initial state
  }
}

/**
 * Update channel state after game round
 * Returns a signed state that can be verified later
 */
export async function updateChannelState(params: {
  channelId: string
  player1Address: string
  player2Address: string
  player1Dollars: number
  player2Dollars: number
  version: number
}): Promise<{ signedState: State; player1Payout: bigint; player2Payout: bigint }> {
  const { player1Dollars, player2Dollars, channelId, version, player1Address, player2Address } =
    params

  if (!serverAccount) {
    throw new Error('Server account not initialized')
  }

  // Calculate payouts based on game dollars
  // Since 1 game dollar = 1 USDC and total always = 20, use direct BigInt arithmetic
  // No ratio needed - player's payout = their dollars directly
  const totalDollars = BigInt(player1Dollars + player2Dollars)
  const totalStake = ENTRY_STAKE * BigInt(2)

  const player1Payout = (BigInt(player1Dollars) * totalStake) / totalDollars
  const player2Payout = totalStake - player1Payout

  // Create updated state
  const sorted = [player1Address.toLowerCase(), player2Address.toLowerCase()].sort() as [
    Address,
    Address,
  ]
  const isPlayer1First = sorted[0].toLowerCase() === player1Address.toLowerCase()

  const updatedState: UnsignedState = {
    intent: StateIntent.OPERATE,
    version: BigInt(version),
    data: '0x' as Hex,
    allocations: [
      {
        destination: sorted[0],
        token: USDC_ADDRESS,
        amount: isPlayer1First ? player1Payout : player2Payout,
      },
      {
        destination: sorted[1],
        token: USDC_ADDRESS,
        amount: isPlayer1First ? player2Payout : player1Payout,
      },
    ],
  }

  // Sign the state with server's private key
  const signature = await signState(channelId as ChannelId, updatedState)

  const signedState: State = {
    ...updatedState,
    sigs: [signature],
  }

  console.log('[Nitrolite] State signed:', {
    channelId,
    version,
    signature,
    allocations: [
      { player: sorted[0], usdc: updatedState.allocations[0].amount.toString() },
      { player: sorted[1], usdc: updatedState.allocations[1].amount.toString() },
    ],
  })

  return { signedState, player1Payout, player2Payout }
}

/**
 * Settle channel and distribute final payouts
 * Returns a final signed state that can be submitted to the Adjudicator
 */
export async function settleChannel(params: {
  channelId: string
  player1Address: string
  player2Address: string
  player1Dollars: number
  player2Dollars: number
}): Promise<{
  finalState: State
  player1Payout: string
  player2Payout: string
  txData?: Hex
}> {
  const { player1Dollars, player2Dollars, channelId, player1Address, player2Address } = params

  console.log('[Nitrolite] settleChannel called with:', {
    channelId,
    player1Address,
    player2Address,
    player1Dollars,
    player2Dollars,
    totalDollars: player1Dollars + player2Dollars,
  })

  if (!serverAccount) {
    throw new Error('Server account not initialized')
  }

  // Since 1 game dollar = 1 USDC and total always = 20, use direct BigInt arithmetic
  const totalDollars = BigInt(player1Dollars + player2Dollars)
  const totalStake = ENTRY_STAKE * BigInt(2)

  const player1Payout = (BigInt(player1Dollars) * totalStake) / totalDollars
  const player2Payout = totalStake - player1Payout

  console.log('[Nitrolite] Calculated payouts:', {
    player1Payout: player1Payout.toString(),
    player2Payout: player2Payout.toString(),
    totalPayout: (player1Payout + player2Payout).toString(),
  })

  // Create final state
  const sorted = [
    params.player1Address.toLowerCase(),
    params.player2Address.toLowerCase(),
  ].sort() as [Address, Address]
  const isPlayer1First = sorted[0].toLowerCase() === params.player1Address.toLowerCase()

  const finalState: UnsignedState = {
    intent: StateIntent.FINALIZE,
    version: BigInt(999), // Final version
    data: '0x' as Hex,
    allocations: [
      {
        destination: sorted[0],
        token: USDC_ADDRESS,
        amount: isPlayer1First ? player1Payout : player2Payout,
      },
      {
        destination: sorted[1],
        token: USDC_ADDRESS,
        amount: isPlayer1First ? player2Payout : player1Payout,
      },
    ],
  }

  // Sign with server key
  const serverSignature = await signState(channelId as ChannelId, finalState)

  const signedFinalState: State = {
    ...finalState,
    sigs: [serverSignature],
  }

  console.log('[Nitrolite] Channel settled:', {
    channelId,
    player1Payout: player1Payout.toString(),
    player2Payout: player2Payout.toString(),
    winner:
      player1Dollars > player2Dollars
        ? 'player1'
        : player2Dollars > player1Dollars
          ? 'player2'
          : 'tie',
    serverSignature,
  })

  return {
    finalState: signedFinalState,
    player1Payout: player1Payout.toString(),
    player2Payout: player2Payout.toString(),
  }
}

/**
 * Get USDC balance for an address
 */
export async function getUSDCBalance(address: Address): Promise<bigint> {
  if (!publicClient) {
    throw new Error('Public client not initialized')
  }

  // @ts-ignore - viem ABI type compatibility issue with readonly arrays
  const balance = (await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [address],
  })) as bigint

  return balance
}

/**
 * Check if an address has enough USDC for entry stake
 */
export async function hasEnoughBalance(address: Address): Promise<boolean> {
  const balance = await getUSDCBalance(address)
  return balance >= ENTRY_STAKE
}
