// Yellow Network Authentication Flow
// Implements auth_request -> auth_challenge -> auth_verify with EIP-712 signing

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { sign } from 'viem/accounts'
import { keccak256, toHex, recoverAddress } from 'viem'
import type { Address, Hex } from 'viem'
import {
  getRPCClient,
  type AuthRequestParams,
  type AuthChallengeResponse,
  type AuthVerifyParams,
  type AuthSessionResponse,
  type Allowance,
} from './rpc-client'
import { YELLOW_APPLICATION_NAME, APP_SESSION_CONFIG } from './config'

// ============================================================================
// Types
// ============================================================================

/**
 * EIP-712 Domain for Yellow authentication
 *
 * IMPORTANT: Yellow's auth_verify expects ONLY the `name` field.
 * Adding version/chainId causes signature hash mismatch.
 */
interface AuthDomain {
  name: string
}

/**
 * EIP-712 Policy types for authentication signature
 *
 * CRITICAL: EIP712Domain MUST be included in the types object.
 * Yellow's server verification explicitly expects it to be present.
 *
 * Based on: https://docs.yellow.org/docs/protocol/off-chain/authentication/
 */
export interface AuthTypes {
  EIP712Domain: Array<{ name: string; type: string }>
  Policy: Array<{ name: string; type: string }>
  Allowance: Array<{ name: string; type: string }>
}

/**
 * EIP-712 Policy message for authentication
 */
interface AuthPolicyMessage {
  challenge: string
  scope: string
  wallet: Address
  session_key: Address
  expires_at: number
  allowances: Allowance[]
}

/**
 * Result of authentication flow
 */
export interface AuthenticatedSession {
  address: Address // Main wallet address
  sessionKeyAddress: Address // Session key address
  sessionKeyPrivate: Hex // Session key private key (keep secret!)
  jwtToken: string // JWT for authenticated requests
  expiresAt: number // Unix ms timestamp
}

/**
 * Stored authentication parameters for re-authentication
 */
interface StoredAuthParams {
  address: Address
  sessionKeyPrivate: Hex
  sessionKeyAddress: Address
  application: string
  allowances?: Allowance[]
  scope?: string
  expiresAt: number
}

// ============================================================================
// Session Key Generation
// ============================================================================

/**
 * Generate a new session key pair using viem
 *
 * The session key is used for signing requests after authentication.
 * The private key never leaves the client.
 *
 * @returns Object with private key and address
 */
export function generateSessionKey(): {
  privateKey: Hex
  address: Address
} {
  const privateKey = generatePrivateKey()
  const account = privateKeyToAccount(privateKey)

  console.log('[Yellow Auth] Generated session key:', {
    address: account.address,
    privateKeyPrefix: privateKey.slice(0, 10) + '...',
  })

  return {
    privateKey,
    address: account.address as Address,
  }
}

// ============================================================================
// EIP-712 Typed Data
// ============================================================================

/**
 * Get EIP-712 types for authentication
 *
 * Returns the type definitions required for EIP-712 signing.
 * EIP712Domain is explicitly included as required by Yellow's verification.
 *
 * NOTE: For Privy's signTypedData, we need to exclude EIP712Domain from the
 * types passed to the wallet (Privy handles it automatically). But Yellow's
 * server-side verification expects it to be part of the complete type structure.
 */
export function getAuthTypes(): AuthTypes {
  return {
    EIP712Domain: [{ name: 'name', type: 'string' }],
    Policy: [
      { name: 'challenge', type: 'string' },
      { name: 'scope', type: 'string' },
      { name: 'wallet', type: 'address' },
      { name: 'session_key', type: 'address' },
      { name: 'expires_at', type: 'uint64' },
      { name: 'allowances', type: 'Allowance[]' },
    ],
    Allowance: [
      { name: 'asset', type: 'string' },
      { name: 'amount', type: 'string' },
    ],
  }
}

/**
 * Get EIP-712 types for wallet signing (excluding EIP712Domain)
 *
 * Wallet providers like Privy automatically handle EIP712Domain and don't
 * expect it in the types object. This function returns types without
 * EIP712Domain for passing to signTypedData functions.
 */
export function getWalletSigningTypes(): Omit<AuthTypes, 'EIP712Domain'> {
  const { EIP712Domain: _, ...walletTypes } = getAuthTypes()
  return walletTypes
}

/**
 * Get EIP-712 domain for authentication
 *
 * Yellow expects only the `name` field in the domain.
 * Adding version/chainId causes signature verification to fail.
 *
 * @param application - Application name (used as domain name)
 */
export function getAuthDomain(application: string): AuthDomain {
  return {
    name: application,
  }
}

/**
 * Create EIP-712 policy message for signing
 *
 * @param params - Auth parameters from auth_request
 * @param challenge - Challenge from auth_challenge response
 */
export function createAuthPolicyMessage(
  params: StoredAuthParams,
  challenge: string
): AuthPolicyMessage {
  // Convert milliseconds to seconds for Yellow's EIP-712 message
  const expiresAtSeconds = Math.floor(params.expiresAt / 1000)

  return {
    challenge,
    scope: params.scope || 'app.create,app.submit,transfer',
    wallet: params.address,
    session_key: params.sessionKeyAddress,
    expires_at: expiresAtSeconds, // Yellow expects seconds
    allowances: params.allowances || [],
  }
}

// ============================================================================
// Authentication Flow
// ============================================================================

/**
 * Configuration for authentication
 */
export interface AuthConfig {
  address: Address // Main wallet address
  application?: string // App identifier (default: 'grid-games')
  allowances?: Allowance[] // Optional spending limits
  scope?: string // Optional operation scope
  sessionDuration?: number // Duration in ms (default: 1 hour)
}

/**
 * Default authentication configuration
 *
 * NOTE: Application name MUST match the one used in app session creation
 * Session keys are authorized for a specific application name
 */
const DEFAULT_AUTH_CONFIG = {
  application: YELLOW_APPLICATION_NAME,
  scope: 'app.create,app.submit,transfer',
  sessionDuration: 60 * 60 * 1000, // 1 hour
  // Create mutable copy of allowances from config (APP_SESSION_CONFIG is readonly due to 'as const')
  allowances: [...APP_SESSION_CONFIG.allowances] as Allowance[],
}

/**
 * Complete authentication flow
 *
 * 1. Generate session key
 * 2. Call auth_request (public, no signature)
 * 3. Receive challenge
 * 4. Sign challenge with main wallet (EIP-712)
 * 5. Call auth_verify with signature
 * 6. Receive JWT token
 *
 * @param signTypedData - Function to sign EIP-712 data (from wallet)
 * @param config - Authentication configuration
 * @returns Authenticated session with JWT token
 *
 * @example
 * ```typescript
 * const session = await authenticate(async (domain, types, value) => {
 *   return await wallet.signTypedData({ domain, types, primaryType: 'Policy', message: value })
 * }, {
 *   address: wallet.address,
 *   application: 'my-game'
 * })
 * ```
 */
export async function authenticate(
  signTypedData: (params: {
    domain: AuthDomain
    types: AuthTypes
    primaryType: string
    message: AuthPolicyMessage
  }) => Promise<string>,
  config: AuthConfig
): Promise<AuthenticatedSession> {
  const { address } = config

  // Generate session key
  const { privateKey: sessionKeyPrivate, address: sessionKeyAddress } = generateSessionKey()

  // Prepare auth parameters
  // CRITICAL: Yellow expects expires_at as Unix timestamp in SECONDS (not milliseconds)
  // We keep milliseconds for client-side expiration checks
  const expiresAtMs = Date.now() + (config.sessionDuration || DEFAULT_AUTH_CONFIG.sessionDuration)
  const expiresAtSec = Math.floor(expiresAtMs / 1000)
  const application = config.application || DEFAULT_AUTH_CONFIG.application
  const allowances = config.allowances || DEFAULT_AUTH_CONFIG.allowances
  const scope = config.scope || DEFAULT_AUTH_CONFIG.scope

  const storedParams: StoredAuthParams = {
    address,
    sessionKeyPrivate,
    sessionKeyAddress,
    application,
    allowances,
    scope,
    expiresAt: expiresAtMs,
  }

  console.log('[Yellow Auth] ════════════════════════════════════════════════════════════════')
  console.log('[Yellow Auth] Starting authentication flow:', {
    address,
    sessionKeyAddress,
    application,
    scope,
    allowances,
    expiresAt: new Date(expiresAtMs).toISOString(),
    expiresAtUnix: expiresAtSec,
    sessionDuration: config.sessionDuration || DEFAULT_AUTH_CONFIG.sessionDuration,
    applicationNameNote:
      application === YELLOW_APPLICATION_NAME ? '✓ Matches YELLOW_APPLICATION_NAME' : '✗ MISMATCH!',
  })
  console.log('[Yellow Auth] ════════════════════════════════════════════════════════════════')

  // Step 1: auth_request (public endpoint, no signature required)
  const rpcClient = getRPCClient()

  console.log('[Yellow Auth] Step 1: auth_request - Calling public endpoint')

  const authRequestParams: AuthRequestParams = {
    address,
    session_key: sessionKeyAddress,
    application,
    allowances,
    scope,
    expires_at: expiresAtSec, // Yellow expects seconds
  }

  console.log(
    '[Yellow Auth] auth_request params (full):',
    JSON.stringify(authRequestParams, null, 2)
  )

  let challengeMessage: string
  try {
    const challengeResponse = await rpcClient.callPublic<AuthChallengeResponse>(
      'auth_request',
      authRequestParams
    )
    challengeMessage = challengeResponse.challenge_message

    console.log('[Yellow Auth] Step 2: auth_challenge received successfully')
    console.log('[Yellow Auth] Challenge details:', {
      fullChallenge: challengeMessage,
      length: challengeMessage.length,
      format: challengeMessage.startsWith('0x') ? 'hex (0x-prefixed)' : 'raw string',
      prefix: challengeMessage.slice(0, 16) + '...',
    })
  } catch (error) {
    console.error('[Yellow Auth] auth_request failed:', error)
    console.error('[Yellow Auth] Error details:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : undefined,
    })
    throw new Error(
      `Authentication request failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }

  console.log('[Yellow Auth] ════════════════════════════════════════════════════════════════')

  // Step 2: Create EIP-712 policy message
  const policyMessage = createAuthPolicyMessage(storedParams, challengeMessage)
  const domain = getAuthDomain(application)
  const types = getAuthTypes()

  console.log('[Yellow Auth] Step 3: Creating EIP-712 Policy signature')

  // Log the exact EIP-712 data being signed
  console.log('[Yellow Auth] EIP-712 Domain (JSON):', JSON.stringify(domain, null, 2))
  console.log('[Yellow Auth] EIP-712 Types (JSON):', JSON.stringify(types, null, 2))
  console.log(
    '[Yellow Auth] EIP-712 Message - Policy (JSON):',
    JSON.stringify(policyMessage, null, 2)
  )
  console.log('[Yellow Auth] Message structure breakdown:', {
    challenge: {
      value: policyMessage.challenge,
      type: typeof policyMessage.challenge,
      length: policyMessage.challenge.length,
      prefix: policyMessage.challenge.slice(0, 20) + '...',
    },
    scope: policyMessage.scope,
    wallet: policyMessage.wallet,
    session_key: policyMessage.session_key,
    expires_at: {
      value: policyMessage.expires_at,
      isoDate: new Date(policyMessage.expires_at * 1000).toISOString(),
      note: 'Unix timestamp in seconds',
    },
    allowances: policyMessage.allowances,
  })
  console.log('[Yellow Auth] ════════════════════════════════════════════════════════════════')

  // Step 3: Sign with main wallet
  let signature: string
  try {
    console.log('[Yellow Auth] Calling wallet to sign EIP-712 typed data...')
    signature = await signTypedData({
      domain,
      types,
      primaryType: 'Policy',
      message: policyMessage,
    })
  } catch (error) {
    console.error('[Yellow Auth] EIP-712 signing failed:', error)
    console.error('[Yellow Auth] Signing error details:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : undefined,
    })
    throw new Error(
      `Failed to sign authentication challenge: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }

  // Log signature details
  console.log('[Yellow Auth] Step 4: EIP-712 Signature created')
  console.log('[Yellow Auth] Signature details:', {
    fullSignature: signature,
    prefix: signature.slice(0, 10) + '...',
    length: signature.length,
    startsWith0x: signature.startsWith('0x'),
    expectedFormat: '0x + r(64 chars) + s(64 chars) + v(2 chars) = 132 chars total',
    isValidLength: signature.length === 132,
    suffix: '...' + signature.slice(-10),
  })

  // Note: Signature verification with viem is skipped for debugging
  // The signature should recover to the wallet address
  console.log('[Yellow Auth] Expected signer (wallet address):', address)
  console.log('[Yellow Auth] ════════════════════════════════════════════════════════════════')

  // Step 4: Call auth_verify with signature
  console.log('[Yellow Auth] Step 5: Sending auth_verify with signature')

  const authVerifyParams: AuthVerifyParams = {
    challenge: challengeMessage,
  }

  console.log('[Yellow Auth] auth_verify params (JSON):', JSON.stringify(authVerifyParams, null, 2))
  console.log('[Yellow Auth] Signature being sent (prefix):', signature.slice(0, 20) + '...')
  console.log('[Yellow Auth] Signature length:', signature.length)

  let authResponse: AuthSessionResponse
  try {
    authResponse = await rpcClient.call<AuthSessionResponse>(
      'auth_verify',
      authVerifyParams,
      signature
    )
  } catch (error) {
    console.error('[Yellow Auth] auth_verify failed:', error)
    console.error('[Yellow Auth] Verification error details:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : undefined,
    })
    throw new Error(
      `Authentication verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }

  if (!authResponse.success || !authResponse.jwt_token) {
    console.error('[Yellow Auth] Authentication response indicates failure:', {
      success: authResponse.success,
      hasJwt: !!authResponse.jwt_token,
      address: authResponse.address,
      session_key: authResponse.session_key,
    })
    throw new Error('Authentication failed: No JWT token received')
  }

  console.log('[Yellow Auth] Step 6: auth_verify successful!')
  console.log(
    '[Yellow Auth] Authentication response (full):',
    JSON.stringify(authResponse, null, 2)
  )
  console.log('[Yellow Auth] Session details:', {
    address: authResponse.address,
    sessionKey: authResponse.session_key,
    jwtTokenPrefix: authResponse.jwt_token.slice(0, 20) + '...',
    jwtTokenLength: authResponse.jwt_token.length,
    expiresAt: new Date(expiresAtMs).toISOString(),
    expiresInMs: expiresAtMs - Date.now(),
    expiresInMinutes: Math.floor((expiresAtMs - Date.now()) / 60000),
  })
  console.log('[Yellow Auth] ════════════════════════════════════════════════════════════════')
  console.log('[Yellow Auth] ✓ Authentication flow completed successfully')
  console.log('[Yellow Auth] ════════════════════════════════════════════════════════════════')

  return {
    address: authResponse.address as Address,
    sessionKeyAddress,
    sessionKeyPrivate,
    jwtToken: authResponse.jwt_token,
    expiresAt: expiresAtMs,
  }
}

/**
 * Re-authenticate using existing JWT token
 *
 * @param jwtToken - Existing JWT token
 * @returns Authenticated session info
 */
export async function reAuthenticate(jwtToken: string): Promise<{
  address: string
  sessionKey: string
  success: boolean
}> {
  const rpcClient = getRPCClient()

  console.log('[Yellow Auth] Re-authenticating with existing JWT')

  const response = await rpcClient.call<AuthSessionResponse>('auth_verify', { jwt: jwtToken })

  if (!response.success) {
    throw new Error('Re-authentication failed: JWT token invalid or expired')
  }

  console.log('[Yellow Auth] ✓ Re-authentication successful')

  return {
    address: response.address,
    sessionKey: response.session_key,
    success: true,
  }
}

/**
 * Sign a request with session key
 *
 * After authentication, use the session key to sign subsequent requests.
 * This function follows the NitroRPC spec:
 * 1. Takes the exact message string (JSON payload)
 * 2. Hashes it with keccak256
 * 3. Signs the hash using ECDSA
 *
 * @param sessionKeyPrivate - Session key private key
 * @param message - Message string to hash and sign
 * @returns ECDSA signature (hex format with 0x prefix)
 */
export async function signWithSessionKey(sessionKeyPrivate: Hex, message: string): Promise<string> {
  console.log('[Yellow Auth] ════════════════════════════════════════════════════════════════')
  console.log('[Yellow Auth] signWithSessionKey - Creating session key signature')
  console.log('[Yellow Auth] Input details:', {
    sessionKeyPrivatePrefix: sessionKeyPrivate.slice(0, 10) + '...',
    messageLength: message.length,
    messagePrefix: message.slice(0, 100) + '...',
    messageSuffix: '...' + message.slice(-50),
  })

  const account = privateKeyToAccount(sessionKeyPrivate)

  // Hash the exact message string bytes (NitroRPC spec)
  const hash = keccak256(toHex(message))

  console.log('[Yellow Auth] Message hashed (keccak256):', {
    hash,
    hashLength: hash.length,
    sessionKeyAddress: account.address,
  })

  // Sign the hash directly using viem's sign utility
  // This produces a standard ECDSA signature (r, s, v) that can be recovered
  console.log('[Yellow Auth] Signing hash with session key...')
  const signature = await sign({
    hash,
    privateKey: sessionKeyPrivate,
    to: 'hex', // Get signature as hex string
  })

  console.log('[Yellow Auth] Session key signature created:', {
    signature,
    signaturePrefix: signature.slice(0, 10) + '...',
    signatureLength: signature.length,
    signatureSuffix: '...' + signature.slice(-10),
    expectedFormat: '0x + r(64) + s(64) + v(2) = 132 chars',
    isValidLength: signature.length === 132,
  })

  // Verify the signature can be recovered to the session key address
  // This helps catch signature format issues early
  try {
    const recoveredAddress = await recoverAddress({
      hash,
      signature,
    })
    const matches = recoveredAddress.toLowerCase() === account.address.toLowerCase()
    console.log('[Yellow Auth] Signature verification:', {
      expectedAddress: account.address,
      recoveredAddress,
      matches,
      status: matches ? '✓ VALID' : '✗ INVALID',
    })

    if (!matches) {
      console.error('[Yellow Auth] WARNING: Signature does not recover to session key address!')
    }
  } catch (error) {
    console.error('[Yellow Auth] Signature verification failed:', error)
  }

  console.log('[Yellow Auth] ════════════════════════════════════════════════════════════════')

  return signature
}

/**
 * Check if a session is expired
 */
export function isSessionExpired(expiresAt: number): boolean {
  return Date.now() >= expiresAt
}

/**
 * Get remaining time for session in milliseconds
 */
export function getSessionTimeRemaining(expiresAt: number): number {
  return Math.max(0, expiresAt - Date.now())
}

/**
 * Format session duration for display
 */
export function formatSessionDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`
  }
  return `${seconds}s`
}
