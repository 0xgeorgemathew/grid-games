import { NextRequest, NextResponse } from 'next/server'
import { getChannel, updateChannel } from '../create-channel/route'

export const runtime = 'nodejs'

interface DepositRequest {
  channelId: string
  walletAddress: string
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as DepositRequest
    const { channelId, walletAddress } = body

    if (!channelId || !walletAddress) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const channel = getChannel(channelId)
    if (!channel) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
    }

    // Verify wallet belongs to one of the players
    const isPlayer1 = walletAddress.toLowerCase() === channel.player1Address.toLowerCase()
    const isPlayer2 = walletAddress.toLowerCase() === channel.player2Address.toLowerCase()

    if (!isPlayer1 && !isPlayer2) {
      return NextResponse.json({ error: 'Wallet not part of this channel' }, { status: 403 })
    }

    // Mark deposit
    if (isPlayer1) {
      channel.player1Deposited = true
    } else {
      channel.player2Deposited = true
    }

    // Check if both deposited - activate channel
    const bothDeposited = channel.player1Deposited && channel.player2Deposited
    if (bothDeposited && channel.status === 'INITIAL') {
      updateChannel(channelId, { status: 'ACTIVE' })
    }

    return NextResponse.json({
      channelId,
      status: bothDeposited ? 'ACTIVE' : channel.status,
      bothDeposited,
    })
  } catch (error) {
    console.error('Deposit error:', error)
    return NextResponse.json({ error: 'Deposit failed' }, { status: 500 })
  }
}
