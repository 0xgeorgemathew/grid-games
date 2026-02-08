/**
 * Yellow Network Authentication for Privy Embedded Wallets
 * ========================================================
 *
 * Adapted from scripts/auth.ts:authenticateWallet to use Privy's signTypedData
 * instead of viem's WalletClient with createEIP712AuthMessageSigner.
 *
 * Key Difference: Privy's embedded wallet provides EIP-712 signing via
 * signTypedData method, compatible with Yellow's authentication challenge.
 *
 * Reference: scripts/auth.ts:128-212 (authenticateWallet function)
 */

import { Client } from 'yellow-ts'
import {
  createAuthRequestMessage,
  createAuthVerifyMessage,
  RPCMethod,
  RPCResponse,
} from '@erc7824/nitrolite'
import { generateSessionKey, type SessionKey } from '../../scripts/utils'

const AUTH_SCOPE = 'Grid app'
const SESSION_DURATION = 3600 // 1 hour

// EIP-712 types for Yellow authentication
interface YellowAuthChallenge {
  scope: string
  session_key: string
  expires_at: bigint | string // bigint for Nitrolite, string for Privy signTypedData
  allowances: YellowAllowance[]
}

interface YellowAllowance {
  asset: string
  amount: string
}

interface PrivyWalletSigner {
  signTypedData: (params: {
    domain: { name: string; version: string; chainId: number }
    types: any
    primaryType: string // Required by Privy's useSignTypedData hook
    message: YellowAuthChallenge
  }) => Promise<`0x${string}`>
}

/**
 * Authenticate with Yellow Network using Privy embedded wallet.
 * Adapted from scripts/auth.ts:authenticateWallet to use Privy's signTypedData.
 *
 * @param yellow - Yellow WebSocket client
 * @param privyWallet - Privy embedded wallet with signTypedData method
 * @param address - Wallet address
 * @returns Session key with address and private key for message signing
 *
 * Reference: scripts/auth.ts:128-212
 */
export async function authenticateWithPrivy(
  yellow: Client,
  privyWallet: PrivyWalletSigner,
  address: `0x${string}`
): Promise<SessionKey> {
  console.log(`[Yellow] Wallet address: ${address}`)

  // Same session key generation as reference (scripts/auth.ts:49)
  const sessionKey = generateSessionKey()
  const sessionExpireTimestamp = String(Math.floor(Date.now() / 1000) + SESSION_DURATION)

  // Create authentication message (same as scripts/auth.ts:54-66)
  const authMessage = await createAuthRequestMessage({
    address,
    session_key: sessionKey.address,
    application: AUTH_SCOPE,
    allowances: [
      {
        asset: 'ytest.usd',
        amount: '100',
      },
    ],
    expires_at: BigInt(sessionExpireTimestamp), // Nitrolite expects bigint
    scope: AUTH_SCOPE,
  })

  // Wrap authentication in Promise (same as scripts/auth.ts:160-206)
  const authPromise = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Authentication timeout'))
    }, 10000)

    yellow.listen(async (message: RPCResponse) => {
      if (message.method === RPCMethod.AuthChallenge) {
        try {
          // ADAPTATION: Use Privy's signTypedData instead of createEIP712AuthMessageSigner
          // Reference: scripts/auth.ts:167-183 (EIP-712 auth params)
          const authParams = {
            scope: AUTH_SCOPE,
            session_key: sessionKey.address,
            expires_at: sessionExpireTimestamp,
            allowances: [
              {
                asset: 'ytest.usd',
                amount: '100',
              },
            ],
          }

          // Phase 2: Add request logging before signTypedData call
          console.log('[Yellow] 📝 Requesting signature via Privy signTypedData...')
          console.log('[Yellow] 📋 Auth params:', JSON.stringify(authParams, null, 2))

          // Use Privy's signTypedData for EIP-712 signing
          // Domain: matches AUTH_SCOPE and Base Sepolia chainId
          // Types: match Yellow's expected EIP-712 structure
          // primaryType: specifies the root type (required by Privy's useSignTypedData)
          const signature = await privyWallet.signTypedData({
            domain: {
              name: AUTH_SCOPE,
              version: '1',
              chainId: 84532, // Base Sepolia
            },
            types: {
              AuthChallenge: [
                { name: 'scope', type: 'string' },
                { name: 'session_key', type: 'address' },
                { name: 'expires_at', type: 'uint256' },
                { name: 'allowances', type: 'Allowance[]' },
              ],
              Allowance: [
                { name: 'asset', type: 'string' },
                { name: 'amount', type: 'string' },
              ],
            },
            primaryType: 'AuthChallenge', // ✅ Required by Privy's useSignTypedData
            message: authParams,
          })

          // Phase 2: Log successful signature receipt
          console.log('[Yellow] ✅ Signature received:', signature.substring(0, 10) + '...')

          // Create verify message (same as scripts/auth.ts:94)
          const authVerifyMessage = await createAuthVerifyMessage(
            async () => signature, // Use Privy signature
            message
          )

          await yellow.sendMessage(authVerifyMessage)
        } catch (error) {
          clearTimeout(timeout)
          reject(error)
        }
      } else if (message.method === RPCMethod.AuthVerify) {
        const params = message.params as any
        // Only resolve if this auth verify is for OUR session key (filter out other concurrent auths)
        // Reference: scripts/auth.ts:192-203
        if (params.sessionKey?.toLowerCase() === sessionKey.address.toLowerCase()) {
          clearTimeout(timeout)
          if (params.success) {
            console.log('[Yellow] ✅ Authentication successful')
            resolve()
          } else {
            reject(new Error('Authentication failed'))
          }
        }
      }
    })
  })

  await yellow.sendMessage(authMessage)
  await authPromise

  return sessionKey
}
