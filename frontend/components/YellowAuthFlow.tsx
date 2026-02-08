'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { usePrivy, useWallets, toViemAccount } from '@privy-io/react-auth'
import type { Socket } from 'socket.io-client'
import { authenticate, getWalletSigningTypes } from '@/lib/yellow/authentication'
import { getRPCClient } from '@/lib/yellow/rpc-client'
import { APP_SESSION_CONFIG, YELLOW_APPLICATION_NAME } from '@/lib/yellow/config'

interface YellowAuthFlowProps {
  walletAddress: `0x${string}`
  socket: Socket | null
  onComplete: (authSession: {
    address: string
    sessionKey: string
    sessionKeyPrivate: string
    jwtToken: string
    expiresAt: number
    wallet?: any // Include the wallet object for later signing
  }) => void
  onClose: () => void
}

type AuthStep = 'connecting' | 'challenge' | 'verifying' | 'success' | 'error'

export function YellowAuthFlow({
  walletAddress,
  socket,
  onComplete,
  onClose,
}: YellowAuthFlowProps) {
  const { ready, authenticated } = usePrivy()
  const { wallets } = useWallets()
  const [step, setStep] = useState<AuthStep>('connecting')
  const [error, setError] = useState<string>('')
  const [timeRemaining, setTimeRemaining] = useState<number>(0)

  // Prevent double authentication in React Strict Mode
  const authInProgressRef = useRef(false)

  // Define performAuthentication before useEffect to avoid hoisting issues
  async function performAuthentication() {
    try {
      console.log(
        '[YellowAuthFlow] ════════════════════════════════════════════════════════════════'
      )
      console.log('[YellowAuthFlow] Starting Yellow Network authentication flow')
      console.log('[YellowAuthFlow] Wallet address:', walletAddress)
      console.log('[YellowAuthFlow] Privy ready:', ready)
      console.log('[YellowAuthFlow] Privy authenticated:', authenticated)
      console.log(
        '[YellowAuthFlow] ════════════════════════════════════════════════════════════════'
      )

      setStep('connecting')
      setError('')

      // Connect RPC client
      const rpcClient = getRPCClient()
      console.log('[YellowAuthFlow] RPC client state before connection:', {
        state: rpcClient.state,
        isConnected: rpcClient.isConnected,
      })

      if (!rpcClient.isConnected) {
        console.log('[YellowAuthFlow] Connecting RPC client to ClearNode...')
        await rpcClient.connect()
        console.log('[YellowAuthFlow] RPC client connected successfully')
      }

      setStep('challenge')
      console.log('[YellowAuthFlow] Waiting for user to sign EIP-712 challenge...')

      // Perform authentication with Privy
      const authSession = await authenticate(
        async (params) => {
          // CRITICAL: Use viem Account for client-side EIP-712 signing
          //
          // The useSignTypedData hook uses server-side signing by default for embedded wallets,
          // which can modify the EIP-712 structure and cause signature verification failures.
          //
          // Instead, we use toViemAccount() to get a local account that signs EIP-712 correctly.
          console.log('[YellowAuthFlow] Looking up wallet for signing:', walletAddress)

          const wallet = wallets.find(
            (w) => w.address.toLowerCase() === walletAddress.toLowerCase()
          )

          if (!wallet) {
            console.error('[YellowAuthFlow] Wallet not found in Privy wallets')
            throw new Error(`Wallet not found: ${walletAddress}`)
          }

          console.log(
            '[YellowAuthFlow] Wallet found, creating viem account for client-side signing'
          )

          // Get the viem account for client-side signing (local, not server-side)
          const account = await toViemAccount({ wallet })

          console.log('[YellowAuthFlow] viem account created, signing EIP-712 typed data')

          // Sign with the viem account (client-side, exact EIP-712 format)
          const signature = await account.signTypedData({
            domain: params.domain as any,
            types: getWalletSigningTypes() as any,
            primaryType: params.primaryType as any,
            message: params.message as any,
          })

          console.log('[YellowAuthFlow] EIP-712 signature created via viem account:', {
            prefix: signature.slice(0, 10) + '...',
            length: signature.length,
            suffix: '...' + signature.slice(-10),
            isValidLength: signature.length === 132,
          })

          return signature
        },
        {
          address: walletAddress,
          application: YELLOW_APPLICATION_NAME,
          // Create mutable copy of allowances (APP_SESSION_CONFIG is readonly due to 'as const')
          allowances: [...APP_SESSION_CONFIG.allowances],
          scope: 'app.create,app.submit,transfer',
          sessionDuration: APP_SESSION_CONFIG.sessionDuration,
        }
      )

      console.log('[YellowAuthFlow] Authentication successful!')
      console.log('[YellowAuthFlow] Session details:', {
        address: authSession.address,
        sessionKeyAddress: authSession.sessionKeyAddress,
        sessionKeyPrivatePrefix: authSession.sessionKeyPrivate.slice(0, 10) + '...',
        jwtTokenPrefix: authSession.jwtToken.slice(0, 20) + '...',
        jwtTokenLength: authSession.jwtToken.length,
        expiresAt: new Date(authSession.expiresAt).toISOString(),
        expiresInMs: authSession.expiresAt - Date.now(),
        expiresInMinutes: Math.floor((authSession.expiresAt - Date.now()) / 60000),
      })

      setStep('success')

      // Update time remaining
      const expiresIn = authSession.expiresAt - Date.now()
      setTimeRemaining(expiresIn)

      // CRITICAL: Store JWT token in RPC client for reconnection handling
      // Yellow's ClearNode loses session key registration on WebSocket disconnect
      // The JWT allows re-authentication without requiring another EIP-712 signature
      rpcClient.setAuthToken(authSession.jwtToken)

      // CRITICAL: Wait for session key to be fully registered on Yellow's server
      // Yellow's ClearNode needs time to process the auth_verify response and
      // register the session key before it can verify signatures from that key.
      // Without this delay, create_app_session will fail with "missing signature".
      console.log('[YellowAuthFlow] Waiting 5000ms for session key registration...')
      await new Promise((resolve) => setTimeout(resolve, 5000))
      console.log('[YellowAuthFlow] Session key should now be fully registered')

      // Notify parent component
      // Include sessionKeyPrivate so server can sign app session requests
      // Include wallet object for client-side app session signing
      console.log('[YellowAuthFlow] Notifying parent component of successful authentication')

      // Look up the wallet again to include it in the auth session
      const wallet = wallets.find((w) => w.address.toLowerCase() === walletAddress.toLowerCase())

      onComplete({
        address: authSession.address,
        sessionKey: authSession.sessionKeyAddress,
        sessionKeyPrivate: authSession.sessionKeyPrivate,
        jwtToken: authSession.jwtToken,
        expiresAt: authSession.expiresAt,
        wallet, // Include the wallet object for later signing
      })

      console.log(
        '[YellowAuthFlow] ════════════════════════════════════════════════════════════════'
      )
      console.log('[YellowAuthFlow] Authentication flow completed successfully')

      // Auto-close after success
      setTimeout(() => {
        onClose()
      }, 1500)
    } catch (err) {
      console.error('[YellowAuthFlow] Authentication error:', err)
      console.error('[YellowAuthFlow] Error details:', {
        message: err instanceof Error ? err.message : 'Unknown error',
        stack: err instanceof Error ? err.stack : undefined,
        name: err instanceof Error ? err.name : undefined,
      })
      setError(err instanceof Error ? err.message : 'Authentication failed')
      setStep('error')
    }
  }

  useEffect(() => {
    if (!ready || !authenticated) {
      setError('Please connect your wallet first')
      setStep('error')
      return
    }

    // Guard against double execution
    if (authInProgressRef.current) {
      return
    }
    authInProgressRef.current = true

    performAuthentication()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, authenticated])

  const formatTime = (ms: number): string => {
    const minutes = Math.floor(ms / 60000)
    const seconds = Math.floor((ms % 60000) / 1000)
    return `${minutes}m ${seconds}s`
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="relative bg-gradient-to-br from-gray-900 to-gray-800 border border-yellow-500/30 rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-yellow-400">Yellow Network</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            ✕
          </button>
        </div>

        {/* Status */}
        <div className="space-y-4">
          {step === 'connecting' && (
            <div className="text-center py-8">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-yellow-400 border-t-transparent mb-4" />
              <p className="text-gray-300">Connecting to Yellow ClearNode...</p>
            </div>
          )}

          {step === 'challenge' && (
            <div className="text-center py-8">
              <div className="inline-block animate-pulse rounded-full h-12 w-12 bg-yellow-400/20 mb-4 flex items-center justify-center">
                <span className="text-2xl">🔐</span>
              </div>
              <p className="text-gray-300 mb-2">Signing Authentication Challenge</p>
              <p className="text-sm text-gray-500">Please confirm the signature in your wallet</p>
            </div>
          )}

          {step === 'verifying' && (
            <div className="text-center py-8">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-yellow-400 border-t-transparent mb-4" />
              <p className="text-gray-300">Verifying authentication...</p>
            </div>
          )}

          {step === 'success' && (
            <div className="text-center py-8">
              <div className="inline-block rounded-full h-16 w-16 bg-green-500/20 mb-4 flex items-center justify-center">
                <span className="text-3xl">✓</span>
              </div>
              <p className="text-green-400 text-lg font-semibold mb-2">Authenticated!</p>
              <p className="text-sm text-gray-400">Session valid for {formatTime(timeRemaining)}</p>
            </div>
          )}

          {step === 'error' && (
            <div className="text-center py-8">
              <div className="inline-block rounded-full h-16 w-16 bg-red-500/20 mb-4 flex items-center justify-center">
                <span className="text-3xl">✕</span>
              </div>
              <p className="text-red-400 text-lg font-semibold mb-2">Authentication Failed</p>
              <p className="text-sm text-gray-400 mb-4">{error}</p>
              <button
                onClick={performAuthentication}
                className="px-6 py-2 bg-yellow-500 hover:bg-yellow-400 text-black font-semibold rounded-lg transition-colors"
              >
                Try Again
              </button>
            </div>
          )}
        </div>

        {/* Info Box */}
        <div className="mt-6 p-4 bg-black/30 rounded-lg border border-gray-700">
          <p className="text-xs text-gray-500">
            <strong className="text-yellow-500">Yellow App Sessions</strong> enable instant,
            gas-free gameplay. You&apos;ll sign once to authenticate, then play freely until the
            session expires.
          </p>
        </div>
      </motion.div>
    </div>
  )
}
