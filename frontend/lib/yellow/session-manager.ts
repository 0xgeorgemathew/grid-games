/**
 * Yellow Network Session Manager (Singleton)
 * ==========================================
 *
 * Manages Yellow WebSocket connection and app session lifecycle for HFT Battle.
 * Follows the exact pattern from app_session_two_signers.ts for:
 * - Session creation with multi-party signatures
 * - Per-settlement state updates
 * - Session close with final allocations
 *
 * Reference: app_session_two_signers.ts:72-292 (main function)
 *
 * Key Pattern:
 * 1. Connect to Yellow WebSocket
 * 2. Authenticate with Privy (adapted from scripts/auth.ts)
 * 3. Create app session (2 signatures required)
 * 4. Submit state updates (2 signatures required per update)
 * 5. Close session (2 signatures required)
 */

import { Client } from 'yellow-ts'
import {
  createAppSessionMessage,
  createCloseAppSessionMessage,
  createECDSAMessageSigner,
  createSubmitAppStateMessage,
  RPCAppDefinition,
  RPCAppSessionAllocation,
  RPCAppStateIntent,
  RPCData,
  RPCProtocolVersion,
  RPCResponse,
} from '@erc7824/nitrolite'
import type { SessionKey } from '../../scripts/utils'
import { authenticateWithPrivy } from './auth-privy'

class YellowSessionManager {
  private static instance: YellowSessionManager | null = null
  private yellow: Client | null = null
  private sessionKey: SessionKey | null = null
  private messageSigner: ReturnType<typeof createECDSAMessageSigner> | null = null
  private isConnected = false
  private appSessionId: string | null = null

  private constructor() {}

  static getInstance(): YellowSessionManager {
    if (!YellowSessionManager.instance) {
      YellowSessionManager.instance = new YellowSessionManager()
    }
    return YellowSessionManager.instance
  }

  // ==========================================================================
  // STEP 1: Connect to Yellow Network
  // ==========================================================================
  // Reference: app_session_two_signers.ts:77-82
  async connect(): Promise<void> {
    if (this.isConnected) {
      console.log('[Yellow] Already connected')
      return
    }

    this.yellow = new Client({
      url: 'wss://clearnet-sandbox.yellow.com/ws',
    })

    await this.yellow.connect()
    console.log('[Yellow] 🔌 Connected to Yellow clearnet')

    // Set up listener to log relevant messages
    // Reference: app_session_two_signers.ts:85-94
    this.yellow.listen(async (message: RPCResponse) => {
      if (message.method === 'error') {
        const error = (message.params as any).error
        // Suppress transient auth errors from concurrent authentication
        if (error !== 'invalid challenge or signature') {
          console.error('[Yellow] ❌ Server error:', message.params)
        }
      }
    })

    this.isConnected = true
  }

  // ==========================================================================
  // STEP 3: Authenticate with Privy
  // ==========================================================================
  // Reference: app_session_two_signers.ts:118-124 (adapted for Privy)
  async authenticate(privyWallet: { signTypedData: (params: any) => Promise<`0x${string}`> }, address: `0x${string}`): Promise<void> {
    if (!this.yellow) {
      throw new Error('Not connected to Yellow')
    }

    this.sessionKey = await authenticateWithPrivy(this.yellow, privyWallet, address)
    console.log('[Yellow] 🔑 Session Key Address:', this.sessionKey.address)

    // Create message signer (same as app_session_two_signers.ts:120)
    this.messageSigner = createECDSAMessageSigner(this.sessionKey.privateKey)
  }

  // ==========================================================================
  // STEP 6: Create App Session (Multi-Party Signatures)
  // ==========================================================================
  // Reference: app_session_two_signers.ts:162-173
  async createAppSession(
    appDefinition: RPCAppDefinition,
    allocations: RPCAppSessionAllocation[],
    secondSignature: string
  ): Promise<string> {
    if (!this.yellow || !this.messageSigner) {
      throw new Error('Not authenticated')
    }

    // Create session message signed by this participant
    // Reference: app_session_two_signers.ts:162-165
    const sessionMessage = await createAppSessionMessage(this.messageSigner, {
      definition: appDefinition,
      allocations,
    })

    // Add second participant's signature
    // Reference: app_session_two_signers.ts:168-170
    const sessionJson = JSON.parse(sessionMessage)
    sessionJson.sig.push(secondSignature)

    // Submit the fully-signed session creation
    // Reference: app_session_two_signers.ts:173
    const sessionResponse = await this.yellow.sendMessage(JSON.stringify(sessionJson))

    if ((sessionResponse as any).method === 'error') {
      console.error('[Yellow] ❌ Session creation failed:', (sessionResponse as any).params)
      throw new Error('Session creation failed')
    }

    this.appSessionId = (sessionResponse as any).params.appSessionId
    console.log('[Yellow] ✅ Session created:', this.appSessionId)
    console.log('[Yellow]    Version: 1 | Status: open')

    return this.appSessionId
  }

  // ==========================================================================
  // STEP 7: Helper Function for State Updates
  // ==========================================================================
  // Reference: app_session_two_signers.ts:188-219
  async submitAppState(
    allocations: RPCAppSessionAllocation[],
    version: number,
    secondSignature: string
  ): Promise<void> {
    if (!this.yellow || !this.messageSigner || !this.appSessionId) {
      throw new Error('Not authenticated or no active session')
    }

    // Create state update message
    // Reference: app_session_two_signers.ts:194-199
    const submitMessage = await createSubmitAppStateMessage(this.messageSigner, {
      app_session_id: this.appSessionId as `0x${string}`,
      intent: RPCAppStateIntent.Operate,
      version,
      allocations,
    })

    // Parse and add second participant's signature
    // Reference: app_session_two_signers.ts:202-204
    const submitJson = JSON.parse(submitMessage)
    submitJson.sig.push(secondSignature)

    // Submit the fully-signed state update
    // Reference: app_session_two_signers.ts:207
    const response = await this.yellow.sendMessage(JSON.stringify(submitJson))

    if ((response as any).method === 'error') {
      console.error('[Yellow] ❌ State update failed:', (response as any).params)
      throw new Error((response as any).params.error)
    }

    const w1Balance = allocations[0].amount
    const w2Balance = allocations[1].amount
    console.log(`[Yellow] ✅ State update v${version}`)
    console.log(`[Yellow]    Balances: Wallet 1 = ${w1Balance}, Wallet 2 = ${w2Balance}`)
  }

  // ==========================================================================
  // STEP 9: Close Session with Multi-Party Signatures
  // ==========================================================================
  // Reference: app_session_two_signers.ts:262-278
  async closeAppSession(
    finalAllocations: RPCAppSessionAllocation[],
    secondSignature: string
  ): Promise<void> {
    if (!this.yellow || !this.messageSigner || !this.appSessionId) {
      throw new Error('Not authenticated or no active session')
    }

    // Create close message signed by this participant
    // Reference: app_session_two_signers.ts:262-265
    const closeMessage = await createCloseAppSessionMessage(this.messageSigner, {
      app_session_id: this.appSessionId as `0x${string}`,
      allocations: finalAllocations,
    })

    // Add second participant's signature
    // Reference: app_session_two_signers.ts:268-270
    const closeJson = JSON.parse(closeMessage)
    closeJson.sig.push(secondSignature)

    // Submit the close request
    // Reference: app_session_two_signers.ts:273
    const closeResponse = await this.yellow.sendMessage(JSON.stringify(closeJson))

    if ((closeResponse as any).method === 'error') {
      console.error('[Yellow] ❌ Close session failed:', (closeResponse as any).params)
      throw new Error('Close session failed')
    }

    console.log('[Yellow] ✅ Session closed successfully')
    console.log(`[Yellow]    Final balances: Wallet 1 = ${finalAllocations[0].amount}, Wallet 2 = ${finalAllocations[1].amount}`)

    // Wait to catch final server messages
    // Reference: app_session_two_signers.ts:291
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  // ==========================================================================
  // Public Getters
  // ==========================================================================

  get isConnectedStatus(): boolean {
    return this.isConnected
  }

  get sessionId(): string | null {
    return this.appSessionId
  }

  get getMessageSigner(): ReturnType<typeof createECDSAMessageSigner> | null {
    return this.messageSigner
  }

  getClient(): Client | null {
    return this.yellow
  }

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  disconnect(): void {
    if (this.yellow) {
      this.yellow.disconnect()
      this.yellow = null
    }
    this.isConnected = false
    this.sessionKey = null
    this.messageSigner = null
    this.appSessionId = null
    console.log('[Yellow] Disconnected')
  }
}

export function getYellowSessionManager(): YellowSessionManager {
  return YellowSessionManager.getInstance()
}
