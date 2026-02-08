'use client'

import { useTradingStore } from '@/game/stores/trading-store'
import { MatchmakingScreen } from '@/components/MatchmakingScreen'
import { GameHUD } from '@/components/GameHUD'
import { PositionIndicator } from '@/components/PositionIndicator'
import { GameCanvasBackground } from '@/components/GameCanvasBackground'
import { ToastNotifications } from '@/components/ToastNotifications'
import { GameOverModal } from '@/components/GameOverModal'
import { SettlementFlash } from '@/components/SettlementFlash'
import { RoundEndFlash } from '@/components/RoundEndFlash'
import GameCanvas from '@/components/GameCanvas'
import { useEffect, useRef } from 'react'

/**
 * YellowSessionKeySignatureHandler
 *
 * CRITICAL: This component MUST remain mounted throughout gameplay to handle session key
 * signature requests from the server. The MatchmakingScreen is unmounted when the
 * game starts, so we register the event listener at the page level.
 *
 * Session keys auto-sign without user interaction for:
 * - submit_app_state: After each round ends
 * - close_app_session: When game completes
 *
 * The session key private key is stored in memory from the initial authentication.
 */
function YellowSessionKeySignatureHandler() {
  const { socket } = useTradingStore()
  const handlerRef = useRef<((data: unknown) => void) | null>(null)

  // Store session key private key from YellowAuthFlow
  // This is set when the user completes authentication
  const sessionKeyPrivateRef = useRef<`0x${string}` | null>(null)

  // Listen for authentication complete event to capture session key
  useEffect(() => {
    console.log(
      '[Page] AUTH HANDLER useEffect running, socket:',
      !!socket,
      'socket.id:',
      socket?.id
    )

    if (!socket) {
      console.log('[Page] AUTH HANDLER: No socket, returning early')
      return
    }

    console.log('[Page] Setting up auth complete listener')

    const handleAuthComplete = (data: {
      walletAddress: string
      sessionKey: string
      sessionKeyPrivate: string
      jwtToken: string
      expiresAt: number
    }) => {
      console.log('[Page] ════════════════════════════════════════════════════════════════')
      console.log('[Page] yellow_auth_complete event received!')
      console.log('[Page] Storing session key private key for auto-signing:', {
        walletAddress: data.walletAddress,
        sessionKey: data.sessionKey,
        sessionKeyPrivatePrefix: data.sessionKeyPrivate?.slice(0, 10) + '...',
      })
      console.log('[Page] ════════════════════════════════════════════════════════════════')
      sessionKeyPrivateRef.current = data.sessionKeyPrivate as `0x${string}`
    }

    socket.on('yellow_auth_complete', handleAuthComplete)

    console.log(
      '[Page] ✓ Auth complete listener registered, socket listeners:',
      socket.eventNames?.()
    )

    return () => {
      console.log('[Page] Cleaning up auth complete listener')
      socket.off('yellow_auth_complete', handleAuthComplete)
    }
  }, [socket])

  useEffect(() => {
    console.log(
      '[Page] SIGNATURE HANDLER useEffect running, socket:',
      !!socket,
      'socket.id:',
      socket?.id
    )

    if (!socket) {
      console.log('[Page] SIGNATURE HANDLER: No socket, returning early')
      return
    }

    console.log('[Page] Setting up session key signature handler')

    // Create stable handler function that we can remove later
    const handleRequestSessionKeySignature = async (data: {
      method: 'submit_app_state' | 'close_app_session'
      requestId: number
      timestamp: number
      payloadString: string // Pre-built JSON string to sign
    }) => {
      console.log('[Page] ════════════════════════════════════════════════════════════════')
      console.log('[Page] Received session key signature request:', {
        method: data.method,
        requestId: data.requestId,
        timestamp: data.timestamp,
      })
      console.log('[Page] ════════════════════════════════════════════════════════════════')

      try {
        const sessionKeyPrivate = sessionKeyPrivateRef.current
        if (!sessionKeyPrivate) {
          console.error('[Page] Session key private key not found - user may not be authenticated')
          console.error('[Page] sessionKeyPrivateRef.current:', sessionKeyPrivateRef.current)
          return
        }

        console.log('[Page] Auto-signing with session key (no user interaction)')

        // Import signWithSessionKey from yellow/authentication
        const { signWithSessionKey } = await import('@/lib/yellow/authentication')

        // Sign with session key (auto-signed, no user interaction)
        const signature = await signWithSessionKey(sessionKeyPrivate, data.payloadString)

        console.log('[Page] ✓ Session key signature created:', {
          prefix: signature.slice(0, 10) + '...',
          length: signature.length,
        })

        // Submit signature to server
        socket.emit('yellow_session_key_signature_submit', {
          method: data.method,
          signature,
          requestId: data.requestId,
          timestamp: data.timestamp,
        })

        console.log('[Page] ✓ Session key signature submitted to server')
      } catch (error) {
        console.error('[Page] Error signing with session key:', error)
      }
    }

    handlerRef.current = handleRequestSessionKeySignature
    socket.on('yellow_request_session_key_signature', handleRequestSessionKeySignature)

    console.log('[Page] ✓ Session key signature handler registered')

    // Debug: Log session key state every 10 seconds
    const debugInterval = setInterval(() => {
      console.log('[Page] DEBUG - Session key state:', {
        hasSessionKey: !!sessionKeyPrivateRef.current,
        sessionKeyPrefix: sessionKeyPrivateRef.current?.slice(0, 10) + '...',
        socketConnected: socket.connected,
      })
    }, 10000)

    return () => {
      console.log('[Page] Cleaning up session key signature handler')
      clearInterval(debugInterval)
      if (handlerRef.current) {
        socket.off('yellow_request_session_key_signature', handlerRef.current)
      }
    }
  }, [socket])

  return null
}

export default function Home() {
  const { isPlaying, connect, resetGame, disconnectPriceFeed, toasts, removeToast } =
    useTradingStore()

  useEffect(() => {
    // Connect to socket on mount
    connect()

    // Cleanup on unmount
    return () => {
      resetGame()
      disconnectPriceFeed()
    }
  }, [connect, resetGame, disconnectPriceFeed])

  return (
    <div className="h-dvh w-screen bg-tron-black relative overflow-hidden">
      {/* Yellow session key signature handler - ALWAYS mounted */}
      <YellowSessionKeySignatureHandler />

      {/* ToastNotifications - ALWAYS visible, regardless of game state */}
      <ToastNotifications toasts={toasts} onRemove={removeToast} />

      {/* Game Over Modal - shows when game ends */}
      <GameOverModal />

      {/* Settlement Flash - shows when orders settle */}
      <SettlementFlash />

      {/* Round End Flash - shows round results */}
      <RoundEndFlash />

      {!isPlaying ? (
        <MatchmakingScreen />
      ) : (
        <>
          {/* Background */}
          <GameCanvasBackground />

          {/* Top UI Layer */}
          <GameHUD />

          {/* Game Canvas - Phaser Scene */}
          <GameCanvas scene="TradingScene" />

          {/* Bottom UI Layer */}
          <PositionIndicator />
        </>
      )}
    </div>
  )
}
