/**
 * Nitrolite-Compatible Client for Yellow Network
 * Based on Liquium's working implementation
 *
 * KEY DIFFERENCES from previous attempt:
 * - protocol: 'nitroliterpc' (NOT 'NitroRPC/0.4')
 * - challenge: 0 (NO challenge period)
 * - quorum: 100 (not 2)
 * - Simple ECDSA signatures (no complex EIP-712 for requests)
 */

import { ethers } from 'ethers'
import type { Address } from 'viem'

// ============================================================================
// Types
// ============================================================================

export interface AppDefinition {
  protocol: string // 'nitroliterpc'
  participants: Address[] // Wallet addresses
  weights: number[] // Governance weights
  quorum: number // Quorum (100 for equal voting)
  challenge: number // Challenge period (0 = immediate)
  nonce: number // Random nonce
}

export interface AppAllocation {
  participant: Address // Wallet address
  asset: string // Asset symbol (e.g., 'usdc', 'ytest.usd')
  amount: string // Human-readable amount (e.g., '10.0')
}

export interface AppState {
  definition: AppDefinition
  allocations: AppAllocation[]
  session_data?: string // JSON string
}

export interface ChannelData {
  channelId: string
  status: 'open' | 'closed' | 'finalized'
  allocations: AppAllocation[]
  version: number
  createdAt: number
}

// ============================================================================
// Configuration
// ============================================================================

const CLEARNODE_WS_URL = 'wss://clearnet-sandbox.yellow.com/ws'
const APP_DOMAIN = 'grid-games-hft-battle'
const APP_NAME = 'Grid Games HFT Battle'

// ============================================================================
// Client Class
// ============================================================================

export class NitroliteClient {
  private ws: WebSocket | null = null
  private wallet: ethers.Wallet | null = null
  private isAuthenticated = false
  private jwtToken: string | null = null
  private messageHandlers = new Map<number, (result: any) => void>()
  private messageId = 0

  /**
   * Initialize with private key (for server-side)
   * Can be omitted if using JWT authentication
   */
  async initialize(privateKey?: string): Promise<void> {
    if (privateKey) {
      this.wallet = new ethers.Wallet(privateKey)
      console.log('[Nitrolite] Initialized with address:', this.wallet.address)
    } else {
      console.log('[Nitrolite] Initialized without wallet (JWT mode)')
    }
  }

  /**
   * Set JWT token for authentication
   * This can be used instead of private key authentication
   */
  setJwtToken(jwt: string): void {
    this.jwtToken = jwt
    console.log('[Nitrolite] JWT token set')
  }

  /**
   * Connect to ClearNode
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.wallet) {
        reject(new Error('Client not initialized'))
        return
      }

      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        resolve()
        return
      }

      console.log('[Nitrolite] Connecting to ClearNode:', CLEARNODE_WS_URL)

      this.ws = new WebSocket(CLEARNODE_WS_URL)

      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout (10s)'))
      }, 10000)

      this.ws.onopen = async () => {
        clearTimeout(timeout)
        console.log('[Nitrolite] ✓ Connected to ClearNode')

        try {
          await this.authenticate()
          resolve()
        } catch (error) {
          reject(error)
        }
      }

      this.ws.onmessage = (event) => this.handleMessage(event)

      this.ws.onerror = (error) => {
        clearTimeout(timeout)
        console.error('[Nitrolite] WebSocket error:', error)
        reject(error)
      }

      this.ws.onclose = () => {
        console.log('[Nitrolite] WebSocket closed')
      }
    })
  }

  /**
   * Authenticate with ClearNode
   */
  private async authenticate(): Promise<void> {
    if (!this.wallet || !this.ws) {
      throw new Error('Not connected')
    }

    console.log('[Nitrolite] Starting authentication...')

    // Step 1: auth_request
    const requestId1 = this.messageId++
    const timestamp1 = Math.floor(Date.now() / 1000)
    const authRequestParams = {
      address: this.wallet.address.toLowerCase(),
      session_key: this.wallet.address.toLowerCase(), // Using same address for simplicity
      application: APP_DOMAIN,
      expires_at: Math.floor(Date.now() / 1000) + 3600, // 1 hour
      scope: 'app.create,app.submit,transfer',
      allowances: [{ asset: 'ytest.usd', amount: '100.0' }],
    }

    const authRequest = {
      req: [requestId1, 'auth_request', [authRequestParams], timestamp1],
      sig: [await this.signMessage(authRequestParams)],
    }

    this.ws?.send(JSON.stringify(authRequest))

    // Wait for auth_challenge response (handled in handleMessage)
    // Then auth_verify (also handled there)

    // Authentication completes asynchronously via handleMessage
    // We'll wait for authenticated flag to be set
    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        if (this.isAuthenticated) {
          clearInterval(checkInterval)
          resolve()
        }
      }, 100)
    })

    console.log('[Nitrolite] ✓ Authentication complete')
  }

  /**
   * Create application session
   */
  async createAppSession(
    participants: Address[],
    allocations: AppAllocation[],
    sessionData: string = '{}'
  ): Promise<{ app_session_id: string; status: string; version: number }> {
    if (!this.isAuthenticated || !this.wallet) {
      throw new Error('Not authenticated')
    }

    const sortedAddresses = participants.map((a) => a.toLowerCase()).sort() as Address[]

    // Sort allocations to match participants
    const sortedAllocations = sortedAddresses.map((participant) => {
      return allocations.find((a) => a.participant.toLowerCase() === participant.toLowerCase())!
    })

    const definition: AppDefinition = {
      protocol: 'nitroliterpc',
      participants: sortedAddresses,
      weights: [50, 50], // Equal voting
      quorum: 100,
      challenge: 0, // NO challenge period - immediate finalization
      nonce: Date.now(),
    }

    const params = {
      definition,
      allocations: sortedAllocations,
      session_data: sessionData,
    }

    console.log('[Nitrolite] Creating app session:', {
      participants: sortedAddresses,
      allocations: sortedAllocations,
    })

    const result = await this.sendRequest('create_app_session', [params])

    return {
      app_session_id: result.app_session_id,
      status: result.status || 'open',
      version: result.version || 1,
    }
  }

  /**
   * Get application sessions
   */
  async getAppSessions(): Promise<any[]> {
    if (!this.isAuthenticated) {
      throw new Error('Not authenticated')
    }

    return await this.sendRequest('get_app_sessions', [
      { participant: this.wallet.address.toLowerCase() },
    ])
  }

  /**
   * Update application session state
   */
  async updateAppState(
    channelId: string,
    allocations: AppAllocation[],
    stateData: string
  ): Promise<any> {
    if (!this.isAuthenticated) {
      throw new Error('Not authenticated')
    }

    return await this.sendRequest('submit_app_state', [
      {
        app_session_id: channelId,
        allocations,
        session_data: stateData,
      },
    ])
  }

  /**
   * Close application session
   */
  async closeAppSession(
    channelId: string,
    finalAllocations: AppAllocation[]
  ): Promise<any> {
    if (!this.isAuthenticated) {
      throw new Error('Not authenticated')
    }

    return await this.sendRequest('close_app_session', [
      {
        app_session_id: channelId,
        allocations: finalAllocations,
      },
    ])
  }

  /**
   * Send signed request to ClearNode
   */
  private async sendRequest(method: string, params: any[]): Promise<any> {
    if (!this.ws || !this.wallet) {
      throw new Error('Not connected')
    }

    const requestId = this.messageId++
    const timestamp = Math.floor(Date.now() / 1000)

    // Sign the request
    const signature = await this.signMessage(params[0])

    const request = {
      req: [requestId, method, params, timestamp],
      sig: [signature],
    }

    console.log('[Nitrolite] Sending request:', { method, requestId })

    // Create a promise for the response
    const responsePromise = new Promise<any>((resolve, reject) => {
      // Set up response handler
      const timeout = setTimeout(() => {
        this.messageHandlers.delete(requestId)
        reject(new Error(`Request timeout: ${method}`))
      }, 30000)

      this.messageHandlers.set(requestId, (result) => {
        clearTimeout(timeout)

        // Check for error
        if (result && typeof result === 'object' && 'error' in result) {
          reject(new Error(result.error))
          return
        }

        resolve(result)
      })
    })

    // Send the request
    this.ws.send(JSON.stringify(request))

    // Wait for response
    return responsePromise
  }

  /**
   * Sign message with wallet (ECDSA, no EIP-191 prefix)
   */
  private async signMessage(message: any): Promise<string> {
    if (!this.wallet) {
      throw new Error('No wallet available')
    }

    const messageString = JSON.stringify(message)
    const digest = ethers.id(messageString)
    const messageBytes = ethers.getBytes(digest)

    // Sign directly without EIP-191 prefix
    const { serialized: signature } = this.wallet.signingKey.sign(messageBytes)

    return signature
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(event: MessageEvent): void {
    try {
      const data = JSON.parse(event.data)

      // Handle response
      if ('res' in data) {
        const [requestId, method, result] = data.res

        console.log('[Nitrolite] Received response:', { method, requestId })

        // Handle auth_challenge
        if (method === 'auth_challenge') {
          this.handleAuthChallenge(data)
          return
        }

        // Handle auth_verify
        if (method === 'auth_verify') {
          this.handleAuthVerify(data)
          return
        }

        // Handle other responses
        const handler = this.messageHandlers.get(requestId)
        if (handler) {
          handler(result || data)
          this.messageHandlers.delete(requestId)
        }
      }

      // Handle error
      if ('err' in data) {
        const [requestId, code, errorMessage] = data.err
        console.error('[Nitrolite] Error:', { requestId, code, errorMessage })

        const handler = this.messageHandlers.get(requestId)
        if (handler) {
          handler(new Error(`${code}: ${errorMessage}`))
          this.messageHandlers.delete(requestId)
        }
      }
    } catch (error) {
      console.error('[Nitrolite] Error handling message:', error)
    }
  }

  /**
   * Handle auth challenge
   */
  private async handleAuthChallenge(data: any): Promise<void> {
    if (!this.wallet || !this.ws) {
      return
    }

    try {
      const result = data.res[2]
      const challenge = result[0]?.challengeMessage || result.challengeMessage

      console.log('[Nitrolite] Received auth_challenge:', challenge?.substring(0, 20) + '...')

      // Create EIP-712 signature
      const eip712Domain = {
        name: APP_DOMAIN,
        version: '1',
      }

      const policyMessage = {
        challenge,
        scope: 'app.create,app.submit,transfer',
        wallet: this.wallet.address.toLowerCase(),
        session_key: this.wallet.address.toLowerCase(),
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        allowances: [{ asset: 'ytest.usd', amount: '100.0' }],
      }

      const eip712Signature = await this.wallet.signTypedData(
        eip712Domain,
        {
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
        },
        policyMessage
      )

      // Send auth_verify
      const requestId = this.messageId++
      const timestamp = Math.floor(Date.now() / 1000)

      const authVerifyParams = {
        signature: eip712Signature,
        challengeMessage: challenge,
      }

      const authVerify = {
        req: [requestId, 'auth_verify', [authVerifyParams], timestamp],
        sig: [await this.signMessage(authVerifyParams)],
      }

      console.log('[Nitrolite] Sending auth_verify...')
      this.ws.send(JSON.stringify(authVerify))
    } catch (error) {
      console.error('[Nitrolite] Error handling auth_challenge:', error)
    }
  }

  /**
   * Handle auth verify success
   */
  private handleAuthVerify(data: any): void {
    try {
      const result = data.res[2]
      const success = result[0]?.success ?? result.success

      if (success) {
        this.isAuthenticated = true
        const jwtToken = result[0]?.jwtToken ?? result.jwtToken

        if (jwtToken) {
          this.jwtToken = jwtToken
        }

        console.log('[Nitrolite] ✓ Authentication successful')
      } else {
        console.error('[Nitrolite] Authentication failed')
      }
    } catch (error) {
      console.error('[Nitrolite] Error handling auth_verify:', error)
    }
  }

  /**
   * Disconnect
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.isAuthenticated = false
    console.log('[Nitrolite] Disconnected')
  }

  /**
   * Get connection status
   */
  getStatus(): { connected: boolean; authenticated: boolean; address: string | null } {
    return {
      connected: this.ws?.readyState === WebSocket.OPEN,
      authenticated: this.isAuthenticated,
      address: this.wallet?.address || null,
    }
  }
}

// ============================================================================
// Export singleton
// ============================================================================

let clientInstance: NitroliteClient | null = null

export async function getNitroliteClient(): Promise<NitroliteClient> {
  if (!clientInstance) {
    clientInstance = new NitroliteClient()

    // Initialize with private key from env if available
    // YELLOW_PRIVATE_KEY or YELLOW_SERVER_PRIVATE_KEY can be used
    // If not provided, the client can still be used with JWT authentication
    const privateKey = process.env.YELLOW_PRIVATE_KEY || process.env.YELLOW_SERVER_PRIVATE_KEY

    await clientInstance.initialize(privateKey)
    await clientInstance.connect()
  }

  return clientInstance
}
