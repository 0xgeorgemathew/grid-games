import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'

export const runtime = 'nodejs'

// In-memory channel storage (resets on server restart)
const channels = new Map<string, ChannelState>()

interface ChannelState {
  channelId: string
  player1Address: string
  player1Name: string
  player2Address: string
  player2Name: string
  stakeAmount: string
  status: 'INITIAL' | 'ACTIVE' | 'FINAL'
  player1Deposited: boolean
  player2Deposited: boolean
  createdAt: number
  allocations: Array<{ participant: string; asset: string; amount: string }>
  version: number
}

interface CreateChannelRequest {
  player1Address: string
  player1Name: string
  player2Address: string
  player2Name: string
  stakeAmount: string
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CreateChannelRequest

    const { player1Address, player1Name, player2Address, player2Name, stakeAmount } = body

    // Validate inputs
    if (!player1Address || !player2Address || !stakeAmount) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Generate unique channel ID
    const channelId = `0x${randomBytes(32).toString('hex')}`

    // Create initial channel state
    const channelState: ChannelState = {
      channelId,
      player1Address,
      player1Name,
      player2Address,
      player2Name,
      stakeAmount,
      status: 'INITIAL',
      player1Deposited: false,
      player2Deposited: false,
      createdAt: Date.now(),
      allocations: [
        { participant: player1Address, asset: 'usdc', amount: stakeAmount },
        { participant: player2Address, asset: 'usdc', amount: stakeAmount },
      ],
      version: 0,
    }

    channels.set(channelId, channelState)

    return NextResponse.json({
      channelId,
      initialState: {
        version: 0,
        status: 'INITIAL',
        channelId,
        createdAt: Date.now(),
        currentRound: 0,
        player1Wins: 0,
        player2Wins: 0,
        lastUpdate: Date.now(),
        allocations: channelState.allocations,
        players: [
          { address: player1Address, name: player1Name, connected: true },
          { address: player2Address, name: player2Name, connected: true },
        ],
      },
    })
  } catch (error) {
    console.error('Create channel error:', error)
    return NextResponse.json({ error: 'Failed to create channel' }, { status: 500 })
  }
}

// Export for other routes to access
export function getChannel(channelId: string): ChannelState | undefined {
  return channels.get(channelId)
}

export function updateChannel(channelId: string, updates: Partial<ChannelState>): boolean {
  const channel = channels.get(channelId)
  if (!channel) return false

  Object.assign(channel, updates)
  return true
}

export function getAllChannels(): Map<string, ChannelState> {
  return channels
}
