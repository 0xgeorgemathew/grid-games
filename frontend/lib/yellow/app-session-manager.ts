// Yellow App Session Manager
// Manages app session lifecycle: create, update, close

import type { Address } from 'viem'
import { keccak256, toHex } from 'viem'
import {
  getRPCClient,
  type AppDefinition,
  type Allocation,
  type AppStateIntent,
  type CreateAppSessionParams,
  type CreateAppSessionResponse,
  type SubmitAppStateParams,
  type SubmitAppStateResponse,
  type CloseAppSessionParams,
  type CloseAppSessionResponse,
  type AppSessionMetadata,
} from './rpc-client'
import { signWithSessionKey, type AuthenticatedSession } from './authentication'
import { YELLOW_TOKEN, YELLOW_APPLICATION_NAME } from './config'

// ============================================================================
// Types
// ============================================================================

/**
 * Game state for HFT Battle
 */
export interface HFTBattleGameState {
  game: 'hft-battle'
  mode: 'best-of-three' | 'sudden-death'
  round: number
  player1Address: string
  player2Address: string
  player1Wins: number
  player2Wins: number
  player1Score: number // Game dollars (1 dollar = 1 USDC)
  player2Score: number
  status: 'active' | 'completed'
  lastMove?: number // Timestamp of last state change
}

/**
 * App session with game state
 */
export interface GameAppSession {
  appSessionId: string
  definition: AppDefinition
  allocations: Allocation[]
  gameState: HFTBattleGameState
  status: 'open' | 'closed'
  version: number
  createdAt: number
}

/**
 * Parameters for creating a game app session
 */
export interface CreateGameSessionParams {
  player1Address: Address
  player2Address: Address
  player1Name?: string
  player2Name?: string
  stakeAmount: number // Per player (e.g., 10 USDC)
}

/**
 * Parameters for updating game state after a round
 */
export interface UpdateGameRoundParams {
  appSessionId: string
  round: number
  player1Address: Address
  player2Address: Address
  player1Score: number // Game dollars
  player2Score: number
  player1Wins: number
  player2Wins: number
  currentVersion: number
  player1Signature?: string // Pre-collected signature from player 1
  player2Signature?: string // Pre-collected signature from player 2
  jwtToken?: string // JWT for authentication (will be set in RPC client)
}

/**
 * Result of game session closure
 */
export interface GameSessionResult {
  winnerAddress: Address
  loserAddress: Address
  finalScore: { player1: number; player2: number }
  winnerPayout: string // USDC
  loserPayout: string // USDC
}

// ============================================================================
// Constants
// ============================================================================

/**
 * FIXED: Use 'application' field per NitroRPC/0.4 spec
 * The official docs use 'application', not 'application_id'
 */
const USE_APPLICATION_ID_FIELD = false

/**
 * TRIAL FIX #4: Add chain_id field to definition
 * Some Nitro implementations require chain_id or network_id in the definition
 * Set this to true to include chain_id in the app definition
 *
 * NOTE: Setting to FALSE because chain_id may be causing "failed to parse parameters" error
 */
const INCLUDE_CHAIN_ID = false // Disable - may be causing parse errors

/**
 * Chain ID for Sepolia (Yellow's sandbox uses Sepolia, not Base Sepolia)
 */
const SEPOLIA_CHAIN_ID = 11155111

/**
 * Default governance for two-player game
 * Per Yellow governance docs: weights [1, 1] with quorum 2 is valid
 * "Absolute values matter for quorum; don't need to sum to 100"
 */
export const TWO_PLAYER_GOVERNANCE = {
  weights: [1, 1], // Equal voting power
  quorum: 2, // Both must agree
  challenge: 60, // Challenge period (seconds) - reasonable for off-chain games
}

/**
 * Protocol version (use 0.4 for new sessions)
 */
export const PROTOCOL_VERSION = 'NitroRPC/0.4' as const

/**
 * Application identifier
 * Re-export from config for convenience
 */
export const APPLICATION_NAME = YELLOW_APPLICATION_NAME

// ============================================================================
// App Session Manager
// ============================================================================

/**
 * Prepare app session creation parameters (for signing)
 *
 * CRITICAL FIX (per Yellow official docs):
 * The participants array must contain MAIN WALLET ADDRESSES, not session key addresses.
 *
 * Per https://docs.yellow.org/docs/protocol/off-chain/app-sessions:
 * > "Array of all participant wallet addresses"
 *
 * The multi-party guide example shows:
 * participants: [wallet1Client.account.address, wallet2Client.account.address]
 *
 * Session keys still sign the requests, but the definition references wallet addresses.
 * This is the correct NitroRPC/0.4 protocol behavior.
 *
 * @param params - Game session creation parameters
 * @returns The CreateAppSessionParams for signing
 */
export function prepareAppSessionParams(
  params: CreateGameSessionParams & {
    player1SessionKeyAddress?: Address
    player2SessionKeyAddress?: Address
  }
): CreateAppSessionParams {
  const {
    player1Address,
    player2Address,
    stakeAmount,
    player1SessionKeyAddress,
    player2SessionKeyAddress,
  } = params

  // CRITICAL: Participants array uses MAIN WALLET ADDRESSES (per Yellow official docs)
  // Session keys sign the requests, but the app definition references wallet addresses
  const address1 = player1Address.toLowerCase()
  const address2 = player2Address.toLowerCase()

  // Sort addresses for deterministic ordering
  const sortedAddresses = [address1, address2].sort() as Address[]

  console.log(
    '[App Session] prepareAppSessionParams - Using MAIN WALLET addresses as participants (per Yellow spec):',
    {
      player1MainWallet: player1Address.toLowerCase(),
      player1SessionKey: player1SessionKeyAddress?.toLowerCase() || 'NOT PROVIDED',
      player2MainWallet: player2Address.toLowerCase(),
      player2SessionKey: player2SessionKeyAddress?.toLowerCase() || 'NOT PROVIDED',
      sortedParticipants: sortedAddresses,
      note: 'Session keys sign, but participants array uses wallet addresses',
    }
  )

  // CRITICAL FIX: Use a smaller random integer for nonce (not timestamp!)
  // Yellow's NitroRPC/0.4 parser expects nonce to be a 32-bit integer
  const nonce = Math.floor(Math.random() * 1_000_000) // 6-digit random integer

  // CRITICAL FIX: Use 'application' field, NOT 'application_id'
  const definitionBase = {
    protocol: PROTOCOL_VERSION,
    participants: sortedAddresses,
    weights: TWO_PLAYER_GOVERNANCE.weights,
    quorum: TWO_PLAYER_GOVERNANCE.quorum,
    challenge: TWO_PLAYER_GOVERNANCE.challenge,
    nonce, // Small 6-digit integer for parser compatibility
  }

  // Use either application or application_id based on setting
  let definition: AppDefinition = USE_APPLICATION_ID_FIELD
    ? ({ ...definitionBase, application_id: APPLICATION_NAME } as any)
    : { ...definitionBase, application: APPLICATION_NAME }

  if (USE_APPLICATION_ID_FIELD) {
    console.warn(
      '[App Session] WARNING: Using application_id field - this may not work with NitroRPC/0.4!'
    )
  }

  // CRITICAL FIX: Add chain_id if enabled (use Sepolia, not Base Sepolia)
  if (INCLUDE_CHAIN_ID) {
    definition = { ...definition, chain_id: SEPOLIA_CHAIN_ID } as any
    console.log(
      '[App Session] CRITICAL FIX: Added chain_id to definition:',
      SEPOLIA_CHAIN_ID,
      '(Sepolia)'
    )
  }

  // Initial allocations (both players stake)
  // CRITICAL FIX: Use HUMAN-READABLE format per Yellow official docs
  // The docs specify: "Amount in human-readable format (e.g., '100.0')"
  // NOT base units - just the token amount as a decimal string
  // CRITICAL: Allocations MUST be in the same order as participants array!
  const allocations: Allocation[] = sortedAddresses.map((participant) => ({
    participant,
    asset: YELLOW_TOKEN,
    amount: String(stakeAmount) + '.0', // Human-readable format: "10.0" for 10 tokens
  }))

  // Initial game state
  const gameState: HFTBattleGameState = {
    game: 'hft-battle',
    mode: 'best-of-three',
    round: 0,
    player1Address,
    player2Address,
    player1Wins: 0,
    player2Wins: 0,
    player1Score: 10, // Starting game dollars
    player2Score: 10,
    status: 'active',
    lastMove: Date.now(),
  }

  return {
    definition,
    allocations,
    session_data: JSON.stringify(gameState),
  }
}

/**
 * Create a new game app session
 *
 * Both players must sign the creation request using their session keys.
 *
 * @param params - Game session creation parameters
 * @param signers - Array of signer functions [player1Signer, player2Signer] in sorted order
 * @returns Created app session
 */
export async function createGameAppSession(
  params: CreateGameSessionParams & {
    player1SessionKeyAddress?: Address
    player2SessionKeyAddress?: Address
  },
  signers: Array<(message: string) => Promise<string>>
): Promise<GameAppSession> {
  const {
    player1Address,
    player2Address,
    stakeAmount,
    player1SessionKeyAddress,
    player2SessionKeyAddress,
  } = params

  console.log('[App Session] Creating game session:', {
    player1MainWallet: player1Address,
    player2MainWallet: player2Address,
    player1SessionKey: player1SessionKeyAddress || 'NOT PROVIDED',
    player2SessionKey: player2SessionKeyAddress || 'NOT PROVIDED',
    stakeAmount,
  })

  const rpcClient = getRPCClient()

  // Ensure connected
  if (!rpcClient.isConnected) {
    await rpcClient.connect()
  }

  // CRITICAL: Use MAIN WALLET ADDRESSES for participants array (per Yellow official docs)
  // Session keys sign the requests, but the app definition references wallet addresses
  const address1 = player1Address.toLowerCase()
  const address2 = player2Address.toLowerCase()

  // Sort addresses for deterministic ordering
  const sortedAddresses = [address1, address2].sort() as Address[]

  console.log(
    '[App Session] Sorted main wallet addresses for participants (per Yellow spec):',
    sortedAddresses
  )

  // CRITICAL FIX: Use a smaller random integer for nonce (not timestamp!)
  // Yellow's NitroRPC/0.4 parser expects nonce to be a 32-bit integer
  const nonce = Math.floor(Math.random() * 1_000_000) // 6-digit random integer

  // CRITICAL FIX: Use 'application' field, NOT 'application_id'
  const definitionBase = {
    protocol: PROTOCOL_VERSION,
    participants: sortedAddresses,
    weights: TWO_PLAYER_GOVERNANCE.weights,
    quorum: TWO_PLAYER_GOVERNANCE.quorum,
    challenge: TWO_PLAYER_GOVERNANCE.challenge,
    nonce, // Small 6-digit integer for parser compatibility
  }

  // Use either application or application_id based on setting
  let definition: AppDefinition = USE_APPLICATION_ID_FIELD
    ? ({ ...definitionBase, application_id: APPLICATION_NAME } as any)
    : { ...definitionBase, application: APPLICATION_NAME }

  if (USE_APPLICATION_ID_FIELD) {
    console.warn(
      '[App Session] WARNING: Using application_id field - this may not work with NitroRPC/0.4!'
    )
  }

  // CRITICAL FIX: Add chain_id if enabled (use Sepolia, not Base Sepolia)
  if (INCLUDE_CHAIN_ID) {
    definition = { ...definition, chain_id: SEPOLIA_CHAIN_ID } as any
    console.log(
      '[App Session] CRITICAL FIX: Added chain_id to definition:',
      SEPOLIA_CHAIN_ID,
      '(Sepolia)'
    )
  }

  // Initial allocations (both players stake)
  // CRITICAL FIX: Use HUMAN-READABLE format per Yellow official docs
  // The docs specify: "Amount in human-readable format (e.g., '100.0')"
  // NOT base units - just the token amount as a decimal string
  // CRITICAL: Allocations MUST be in the same order as participants array!
  const allocations: Allocation[] = sortedAddresses.map((participant) => ({
    participant,
    asset: YELLOW_TOKEN,
    amount: String(stakeAmount) + '.0', // Human-readable format: "10.0" for 10 tokens
  }))

  // Initial game state
  const gameState: HFTBattleGameState = {
    game: 'hft-battle',
    mode: 'best-of-three',
    round: 0,
    player1Address,
    player2Address,
    player1Wins: 0,
    player2Wins: 0,
    player1Score: 10, // Starting game dollars
    player2Score: 10,
    status: 'active',
    lastMove: Date.now(),
  }

  // FIXED: Using empty session_data for initial testing
  // Once participant address fix is confirmed, we can use full game state
  console.log('[App Session] Using empty session_data for initial test')
  const sessionDataString = '{}'

  const createParams: CreateAppSessionParams = {
    definition,
    allocations,
    session_data: sessionDataString,
  }

  console.log('[App Session] Sending create_app_session:', {
    definition: {
      protocol: definition.protocol,
      participants: definition.participants,
      nonce,
    },
    allocations,
    hasSigners: signers.length > 0,
  })

  // Call create_app_session with signers
  // The RPC client will build the request and have each signer sign it
  let response: CreateAppSessionResponse
  try {
    response = await rpcClient.callWithSigners<CreateAppSessionResponse>(
      'create_app_session',
      createParams,
      signers
    )
  } catch (error) {
    console.error('[App Session] create_app_session failed:', error)
    throw new Error(
      `Failed to create app session: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }

  console.log('[App Session] ✓ App session created:', {
    appSessionId: response.app_session_id,
    status: response.status,
    version: response.version,
  })

  // CRITICAL: Validate response was created with correct data
  console.log('[App Session] Validating session creation response...')
  console.log('[App Session] Session definition used:', {
    protocol: definition.protocol,
    application: definition.application,
    participants: definition.participants,
    nonce: definition.nonce,
  })

  // If we could get the full session back, we'd validate here
  // For now, ensure we log the input params for debugging
  if (!definition.application) {
    console.error('[App Session] WARNING: Definition has empty application name!')
  }
  if (!definition.participants || definition.participants.length !== 2) {
    console.error('[App Session] WARNING: Definition does not have exactly 2 participants!', {
      count: definition.participants?.length,
      participants: definition.participants,
    })
  }

  return {
    appSessionId: response.app_session_id,
    definition,
    allocations,
    gameState,
    status: response.status,
    version: response.version,
    createdAt: Date.now(),
  }
}

/**
 * Update app session state after a game round
 *
 * @param params - Round update parameters
 * @returns Updated app session
 */
export async function updateGameRound(
  params: UpdateGameRoundParams
): Promise<{ version: number; allocations: Allocation[] }> {
  const {
    appSessionId,
    round,
    player1Address,
    player2Address,
    player1Score,
    player2Score,
    player1Wins,
    player2Wins,
    currentVersion,
    jwtToken,
  } = params

  console.log('[App Session] Updating round:', {
    appSessionId: appSessionId.slice(0, 10) + '...',
    round,
    player1Score,
    player2Score,
  })

  const rpcClient = getRPCClient()

  // CRITICAL: Set JWT token before making authenticated call
  // submit_app_state requires JWT token for authentication
  if (jwtToken) {
    rpcClient.setAuthToken(jwtToken)
    console.log('[App Session] JWT token set in RPC client for submit_app_state')
  } else if (!rpcClient.hasAuthToken()) {
    console.warn(
      '[App Session] WARNING: No JWT token available for submit_app_state - call may fail'
    )
  }

  // Sort addresses
  const sortedAddresses = [
    player1Address.toLowerCase(),
    player2Address.toLowerCase(),
  ].sort() as Address[]
  const isPlayer1First = sortedAddresses[0].toLowerCase() === player1Address.toLowerCase()

  // Calculate USDC allocations based on game scores
  // Total pot is 20 USDC (10 from each player)
  const totalScore = player1Score + player2Score
  const totalPot = 20 // 20 USDC

  const player1Payout = (player1Score / totalScore) * totalPot
  const player2Payout = (player2Score / totalScore) * totalPot

  // CRITICAL FIX: Use HUMAN-READABLE format per Yellow official docs
  // The docs specify: "Amount in human-readable format (e.g., '100.0')"
  // Asset conservation: player1Payout + player2Payout should always equal totalPot (20)
  const allocations: Allocation[] = [
    {
      participant: sortedAddresses[0],
      asset: YELLOW_TOKEN,
      amount: String(isPlayer1First ? player1Payout : player2Payout),
    },
    {
      participant: sortedAddresses[1],
      asset: YELLOW_TOKEN,
      amount: String(isPlayer1First ? player2Payout : player1Payout),
    },
  ]

  // Verify asset conservation invariant (in human-readable format)
  const totalAllocated = player1Payout + player2Payout
  if (Math.abs(totalAllocated - totalPot) > 0.01) {
    console.error('[App Session] ASSET CONSERVIATION VIOLATION!', {
      totalAllocated,
      totalPot,
      difference: totalAllocated - totalPot,
    })
  } else {
    console.log('[App Session] ✓ Asset conservation verified:', {
      totalAllocated,
      totalPot,
    })
  }

  // Update game state
  const gameState: HFTBattleGameState = {
    game: 'hft-battle',
    mode: round >= 3 ? 'sudden-death' : 'best-of-three',
    round,
    player1Address,
    player2Address,
    player1Wins,
    player2Wins,
    player1Score,
    player2Score,
    status: player1Wins >= 2 || player2Wins >= 2 ? 'completed' : 'active',
    lastMove: Date.now(),
  }

  const submitParams: SubmitAppStateParams = {
    app_session_id: appSessionId,
    intent: 'OPERATE', // CRITICAL FIX: Uppercase enum value
    version: currentVersion + 1,
    allocations,
    session_data: JSON.stringify(gameState),
  }

  console.log('[App Session] Submitting state update:', {
    appSessionId: appSessionId.slice(0, 10) + '...',
    intent: 'operate',
    version: submitParams.version,
    allocations,
  })

  // CRITICAL: Signatures MUST be in the same order as participants array
  // The participants array is sorted, so we need to reorder signatures to match
  const signatures: string[] = []
  if (params.player1Signature && params.player2Signature) {
    // Put signatures in sorted order
    signatures[0] = isPlayer1First ? params.player1Signature : params.player2Signature
    signatures[1] = isPlayer1First ? params.player2Signature : params.player1Signature
  } else if (params.player1Signature || params.player2Signature) {
    // Single signature (for testing)
    signatures.push(params.player1Signature || params.player2Signature!)
  }

  let response: SubmitAppStateResponse
  try {
    response = await rpcClient.call<SubmitAppStateResponse>(
      'submit_app_state',
      submitParams,
      signatures
    )
  } catch (error) {
    console.error('[App Session] submit_app_state failed:', error)
    throw new Error(
      `Failed to update app state: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }

  console.log('[App Session] ✓ State updated:', {
    appSessionId: response.app_session_id,
    newVersion: response.version,
    status: response.status,
  })

  return {
    version: response.version,
    allocations,
  }
}

/**
 * Close game app session and distribute final winnings
 *
 * @param appSessionId - Session to close
 * @param gameState - Final game state
 * @param signatures - Closing signatures (both players)
 * @returns Close result
 */
export async function closeGameAppSession(
  appSessionId: string,
  gameState: HFTBattleGameState,
  signatures: string[]
): Promise<GameSessionResult> {
  console.log('[App Session] Closing game session:', {
    appSessionId: appSessionId.slice(0, 10) + '...',
    finalScore: { player1: gameState.player1Score, player2: gameState.player2Score },
  })

  const rpcClient = getRPCClient()

  // Determine winner
  const player1Address = gameState.player1Address as Address
  const player2Address = gameState.player2Address as Address
  const sortedAddresses = [
    player1Address.toLowerCase(),
    player2Address.toLowerCase(),
  ].sort() as Address[]
  const isPlayer1First = sortedAddresses[0].toLowerCase() === player1Address.toLowerCase()

  const player1Won = gameState.player1Wins > gameState.player2Wins
  const winnerAddress = player1Won ? player1Address : player2Address
  const loserAddress = player1Won ? player2Address : player1Address

  // Final allocations (winner takes all)
  // CRITICAL FIX: Use HUMAN-READABLE format per Yellow official docs
  // The docs specify: "Amount in human-readable format (e.g., '100.0')"
  const totalPot = 20 // 20 USDC

  const allocations: Allocation[] = [
    {
      participant: sortedAddresses[0],
      asset: YELLOW_TOKEN,
      amount: String(
        (isPlayer1First && player1Won) || (!isPlayer1First && !player1Won) ? totalPot : 0
      ),
    },
    {
      participant: sortedAddresses[1],
      asset: YELLOW_TOKEN,
      amount: String(
        (isPlayer1First && !player1Won) || (!isPlayer1First && player1Won) ? totalPot : 0
      ),
    },
  ]

  // Verify asset conservation invariant
  const totalAllocated = allocations.reduce((sum, alloc) => sum + Number(alloc.amount), 0)
  if (totalAllocated !== totalPot) {
    console.error('[App Session] ASSET CONSERVIATION VIOLATION on close!', {
      totalAllocated,
      totalPot,
      difference: totalAllocated - totalPot,
    })
  }

  // Final game state
  const finalGameState: HFTBattleGameState = {
    ...gameState,
    status: 'completed',
    lastMove: Date.now(),
  }

  const closeParams: CloseAppSessionParams = {
    app_session_id: appSessionId,
    allocations,
    session_data: JSON.stringify(finalGameState),
  }

  console.log('[App Session] Closing session:', {
    winner: winnerAddress,
    allocations,
  })

  let response: CloseAppSessionResponse
  try {
    response = await rpcClient.call<CloseAppSessionResponse>(
      'close_app_session',
      closeParams,
      signatures
    )
  } catch (error) {
    console.error('[App Session] close_app_session failed:', error)
    throw new Error(
      `Failed to close app session: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }

  console.log('[App Session] ✓ Session closed:', {
    appSessionId: response.app_session_id,
    status: response.status,
  })

  return {
    winnerAddress,
    loserAddress,
    finalScore: {
      player1: gameState.player1Score,
      player2: gameState.player2Score,
    },
    winnerPayout: totalPot.toFixed(2),
    loserPayout: '0.00',
  }
}

/**
 * Parse game state from session_data string
 */
export function parseGameState(sessionData?: string): HFTBattleGameState | null {
  if (!sessionData) return null

  try {
    return JSON.parse(sessionData) as HFTBattleGameState
  } catch (error) {
    console.error('[App Session] Failed to parse game state:', error)
    return null
  }
}

/**
 * Get app session details
 */
export async function getAppSession(
  appSessionId: string,
  authSession: AuthenticatedSession
): Promise<GameAppSession | null> {
  const rpcClient = getRPCClient()

  try {
    const response = await rpcClient.call<AppSessionMetadata>(
      'get_app_sessions',
      { app_session_ids: [appSessionId] },
      authSession.jwtToken
    )

    if (!response || !response.app_session_id) {
      return null
    }

    const gameState = parseGameState(response.session_data)

    return {
      appSessionId: response.app_session_id,
      definition: response.definition,
      allocations: response.allocations,
      gameState: gameState || {
        game: 'hft-battle',
        mode: 'best-of-three',
        round: 0,
        player1Address: '',
        player2Address: '',
        player1Wins: 0,
        player2Wins: 0,
        player1Score: 10,
        player2Score: 10,
        status: 'active',
      },
      status: response.status,
      version: response.version,
      createdAt: response.created_at || Date.now(),
    }
  } catch (error) {
    console.error('[App Session] get_app_sessions failed:', error)
    return null
  }
}

/**
 * Create a signer function for app session requests
 *
 * Returns a function that signs message strings using the session key.
 * The signer will hash the message and sign it per NitroRPC spec.
 *
 * Note: signWithSessionKey handles the hashing internally, so we pass
 * the message string directly (not pre-hashed).
 *
 * @param authSession - Authenticated session with session key
 * @returns Signer function that accepts a message string and returns a signature
 */
export function createSessionKeySigner(
  authSession: AuthenticatedSession
): (message: string) => Promise<string> {
  return async (message: string): Promise<string> => {
    // Pass the message string directly - signWithSessionKey will hash it
    return signWithSessionKey(authSession.sessionKeyPrivate, message)
  }
}

/**
 * Create a signer function for wallet signing
 *
 * Returns a function that signs message strings using the main wallet.
 * The signer hashes the message with keccak256 before signing.
 *
 * @param walletSigner - Function to sign with main wallet (accepts hash string)
 * @returns Signer function that accepts a message string and returns a signature
 */
export function createWalletSigner(
  walletSigner: (hash: string) => Promise<string>
): (message: string) => Promise<string> {
  return async (message: string): Promise<string> => {
    // Hash the message with keccak256 (Ethereum standard)
    const hash = keccak256(toHex(message))
    // Sign with wallet
    return walletSigner(hash)
  }
}
