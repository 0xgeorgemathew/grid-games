/**
 * Nitrolite Games Service
 * Simplified state channel management for HFT Battle
 *
 * Based on Liquium's working implementation
 */

import { type Address } from 'viem'
import { getNitroliteClient, type NitroliteClient } from './nitrolite-client'

// ============================================================================
// Types
// ============================================================================

export interface PlayerAllocation {
  participant: Address
  asset: string // 'ytest.usd'
  amount: string // Human-readable, e.g., '10.0'
}

export interface GameChannel {
  channelId: string
  player1Address: Address
  player2Address: Address
  player1Allocation: PlayerAllocation
  player2Allocation: PlayerAllocation
  status: 'open' | 'active' | 'closed'
  version: number
}

export interface CreateGameChannelParams {
  player1Address: Address
  player2Address: Address
  stakeAmount: number // Per player, e.g., 10
  sessionData?: string
}

// ============================================================================
// Service
// ============================================================================

class NitroliteGamesService {
  private client: NitroliteClient | null = null
  private channels = new Map<string, GameChannel>()

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    try {
      console.log('[Nitrolite Games] Initializing...')

      this.client = await getNitroliteClient()

      console.log('[Nitrolite Games] ✓ Initialized')
    } catch (error) {
      console.error('[Nitrolite Games] Failed to initialize:', error)
      throw error
    }
  }

  /**
   * Create a game channel for HFT Battle
   */
  async createGameChannel(params: CreateGameChannelParams): Promise<GameChannel> {
    if (!this.client) {
      await this.initialize()
    }

    const { player1Address, player2Address, stakeAmount, sessionData } = params

    console.log('[Nitrolite Games] Creating game channel:', {
      player1: player1Address.toLowerCase(),
      player2: player2Address.toLowerCase(),
      stakeAmount,
    })

    // Define allocations (both players stake)
    const allocations: PlayerAllocation[] = [
      {
        participant: player1Address.toLowerCase() as Address,
        asset: 'ytest.usd',
        amount: `${stakeAmount}.0`,
      },
      {
        participant: player2Address.toLowerCase() as Address,
        asset: 'ytest.usd',
        amount: `${stakeAmount}.0`,
      },
    ]

    // Create the app session
    const session = await this.client.createAppSession(
      [player1Address, player2Address],
      allocations,
      sessionData || JSON.stringify({
        game: 'hft-battle',
        round: 0,
        player1Score: 10,
        player2Score: 10,
      })
    )

    const channel: GameChannel = {
      channelId: session.app_session_id,
      player1Address,
      player2Address,
      player1Allocation: allocations[0],
      player2Allocation: allocations[1],
      status: 'open',
      version: session.version,
    }

    this.channels.set(channel.channelId, channel)

    console.log('[Nitrolite Games] ✓ Game channel created:', {
      channelId: channel.channelId,
    })

    return channel
  }

  /**
   * Update game state (after a round)
   */
  async updateGameState(
    channelId: string,
    player1Score: number,
    player2Score: number
  ): Promise<void> {
    const channel = this.channels.get(channelId)
    if (!channel) {
      throw new Error(`Channel not found: ${channelId}`)
    }

    const sessionData = JSON.stringify({
      game: 'hft-battle',
      round: channel.version + 1,
      player1Score,
      player2Score,
      lastUpdate: Date.now(),
    })

    // Update allocations based on scores
    const allocations: PlayerAllocation[] = [
      {
        participant: channel.player1Address.toLowerCase() as Address,
        asset: 'ytest.usd',
        amount: `${player1Score}.0`,
      },
      {
        participant: channel.player2Address.toLowerCase() as Address,
        asset: 'ytest.usd',
        amount: `${player2Score}.0`,
      },
    ]

    await this.client.updateAppState(channelId, allocations, sessionData)

    // Update local state
    channel.version++
    channel.player1Allocation = allocations[0]
    channel.player2Allocation = allocations[1]

    console.log('[Nitrolite Games] Game state updated:', {
      channelId,
      version: channel.version,
      player1Score,
      player2Score,
    })
  }

  /**
   * Close game channel and settle
   */
  async closeGameChannel(
    channelId: string,
    winnerAddress: Address,
    winnerScore: number,
    loserScore: number
  ): Promise<void> {
    const channel = this.channels.get(channelId)
    if (!channel) {
      throw new Error(`Channel not found: ${channelId}`)
    }

    console.log('[Nitrolite Games] Closing game channel:', {
      channelId,
      winner: winnerAddress.toLowerCase(),
      winnerScore,
      loserScore,
    })

    // Calculate final allocations (winner takes both stakes)
    const totalStake = winnerScore + loserScore
    const loserAllocation = {
      participant: channel.player1Address.toLowerCase() as Address,
      asset: 'ytest.usd',
      amount: '0.0',
    }

    const winnerAllocation = {
      participant: winnerAddress.toLowerCase() as Address,
      asset: 'ytest.usd',
      amount: `${totalStake}.0`,
    }

    // Order matters - must match participant order
    const allocations =
      winnerAddress.toLowerCase() === channel.player1Address.toLowerCase()
        ? [winnerAllocation, loserAllocation]
        : [loserAllocation, winnerAllocation]

    await this.client.closeAppSession(channelId, allocations)

    // Update local state
    channel.status = 'closed'

    console.log('[Nitrolite Games] ✓ Game channel closed:', {
      channelId,
      finalAllocations: allocations,
    })
  }

  /**
   * Get channel info
   */
  getChannel(channelId: string): GameChannel | undefined {
    return this.channels.get(channelId)
  }

  /**
   * Get all channels
   */
  getAllChannels(): GameChannel[] {
    return Array.from(this.channels.values())
  }
}

// ============================================================================
// Export singleton
// ============================================================================

let serviceInstance: NitroliteGamesService | null = null

export async function getNitroliteGamesService(): Promise<NitroliteGamesService> {
  if (!serviceInstance) {
    serviceInstance = new NitroliteGamesService()
    await serviceInstance.initialize()
  }

  return serviceInstance
}

// Also export class for direct use
export { NitroliteGamesService }
