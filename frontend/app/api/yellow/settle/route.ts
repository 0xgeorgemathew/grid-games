import { NextRequest, NextResponse } from 'next/server'
import { getChannel, updateChannel, getAllChannels } from '../create-channel/route'

export const runtime = 'nodejs'

interface SettleRequest {
  channelId: string
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as SettleRequest
    const { channelId } = body

    if (!channelId) {
      return NextResponse.json({ error: 'Missing channelId' }, { status: 400 })
    }

    const channel = getChannel(channelId)
    if (!channel) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
    }

    // Set final status
    updateChannel(channelId, { status: 'FINAL' })

    const finalState = getChannel(channelId)!

    // TODO: Integrate with Yellow custody contract for on-chain settlement
    // For MVP: Return mock transaction hash
    const mockTxHash = `0x${Buffer.from(`${channelId}-settled`).toString('hex')}`

    return NextResponse.json({
      channelId,
      finalState: {
        version: finalState.version,
        status: 'FINAL',
        channelId: finalState.channelId,
        createdAt: finalState.createdAt,
        currentRound: 0,
        player1Wins: 0,
        player2Wins: 0,
        lastUpdate: Date.now(),
        allocations: finalState.allocations,
        players: [
          { address: finalState.player1Address, name: finalState.player1Name, connected: true },
          { address: finalState.player2Address, name: finalState.player2Name, connected: true },
        ],
      },
      settleTxHash: mockTxHash,
      player1Payout: finalState.allocations[0]?.amount || '0',
      player2Payout: finalState.allocations[1]?.amount || '0',
    })
  } catch (error) {
    console.error('Settlement error:', error)
    return NextResponse.json({ error: 'Settlement failed' }, { status: 500 })
  }
}

// GET endpoint to query channel status
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const channelId = searchParams.get('channelId')

  if (!channelId) {
    return NextResponse.json({ error: 'Missing channelId' }, { status: 400 })
  }

  const channel = getChannel(channelId)
  if (!channel) {
    return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
  }

  return NextResponse.json({
    channelId: channel.channelId,
    status: channel.status,
    player1Deposited: channel.player1Deposited,
    player2Deposited: channel.player2Deposited,
    allocations: channel.allocations,
    version: channel.version,
  })
}
