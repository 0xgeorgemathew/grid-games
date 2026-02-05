import { NextRequest, NextResponse } from 'next/server'
import { PrivyClient } from '@privy-io/node'

export const runtime = 'nodejs'

const privy = new PrivyClient({
  appId: process.env.NEXT_PUBLIC_PRIVY_APP_ID || process.env.PRIVY_APP_ID!,
  appSecret: process.env.PRIVY_APP_SECRET!,
})

const AUTHORIZATION_KEY_ID = (process.env.PRIVY_AUTHORIZATION_KEY_ID || 'dosot9g1wi7fhmdv349o7tw3') as string

async function createSponsoredWallet() {
  return await privy.wallets().create({
    chain_type: 'ethereum',
    owner_id: AUTHORIZATION_KEY_ID,
  })
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await req.json()

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }

    const wallet = await createSponsoredWallet()

    return NextResponse.json({
      wallet: {
        id: wallet.id,
        address: wallet.address,
        chainType: wallet.chain_type,
        ownerId: wallet.owner_id,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get('userId')

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }

    const walletsPage = await privy.wallets().list({ user_id: userId })
    const wallets: unknown[] = []

    for await (const wallet of walletsPage) {
      wallets.push(wallet)
    }

    const ethWallet = wallets.find(
      (w: unknown) => (w as { chain_type: string }).chain_type === 'ethereum'
    )

    if (!ethWallet) {
      return NextResponse.json({ wallet: null })
    }

    return NextResponse.json({
      wallet: {
        id: (ethWallet as { id: string }).id,
        address: (ethWallet as { address: string }).address,
        chainType: (ethWallet as { chain_type: string }).chain_type,
        ownerId: (ethWallet as { owner_id: string | null }).owner_id,
      },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch wallet' }, { status: 500 })
  }
}
