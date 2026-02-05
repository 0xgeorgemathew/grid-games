// Yellow channel state manager (client-side)
// MVP: Server handles signing, client tracks state for UI

import type {
  ChannelState,
  ChannelCreateRequest,
  ChannelCreateResponse,
  ChannelDepositResponse,
  StateUpdateRequest,
  StateUpdateResponse,
  ChannelSettleResponse,
} from './types'
import { YELLOW_API, ENTRY_STAKE } from './config'

/**
 * ChannelManager - Client-side channel state management
 *
 * In MVP mode:
 * - Server creates and signs states
 * - Client sends requests via API
 * - Client stores state for UI updates
 */
export class ChannelManager {
  private currentChannel: ChannelState | null = null
  private readonly apiUrl: string

  constructor(apiBaseUrl: string = '') {
    this.apiUrl = apiBaseUrl
  }

  /** Get current channel state */
  getChannel(): ChannelState | null {
    return this.currentChannel
  }

  /** Check if player has enough balance (1 USDC) */
  async checkBalance(walletAddress: string): Promise<{ hasEnough: boolean; balance: string; formatted: string }> {
    try {
      const response = await fetch(`${this.apiUrl}/api/usdc-balance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress }),
      })

      if (!response.ok) {
        console.error('Balance check failed:', await response.text())
        return { hasEnough: false, balance: '0', formatted: '0.00' }
      }

      const data = await response.json()
      const balance = BigInt(data.balance || 0)
      const required = BigInt(ENTRY_STAKE)

      return {
        hasEnough: balance >= required,
        balance: data.balance || '0',
        formatted: data.formatted || '0.00',
      }
    } catch (error) {
      console.error('Balance check error:', error)
      return { hasEnough: false, balance: '0', formatted: '0.00' }
    }
  }

  /** Create a new game channel */
  async createChannel(params: ChannelCreateRequest): Promise<ChannelCreateResponse> {
    const response = await fetch(this.apiUrl + YELLOW_API.createChannel, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to create channel')
    }

    const data = (await response.json()) as ChannelCreateResponse

    // Store initial state
    this.currentChannel = data.initialState

    return data
  }

  /** Signal that player has deposited */
  async deposit(channelId: string, walletAddress: string): Promise<ChannelDepositResponse> {
    const response = await fetch(this.apiUrl + YELLOW_API.deposit, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId, walletAddress }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Deposit failed')
    }

    const data = (await response.json()) as ChannelDepositResponse

    // Update local state
    if (this.currentChannel && this.currentChannel.channelId === channelId) {
      this.currentChannel.status = data.status
    }

    return data
  }

  /** Request state update (after round ends) */
  async updateState(params: StateUpdateRequest): Promise<StateUpdateResponse> {
    const response = await fetch(this.apiUrl + YELLOW_API.stateUpdate, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'State update failed')
    }

    const data = (await response.json()) as StateUpdateResponse

    // Update local state
    if (this.currentChannel && this.currentChannel.channelId === params.channelId) {
      this.currentChannel.version = data.version
      this.currentChannel.status = data.status
      this.currentChannel.allocations = params.allocations
      this.currentChannel.lastUpdate = Date.now()
    }

    return data
  }

  /** Settle channel and close it */
  async settleChannel(channelId: string): Promise<ChannelSettleResponse> {
    const response = await fetch(this.apiUrl + YELLOW_API.settle, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Settlement failed')
    }

    const data = (await response.json()) as ChannelSettleResponse

    // Clear local state
    this.currentChannel = null

    return data
  }

  /** Clear local channel state */
  reset(): void {
    this.currentChannel = null
  }
}

// Singleton instance
let channelManagerInstance: ChannelManager | null = null

export function getChannelManager(): ChannelManager {
  if (!channelManagerInstance) {
    channelManagerInstance = new ChannelManager()
  }
  return channelManagerInstance
}
