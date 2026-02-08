import {
  AuthChallengeResponse,
  createAuthRequestMessage,
  createEIP712AuthMessageSigner,
  createAuthVerifyMessage,
  RPCResponse,
  RPCMethod,
} from '@erc7824/nitrolite'
import { Client } from 'yellow-ts'

import { createPublicClient, createWalletClient, http, WalletClient } from 'viem'
import { mnemonicToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'
import { generateSessionKey, SessionKey } from './utils'

import { config } from 'dotenv'

config()

const AUTH_SCOPE = 'Grid app'

const SESSION_DURATION = 3600 // 1 hour

export const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(),
})

// Lazy-loaded wallet for authenticate() function
let walletClient: WalletClient | null = null
export async function authenticate(client: Client): Promise<SessionKey> {
  // Lazy initialization: only check SEED_PHRASE when this function is called
  if (!walletClient) {
    const seedPhrase = process.env.SEED_PHRASE
    if (!seedPhrase) {
      throw new Error('SEED_PHRASE environment variable is not set')
    }
    const account = mnemonicToAccount(seedPhrase)
    walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(),
    })
  }

  const account = walletClient.account!
  console.log(`Wallet address: ${account.address}`)

  const sessionKey = generateSessionKey()

  const sessionExpireTimestamp = String(Math.floor(Date.now() / 1000) + SESSION_DURATION)

  // Create authentication message with session configuration
  const authMessage = await createAuthRequestMessage({
    address: account.address,
    session_key: sessionKey.address,
    application: AUTH_SCOPE,
    allowances: [
      {
        asset: 'ytest.usd',
        amount: '100', // Increased to support higher channel amounts
      },
    ],
    expires_at: BigInt(sessionExpireTimestamp),
    scope: AUTH_SCOPE,
  })

  // Wrap authentication in a Promise to wait for AuthVerifyResponse
  const authPromise = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Authentication timeout'))
    }, 10000)

    let hasSentVerify = false // Track if we've responded to a challenge

    client.listen(async (message: RPCResponse) => {
      if (message.method === RPCMethod.AuthChallenge) {
        try {
          // EIP-712 auth params - only include fields expected by server
          const authParams = {
            scope: AUTH_SCOPE,
            session_key: sessionKey.address,
            expires_at: BigInt(sessionExpireTimestamp),
            allowances: [
              {
                asset: 'ytest.usd',
                amount: '100', // Must match auth request allowance
              },
            ],
          }

          const eip712Signer = createEIP712AuthMessageSigner(walletClient, authParams, { name: AUTH_SCOPE })

          const authVerifyMessage = await createAuthVerifyMessage(eip712Signer, message)

          await client.sendMessage(authVerifyMessage)
          hasSentVerify = true // Mark that we've responded
        } catch (error) {
          // Ignore signature errors - may be from other concurrent auths
          // Only reject if we haven't successfully sent a verify yet
          if (!hasSentVerify) {
            clearTimeout(timeout)
            reject(error)
          }
        }
      } else if (message.method === RPCMethod.AuthVerify) {
        // Only resolve if this auth verify is for OUR session key (filter out other concurrent auths)
        const params = message.params as any
        if (params.sessionKey?.toLowerCase() === sessionKey.address.toLowerCase()) {
          clearTimeout(timeout)
          if (params.success) {
            console.log('✅ Authentication successful')
            resolve()
          } else {
            reject(new Error('Authentication failed'))
          }
        }
      }
    })
  })

  await client.sendMessage(authMessage)
  await authPromise

  return sessionKey
}

export async function authenticateWallet(
  client: Client,
  walletAccount: WalletClient
): Promise<SessionKey> {
  console.log(`Wallet address: ${walletAccount.account?.address}`)

  const sessionKey = generateSessionKey()

  const sessionExpireTimestamp = String(Math.floor(Date.now() / 1000) + SESSION_DURATION)

  const customWalletClient = createWalletClient({
    account: walletAccount.account,
    chain: baseSepolia,
    transport: http(),
  })

  // Create authentication message with session configuration
  const authMessage = await createAuthRequestMessage({
    address: walletAccount.account?.address as `0x${string}`,
    session_key: sessionKey.address,
    application: AUTH_SCOPE,
    allowances: [
      {
        asset: 'ytest.usd',
        amount: '100', // Increased to support higher channel amounts
      },
    ],
    expires_at: BigInt(sessionExpireTimestamp),
    scope: AUTH_SCOPE,
  })

  // Wrap authentication in a Promise to wait for AuthVerifyResponse
  const authPromise = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Authentication timeout'))
    }, 10000)

    client.listen(async (message: RPCResponse) => {
      if (message.method === RPCMethod.AuthChallenge) {
        try {
          // EIP-712 auth params - only include fields expected by server
          const authParams = {
            scope: AUTH_SCOPE,
            session_key: sessionKey.address,
            expires_at: BigInt(sessionExpireTimestamp),
            allowances: [
              {
                asset: 'ytest.usd',
                amount: '100', // Must match auth request allowance
              },
            ],
          }

          const eip712Signer = createEIP712AuthMessageSigner(customWalletClient, authParams, {
            name: AUTH_SCOPE,
          })

          const authVerifyMessage = await createAuthVerifyMessage(eip712Signer, message)

          await client.sendMessage(authVerifyMessage)
        } catch (error) {
          clearTimeout(timeout)
          reject(error)
        }
      } else if (message.method === RPCMethod.AuthVerify) {
        // Only resolve if this auth verify is for OUR session key (filter out other concurrent auths)
        const params = message.params as any
        if (params.sessionKey?.toLowerCase() === sessionKey.address.toLowerCase()) {
          clearTimeout(timeout)
          if (params.success) {
            console.log('✅ Authentication successful')
            resolve()
          } else {
            reject(new Error('Authentication failed'))
          }
        }
      }
    })
  })

  await client.sendMessage(authMessage)
  await authPromise

  return sessionKey
}
