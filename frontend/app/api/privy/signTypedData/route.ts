import { NextRequest, NextResponse } from 'next/server'

// POST /api/privy/signTypedData
// This endpoint is no longer used - signing is done client-side via useSignTypedData
// Kept for backwards compatibility
export async function POST(req: NextRequest) {
  return NextResponse.json(
    { error: 'Client-side signing only. Please use the Privy React SDK hooks.' },
    { status: 410 } // Gone
  )
}
