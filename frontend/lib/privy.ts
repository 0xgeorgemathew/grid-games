// Privy server client initialization
import { PrivyClient } from '@privy-io/node'

let privyInstance: PrivyClient | null = null

export function getPrivy(): PrivyClient {
  if (!privyInstance) {
    const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID
    const appSecret = process.env.PRIVY_APP_SECRET

    if (!appId || !appSecret) {
      throw new Error(
        'Missing Privy credentials: NEXT_PUBLIC_PRIVY_APP_ID and PRIVY_APP_SECRET are required'
      )
    }

    privyInstance = new PrivyClient({ appId, appSecret })
  }

  return privyInstance
}
