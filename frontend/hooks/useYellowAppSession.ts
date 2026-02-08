// React hook for Yellow Network App Sessions
// Handles authentication and app session management on the client side

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useTradingStore } from '@/game/stores/trading-store'
import type { Address } from 'viem'

// =============================================================================
// Types
// ============================================================================

export interface YellowAuthState {
  isAuthenticated: boolean
  walletAddress?: Address
  sessionKey?: Address
  sessionExpiresAt?: number
  error?: string
  isAuthenticating: boolean
}

export interface AppSessionState {
  appSessionId?: string
  roomId?: string
  status: 'none' | 'creating' | 'active' | 'settling' | 'closed'
  gameState?: {
    game: string
    round: number
    player1Score: number
    player2Score: number
    player1Wins: number
    player2Wins: number
  }
  version?: number
  allocations?: Array<{
    participant: string
    asset: string
    amount: string
  }>
  error?: string
}

export interface RoundUpdateParams {
  roomId: string
  round: number
  player1Score: number
  player2Score: number
  player1Wins: number
  player2Wins: number
  signature?: string
}

export interface SessionCloseResult {
  winnerAddress: Address
  loserAddress: Address
  finalScore: { player1: number; player2: number }
  winnerPayout: string
  loserPayout: string
}

// =============================================================================
// Hook
// ============================================================================

export function useYellowAppSession() {
  const socket = useTradingStore((state) => state.socket)
  const isConnected = useTradingStore((state) => state.isConnected)

  // Authentication state
  const [authState, setAuthState] = useState<YellowAuthState>({
    isAuthenticated: false,
    isAuthenticating: false,
  })

  // App session state
  const [appSession, setAppSession] = useState<AppSessionState>({
    status: 'none',
  })

  // Refs for timeout cleanup
  const authTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const signatureResolverRef = useRef<{
    resolve: (signature: string) => void
    reject: (error: Error) => void
  } | null>(null)

  // -------------------------------------------------------------------------
  // Authentication
  // -------------------------------------------------------------------------

  /**
   * Authenticate with Yellow Network
   *
   * This initiates the 3-step authentication flow:
   * 1. auth_request (public, no signature)
   * 2. auth_challenge (returns UUID)
   * 3. auth_verify (requires EIP-712 signature)
   */
  const authenticate = useCallback(
    async (
      walletAddress: Address,
      signTypedData: (params: {
        domain: { name: string }
        types: any
        primaryType: string
        message: any
      }) => Promise<string>
    ): Promise<boolean> => {
      if (!socket || !isConnected) {
        setAuthState((prev) => ({ ...prev, error: 'Socket not connected' }))
        return false
      }

      setAuthState((prev) => ({
        ...prev,
        isAuthenticating: true,
        error: undefined,
      }))

      return new Promise((resolve) => {
        // Set up timeout
        authTimeoutRef.current = setTimeout(() => {
          setAuthState((prev) => ({
            ...prev,
            isAuthenticating: false,
            error: 'Authentication timeout',
          }))
          resolve(false)
        }, 30000)

        // Send authentication request
        socket.emit(
          'yellow_authenticate',
          {
            walletAddress,
            signTypedData,
          },
          (response: {
            success: boolean
            error?: string
            walletAddress?: Address
            sessionKey?: Address
            expiresIn?: number
          }) => {
            clearTimeout(authTimeoutRef.current!)

            if (response.success) {
              setAuthState({
                isAuthenticated: true,
                walletAddress: response.walletAddress,
                sessionKey: response.sessionKey,
                sessionExpiresAt: response.expiresIn ? Date.now() + response.expiresIn : undefined,
                isAuthenticating: false,
              })
              resolve(true)
            } else {
              setAuthState((prev) => ({
                ...prev,
                isAuthenticating: false,
                error: response.error || 'Authentication failed',
              }))
              resolve(false)
            }
          }
        )
      })
    },
    [socket, isConnected]
  )

  /**
   * Re-authenticate with existing JWT token
   */
  const reAuthenticate = useCallback(
    async (jwtToken: string): Promise<boolean> => {
      if (!socket || !isConnected) return false

      return new Promise((resolve) => {
        socket.emit(
          'yellow_re_authenticate',
          { jwtToken },
          (response: { success: boolean; error?: string; address?: Address }) => {
            if (response.success) {
              setAuthState({
                isAuthenticated: true,
                walletAddress: response.address,
                isAuthenticating: false,
              })
              resolve(true)
            } else {
              setAuthState((prev) => ({
                ...prev,
                error: response.error,
              }))
              resolve(false)
            }
          }
        )
      })
    },
    [socket, isConnected]
  )

  // -------------------------------------------------------------------------
  // App Session Management
  // -------------------------------------------------------------------------

  /**
   * Create a new app session for a game
   *
   * @param opponentSocketId - Socket ID of the opponent
   * @param stakeAmount - Amount to stake per player (default 10 USDC)
   */
  const createAppSession = useCallback(
    async (
      opponentSocketId: string,
      stakeAmount: number = 10
    ): Promise<{ success: boolean; roomId?: string; appSessionId?: string; error?: string }> => {
      if (!socket || !isConnected) {
        return { success: false, error: 'Socket not connected' }
      }

      if (!authState.isAuthenticated) {
        return { success: false, error: 'Not authenticated' }
      }

      setAppSession((prev) => ({ ...prev, status: 'creating', error: undefined }))

      return new Promise((resolve) => {
        socket.emit(
          'yellow_create_app_session',
          {
            player2SocketId: opponentSocketId,
            stakeAmount,
          },
          (response: {
            success: boolean
            roomId?: string
            appSessionId?: string
            gameState?: any
            error?: string
          }) => {
            if (response.success) {
              setAppSession({
                appSessionId: response.appSessionId,
                roomId: response.roomId,
                status: 'active',
                gameState: response.gameState,
              })
              resolve({
                success: true,
                roomId: response.roomId,
                appSessionId: response.appSessionId,
              })
            } else {
              setAppSession((prev) => ({
                ...prev,
                status: 'none',
                error: response.error,
              }))
              resolve({ success: false, error: response.error })
            }
          }
        )
      })
    },
    [socket, isConnected, authState.isAuthenticated]
  )

  /**
   * Update app session state after a round
   */
  const updateRound = useCallback(
    async (params: RoundUpdateParams): Promise<boolean> => {
      if (!socket || !isConnected) return false

      setAppSession((prev) => ({ ...prev, status: 'settling' }))

      return new Promise((resolve) => {
        socket.emit(
          'yellow_update_round',
          params,
          (response: { success: boolean; version?: number; allocations?: any; error?: string }) => {
            if (response.success) {
              setAppSession((prev) => ({
                ...prev,
                status: 'active',
                version: response.version,
                allocations: response.allocations,
              }))
              resolve(true)
            } else {
              setAppSession((prev) => ({
                ...prev,
                status: 'active',
                error: response.error,
              }))
              resolve(false)
            }
          }
        )
      })
    },
    [socket, isConnected]
  )

  /**
   * Close the app session and settle final balances
   */
  const closeSession = useCallback(
    async (roomId: string): Promise<SessionCloseResult | null> => {
      if (!socket || !isConnected) return null

      setAppSession((prev) => ({ ...prev, status: 'settling' }))

      return new Promise((resolve) => {
        socket.emit(
          'yellow_close_session',
          { roomId },
          (response: { success: boolean; error?: string } & SessionCloseResult) => {
            if (response.success) {
              setAppSession({
                status: 'closed',
                gameState: undefined,
              })
              resolve(response)
            } else {
              setAppSession((prev) => ({
                ...prev,
                status: 'active',
                error: response.error,
              }))
              resolve(null)
            }
          }
        )
      })
    },
    [socket, isConnected]
  )

  /**
   * Get session status
   */
  const getSessionStatus = useCallback(
    async (roomId?: string) => {
      if (!socket || !isConnected) return null

      return new Promise((resolve) => {
        socket.emit('yellow_session_status', { roomId }, (response: any) => {
          resolve(response)
        })
      })
    },
    [socket, isConnected]
  )

  // -------------------------------------------------------------------------
  // Event Handlers
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!socket) return

    const handleAppSessionCreated = (data: {
      roomId: string
      appSessionId: string
      gameState: any
      youAre: 'player1' | 'player2'
    }) => {
      console.log('[Yellow] App session created:', data)
      setAppSession({
        appSessionId: data.appSessionId,
        roomId: data.roomId,
        status: 'active',
        gameState: data.gameState,
      })
    }

    const handleRoundUpdated = (data: {
      appSessionId: string
      version: number
      allocations: any[]
      gameState: any
    }) => {
      console.log('[Yellow] Round updated:', data)
      setAppSession((prev) => ({
        ...prev,
        version: data.version,
        allocations: data.allocations,
        gameState: data.gameState,
        status: 'active',
      }))
    }

    const handleSessionClosed = (data: SessionCloseResult) => {
      console.log('[Yellow] Session closed:', data)
      setAppSession({
        status: 'closed',
      })
    }

    socket.on('yellow_app_session_created', handleAppSessionCreated)
    socket.on('yellow_round_updated', handleRoundUpdated)
    socket.on('yellow_session_closed', handleSessionClosed)

    return () => {
      socket.off('yellow_app_session_created', handleAppSessionCreated)
      socket.off('yellow_round_updated', handleRoundUpdated)
      socket.off('yellow_session_closed', handleSessionClosed)
    }
  }, [socket])

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  useEffect(() => {
    return () => {
      if (authTimeoutRef.current) {
        clearTimeout(authTimeoutRef.current)
      }
    }
  }, [])

  // -------------------------------------------------------------------------
  // Time-based calculations (using useMemo to avoid impure Date.now() calls)
  // -------------------------------------------------------------------------

  const { isExpired, timeRemaining } = useMemo(() => {
    const now = Date.now() // eslint-disable-line react-hooks/purity -- Time-based calculation
    return {
      isExpired: authState.sessionExpiresAt ? now >= authState.sessionExpiresAt : false,
      timeRemaining: authState.sessionExpiresAt ? Math.max(0, authState.sessionExpiresAt - now) : 0,
    }
  }, [authState.sessionExpiresAt])

  // -------------------------------------------------------------------------
  // Return
  // -------------------------------------------------------------------------

  return {
    // Authentication
    authState,
    authenticate,
    reAuthenticate,
    isExpired,
    timeRemaining,

    // App Session
    appSession,
    createAppSession,
    updateRound,
    closeSession,
    getSessionStatus,

    // Computed
    isReady: authState.isAuthenticated && socket && isConnected,
    error: authState.error || appSession.error,
  }
}
