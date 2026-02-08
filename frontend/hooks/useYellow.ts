/**
 * Yellow Network React Hook
 * =========================
 *
 * React hook for managing Yellow Network session operations in HFT Battle.
 * Provides methods for connecting, authenticating, and managing app sessions.
 *
 * Usage:
 * ```tsx
 * const { connect, authenticate, createSession, isReady } = useYellow()
 * ```
 */

import { useState, useCallback } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import {
  RPCAppDefinition,
  RPCAppSessionAllocation,
  RPCProtocolVersion,
} from '@erc7824/nitrolite'
import { getYellowSessionManager } from '@/lib/yellow/session-manager'

export interface YellowState {
  isConnected: boolean
  isAuthenticated: boolean
  sessionId: string | null
  isReady: boolean // Ready = connected + authenticated
  error: string | null
}

export interface YellowActions {
  connect: () => Promise<void>
  authenticate: () => Promise<void>
  createSession: (
    appDefinition: RPCAppDefinition,
    allocations: RPCAppSessionAllocation[],
    secondSignature: string
  ) => Promise<string>
  submitStateUpdate: (
    allocations: RPCAppSessionAllocation[],
    version: number,
    secondSignature: string
  ) => Promise<void>
  closeSession: (
    finalAllocations: RPCAppSessionAllocation[],
    secondSignature: string
  ) => Promise<void>
  disconnect: () => void
  signData: (data: any) => Promise<`0x${string}`>
}

export function useYellow(): YellowState & YellowActions {
  const { ready, authenticated, user } = usePrivy()
  const [state, setState] = useState<YellowState>({
    isConnected: false,
    isAuthenticated: false,
    sessionId: null,
    isReady: false,
    error: null,
  })

  const manager = getYellowSessionManager()

  // Helper to update isReady based on current state
  const updateIsReady = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isReady: prev.isConnected && prev.isAuthenticated,
    }))
  }, [])

  // Connect to Yellow Network
  const connect = useCallback(async () => {
    try {
      setState((prev) => ({ ...prev, error: null }))
      await manager.connect()
      setState((prev) => ({ ...prev, isConnected: true }))
      updateIsReady()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed'
      setState((prev) => ({ ...prev, error: message }))
      throw error
    }
  }, [manager, updateIsReady])

  // Authenticate with Privy
  const authenticate = useCallback(async () => {
    if (!authenticated || !user?.wallet) {
      throw new Error('Privy not authenticated')
    }

    try {
      setState((prev) => ({ ...prev, error: null }))

      // Create signTypedData wrapper for Privy wallet with proper null checks
      const privyWalletWithSigner = {
        signTypedData: async (params: any) => {
          if (!user?.wallet) {
            throw new Error('Privy wallet not available')
          }

          const wallet = user.wallet as any

          // Try wallet.signTypedData first
          if (typeof wallet.signTypedData === 'function') {
            return await wallet.signTypedData(params)
          }

          // Fallback to account.signTypedData
          if (wallet.account?.signTypedData && typeof wallet.account.signTypedData === 'function') {
            return await wallet.account.signTypedData(params)
          }

          throw new Error('signTypedData not available on Privy wallet')
        },
      }

      await manager.authenticate(
        privyWalletWithSigner,
        user.wallet.address as `0x${string}`
      )
      setState((prev) => ({ ...prev, isAuthenticated: true }))
      updateIsReady()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Authentication failed'
      setState((prev) => ({ ...prev, error: message }))
      throw error
    }
  }, [authenticated, user, manager, updateIsReady])

  // Create app session with multi-party signatures
  const createSession = useCallback(
    async (
      appDefinition: RPCAppDefinition,
      allocations: RPCAppSessionAllocation[],
      secondSignature: string
    ): Promise<string> => {
      try {
        setState((prev) => ({ ...prev, error: null }))
        const sessionId = await manager.createAppSession(
          appDefinition,
          allocations,
          secondSignature
        )
        setState((prev) => ({ ...prev, sessionId }))
        return sessionId
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Session creation failed'
        setState((prev) => ({ ...prev, error: message }))
        throw error
      }
    },
    [manager]
  )

  // Submit state update (called after each settlement)
  const submitStateUpdate = useCallback(
    async (
      allocations: RPCAppSessionAllocation[],
      version: number,
      secondSignature: string
    ): Promise<void> => {
      try {
        setState((prev) => ({ ...prev, error: null }))
        await manager.submitAppState(allocations, version, secondSignature)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'State update failed'
        setState((prev) => ({ ...prev, error: message }))
        throw error
      }
    },
    [manager]
  )

  // Close session with final allocations
  const closeSession = useCallback(
    async (
      finalAllocations: RPCAppSessionAllocation[],
      secondSignature: string
    ): Promise<void> => {
      try {
        setState((prev) => ({ ...prev, error: null }))
        await manager.closeAppSession(finalAllocations, secondSignature)
        setState((prev) => ({ ...prev, sessionId: null }))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Session close failed'
        setState((prev) => ({ ...prev, error: message }))
        throw error
      }
    },
    [manager]
  )

  // Disconnect from Yellow Network
  const disconnect = useCallback(() => {
    manager.disconnect()
    setState({
      isConnected: false,
      isAuthenticated: false,
      sessionId: null,
      isReady: false,
      error: null,
    })
  }, [manager])

  // Sign data using message signer (for Socket.IO event handlers)
  const signData = useCallback(
    async (data: any): Promise<`0x${string}`> => {
      const signer = manager.getMessageSigner
      if (!signer) {
        throw new Error('Not authenticated')
      }
      return await signer(data)
    },
    [manager]
  )

  return {
    ...state,
    connect,
    authenticate,
    createSession,
    submitStateUpdate,
    closeSession,
    disconnect,
    signData,
  }
}
