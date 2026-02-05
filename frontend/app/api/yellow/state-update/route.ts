import { NextRequest, NextResponse } from 'next/server'
import { getChannel, updateChannel } from '../create-channel/route'

export const runtime = 'nodejs'

interface StateUpdateRequest {
  channelId: string
  version: number
  allocations: Array<{ participant: string; asset: string; amount: string }>
  roundResults?: {
    roundNumber: number
    winnerId: string
    player1Dollars: number
    player2Dollars: number
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as StateUpdateRequest
    const { channelId, version, allocations, roundResults } = body

    if (!channelId || allocations === undefined) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const channel = getChannel(channelId)
    if (!channel) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
    }

    // Verify version sequence
    if (version !== channel.version + 1) {
      return NextResponse.json(
        { error: `Invalid version. Expected ${channel.version + 1}, got ${version}` },
        { status: 400 }
      )
    }

    // Verify total allocation equals 2 USDC (zero-sum)
    const totalAllocation = allocations.reduce(
      (sum, alloc) => sum + BigInt(alloc.amount),
      BigInt(0)
    )
    const expectedTotal = BigInt(channel.stakeAmount) * BigInt(2)

    if (totalAllocation !== expectedTotal) {
      return NextResponse.json(
        { error: `Invalid allocation total. Expected ${expectedTotal}, got ${totalAllocation}` },
        { status: 400 }
      )
    }

    // Update channel state
    updateChannel(channelId, {
      version,
      allocations,
      status: 'ACTIVE', // Keep active unless explicitly settled
    })

    return NextResponse.json({
      channelId,
      version: channel.version + 1,
      status: channel.status,
    })
  } catch (error) {
    console.error('State update error:', error)
    return NextResponse.json({ error: 'State update failed' }, { status: 500 })
  }
}
