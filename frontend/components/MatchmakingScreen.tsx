'use client'

import { useState, useEffect, useRef } from 'react'
import { useTradingStore } from '@/game/stores/trading-store'
import { motion, AnimatePresence } from 'framer-motion'
import { GridScanBackground } from '@/components/GridScanBackground'
import { YellowAuthFlow } from '@/components/YellowAuthFlow'
import { usePrivy, useWallets, toViemAccount } from '@privy-io/react-auth'
import { signWithSessionKey } from '@/lib/yellow/authentication'
import { getRPCClient, stableStringify } from '@/lib/yellow/rpc-client'
import { keccak256, toHex } from 'viem'
import type { Address } from 'viem'

// Type for stored auth session (includes private key for client-side signing)
interface StoredAuthSession {
  address: Address
  sessionKey: Address
  sessionKeyPrivate: `0x${string}`
  jwtToken: string
  expiresAt: number
  wallet?: any // Store the wallet object for later signing
}

const BOTTOM_DOTS_COUNT = 7

const TRADER_NAMES = [
  'Alfa',
  'Bravo',
  'Charlie',
  'Delta',
  'Echo',
  'Foxtrot',
  'Golf',
  'Hotel',
  'India',
  'Juliet',
]

const BUTTON_TRANSITION = { duration: 2, repeat: Infinity, ease: 'easeInOut' as const }

/**
 * Sign a message string with the main wallet
 *
 * CRITICAL: For create_app_session, we need MAIN WALLET signatures (not session key signatures)
 * because the participants array contains wallet addresses per Yellow's spec.
 *
 * This function:
 * 1. First tries to use the stored wallet from auth session (most reliable)
 * 2. Falls back to looking up the wallet from the wallets ref by address
 * 3. Gets the viem account from the Privy wallet using toViemAccount
 * 4. Signs the message with the account (ECDSA signing per NitroRPC spec)
 *
 * @param walletAddress - The wallet address to look up
 * @param walletsRef - Ref containing the wallets array from useWallets()
 * @param authSession - The stored auth session (may contain the wallet object)
 * @param message - The message string to sign
 * @returns ECDSA signature as hex string
 */
async function signWithWallet(
  walletAddress: string,
  walletsRef: React.MutableRefObject<any[]>,
  authSession: StoredAuthSession | null,
  message: string
): Promise<string> {
  console.log('[Matchmaking] Looking up wallet for signing:', {
    walletAddress,
    hasAuthSession: !!authSession,
    hasStoredWallet: !!authSession?.wallet,
    walletsRefLength: walletsRef.current.length,
  })

  // First try to use the stored wallet from auth session (most reliable - from YellowAuthFlow)
  let wallet = authSession?.wallet

  // Fall back to looking up from wallets ref (in case auth session doesn't have it)
  if (!wallet) {
    const wallets = walletsRef.current
    wallet = wallets.find((w) => w.address.toLowerCase() === walletAddress.toLowerCase())
    console.log('[Matchmaking] Wallet not in auth session, trying wallets ref:', {
      walletsRefLength: wallets.length,
    })
  }

  if (!wallet) {
    console.error('[Matchmaking] Wallet not found in Privy wallets or auth session:', {
      walletAddress,
      walletsRefAddresses: walletsRef.current.map((w) => w.address),
      hasAuthSession: !!authSession,
      hasStoredWallet: !!authSession?.wallet,
    })
    throw new Error(`Wallet not found: ${walletAddress}`)
  }

  console.log('[Matchmaking] Wallet found, creating viem account for signing:', {
    walletAddress: wallet.address,
    walletType: wallet?.type,
  })

  // Get the viem account for client-side signing (same approach as YellowAuthFlow)
  const account = await toViemAccount({ wallet })

  console.log('[Matchmaking] viem account created for wallet signing')

  // Sign the message with the viem account
  // The account.signMessage handles the hashing internally
  const signature = await account.signMessage({ message })

  console.log('[Matchmaking] Main wallet signature created:', {
    prefix: signature.slice(0, 10) + '...',
    length: signature.length,
    isValidLength: signature.length === 132,
  })

  return signature
}

type MatchState =
  | 'login'
  | 'claim'
  | 'ready'
  | 'checking'
  | 'insufficient'
  | 'entering'
  | 'depositing' // Yellow deposit flow active

export function MatchmakingScreen() {
  const { ready, authenticated, login, logout, user } = usePrivy()
  const { wallets } = useWallets()
  const { isConnected, isMatching, findMatch, connect, socket } = useTradingStore()
  // TODO: Replace with App Session manager
  // const channelManager = getChannelManager()

  const [playerName] = useState(() => {
    const name = TRADER_NAMES[Math.floor(Math.random() * TRADER_NAMES.length)]
    const suffix = Math.floor(Math.random() * 999)
    return `${name}${suffix}`
  })

  const [matchState, setMatchState] = useState<MatchState>('login')
  const [usdcBalance, setUsdcBalance] = useState<string>('0')
  const [isClaiming, setIsClaiming] = useState(false)

  // Yellow App Session authentication state
  const [showAuthFlow, setShowAuthFlow] = useState(false)
  const [authComplete, setAuthComplete] = useState(false)
  // Store auth session data for client-side signing
  const authSessionRef = useRef<StoredAuthSession | null>(null)
  // Store wallets for app session signing (useWallets may be empty during signature request)
  const walletsRef = useRef<any[]>([])

  // Update wallets ref when wallets array changes
  useEffect(() => {
    walletsRef.current = wallets
    console.log('[Matchmaking] Wallets ref updated:', {
      walletCount: wallets.length,
      addresses: wallets.map((w) => w.address),
    })
  }, [wallets])

  // Connect to Socket.IO when component mounts
  useEffect(() => {
    connect()
  }, [connect])

  // Listen for Yellow App Session events
  useEffect(() => {
    if (!socket) return

    // Match found - need to authenticate both players before app session
    const handleMatchFound = (data: {
      roomId: string
      channelId: string
      players: Array<{ id: string; name: string }>
    }) => {
      console.log('[Matchmaking] Match found, need to authenticate with Yellow:', data)
      // Show auth flow for Yellow Network authentication
      setShowAuthFlow(true)
    }

    // App session is ready - game can start
    const handleAppSessionReady = (data: {
      appSessionId: string
      gameState: any
      canStart: boolean
    }) => {
      console.log('[Matchmaking] App session ready, game starting...')
      setShowAuthFlow(false)
      // Game will start automatically via round_start event
    }

    // Authentication success
    const handleAuthSuccess = (data: { walletAddress: string; authenticated: boolean }) => {
      console.log('[Matchmaking] Authentication successful:', data)
      setAuthComplete(true)
    }

    // Round starting
    const handleRoundStart = () => {
      console.log('[Matchmaking] Round starting, closing auth flow')
      setShowAuthFlow(false)
    }

    // Server requests client to create app session (using client's authenticated RPC connection)
    const handleSignAppSession = async (data: {
      role: string
      walletAddress: string
      createParams: {
        definition: any
        allocations: any[]
        session_data: string
      }
      nonce: number
      requestId?: number
      timestamp?: number
      isFirstParticipant?: boolean // CRITICAL: Server tells us if we're first
    }) => {
      console.log('[Matchmaking] ════════════════════════════════════════════════════════════════')
      console.log('[Matchmaking] Received app session signature request')
      console.log('[Matchmaking] Request details:', {
        role: data.role,
        walletAddress: data.walletAddress,
        nonce: data.nonce,
        requestId: data.requestId,
        timestamp: data.timestamp,
        timestampAsDate: data.timestamp ? new Date(data.timestamp).toISOString() : 'not provided',
        isFirstParticipant: data.isFirstParticipant,
        createParams: {
          definition: JSON.stringify(data.createParams.definition, null, 2),
          allocations: data.createParams.allocations,
          sessionDataLength: data.createParams.session_data?.length,
          sessionDataPrefix: data.createParams.session_data?.slice(0, 100) + '...',
        },
      })
      console.log('[Matchmaking] ════════════════════════════════════════════════════════════════')

      const authSession = authSessionRef.current
      if (!authSession) {
        console.error('[Matchmaking] No auth session found - cannot sign app session')
        socket.emit('yellow_app_session_result', {
          success: false,
          error: 'Not authenticated',
        })
        return
      }

      console.log('[Matchmaking] Auth session found:', {
        address: authSession.address,
        sessionKey: authSession.sessionKey,
      })

      try {
        // CRITICAL: Use the isFirstParticipant flag from the server instead of computing locally
        // The server correctly determines the position based on sorted session key addresses
        const isFirstParticipant = data.isFirstParticipant ?? false
        const sortedAddresses = data.createParams.definition.participants as string[]

        console.log('[Matchmaking] Participant order (from server):', {
          sortedAddresses,
          myWalletAddress: authSession.address,
          mySessionKey: authSession.sessionKey.toLowerCase(),
          isFirstParticipant,
          serverProvidedFlag: data.isFirstParticipant,
          note: isFirstParticipant
            ? 'I will create the app session'
            : 'Waiting for other participant to create',
        })

        if (!isFirstParticipant) {
          console.log('[Matchmaking] Not first participant - just sending signature to server')
          // Second participant: just send signature to server
          // CRITICAL: Payload must match what RPC client sends: [requestId, method, params, timestamp]
          // Use the requestId and timestamp provided by the server - DON'T generate our own!
          const requestId = data.requestId || data.nonce
          const timestamp = data.timestamp || Date.now()

          // Warn if server didn't provide timestamp (shouldn't happen with proper orchestration)
          if (!data.timestamp) {
            console.warn(
              '[Matchmaking] ⚠️ WARNING: Server did not provide timestamp - using local time. This may cause signature mismatch!'
            )
          }

          // Pass createParams directly - RPC client will wrap it
          // NitroRPC/0.4 spec expects [requestId, method, [{...params}], timestamp]
          // RPC client handles the wrapping: finalParams = [params]
          const payload = [requestId, 'create_app_session', data.createParams, timestamp] as [
            number,
            string,
            any,
            number,
          ]

          const payloadString = stableStringify(payload)

          console.log('[Matchmaking] Payload to sign (second participant):', {
            requestId,
            timestamp,
            timestampAsDate: new Date(timestamp).toISOString(),
            payloadString,
            payloadLength: payloadString.length,
          })

          // CRITICAL FIX: Use MAIN WALLET signature (not session key signature)
          // Per Yellow's spec, participants array contains wallet addresses,
          // so signatures must recover to wallet addresses, not session key addresses
          const signature = await signWithWallet(
            user.wallet.address,
            walletsRef,
            authSessionRef.current,
            payloadString
          )

          console.log('[Matchmaking] Signature sent to server (as second participant):', {
            prefix: signature.slice(0, 10) + '...',
            length: signature.length,
            note: 'Using main wallet signature - recovers to wallet address',
          })

          socket.emit('yellow_app_session_signature', {
            walletAddress: authSession.address,
            sessionKeyAddress: authSession.sessionKey?.toLowerCase(), // Still include for lookup consistency
            signature,
            nonce: data.nonce,
            requestId, // Echo back the requestId we used
            timestamp, // Echo back the timestamp we used
          })
          return
        }

        // First participant: Create signature and request other player's signature
        console.log('[Matchmaking] I am first participant - will create app session')

        // Build and sign the payload
        // CRITICAL: Payload must match what RPC client sends: [requestId, method, params, timestamp]
        // Use the requestId and timestamp provided by the server - DON'T generate our own!
        const requestId = data.requestId || data.nonce
        const timestamp = data.timestamp || Date.now()

        // Warn if server didn't provide timestamp (shouldn't happen with proper orchestration)
        if (!data.timestamp) {
          console.warn(
            '[Matchmaking] ⚠️ WARNING: Server did not provide timestamp - using local time. This may cause signature mismatch!'
          )
        }

        // Pass createParams directly - RPC client will wrap it
        // NitroRPC/0.4 spec expects [requestId, method, [{...params}], timestamp]
        // RPC client handles the wrapping: finalParams = [params]
        const payload = [requestId, 'create_app_session', data.createParams, timestamp] as [
          number,
          string,
          any,
          number,
        ]

        const payloadString = stableStringify(payload)

        console.log('[Matchmaking] Creating signature for app session')
        console.log('[Matchmaking] Payload to sign (first participant):', {
          requestId,
          timestamp,
          payloadString,
          payloadLength: payloadString.length,
        })

        // CRITICAL FIX: Use MAIN WALLET signature (not session key signature)
        // Per Yellow's spec, participants array contains wallet addresses,
        // so signatures must recover to wallet addresses, not session key addresses
        const mySignature = await signWithWallet(
          user.wallet.address,
          walletsRef,
          authSessionRef.current,
          payloadString
        )

        console.log('[Matchmaking] ✓ My signature created:', {
          prefix: mySignature.slice(0, 10) + '...',
          length: mySignature.length,
          note: 'Using main wallet signature - recovers to wallet address',
        })

        // Send my signature to server
        console.log('[Matchmaking] Sending my signature to server:', {
          walletAddress: authSession.address,
          signaturePrefix: mySignature.slice(0, 10) + '...',
          nonce: data.nonce,
          requestId,
          timestamp,
        })

        socket.emit('yellow_app_session_signature', {
          walletAddress: authSession.address,
          sessionKeyAddress: authSession.sessionKey?.toLowerCase(), // CRITICAL: Must be lowercase for consistent lookup
          signature: mySignature,
          nonce: data.nonce,
          requestId, // Include requestId so server can forward to other participant
          timestamp, // Include timestamp so other participant uses same
        })

        console.log('[Matchmaking] ✓ My signature sent to server - waiting for other player...')

        // Listen for the server to notify us when both signatures are ready
        // Then we'll make the RPC call with both signatures
        const handleBothSignaturesReady = async (signatureData: {
          signature1: string
          signature2: string
          sortedAddresses: string[]
          requestId?: number
          timestamp?: number
        }) => {
          console.log(
            '[Matchmaking] ════════════════════════════════════════════════════════════════'
          )
          console.log('[Matchmaking] ★★ yellow_both_signatures_ready event received! ★★')
          console.log('[Matchmaking] Both signatures ready from server!')
          console.log('[Matchmaking] Signature details:', {
            sig1Prefix: signatureData.signature1.slice(0, 10) + '...',
            sig2Prefix: signatureData.signature2.slice(0, 10) + '...',
            sortedAddresses,
            myAddress: authSession.address,
            myAddressLower: authSession.address.toLowerCase(),
            requestId: signatureData.requestId,
            timestamp: signatureData.timestamp,
            timestampAsDate: signatureData.timestamp
              ? new Date(signatureData.timestamp).toISOString()
              : 'not provided',
          })
          console.log(
            '[Matchmaking] ════════════════════════════════════════════════════════════════'
          )
          console.log('[Matchmaking] Making create_app_session RPC call with both signatures')

          const rpcClient = getRPCClient()

          // Log RPC client state before call
          console.log('[Matchmaking] RPC client state before call:', {
            isConnected: rpcClient.isConnected,
            state: rpcClient.state,
            url: (rpcClient as any).url?.slice(0, 50) + '...',
          })

          // Ensure connected
          if (!rpcClient.isConnected) {
            console.log('[Matchmaking] RPC client not connected, connecting...')
            await rpcClient.connect()
            console.log('[Matchmaking] RPC client connected')
          }

          try {
            // CRITICAL: Use the requestId and timestamp that were used for signing
            // This ensures the RPC request matches exactly what was signed
            const rpcRequestId = signatureData.requestId || data.nonce
            const rpcTimestamp = signatureData.timestamp || Date.now()

            console.log('[Matchmaking] About to make RPC call with:', {
              requestId: rpcRequestId,
              timestamp: rpcTimestamp,
              timestampAsDate: new Date(rpcTimestamp).toISOString(),
              signature1Prefix: signatureData.signature1.slice(0, 10),
              signature2Prefix: signatureData.signature2.slice(0, 10),
              createParamsDefinitionParticipants: data.createParams.definition.participants,
              sortedAddresses: signatureData.sortedAddresses,
            })

            // Build the exact payload that was signed to verify
            // Pass createParams directly - RPC client will wrap it
            const verifyPayload = [
              rpcRequestId,
              'create_app_session',
              data.createParams,
              rpcTimestamp,
            ] as [number, string, any, number]
            const verifyPayloadString = stableStringify(verifyPayload)

            // CRITICAL: Log the exact createParams JSON for verification
            const createParamsString = stableStringify(data.createParams)
            console.log('[Matchmaking] createParams JSON:', {
              json: createParamsString,
              length: createParamsString.length,
              keysOrder: Object.keys(data.createParams),
            })

            console.log('[Matchmaking] Payload that WILL be sent to RPC:', {
              payload: verifyPayloadString,
              length: verifyPayloadString.length,
            })

            // Also log what we signed earlier
            console.log('[Matchmaking] Original signed payload (for comparison):', {
              requestId: data.requestId,
              timestamp: data.timestamp,
              nonce: data.nonce,
            })

            console.log('[Matchmaking] Calling rpcClient.call()...')

            // CRITICAL: Ensure we have a fresh connection before making the RPC call
            // If there were any reconnections, the session key might have been de-registered
            // We need to verify the connection is stable and re-authenticate if needed
            console.log('[Matchmaking] Verifying connection state before RPC call...')

            // Force reconnect if connection was lost to get fresh auth state
            if (rpcClient.state !== 'connected') {
              console.log('[Matchmaking] Connection lost, reconnecting...')
              await rpcClient.connect()
              // Additional wait after reconnect for session key registration
              await new Promise((resolve) => setTimeout(resolve, 1000))
            } else {
              // Even if connected, wait a bit to ensure no pending reconnection
              console.log('[Matchmaking] Waiting 1000ms for stable connection...')
              await new Promise((resolve) => setTimeout(resolve, 1000))
            }

            // Build the exact payload that was signed
            // Pass createParams directly - RPC client will wrap it
            const rpcPayload = [
              rpcRequestId,
              'create_app_session',
              data.createParams,
              rpcTimestamp,
            ] as [number, string, any, number]
            const rpcPayloadString = stableStringify(rpcPayload)

            console.log('[Matchmaking] Verifying payload matches signed version:', {
              payloadString: rpcPayloadString,
              payloadLength: rpcPayloadString.length,
            })

            // CRITICAL: Verify signature order matches participants order
            const participants = data.createParams.definition.participants as string[]
            console.log('[Matchmaking] Verifying signature order:', {
              participants,
              sig1For: signatureData.sortedAddresses[0],
              sig2For: signatureData.sortedAddresses[1],
              participantsInRequest: participants,
              orderMatches:
                JSON.stringify(participants) === JSON.stringify(signatureData.sortedAddresses),
              // CRITICAL: The signature array must match participants order
              sigArrayToSend: [
                {
                  index: 0,
                  for: signatureData.sortedAddresses[0],
                  prefix: signatureData.signature1.slice(0, 10),
                },
                {
                  index: 1,
                  for: signatureData.sortedAddresses[1],
                  prefix: signatureData.signature2.slice(0, 10),
                },
              ],
            })

            // Call create_app_session with BOTH signatures on THIS authenticated connection
            // CRITICAL: Pass requestId and timestamp so the RPC request matches exactly what was signed
            // CRITICAL FIX: Wrap params in array since RPC client no longer auto-wraps
            const response = await rpcClient.call<any>(
              'create_app_session',
              [data.createParams], // Wrap in array for NitroRPC/0.4 spec
              [signatureData.signature1, signatureData.signature2], // Both signatures!
              { requestId: rpcRequestId, timestamp: rpcTimestamp } // Must match signed payload!
            )

            console.log('[Matchmaking] ✓ App session created successfully!', {
              appSessionId: response.app_session_id,
              status: response.status,
              version: response.version,
            })
            console.log(
              '[Matchmaking] ════════════════════════════════════════════════════════════════'
            )

            // Notify server of success
            socket.emit('yellow_app_session_result', {
              success: true,
              appSessionId: response.app_session_id,
              appSession: {
                appSessionId: response.app_session_id,
                definition: data.createParams.definition,
                allocations: data.createParams.allocations,
                gameState: JSON.parse(data.createParams.session_data),
                status: response.status,
                version: response.version,
                createdAt: Date.now(),
              },
            })
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error'
            console.error(
              '[Matchmaking] ════════════════════════════════════════════════════════════════'
            )
            console.error('[Matchmaking] ★★ create_app_session RPC CALL FAILED! ★★')
            console.error('[Matchmaking] Error:', {
              errorMessage,
              errorName: error instanceof Error ? error.name : undefined,
              errorString: String(error),
              stack: error instanceof Error ? error.stack : undefined,
            })
            console.error(
              '[Matchmaking] ════════════════════════════════════════════════════════════════'
            )

            // Notify server of failure
            socket.emit('yellow_app_session_result', {
              success: false,
              error: errorMessage,
            })

            // Keep auth flow visible and show error - don't reset to ready
            // The user should see the error state, not return to the "Enter" screen
            setShowAuthFlow(true)
            setMatchState('entering') // Stay in entering state
          }

          // Clean up listener
          socket.off('yellow_both_signatures_ready', handleBothSignaturesReady)
        }

        socket.once('yellow_both_signatures_ready', handleBothSignaturesReady)

        console.log('[Matchmaking] Registered yellow_both_signatures_ready listener')
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'

        console.error('[Matchmaking] App session signature creation failed:', {
          errorMessage,
          errorName: error instanceof Error ? error.name : undefined,
          stack: error instanceof Error ? error.stack : undefined,
        })

        socket.emit('yellow_app_session_result', {
          success: false,
          error: errorMessage,
        })
      }
    }

    // Handle app session creation success (from another player)
    const handleAppSessionCreated = (data: {
      appSessionId: string
      gameState: any
      youAre: string
    }) => {
      console.log('[Matchmaking] App session created by other player:', {
        appSessionId: data.appSessionId,
        youAre: data.youAre,
      })
      setShowAuthFlow(false)
      setMatchState('ready')
    }

    socket.on('match_found', handleMatchFound)
    socket.on('yellow_app_session_ready', handleAppSessionReady)
    socket.on('yellow_auth_success', handleAuthSuccess)
    socket.on('round_start', handleRoundStart)
    socket.on('yellow_sign_app_session', handleSignAppSession)
    socket.on('yellow_app_session_created', handleAppSessionCreated) // Listen for successful creation

    // NOTE: yellow_request_wallet_signature is now handled at page level
    // to ensure it persists during gameplay when MatchmakingScreen is unmounted

    return () => {
      socket.off('match_found', handleMatchFound)
      socket.off('yellow_app_session_ready', handleAppSessionReady)
      socket.off('yellow_auth_success', handleAuthSuccess)
      socket.off('round_start', handleRoundStart)
      socket.off('yellow_sign_app_session', handleSignAppSession)
      socket.off('yellow_app_session_created', handleAppSessionCreated)
    }
  }, [socket, ready, user?.wallet])

  // Update match state based on auth - check balance immediately
  useEffect(() => {
    if (authenticated && user?.wallet) {
      // Check balance on login to determine correct state
      checkBalance()
    } else if (!authenticated) {
      setMatchState('login')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, user?.wallet])

  const handleClaimFaucet = async () => {
    if (!authenticated || !ready || !user?.wallet) {
      alert('Please login first.')
      return
    }

    setIsClaiming(true)
    try {
      const claimResponse = await fetch('/api/claim-usdc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userWalletAddress: user.wallet.address,
          userId: user.id,
        }),
      })

      const claimData = await claimResponse.json()

      if (claimResponse.ok && claimData.claimTx?.hash) {
        setMatchState('checking')

        // Poll for transaction confirmation + balance update
        const maxRetries = 20
        const delayMs = 1000

        for (let i = 0; i < maxRetries; i++) {
          await new Promise((resolve) => setTimeout(resolve, delayMs))

          // TODO: Replace with App Session balance check
          // const result = await channelManager.checkBalance(user.wallet.address)
          // setUsdcBalance(result.formatted || '0')

          // if (result.hasEnough) {
          //   setMatchState('ready')
          //   return
          // }

          setUsdcBalance('0') // TODO: Remove
        }

        // If we still don't have enough after retries, show insufficient
        setMatchState('insufficient')
      } else {
        alert('Claim failed: ' + (claimData.error || 'Unknown error'))
        setIsClaiming(false)
      }
    } catch {
      alert('Something went wrong. Please try again.')
      setIsClaiming(false)
    } finally {
      setIsClaiming(false)
    }
  }

  const checkBalance = async () => {
    if (!user?.wallet) return

    setMatchState('checking')
    try {
      // TODO: Replace with App Session balance check
      // const result = await channelManager.checkBalance(user.wallet.address)
      // setUsdcBalance(result.formatted || '0')
      const result = { hasEnough: true, formatted: '0' } // Stub
      setUsdcBalance(result.formatted || '0')

      if (result.hasEnough) {
        setMatchState('ready')
      } else {
        setMatchState('insufficient')
      }
    } catch (error) {
      console.error('Balance check error:', error)
      setMatchState('insufficient')
    }
  }

  const handleEnter = async () => {
    if (!isConnected || isMatching || !user?.wallet) return

    // TODO: Replace with App Session balance check
    // const balanceResult = await channelManager.checkBalance(user.wallet.address)
    // if (!balanceResult.hasEnough) {
    //   setUsdcBalance(balanceResult.formatted || '0')
    //   setMatchState('insufficient')
    //   return
    // }

    // Start matchmaking immediately (deposit flow will show after match found)
    setMatchState('entering')
    findMatch(playerName, user.wallet.address)
  }

  if (!ready) {
    return (
      <div className="min-h-screen relative flex items-center justify-center overflow-hidden">
        <GridScanBackground />
        <motion.p
          className="relative z-20 font-[family-name:var(--font-orbitron)] text-cyan-400 tracking-widest"
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 1.5, repeat: Infinity }}
        >
          INITIALIZING...
        </motion.p>
      </div>
    )
  }

  return (
    <div className="min-h-screen relative flex items-center justify-center overflow-hidden">
      <GridScanBackground />

      {/* Yellow App Session Authentication Flow */}
      {user?.wallet && showAuthFlow && (
        <YellowAuthFlow
          walletAddress={user.wallet.address as `0x${string}`}
          socket={socket}
          onComplete={(authSession) => {
            console.log('[Matchmaking] Auth complete, notifying server:', {
              address: authSession.address,
              sessionKey: authSession.sessionKey?.slice(0, 10) + '...',
            })

            // Store auth session for client-side signing
            authSessionRef.current = {
              address: authSession.address as Address,
              sessionKey: authSession.sessionKey as Address,
              sessionKeyPrivate: authSession.sessionKeyPrivate as `0x${string}`,
              jwtToken: authSession.jwtToken,
              expiresAt: authSession.expiresAt,
            }

            socket.emit('yellow_auth_complete', {
              walletAddress: authSession.address,
              jwtToken: authSession.jwtToken,
              sessionKey: authSession.sessionKey,
              sessionKeyPrivate: authSession.sessionKeyPrivate,
              expiresAt: authSession.expiresAt,
            })
            setAuthComplete(true)
          }}
          onClose={() => {
            setShowAuthFlow(false)
            // If auth was complete, stay in entering state; otherwise go back to ready
            if (!authComplete) {
              setMatchState('ready')
            }
          }}
        />
      )}

      {/* Scanline overlay */}
      <div className="fixed inset-0 pointer-events-none z-10 opacity-15">
        <motion.div
          className="w-full h-px bg-cyan-400"
          animate={{ y: ['-10%', '110%'] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
        />
      </div>

      {/* Main Content */}
      <div className="relative z-20 flex flex-col items-center gap-12 px-6">
        {/* Title */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.2, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="text-center"
        >
          <h1 className="font-[family-name:var(--font-orbitron)] text-xl sm:text-2xl md:text-3xl lg:text-4xl font-bold tracking-[0.25em] text-white">
            ENTER THE GRID
          </h1>
          <motion.h2
            className="font-[family-name:var(--font-orbitron)] text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold tracking-[0.2em] text-cyan-400"
            animate={{
              textShadow: [
                '0 0 20px rgba(0,217,255,0.4)',
                '0 0 40px rgba(0,217,255,0.8)',
                '0 0 20px rgba(0,217,255,0.4)',
              ],
            }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          >
            GRID
          </motion.h2>
        </motion.div>

        {/* Auth Section */}
        <div className="flex flex-col items-center gap-4">
          <AnimatePresence mode="wait">
            {matchState === 'login' && (
              <motion.div
                key="login"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.4 }}
                className="flex flex-col items-center gap-4"
              >
                <p className="text-gray-400 text-sm tracking-wider">CONNECT TO PLAY</p>
                <ActionButton onClick={login} color="indigo">
                  LOGIN WITH GOOGLE
                </ActionButton>
              </motion.div>
            )}

            {matchState === 'claim' && (
              <motion.div
                key="claim"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.4 }}
                className="flex flex-col items-center gap-3"
              >
                <p className="text-gray-400 text-xs tracking-wider">CLAIM 0.1 USDC TO START</p>
                <ActionButton onClick={handleClaimFaucet} isLoading={isClaiming} color="green">
                  {isClaiming ? 'CLAIMING...' : 'GET 0.1 USDC'}
                </ActionButton>
              </motion.div>
            )}

            {matchState === 'checking' && (
              <motion.div
                key="checking"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.4 }}
                className="flex flex-col items-center gap-3"
              >
                <p className="text-cyan-400 text-xs tracking-wider animate-pulse">
                  CHECKING BALANCE...
                </p>
              </motion.div>
            )}

            {matchState === 'insufficient' && (
              <motion.div
                key="insufficient"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.4 }}
                className="flex flex-col items-center gap-3"
              >
                <p className="text-yellow-400 text-xs tracking-wider">
                  BALANCE: {usdcBalance} USDC (NEED 10.0)
                </p>
                <ActionButton onClick={handleClaimFaucet} isLoading={isClaiming} color="green">
                  {isClaiming ? 'CLAIMING...' : 'CLAIM USDC'}
                </ActionButton>
                <button
                  onClick={checkBalance}
                  className="text-xs text-gray-400 hover:text-gray-300 transition-colors"
                >
                  REFRESH BALANCE
                </button>
              </motion.div>
            )}

            {matchState === 'ready' && (
              <motion.div
                key="ready"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.4 }}
                className="flex flex-col items-center gap-3"
              >
                <p className="text-green-400 text-xs tracking-wider">
                  ✓ READY ({usdcBalance} USDC)
                </p>
                <ActionButton
                  onClick={handleEnter}
                  disabled={!isConnected || isMatching}
                  color="cyan"
                >
                  {isMatching ? 'ENTERING...' : 'ENTER'}
                </ActionButton>
                <button
                  onClick={logout}
                  className="text-xs text-gray-500 hover:text-gray-400 transition-colors"
                >
                  LOGOUT
                </button>
              </motion.div>
            )}

            {matchState === 'entering' && (
              <motion.div
                key="entering"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.4 }}
                className="flex flex-col items-center gap-3"
              >
                <p className="text-cyan-400 text-xs tracking-wider animate-pulse">
                  FINDING OPPONENT...
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Bottom dots */}
      <div className="fixed bottom-12 left-0 right-0 z-20 flex justify-center gap-2">
        {[...Array(BOTTOM_DOTS_COUNT)].map((_, i) => (
          <motion.div
            key={i}
            className="w-0.5 h-0.5 bg-cyan-400/40"
            animate={{ opacity: [0.2, 1, 0.2], scaleY: [1, 2, 1] }}
            transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
          />
        ))}
      </div>
    </div>
  )
}

type ActionButtonProps = {
  children: string
  onClick: () => void
  color: 'indigo' | 'green' | 'cyan' | 'yellow'
  isLoading?: boolean
  disabled?: boolean
}

const COLOR_CONFIG = {
  indigo: { border: 'border-indigo-400/30', text: 'text-indigo-300', glow: 'rgba(99,102,241,0.6)' },
  green: { border: 'border-green-400/30', text: 'text-green-300', glow: 'rgba(34,197,94,0.6)' },
  cyan: { border: 'border-cyan-400/30', text: 'text-cyan-300', glow: 'rgba(0,217,255,0.6)' },
  yellow: { border: 'border-yellow-400/30', text: 'text-yellow-300', glow: 'rgba(250,204,21,0.6)' },
}

function ActionButton({
  children,
  onClick,
  color,
  isLoading = false,
  disabled = false,
}: ActionButtonProps) {
  const config = COLOR_CONFIG[color]
  const isInteractive = !isLoading && !disabled

  return (
    <motion.button
      onClick={onClick}
      disabled={disabled || isLoading}
      className="relative group"
      whileHover={isInteractive ? { scale: 1.02 } : undefined}
      whileTap={isInteractive ? { scale: 0.98 } : undefined}
    >
      <motion.div
        className="absolute inset-0 rounded-lg"
        animate={{
          boxShadow: isInteractive
            ? [`0 0 20px ${config.glow}40`, `0 0 60px ${config.glow}`, `0 0 20px ${config.glow}40`]
            : '0 0 10px rgba(255,255,255,0.1)',
        }}
        transition={BUTTON_TRANSITION}
      />
      <div
        className={`relative px-12 py-3 bg-black/40 backdrop-blur-md border ${config.border} rounded`}
      >
        <motion.span
          className={`font-[family-name:var(--font-orbitron)] text-[10px] tracking-[0.3em] font-medium block ${config.text}`}
          animate={
            isInteractive
              ? {
                  textShadow: [
                    `0 0 10px ${config.glow}80`,
                    `0 0 20px ${config.glow}`,
                    `0 0 10px ${config.glow}80`,
                  ],
                }
              : {}
          }
          transition={BUTTON_TRANSITION}
        >
          {children}
        </motion.span>
      </div>
    </motion.button>
  )
}
