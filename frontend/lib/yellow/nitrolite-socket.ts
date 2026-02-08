/**
 * Nitrolite Game Events Socket.IO Handler
 * Replaces the complex Yellow RPC implementation with simplified Nitrolite protocol
 *
 * Based on Liquium's working implementation
 */

import { Socket } from 'socket.io'
import { getNitroliteGamesService, type NitroliteGamesService } from '@/lib/yellow/nitrolite-games'
import type { Address } from 'viem'

// ============================================================================
// Types
// ============================================================================

interface CreateNitroliteChannelParams {
  player1Address: Address
  player2Address: Address
  player1Name: string
  player2Name: string
  stakeAmount: number
}

interface UpdateNitroliteStateParams {
  channelId: string
  player1Score: number
  player2Score: number
}

interface CloseNitroliteChannelParams {
  channelId: string
  winnerAddress: Address
  winnerScore: number
  loserScore: number
}

// ============================================================================
// Service Initialization
// ============================================================================

let gamesService: NitroliteGamesService | null = null

async function getService(): Promise<NitroliteGamesService> {
  if (!gamesService) {
    gamesService = await getNitroliteGamesService()
  }
  return gamesService
}

// ============================================================================
// Socket.IO Handlers
// ============================================================================

/**
 * Create Nitrolite game channel
 */
export async function handleCreateNitroliteChannel(
  socket: Socket,
  params: CreateNitroliteChannelParams
): Promise<void> {
  try {
    console.log('[Nitrolite Socket] Creating channel for:', params)

    const service = await getService()

    const sessionData = JSON.stringify({
      game: 'hft-battle',
      mode: 'best-of-three',
      player1Name: params.player1Name,
      player2Name: params.player2Name,
      createdAt: Date.now(),
    })

    const channel = await service.createGameChannel({
      player1Address: params.player1Address,
      player2Address: params.player2Address,
      stakeAmount: params.stakeAmount,
      sessionData,
    })

    // Notify both players
    socket.emit('nitrolite_channel_created', {
      channelId: channel.channelId,
      status: channel.status,
      player1Allocation: channel.player1Allocation,
      player2Allocation: channel.player2Allocation,
    })

    // Also emit to room if in one
    if (socket.data.roomId) {
      socket.to(socket.data.roomId).emit('nitrolite_channel_created', {
        channelId: channel.channelId,
        status: channel.status,
      })
    }

    console.log('[Nitrolite Socket] ✓ Channel created, notifying players')
  } catch (error) {
    console.error('[Nitrolite Socket] Failed to create channel:', error)

    socket.emit('nitrolite_error', {
      error: error instanceof Error ? error.message : 'Failed to create channel',
    })

    throw error
  }
}

/**
 * Update Nitrolite game state
 */
export async function handleUpdateNitroliteState(
  socket: Socket,
  params: UpdateNitroliteStateParams
): Promise<void> {
  try {
    console.log('[Nitrolite Socket] Updating state:', params)

    const service = await getService()

    await service.updateGameState(
      params.channelId,
      params.player1Score,
      params.player2Score
    )

    // Broadcast to room
    if (socket.data.roomId) {
      socket.to(socket.data.roomId).emit('nitrolite_state_updated', {
        channelId: params.channelId,
        player1Score: params.player1Score,
        player2Score: params.player2Score,
      })
    }

    socket.emit('nitrolite_state_updated', {
      channelId: params.channelId,
      player1Score: params.player1Score,
      player2Score: params.player2Score,
    })

    console.log('[Nitrolite Socket] ✓ State updated')
  } catch (error) {
    console.error('[Nitrolite Socket] Failed to update state:', error)

    socket.emit('nitrolite_error', {
      error: error instanceof Error ? error.message : 'Failed to update state',
    })

    throw error
  }
}

/**
 * Close Nitrolite game channel
 */
export async function handleCloseNitroliteChannel(
  socket: Socket,
  params: CloseNitroliteChannelParams
): Promise<void> {
  try {
    console.log('[Nitrolite Socket] Closing channel:', params)

    const service = await getService()

    await service.closeGameChannel(
      params.channelId,
      params.winnerAddress,
      params.winnerScore,
      params.loserScore
    )

    // Notify players
    if (socket.data.roomId) {
      socket.to(socket.data.roomId).emit('nitrolite_channel_closed', {
        channelId: params.channelId,
        winnerAddress: params.winnerAddress,
        winnerScore: params.winnerScore,
        loserScore: params.loserScore,
      })
    }

    socket.emit('nitrolite_channel_closed', {
      channelId: params.channelId,
      winnerAddress: params.winnerAddress,
      winnerScore: params.winnerScore,
      loserScore: params.loserScore,
    })

    console.log('[Nitrolite Socket] ✓ Channel closed')
  } catch (error) {
    console.error('[Nitrolite Socket] Failed to close channel:', error)

    socket.emit('nitrolite_error', {
      error: error instanceof Error ? error.message : 'Failed to close channel',
    })

    throw error
  }
}

/**
 * Get Nitrolite channel info
 */
export async function handleGetNitroliteChannel(
  socket: Socket,
  channelId: string
): Promise<void> {
  try {
    const service = await getService()
    const channel = service.getChannel(channelId)

    if (!channel) {
      socket.emit('nitrolite_error', {
        error: `Channel not found: ${channelId}`,
      })
      return
    }

    socket.emit('nitrolite_channel_info', channel)
  } catch (error) {
    console.error('[Nitrolite Socket] Failed to get channel:', error)

    socket.emit('nitrolite_error', {
      error: error instanceof Error ? error.message : 'Failed to get channel',
    })
  }
}

/**
 * Disconnect service
 */
export async function handleNitroliteDisconnect(): Promise<void> {
  if (gamesService) {
    // TODO: Add disconnect method to service
    gamesService = null
  }
}

// ============================================================================
// Exports
// ============================================================================

export const nitroliteHandlers = {
  create_nitrolite_channel: handleCreateNitroliteChannel,
  update_nitrolite_state: handleUpdateNitroliteState,
  close_nitrolite_channel: handleCloseNitroliteChannel,
  get_nitrolite_channel: handleGetNitroliteChannel,
  nitrolite_disconnect: handleNitroliteDisconnect,
}
