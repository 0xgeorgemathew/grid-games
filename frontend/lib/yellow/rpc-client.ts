// Yellow Network RPC WebSocket client for App Sessions
// Implements full communication with ClearNode for off-chain state management

import type { Address, Hex } from 'viem'
import { ethers } from 'ethers'

/**
 * Stable JSON stringify that preserves insertion order.
 *
 * CRITICAL: Yellow's ClearNode verifies signatures by hashing the exact JSON string
 * that was received. The JSON.stringify() function already preserves insertion order
 * for object keys in modern JavaScript engines (ES2015+), so we don't need to sort.
 *
 * The key order for create_app_session must be:
 * - definition (first - initializes session context)
 * - allocations (second - depends on definition)
 * - session_data (third - optional session state)
 *
 * @param obj - Any JSON-serializable value
 * @returns JSON string with preserved insertion order
 */
export function stableStringify(obj: unknown): string {
  // JSON.stringify preserves insertion order in modern JS engines
  // We don't sort keys to maintain the correct order for Yellow's parser
  return JSON.stringify(obj)
}

/**
 * Yellow ClearNode WebSocket URLs
 */
export const CLEARNODE_SANDBOX = 'wss://clearnet-sandbox.yellow.com/ws'
export const CLEARNODE_MAINNET = 'wss://clearnet.yellow.com/ws'

/**
 * Get the appropriate ClearNode URL based on environment
 */
export function getClearNodeUrl(): string {
  if (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_CLEARNODE_URL) {
    return process.env.NEXT_PUBLIC_CLEARNODE_URL
  }
  return CLEARNODE_SANDBOX
}

// ============================================================================
// Types
// ============================================================================

export type YellowRpcMethod =
  | 'auth_request'
  | 'auth_verify'
  | 'create_app_session'
  | 'submit_app_state'
  | 'close_app_session'
  | 'get_app_sessions'
  | 'get_balance'
  | 'get_unified_balance'

export interface YellowRpcRequest {
  req: [number, string, unknown, number]
  sig?: string[]
  jwt?: string // JWT at envelope level for authentication required methods
}

/**
 * Yellow RPC Response format per NitroRPC/0.4 spec:
 * Single: { "res": [requestId, method, result/error, timestamp], "sig": [...] }
 * Batch:  { "res": [[requestId, method, result/error, timestamp], ...], "sig": [...] }
 *
 * Note: The response includes the method name as the second element,
 * unlike the request which has params as third element.
 */
export interface YellowRpcResponse {
  res:
    | Array<[number, string, unknown | { error: string; code?: number }, number]>
    | [number, string, unknown | { error: string; code?: number }, number]
  sig?: string[]
}

/**
 * Extract result from Yellow RPC response
 *
 * Handles NitroRPC/0.4 response format: [requestId, method, result, timestamp]
 *
 * @param response - Full response from ClearNode
 * @param id - Request ID to find
 * @returns Result data
 * @throws Error if request not found or response contains error
 */
export function extractRpcResult<T>(response: YellowRpcResponse, id: number): T {
  const res = response.res

  // Normalize to batch array format for both single and batch responses
  // Check if res[0] is an array (batch format: [[id, method, result, timestamp], ...])
  // or if res is a single response (format: [id, method, result, timestamp])
  const batch = Array.isArray(res[0])
    ? (res as Array<[number, string, unknown, number]>)
    : ([res] as [number, string, unknown, number][])

  const resultPair = batch.find(([rId]) => rId === id)
  if (!resultPair) {
    throw new Error(`No response found for request id ${id}`)
  }

  // Response format: [requestId, method, result, timestamp]
  // We skip the method name (index 1) and get result (index 2)
  const [, , resultOrError] = resultPair
  if (typeof resultOrError === 'object' && resultOrError !== null && 'error' in resultOrError) {
    throw new Error(String(resultOrError.error))
  }

  return resultOrError as T
}

export interface AuthRequestParams {
  address: string
  session_key: string
  application: string
  allowances?: Allowance[]
  scope?: string
  expires_at: number
}

export interface Allowance {
  asset: string
  amount: string
}

export interface AuthChallengeResponse {
  challenge_message: string
}

export interface AuthVerifyParams {
  challenge: string
  jwt?: string
}

export interface AuthSessionResponse {
  address: string
  session_key: string
  jwt_token: string
  success: boolean
}

export interface AppDefinition {
  protocol: 'NitroRPC/0.2' | 'NitroRPC/0.4'
  participants: string[]
  weights: number[]
  quorum: number
  challenge: number
  nonce: number
  application?: string
  application_id?: string // Alternative field name (some docs use this)
  chain_id?: number // TRIAL FIX #4: Some sandbox environments require chain ID
  network_id?: string // Alternative chain identifier
}

export interface Allocation {
  participant: string
  asset: string
  amount: string
}

export type AppStateIntent = 'OPERATE' | 'DEPOSIT' | 'WITHDRAW' | 'operate' | 'deposit' | 'withdraw'

export interface CreateAppSessionParams {
  definition: AppDefinition
  allocations: Allocation[]
  session_data?: string
}

export interface CreateAppSessionResponse {
  app_session_id: string
  status: 'open' | 'closed'
  version: number
}

export interface SubmitAppStateParams {
  app_session_id: string
  intent?: AppStateIntent
  version: number
  allocations: Allocation[]
  session_data?: string
}

export interface SubmitAppStateResponse {
  app_session_id: string
  version: number
  status: 'open' | 'closed'
}

export interface CloseAppSessionParams {
  app_session_id: string
  allocations: Allocation[]
  session_data?: string
}

export interface CloseAppSessionResponse {
  app_session_id: string
  status: 'closed'
  version: number
}

export interface AppSessionMetadata {
  app_session_id: string
  definition: AppDefinition
  allocations: Allocation[]
  session_data?: string
  status: 'open' | 'closed'
  version: number
  created_at?: number
  updated_at?: number
}

export interface BalanceResponse {
  account: string
  asset: string
  available: string
  custodied: string
  total: string
}

export interface UnifiedBalanceResponse {
  account: string
  balances: BalanceResponse[]
}

export interface AuthenticatedSession {
  address: Address
  sessionKeyAddress: Address
  sessionKeyPrivate: Hex
  jwtToken: string
  expiresAt: number
}

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'shutdown'

interface PendingRequest {
  resolve: (response: YellowRpcResponse) => void
  reject: (error: Error) => void
  timestamp: number
  method: string
}

export class YellowRPCClient {
  private ws: WebSocket | null = null
  private messageId = 0
  private pendingRequests = new Map<number, PendingRequest>()
  private connectionState: ConnectionState = 'disconnected'
  private reconnectTimeout: NodeJS.Timeout | null = null
  private notificationHandlers = new Map<string, Set<(data: unknown) => void>>()

  // Store JWT token for re-authentication after reconnection
  private jwtToken: string | null = null
  private isReconnecting: boolean = false
  // Track consecutive connection failures to stop infinite retry loops
  private consecutiveFailures = 0
  private readonly MAX_CONSECUTIVE_FAILURES = 3

  // For authentication with private key (like Nitrolite client)
  private authPrivateKey?: string
  private serverSessionKeyAddress?: string  // Server's session key for Yellow authentication
  private isAuthenticated = false
  private authMessageId = 0
  private authPendingRequests = new Map<number, { resolve: () => void; reject: (error: Error) => void }>()

  constructor(private url: string = getClearNodeUrl(), private privateKey?: string) {
    this.authPrivateKey = privateKey
  }

  /**
   * Set private key for authentication
   */
  setPrivateKey(privateKey: string): void {
    this.authPrivateKey = privateKey
  }

  /**
   * Store the JWT token for re-authentication
   * This is called after successful auth_verify
   */
  setAuthToken(jwt: string): void {
    this.jwtToken = jwt
    console.log('[Yellow RPC] Auth token stored for reconnection')
  }

  /**
   * Clear the stored JWT token
   */
  clearAuthToken(): void {
    this.jwtToken = null
    console.log('[Yellow RPC] Auth token cleared')
  }

  /**
   * Check if we have an auth token
   */
  hasAuthToken(): boolean {
    return this.jwtToken !== null
  }

  /**
   * Get the stored JWT token
   */
  getAuthToken(): string | null {
    return this.jwtToken
  }

  /**
   * Force re-authentication with the stored private key.
   * This is useful when the JWT token may have been overwritten (e.g., by client-side auth)
   * and the server needs to authenticate with its own credentials.
   *
   * @throws Error if no private key is available
   */
  async forceReauthenticate(): Promise<void> {
    if (!this.authPrivateKey) {
      throw new Error('No private key available for server authentication')
    }
    console.log('[Yellow RPC] Force re-authenticating with server private key...')
    await this.authenticateWithPrivateKey()
    console.log('[Yellow RPC] ✓ Server re-authentication complete')
  }

  /**
   * Clear the JWT token to force sending a request without authentication.
   * This is useful for operations like create_app_session that rely on participant
   * signatures rather than JWT authentication.
   */
  clearJwtForRequest(): void {
    const previousJwt = this.jwtToken
    this.jwtToken = null
    console.log('[Yellow RPC] JWT cleared for this request (was:', !!previousJwt, ')')
  }

  async connect(): Promise<void> {
    if (this.connectionState === 'connected') {
      return
    }

    if (this.connectionState === 'shutdown') {
      throw new Error('Client is shutdown. Create a new instance.')
    }

    if (this.connectionState === 'connecting') {
      // Wait for connection attempt to complete
      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (this.connectionState !== 'connecting') {
            clearInterval(checkInterval)
            resolve()
          }
        }, 100)
      })
      // After waiting, check final connection state
      // Type assertion: after setInterval callback, state is no longer 'connecting'
      if ((this.connectionState as 'disconnected' | 'connected' | 'shutdown') === 'connected') {
        return
      }
      throw new Error('Connection failed')
    }

    this.connectionState = 'connecting'

    return new Promise((resolve, reject) => {
      try {
        console.log('[Yellow RPC] Connecting to ClearNode:', this.url)

        this.ws = new WebSocket(this.url)

        const connectTimeout = setTimeout(() => {
          this.connectionState = 'disconnected'
          reject(new Error('RPC connection timeout (10s)'))
        }, 10000)

        this.ws.onopen = async () => {
          clearTimeout(connectTimeout)
          this.connectionState = 'connected'
          this.consecutiveFailures = 0 // Reset failure counter on successful connection
          console.log('[Yellow RPC] Connected to ClearNode')

          try {
            // CRITICAL: Authenticate with private key if provided (for create_app_session)
            // This uses the same flow as Nitrolite client: auth_request -> auth_challenge -> auth_verify
            if (this.authPrivateKey) {
              console.log('[Yellow RPC] Authenticating with private key...')
              await this.authenticateWithPrivateKey()
              console.log('[Yellow RPC] ✓ Authentication successful')
            }
            // CRITICAL: After reconnection, re-authenticate with JWT token
            // Yellow's ClearNode loses session key registration on disconnect
            else if (this.isReconnecting && this.jwtToken) {
              console.log('[Yellow RPC] Re-authenticating with JWT token after reconnection...')
              try {
                await this.reauthenticateWithJwt()
                console.log('[Yellow RPC] ✓ Re-authentication successful')
              } catch (error) {
                console.error('[Yellow RPC] Re-authentication failed:', error)
                // Continue anyway - some requests might still work
              }
            }
          } catch (error) {
            console.error('[Yellow RPC] Authentication failed:', error)
            // Don't reject connection - allow unauthenticated connection for some operations
          }
          this.isReconnecting = false

          resolve()
        }

        this.ws.onerror = (event) => {
          clearTimeout(connectTimeout)
          this.connectionState = 'disconnected'
          this.consecutiveFailures++
          console.error('[Yellow RPC] Connection error:', event)
          console.error(`[Yellow RPC] Consecutive failures: ${this.consecutiveFailures}/${this.MAX_CONSECUTIVE_FAILURES}`)
          reject(new Error(`RPC connection error: ${event}`))
        }

        this.ws.onclose = () => {
          console.log('[Yellow RPC] Connection closed')
          const wasShutdown = this.connectionState === 'shutdown'
          this.connectionState = 'disconnected'

          // Stop retrying after too many consecutive failures (service likely down)
          if (!wasShutdown && this.consecutiveFailures < this.MAX_CONSECUTIVE_FAILURES) {
            this.isReconnecting = true
            this.reconnectTimeout = setTimeout(() => {
              console.log('[Yellow RPC] Attempting reconnect...')
              this.connect().catch((err) => {
                console.error('[Yellow RPC] Reconnect failed:', err)
              })
            }, 5000)
          } else if (this.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
            console.error('[Yellow RPC] Max consecutive failures reached. Stopping reconnection attempts.')
            console.error('[Yellow RPC] Yellow ClearNode service may be down. Please check status.')
          }

          for (const [id, pending] of this.pendingRequests) {
            pending.reject(new Error('Connection closed'))
          }
          this.pendingRequests.clear()
        }

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data)
        }
      } catch (error) {
        this.connectionState = 'disconnected'
        reject(error)
      }
    })
  }

  /**
   * Authenticate with private key using auth_request and auth_verify
   * This is required for create_app_session to work
   *
   * Flow:
   * 1. Send auth_request with signed params
   * 2. Receive auth_challenge with challenge message
   * 3. Sign EIP-712 typed data with challenge
   * 4. Send auth_verify with EIP-712 signature
   * 5. Receive auth_verify response with JWT token
   */
  async authenticateWithPrivateKey(): Promise<void> {
    if (!this.authPrivateKey || !this.ws) {
      throw new Error('No private key available for authentication')
    }

    const wallet = new ethers.Wallet(this.authPrivateKey)
    const address = wallet.address.toLowerCase()
    const APP_DOMAIN = 'grid-games-hft-battle'

    // Generate a session key for the server (one-time, stored for future use)
    if (!this.serverSessionKeyAddress) {
      const sessionKeyWallet = ethers.Wallet.createRandom()
      this.serverSessionKeyAddress = sessionKeyWallet.address.toLowerCase()
      console.log('[Yellow RPC] Generated server session key:', this.serverSessionKeyAddress)
    }

    // Use a dedicated map for authentication to avoid conflict with pendingRequests
    const authPromise = new Promise<void>((resolve, reject) => {
      // Combined timeout for entire auth flow (request + challenge + verify)
      const overallTimeout = setTimeout(() => {
        this.authPendingRequests.delete(this.authMessageId)
        reject(new Error('Authentication timeout (30s)'))
      }, 30000)

      // Step 1: Send auth_request
      const requestId1 = this.messageId++
      const timestamp1 = Math.floor(Date.now() / 1000)
      const authRequestParams = {
        address: address.toLowerCase(),
        session_key: this.serverSessionKeyAddress,  // Use generated session key, not wallet address
        application: APP_DOMAIN,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        scope: 'app.create,app.submit,transfer',
        allowances: [{ asset: 'ytest.usd', amount: '100.0' }],
      }

      // Sign the params
      const messageString = JSON.stringify(authRequestParams)
      const digest = ethers.id(messageString)
      const messageBytes = ethers.getBytes(digest)
      const { serialized: signature } = wallet.signingKey.sign(messageBytes)

      const authRequest = {
        req: [requestId1, 'auth_request', authRequestParams, timestamp1],
        sig: [signature],
      }

      console.log('[Yellow RPC] Sending auth_request:', { requestId: requestId1 })

      // Store the resolve/reject for the auth flow (will be called in handleAuthVerify)
      this.authMessageId = requestId1
      this.authPendingRequests.set(requestId1, {
        resolve: () => {
          clearTimeout(overallTimeout)
          console.log('[Yellow RPC] Authentication flow completed successfully')
          resolve()
        },
        reject: (error: Error) => {
          clearTimeout(overallTimeout)
          console.error('[Yellow RPC] Authentication flow failed:', error)
          reject(error)
        },
      })

      this.ws.send(stableStringify(authRequest))
    })

    return authPromise
  }

  /**
   * Re-authenticate with stored JWT token after reconnection
   * This is called automatically after WebSocket reconnects
   */
  private async reauthenticateWithJwt(): Promise<void> {
    if (!this.jwtToken) {
      throw new Error('No JWT token available for re-authentication')
    }

    const id = ++this.messageId
    const timestamp = Date.now()

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error('Re-authentication timeout (10s)'))
      }, 10000)

      this.pendingRequests.set(id, {
        resolve: (response) => {
          clearTimeout(timeout)
          try {
            const result = extractRpcResult<{ success: boolean }>(response, id)
            if (result.success) {
              console.log('[Yellow RPC] ✓ Re-authentication with JWT successful')
              resolve()
            } else {
              reject(new Error('Re-authentication failed'))
            }
          } catch (error) {
            reject(error)
          }
        },
        reject: (error) => {
          clearTimeout(timeout)
          reject(error)
        },
        timestamp,
        method: 'auth_verify',
      })

      const request: YellowRpcRequest = {
        req: [id, 'auth_verify', { jwt: this.jwtToken }, timestamp],
      }

      console.log('[Yellow RPC] Sending re-authentication with JWT')

      this.ws?.send(stableStringify(request))
    })
  }

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data)

      // Log all incoming messages for debugging
      const hasReq = !!(message as { req?: unknown }).req
      const hasRes = !!(message as { res?: unknown }).res
      const hasNot = !!(message as { not?: unknown }).not

      console.log('[Yellow RPC] Raw message received:', {
        hasReq,
        hasRes,
        hasNot,
        preview: JSON.stringify(message).slice(0, 500),
      })

      // Enhanced logging for auth methods
      if (hasRes) {
        const res = (message as { res: unknown }).res
        if (Array.isArray(res)) {
          // Check if batch or single format
          if (res.length > 0 && Array.isArray(res[0])) {
            // Batch format
            for (const item of res) {
              if (Array.isArray(item) && item.length >= 2) {
                const [, method] = item
                if (
                  method === 'auth_request' ||
                  method === 'auth_verify' ||
                  method === 'create_app_session'
                ) {
                  console.log(
                    `[Yellow RPC] ${method} response (full):`,
                    JSON.stringify(message, null, 2)
                  )
                }
              }
            }
          } else if (res.length >= 2) {
            // Single format
            const [, method] = res
            if (
              method === 'auth_request' ||
              method === 'auth_verify' ||
              method === 'create_app_session'
            ) {
              console.log(
                `[Yellow RPC] ${method} response (full):`,
                JSON.stringify(message, null, 2)
              )
            }
          }
        }
      }

      const notification = (message as { not?: [string, unknown, number] }).not
      if (notification) {
        const [type, notifData] = notification
        this.handleNotification(type, notifData)
        return
      }

      // Handle auth_challenge and auth_verify responses for private key authentication
      // These are routed through authPendingRequests instead of pendingRequests
      if (message.res && Array.isArray(message.res)) {
        const res = message.res
        // Single format: [id, method, result, timestamp]
        if (!Array.isArray(res[0]) && res.length >= 3) {
          const [id, method, result] = res
          // Check auth_pending_requests first for auth-related messages
          if (method === 'auth_challenge' || method === 'auth_verify') {
            const authPending = this.authPendingRequests.get(id as number)
            if (authPending) {
              console.log(`[Yellow RPC] Received ${method} for auth flow`)
              if (method === 'auth_challenge') {
                this.handleAuthChallenge(message, id as number)
              } else if (method === 'auth_verify') {
                this.handleAuthVerify(message, id as number)
              }
              return
            }
            // Also check if this is an auth_challenge for an auth_request that's still pending
            if (method === 'auth_challenge' && this.authPendingRequests.has(id as number)) {
              console.log('[Yellow RPC] Received auth_challenge for auth_request')
              this.handleAuthChallenge(message, id as number)
              return
            }
          }
        }
      }

      // ClearNode sends an initial assets message that's not an array
      // Format: { res: [0, "assets", { assets: [...] }, timestamp] }
      // The first element is a numeric ID, second is method name, third is data
      if (!message.res || !Array.isArray(message.res)) {
        console.log('[Yellow RPC] Non-response message (ignoring):', data.slice(0, 200))
        return
      }

      console.log('[Yellow RPC] Processing response array, length:', message.res.length)

      // Detect format: batch (array of arrays) vs single (flat array)
      // Batch: [[id, method, result, timestamp], ...]
      // Single: [id, method, result, timestamp]
      const isBatchFormat = message.res.length > 0 && Array.isArray(message.res[0])

      if (isBatchFormat) {
        // Batch format: [[id, method, result, timestamp], ...]
        console.log('[Yellow RPC] Detected batch response format')
        for (const responseItem of message.res) {
          if (Array.isArray(responseItem) && responseItem.length >= 2) {
            const [id, method] = responseItem
            const pending = this.pendingRequests.get(id as number)

            console.log('[Yellow RPC] Response item (batch):', {
              id,
              method,
              hasPending: !!pending,
            })

            if (pending) {
              console.log('[Yellow RPC] Matching response found (batch):', {
                id,
                method,
                pendingMethod: pending.method,
              })
              this.pendingRequests.delete(id as number)
              pending.resolve(message)
            }
          }
        }
      } else if (message.res.length >= 2) {
        // Single response format: [id, method, result, timestamp]
        const [id, method] = message.res
        const pending = this.pendingRequests.get(id as number)

        console.log('[Yellow RPC] Response item (single):', {
          id,
          method,
          hasPending: !!pending,
        })

        if (pending) {
          console.log('[Yellow RPC] Matching response found (single):', {
            id,
            method,
            pendingMethod: pending.method,
          })
          this.pendingRequests.delete(id as number)
          pending.resolve(message)
        }
      }
    } catch (error) {
      console.log('[Yellow RPC] Unparseable message (ignoring):', data.slice(0, 200))
    }
  }

  /**
   * Handle auth_challenge response during private key authentication
   */
  private async handleAuthChallenge(message: any, originalRequestId: number): Promise<void> {
    if (!this.authPrivateKey || !this.ws) {
      return
    }

    try {
      const res = message.res
      const result = res[2] // Third element is the result
      // Yellow uses snake_case: challenge_message
      const challenge = result?.[0]?.challenge_message || result?.challenge_message || result?.challengeMessage

      if (!challenge) {
        console.error('[Yellow RPC] No challenge in auth_challenge response')
        console.error('[Yellow RPC] Result structure:', JSON.stringify(result, null, 2))
        // Reject the original auth promise
        const pending = this.authPendingRequests.get(originalRequestId)
        if (pending) {
          this.authPendingRequests.delete(originalRequestId)
          pending.reject(new Error('No challenge in auth_challenge response'))
        }
        return
      }

      console.log('[Yellow RPC] Received auth_challenge:', challenge?.substring(0, 20) + '...')

      const wallet = new ethers.Wallet(this.authPrivateKey)
      const APP_DOMAIN = 'grid-games-hft-battle'

      // Create EIP-712 signature - must match client-side format exactly
      // Domain: only 'name' field, no 'version' (critical for Yellow verification)
      const eip712Domain = {
        name: APP_DOMAIN,
        // No 'version' or 'chainId' - adding these causes signature verification to fail
      }

      const policyMessage = {
        challenge,
        scope: 'app.create,app.submit,transfer',
        wallet: wallet.address.toLowerCase(),
        session_key: this.serverSessionKeyAddress || wallet.address.toLowerCase(),
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        allowances: [{ asset: 'ytest.usd', amount: '100.0' }],
      }

      // Types must match the exact format Yellow expects
      const eip712Types = {
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

      console.log('[Yellow RPC] Server EIP-712 signing:', {
        domain: eip712Domain,
        types: eip712Types,
        message: policyMessage,
      })

      const eip712Signature = await wallet.signTypedData(
        eip712Domain,
        eip712Types,
        policyMessage
      )

      // Send auth_verify - use a new request ID
      const verifyRequestId = this.messageId++
      const timestamp = Math.floor(Date.now() / 1000)

      // auth_verify params should only contain the challenge (matching client-side pattern)
      const authVerifyParams = {
        challenge,  // Just the challenge string, signature goes in sig field
      }

      // Sign the params
      const messageString = JSON.stringify(authVerifyParams)
      const digest = ethers.id(messageString)
      const messageBytes = ethers.getBytes(digest)
      const { serialized: signature } = wallet.signingKey.sign(messageBytes)

      const authVerify = {
        req: [verifyRequestId, 'auth_verify', authVerifyParams, timestamp],  // No array wrapper
        sig: [eip712Signature],  // The EIP-712 signature goes here, not the params signature
      }

      console.log('[Yellow RPC] Sending auth_verify...')

      // Store the original request ID with the verify request ID for callback
      this.authPendingRequests.set(verifyRequestId, {
        resolve: () => {
          // This will be called by handleAuthVerify when we get the response
          // Then resolve the original auth_request promise
          const originalPending = this.authPendingRequests.get(originalRequestId)
          if (originalPending) {
            this.authPendingRequests.delete(originalRequestId)
            originalPending.resolve()
          }
        },
        reject: (error: Error) => {
          const originalPending = this.authPendingRequests.get(originalRequestId)
          if (originalPending) {
            this.authPendingRequests.delete(originalRequestId)
            originalPending.reject(error)
          }
        },
      })

      this.ws.send(stableStringify(authVerify))
    } catch (error) {
      console.error('[Yellow RPC] Error handling auth_challenge:', error)
      const pending = this.authPendingRequests.get(originalRequestId)
      if (pending) {
        this.authPendingRequests.delete(originalRequestId)
        pending.reject(error as Error)
      }
    }
  }

  /**
   * Handle auth_verify response
   * Called when we receive the auth_verify response after sending the EIP-712 signature
   */
  private handleAuthVerify(message: any, requestId: number): void {
    try {
      const res = message.res
      const result = res[2] // Third element is the result
      const success = result?.[0]?.success ?? result?.success

      console.log('[Yellow RPC] Received auth_verify response:', { success })

      if (success) {
        this.isAuthenticated = true
        const jwtToken = result?.[0]?.jwtToken ?? result?.jwtToken
        if (jwtToken) {
          this.jwtToken = jwtToken
          console.log('[Yellow RPC] ✓ JWT token stored')
        }
        console.log('[Yellow RPC] ✓ Authentication successful')
      } else {
        console.error('[Yellow RPC] Authentication failed - success was false/undefined')
        const pending = this.authPendingRequests.get(requestId)
        if (pending) {
          this.authPendingRequests.delete(requestId)
          pending.reject(new Error('Authentication failed'))
        }
        return
      }

      // Resolve the pending auth_verify request (which will resolve the original auth_request)
      const pending = this.authPendingRequests.get(requestId)
      if (pending) {
        this.authPendingRequests.delete(requestId)
        pending.resolve()
      }
    } catch (error) {
      console.error('[Yellow RPC] Error handling auth_verify:', error)
      const pending = this.authPendingRequests.get(requestId)
      if (pending) {
        this.authPendingRequests.delete(requestId)
        pending.reject(error as Error)
      }
    }
  }

  private handleNotification(type: string, data: unknown): void {
    console.log('[Yellow RPC] Notification:', type, data)

    // Special handling for ASU (App Session Update) notifications
    // These are sent when the opponent submits a state update
    if (type === 'asu') {
      console.log('[Yellow RPC] ════════════════════════════════════════════════════════════════')
      console.log('[Yellow RPC] ★★ App Session Update (ASU) received ★★')
      console.log('[Yellow RPC] ASU data:', JSON.stringify(data, null, 2))
      console.log('[Yellow RPC] ════════════════════════════════════════════════════════════════')
    }

    const handlers = this.notificationHandlers.get(type)
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data)
        } catch (error) {
          console.error('[Yellow RPC] Notification handler error:', error)
        }
      }
    }
  }

  on(notificationType: string, handler: (data: unknown) => void): () => void {
    if (!this.notificationHandlers.has(notificationType)) {
      this.notificationHandlers.set(notificationType, new Set())
    }
    this.notificationHandlers.get(notificationType)!.add(handler)

    return () => {
      const handlers = this.notificationHandlers.get(notificationType)
      if (handlers) {
        handlers.delete(handler)
      }
    }
  }

  async callPublic<T = unknown>(method: string, params: unknown = {}): Promise<T> {
    return this.call(method, params, undefined)
  }

  async call<T = unknown>(
    method: string,
    params: unknown = {},
    signatures?: string | string[],
    options?: { requestId?: number; timestamp?: number }
  ): Promise<T> {
    if (this.connectionState !== 'connected') {
      await this.connect()
    }

    // Allow custom requestId and timestamp for signatures to match
    // This is critical for app session creation where multiple parties sign the same request
    const id = options?.requestId !== undefined ? options.requestId : ++this.messageId
    const timestamp = options?.timestamp !== undefined ? options.timestamp : Date.now()

    // If using custom requestId, don't increment messageId
    if (options?.requestId === undefined) {
      this.messageId = id
    }

    // CRITICAL: For authenticated methods, JWT is handled at envelope level only
    // Yellow's ClearNode expects JWT token at envelope level, NOT in params
    // This matches the NitroRPC specification: jwt is a sibling to req/sig, not inside req
    // NOTE: create_app_session DOES require JWT, but it must be from the caller (server),
    // not from participants. The server must authenticate with its own private key.
    const needsAuth = ['submit_app_state', 'close_app_session', 'get_app_sessions', 'create_app_session'].includes(method)

    // JWT is NOT added to params - params remain as-is for signing
    // TRIAL FIX: Don't wrap create_app_session params
    // The NitroRPC/0.4 spec might expect params directly for create_app_session
    // For other methods, params are passed directly.
    // NOTE: Callers should now wrap params in array if needed
    const finalParams = params

    const sigArray = typeof signatures === 'string' ? [signatures] : signatures

    // CRITICAL: Verify sig array before building request
    console.log(`[Yellow RPC] ${method} - Building request with signatures:`, {
      hasSignatures: !!signatures,
      signaturesType: typeof signatures,
      sigArrayLength: sigArray?.length || 0,
      sigArrayContents: sigArray?.map((s, i) => ({
        index: i,
        prefix: s.slice(0, 10),
        length: s.length,
      })),
      // Check the condition
      condition: sigArray && sigArray.length > 0,
      willIncludeSig: !!(sigArray && sigArray.length > 0),
    })

    // Build request WITHOUT conditional spread first to debug
    const request: YellowRpcRequest = {
      req: [id, method, finalParams, timestamp],
    }

    // Add sig field ONLY if we have signatures
    if (sigArray && sigArray.length > 0) {
      console.log(
        `[Yellow RPC] ${method} - Adding sig field to request with ${sigArray.length} signatures`
      )
      request.sig = sigArray
    } else {
      console.warn(`[Yellow RPC] ${method} - WARNING: No signatures to include!`)
    }

    // CRITICAL: Add JWT at envelope level for authenticated methods
    // JWT is a sibling to req/sig in the NitroRPC envelope, NOT inside params
    // This matches Yellow's API specification for submit_app_state, close_app_session, etc.
    console.log(`[Yellow RPC] ${method} - JWT check:`, {
      needsAuth,
      hasJwtToken: !!this.jwtToken,
      jwtTokenPrefix: this.jwtToken ? this.jwtToken.slice(0, 30) + '...' : 'none',
    })
    if (needsAuth && this.jwtToken) {
      request.jwt = this.jwtToken
      console.log(`[Yellow RPC] ${method} - Adding JWT at envelope level for authentication`, {
        jwtLength: this.jwtToken.length,
        jwtPrefix: this.jwtToken.slice(0, 20) + '...',
      })
    } else if (needsAuth && !this.jwtToken) {
      console.error(`[Yellow RPC] ${method} - ERROR: needsAuth=true but no JWT token available!`)
    }

    // Verify the request has the sig field and JWT
    console.log(`[Yellow RPC] ${method} - Request built:`, {
      hasReq: !!request.req,
      hasSig: !!request.sig,
      hasJwt: !!request.jwt,
      sigCount: request.sig?.length || 0,
      reqId: request.req[0],
      // Log the actual sig array
      sigArray: request.sig?.map((s: string) => ({ prefix: s.slice(0, 10), length: s.length })),
    })

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`RPC timeout: ${method} (30s)`))
      }, 30000)

      this.pendingRequests.set(id, {
        resolve: (response) => {
          clearTimeout(timeout)

          // Enhanced response logging
          const isAuthMethod =
            method === 'auth_request' || method === 'auth_verify' || method === 'create_app_session'

          if (isAuthMethod) {
            console.log(
              `[Yellow RPC] ${method} - Received response (full):`,
              JSON.stringify(response, null, 2)
            )
          } else {
            console.log('[Yellow RPC] Received response:', {
              id,
              method,
              response: JSON.stringify(response).slice(0, 500),
            })
          }

          // Log error details if present
          try {
            const batch = Array.isArray(response.res[0])
              ? (response.res as Array<[number, string, unknown, number]>)
              : ([response.res] as [number, string, unknown, number][])

            const matchingResponse = batch.find(([rId]) => rId === id)
            if (matchingResponse) {
              const [rId, respMethod, resultOrError, respTimestamp] = matchingResponse

              if (isAuthMethod) {
                console.log(`[Yellow RPC] ${method} - Response details:`, {
                  id: rId,
                  method: respMethod,
                  resultType: typeof resultOrError,
                  resultKeys:
                    typeof resultOrError === 'object' && resultOrError !== null
                      ? Object.keys(resultOrError)
                      : 'N/A',
                  timestamp: respTimestamp,
                  timestampAsDate: new Date(respTimestamp).toISOString(),
                })

                // CRITICAL: Log error immediately for create_app_session
                if (
                  method === 'create_app_session' &&
                  typeof resultOrError === 'object' &&
                  resultOrError !== null &&
                  'error' in resultOrError
                ) {
                  console.error(
                    `[Yellow RPC] ════════════════════════════════════════════════════════════════`
                  )
                  console.error(`[Yellow RPC] ★★ create_app_session FAILED! ★★`)
                  console.error(`[Yellow RPC] Error:`, (resultOrError as { error: string }).error)
                  console.error(
                    `[Yellow RPC] Full error object:`,
                    JSON.stringify(resultOrError, null, 2)
                  )
                  console.error(
                    `[Yellow RPC] ════════════════════════════════════════════════════════════════`
                  )
                }
              } else {
                console.log('[Yellow RPC] Response details:', {
                  id: rId,
                  method: respMethod,
                  resultType: typeof resultOrError,
                  timestamp: respTimestamp,
                })
              }

              if (
                typeof resultOrError === 'object' &&
                resultOrError !== null &&
                'error' in resultOrError
              ) {
                const errorObj = resultOrError as {
                  error: string
                  code?: number
                  [key: string]: unknown
                }
                console.error(`[Yellow RPC] ${method} - ERROR in response:`, errorObj.error)
                console.error(
                  `[Yellow RPC] ${method} - Full error object:`,
                  JSON.stringify(errorObj, null, 2)
                )
                if (errorObj.code) {
                  console.error(`[Yellow RPC] ${method} - Error code:`, errorObj.code)
                }
              }
            }
          } catch (e) {
            // Error parsing failed, continue with normal flow
          }

          try {
            const result = extractRpcResult<T>(response, id)
            resolve(result)
          } catch (error) {
            reject(error)
          }
        },
        reject: (error) => {
          clearTimeout(timeout)
          reject(error)
        },
        timestamp,
        method,
      })

      const requestJson = stableStringify(request)

      // Enhanced logging for auth methods
      const isAuthMethod =
        method === 'auth_request' || method === 'auth_verify' || method === 'create_app_session'
      const needsAuthMethod =
        method === 'submit_app_state' ||
        method === 'close_app_session' ||
        method === 'get_app_sessions'

      if (needsAuthMethod) {
        // CRITICAL: Log the exact request being sent for JWT-authenticated methods
        console.log(`[Yellow RPC] ════════════════════════════════════════════════════════════════`)
        console.log(`[Yellow RPC] Sending ${method} request (JWT-authenticated):`)
        console.log(`[Yellow RPC] Full request JSON:`, requestJson)
        console.log(`[Yellow RPC] Request structure:`, {
          hasReq: !!request.req,
          hasSig: !!request.sig,
          hasJwt: !!request.jwt,
          jwtPrefix: request.jwt ? request.jwt.slice(0, 30) + '...' : 'MISSING!',
          sigCount: request.sig?.length || 0,
          requestKeys: Object.keys(request),
          requestId: request.req[0],
        })
        console.log(`[Yellow RPC] ════════════════════════════════════════════════════════════════`)
      }

      if (isAuthMethod) {
        // CRITICAL: Log the exact payload that signatures should have signed
        const expectedSignedPayload = JSON.stringify([id, method, finalParams, timestamp])
        console.log(`[Yellow RPC] Sending ${method} request (full):`, {
          id,
          method,
          fullRequestJson: requestJson,
          parsedRequest: request,
          params: JSON.stringify(finalParams, null, 2),
          signatureDetails: sigArray
            ? {
                count: sigArray.length,
                signatures: sigArray.map((sig, idx) => ({
                  index: idx,
                  prefix: sig?.slice(0, 10),
                  length: sig?.length,
                })),
              }
            : 'none',
          // Log the exact payload that signatures should have signed
          payloadThatWasSigned: expectedSignedPayload,
          payloadLength: expectedSignedPayload.length,
          timestamp,
          timestampAsDate: new Date(timestamp).toISOString(),
          hasJwt: !!(finalParams as { jwt?: string }).jwt,
        })

        // Log participants array from params for create_app_session
        if (method === 'create_app_session') {
          // CRITICAL: finalParams is wrapped in an array for create_app_session
          // The structure is: [{ definition: {...}, allocations: [...], session_data: "..." }]
          // This matches NitroRPC/0.4 spec where create_app_session accepts array of session objects
          const paramsArray = finalParams as unknown[]
          const paramsObj = paramsArray[0] as { definition?: { participants?: string[] } }
          console.log('[Yellow RPC] create_app_session participants:', {
            participants: paramsObj?.definition?.participants,
            participantsCount: paramsObj?.definition?.participants?.length,
            signatureCount: sigArray?.length || 0,
            finalParamsIsArray: Array.isArray(finalParams),
            finalParamsLength: (finalParams as unknown[]).length,
            signatureArrayOrder: sigArray?.map((sig, idx) => ({
              index: idx,
              prefix: sig.slice(0, 10),
              forParticipant: paramsObj?.definition?.participants?.[idx],
            })),
          })

          // SMOKING GUN DEBUG for create_app_session
          console.log(
            '[Yellow RPC] ════════════════════════════════════════════════════════════════'
          )
          console.log('[Yellow RPC] CRITICAL DEBUG - RAW JSON SENDING TO YELLOW CLEARNODE:')
          console.log(requestJson)
          console.log(
            '[Yellow RPC] ════════════════════════════════════════════════════════════════'
          )

          // Parse and validate the params
          try {
            const parsed = JSON.parse(requestJson) as { req: unknown[] }
            const reqArray = parsed.req
            if (Array.isArray(reqArray) && reqArray.length >= 3) {
              const reqParams = reqArray[2] as unknown[]
              if (Array.isArray(reqParams) && reqParams.length > 0) {
                const createParams = reqParams[0] as {
                  definition?: unknown
                  allocations?: unknown
                  session_data?: string
                }
                console.log('[Yellow RPC] CRITICAL DEBUG - PARAMS VALIDATION:')
                console.log(
                  '[Yellow RPC]   definition:',
                  JSON.stringify(createParams.definition, null, 2)
                )
                console.log(
                  '[Yellow RPC]   definition.application:',
                  (createParams.definition as { application?: string })?.application
                )
                console.log(
                  '[Yellow RPC]   definition.application_id (TRIAL FIX #1):',
                  (createParams.definition as { application_id?: string })?.application_id
                )
                console.log(
                  '[Yellow RPC]   definition.chain_id (TRIAL FIX #4):',
                  (createParams.definition as { chain_id?: number })?.chain_id
                )
                console.log(
                  '[Yellow RPC]   definition.participants:',
                  (createParams.definition as { participants?: string[] })?.participants
                )
                console.log(
                  '[Yellow RPC]   definition.challenge (type):',
                  typeof (createParams.definition as { challenge?: number })?.challenge,
                  (createParams.definition as { challenge?: number })?.challenge
                )
                console.log(
                  '[Yellow RPC]   definition.nonce (type):',
                  typeof (createParams.definition as { nonce?: number })?.nonce,
                  (createParams.definition as { nonce?: number })?.nonce
                )
                console.log(
                  '[Yellow RPC]   definition.quorum (type):',
                  typeof (createParams.definition as { quorum?: number })?.quorum,
                  (createParams.definition as { quorum?: number })?.quorum
                )
                console.log(
                  '[Yellow RPC]   allocations:',
                  JSON.stringify(createParams.allocations, null, 2)
                )
                console.log('[Yellow RPC]   session_data:', createParams.session_data)
                console.log(
                  '[Yellow RPC]   session_data length:',
                  createParams.session_data?.length
                )

                // Check for undefined/null critical fields
                const hasApplication = !!(createParams.definition as { application?: string })
                  ?.application
                const hasApplicationId = !!(createParams.definition as { application_id?: string })
                  ?.application_id
                const hasChainId = !!(createParams.definition as { chain_id?: number })?.chain_id

                console.log('[Yellow RPC]   TRIAL FIXES STATUS:', {
                  hasApplication,
                  hasApplicationId,
                  hasChainId,
                  fix1_using_application_id: hasApplicationId && !hasApplication,
                  fix4_has_chain_id: hasChainId,
                })

                if (!hasApplication && !hasApplicationId) {
                  console.error(
                    '[Yellow RPC] ERROR: Neither definition.application nor definition.application_id is present!'
                  )
                }
                const participants = (createParams.definition as { participants?: string[] })
                  ?.participants
                if (!participants || participants.length !== 2) {
                  console.error('[Yellow RPC] ERROR: definition.participants is INVALID!', {
                    length: participants?.length,
                    participants,
                  })
                }
              }
            }
          } catch (e) {
            console.error('[Yellow RPC] CRITICAL DEBUG - JSON PARSE FAILED:', e)
          }
        }
      } else {
        console.log('[Yellow RPC] Sending request:', {
          id,
          method,
          params: JSON.stringify(finalParams).slice(0, 200),
          hasSignature: !!signatures,
          hasJwt: !!request.jwt, // Check the actual request object, not params!
          jwtPrefix: request.jwt ? request.jwt.slice(0, 20) + '...' : 'none',
          requestKeys: Object.keys(request),
        })
      }

      // FINAL CHECK: Log the exact JSON being sent for authenticated methods
      if (needsAuthMethod) {
        const parsedRequest = JSON.parse(requestJson) as { req: unknown[]; jwt?: string }
        console.log(`[Yellow RPC] ═════════ FINAL SEND CHECK ═══════════`)
        console.log(`[Yellow RPC] ${method} - About to send to Yellow ClearNode:`)
        console.log(`[Yellow RPC] Request has JWT field:`, 'jwt' in parsedRequest)
        console.log(
          `[Yellow RPC] Request JWT value:`,
          parsedRequest.jwt ? parsedRequest.jwt.slice(0, 30) + '...' : 'MISSING!'
        )
        console.log(`[Yellow RPC] Request keys:`, Object.keys(parsedRequest))
        console.log(`[Yellow RPC] ═════════════════════════════════════`)
      }

      this.ws?.send(requestJson)
    })
  }

  /**
   * Call with session key signing (follows NitroRPC spec exactly)
   *
   * This method follows the NitroRPC spec:
   * 1. Builds the request with id, method, params (object), timestamp
   * 2. Signs the exact request structure that will be sent
   * 3. Includes the signature in the request
   *
   * @param method - RPC method name
   * @param params - Request parameters (single object, NOT wrapped in array)
   * @param signers - Array of signer functions (one per signature required)
   * @returns Response data
   */
  async callWithSigners<T = unknown>(
    method: string,
    params: unknown,
    signers: Array<(message: string) => Promise<string>>
  ): Promise<T> {
    console.log('[Yellow RPC] ════════════════════════════════════════════════════════════════')
    console.log(`[Yellow RPC] callWithSigners - Starting signed call for ${method}`)

    if (this.connectionState !== 'connected') {
      console.log('[Yellow RPC] Not connected, connecting...')
      await this.connect()
    }

    const id = ++this.messageId
    const timestamp = Date.now()

    // Build the payload array [id, method, params, timestamp]
    // TRIAL FIX: Don't wrap create_app_session params - pass them directly
    // The NitroRPC/0.4 spec expects params directly for create_app_session
    // IMPORTANT: Callers should wrap params in array if needed
    const finalParams = params

    // This is what gets signed - NOT the full { req: [...] } object!
    const payload = [id, method, finalParams, timestamp] as [number, string, unknown, number]

    // Sign the payload array (JSON stringified, NOT wrapped in { req: ... })
    const payloadString = JSON.stringify(payload)

    console.log('[Yellow RPC] callWithSigners - Payload to sign:', {
      method,
      id,
      timestamp,
      timestampAsDate: new Date(timestamp).toISOString(),
      payloadString,
      payloadLength: payloadString.length,
      params: JSON.stringify(params, null, 2),
    })

    const signatures = await Promise.all(
      signers.map(async (signer, index) => {
        console.log(
          `[Yellow RPC] callWithSigners - Creating signature ${index + 1}/${signers.length}`
        )
        const sig = await signer(payloadString)
        console.log(`[Yellow RPC] callWithSigners - Signature ${index + 1} created:`, {
          prefix: sig.slice(0, 10) + '...',
          length: sig.length,
          suffix: '...' + sig.slice(-10),
        })
        return sig
      })
    )

    // Build the final request with signatures
    const request: YellowRpcRequest = {
      req: payload,
      sig: signatures,
    }

    console.log('[Yellow RPC] callWithSigners - Request built with signatures:', {
      signatureCount: signatures.length,
      requestId: id,
    })

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`RPC timeout: ${method} (30s)`))
      }, 30000)

      this.pendingRequests.set(id, {
        resolve: (response) => {
          clearTimeout(timeout)
          console.log(`[Yellow RPC] callWithSigners - ${method} response received`)
          try {
            const result = extractRpcResult<T>(response, id)
            console.log(`[Yellow RPC] callWithSigners - ${method} completed successfully`)
            resolve(result)
          } catch (error) {
            console.error(
              `[Yellow RPC] callWithSigners - ${method} result extraction failed:`,
              error
            )
            reject(error)
          }
        },
        reject: (error) => {
          clearTimeout(timeout)
          console.error(`[Yellow RPC] callWithSigners - ${method} rejected:`, error)
          reject(error)
        },
        timestamp,
        method,
      })

      const requestJson = stableStringify(request)

      const isAuthMethod =
        method === 'auth_request' || method === 'auth_verify' || method === 'create_app_session'

      if (isAuthMethod) {
        console.log(`[Yellow RPC] callWithSigners - Sending ${method} request (full):`, {
          id,
          method,
          fullRequest: requestJson,
          params: JSON.stringify(params, null, 2),
          signatureCount: signatures.length,
          signatures: signatures.map((sig, idx) => ({
            index: idx,
            prefix: sig.slice(0, 10),
            length: sig.length,
          })),
        })
      } else {
        console.log('[Yellow RPC] callWithSigners - Sending signed request:', {
          id,
          method,
          params: JSON.stringify(params).slice(0, 200),
          signatureCount: signatures.length,
        })
      }

      console.log('[Yellow RPC] ════════════════════════════════════════════════════════════════')
      console.log(`[Yellow RPC] ★★ SENDING TO WEBSOCKET ★★`)
      console.log(`[Yellow RPC] Target URL: ${this.url}`)
      console.log(`[Yellow RPC] Request object:`, request)
      console.log(
        `[Yellow RPC] Has sig field?`,
        !!request.sig,
        `Sig count:`,
        request.sig?.length || 0
      )

      // CRITICAL: Show the exact JSON that will be sent
      console.log(`[Yellow RPC] Full request JSON (not truncated):`)
      console.log(requestJson) // Log without truncation

      console.log(`[Yellow RPC] Request structure:`, {
        hasReq: !!request.req,
        hasSig: !!request.sig,
        reqId: request.req?.[0],
        reqMethod: request.req?.[1],
        sigCount: request.sig?.length || 0,
        sigPrefixes: request.sig?.map((s: string) => s.slice(0, 10)),
        // Show if sig is in the JSON
        hasSigInJson: requestJson.includes('"sig":'),
      })
      console.log('[Yellow RPC] ════════════════════════════════════════════════════════════════')

      // SMOKING GUN DEBUG: Log the exact JSON for copy-paste validation
      console.log('[Yellow RPC] CRITICAL DEBUG - RAW JSON SENDING:')
      console.log(requestJson)

      // Also log a parsed version to verify JSON is valid
      try {
        const parsed = JSON.parse(requestJson)
        console.log('[Yellow RPC] CRITICAL DEBUG - PARSED BACK:')
        console.log(JSON.stringify(parsed, null, 2))

        // Check for any undefined or null values in critical fields
        const reqArray = parsed.req
        if (Array.isArray(reqArray) && reqArray.length >= 3) {
          const params = reqArray[2]
          if (Array.isArray(params) && params.length > 0) {
            const createParams = params[0]
            console.log('[Yellow RPC] CRITICAL DEBUG - PARAMS VALIDATION:')
            console.log(
              '[Yellow RPC]   definition:',
              JSON.stringify(createParams.definition, null, 2)
            )
            console.log(
              '[Yellow RPC]   definition.application:',
              createParams.definition?.application
            )
            console.log(
              '[Yellow RPC]   definition.participants:',
              createParams.definition?.participants
            )
            console.log(
              '[Yellow RPC]   definition.challenge (type):',
              typeof createParams.definition?.challenge,
              createParams.definition?.challenge
            )
            console.log(
              '[Yellow RPC]   definition.nonce (type):',
              typeof createParams.definition?.nonce,
              createParams.definition?.nonce
            )
            console.log(
              '[Yellow RPC]   definition.quorum (type):',
              typeof createParams.definition?.quorum,
              createParams.definition?.quorum
            )
            console.log(
              '[Yellow RPC]   allocations:',
              JSON.stringify(createParams.allocations, null, 2)
            )
            console.log('[Yellow RPC]   session_data:', createParams.session_data)
            console.log('[Yellow RPC]   session_data length:', createParams.session_data?.length)

            // Check if any critical fields are undefined or null
            if (!createParams.definition?.application) {
              console.error('[Yellow RPC] ERROR: definition.application is MISSING!')
            }
            if (
              !createParams.definition?.participants ||
              createParams.definition.participants.length !== 2
            ) {
              console.error('[Yellow RPC] ERROR: definition.participants is INVALID!')
            }
            if (typeof createParams.definition?.challenge !== 'number') {
              console.error(
                '[Yellow RPC] ERROR: definition.challenge is NOT a number!',
                typeof createParams.definition?.challenge
              )
            }
            if (typeof createParams.definition?.nonce !== 'number') {
              console.error(
                '[Yellow RPC] ERROR: definition.nonce is NOT a number!',
                typeof createParams.definition?.nonce
              )
            }
          }
        }
      } catch (e) {
        console.error('[Yellow RPC] CRITICAL DEBUG - JSON PARSE FAILED:', e)
      }

      this.ws?.send(requestJson)
    })
  }

  get state(): ConnectionState {
    return this.connectionState
  }

  get isConnected(): boolean {
    return this.connectionState === 'connected' && this.ws?.readyState === WebSocket.OPEN
  }

  disconnect(): void {
    console.log('[Yellow RPC] Disconnecting...')
    this.connectionState = 'shutdown'

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }

    if (this.ws) {
      this.ws.onclose = null
      this.ws.close()
      this.ws = null
    }

    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error('Client disconnected'))
    }
    this.pendingRequests.clear()

    this.notificationHandlers.clear()
  }
}

let rpcClientInstance: YellowRPCClient | null = null

export function getRPCClient(): YellowRPCClient {
  if (!rpcClientInstance) {
    // Get private key from environment for authentication
    const privateKey = process.env.YELLOW_PRIVATE_KEY || process.env.YELLOW_SERVER_PRIVATE_KEY

    if (privateKey) {
      console.log('[Yellow RPC] Creating RPC client with private key authentication')
    } else {
      console.warn('[Yellow RPC] WARNING: No YELLOW_PRIVATE_KEY or YELLOW_SERVER_PRIVATE_KEY found. Authentication may fail.')
    }

    rpcClientInstance = new YellowRPCClient(undefined, privateKey)
  }
  return rpcClientInstance
}

export function cleanupRPCClient(): void {
  if (rpcClientInstance) {
    rpcClientInstance.disconnect()
    rpcClientInstance = null
  }
}
