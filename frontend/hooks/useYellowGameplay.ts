/**
 * Yellow Gameplay Hook
 * ===================
 *
 * Hook to set up Yellow signing for gameplay ONLY.
 * Call this from a component that only renders during active gameplay.
 *
 * This ensures Yellow is NEVER initialized during matchmaking.
 *
 * Usage:
 * ```tsx
 * import { useYellowGameplay } from '@/hooks/useYellowGameplay'
 *
 * export function GameCanvasClient() {
 *   // Only runs when game canvas is active (gameplay), not during matchmaking
 *   useYellowGameplay()
 *   // ... rest of component
 * }
 * ```
 */

import { useEffect, useRef } from 'react'
import { useSignTypedData } from '@privy-io/react-auth'
import { useTradingStore } from '@/game/stores/trading-store'

/**
 * Hook to set up Yellow signing for gameplay ONLY.
 *
 * Key Principles:
 * - LAZY: Only initialized when gameplay component mounts
 * - TRANSIENT: Cleaned up when gameplay ends
 * - SERVER-DRIVEN: Client only responds to signing requests
 *
 * This prevents any Yellow initialization during matchmaking.
 */
export function useYellowGameplay() {
  const { setYellowMessageSigner } = useTradingStore()
  const { signTypedData: privySignTypedData } = useSignTypedData()
  const signerInitialized = useRef(false)

  useEffect(() => {
    if (signerInitialized.current) return

    // Create wrapper that adapts Privy's signTypedData to Nitrolite's expected format
    const privyMessageSigner = async (data: any): Promise<`0x${string}`> => {
      console.log('[Yellow] Signing with Privy...')
      const result = await privySignTypedData(data)
      console.log('[Yellow] Signed successfully')
      return result.signature as `0x${string}`
    }

    setYellowMessageSigner(privyMessageSigner)
    signerInitialized.current = true
    console.log('[Yellow] Message signer ready for gameplay')

    return () => {
      // Cleanup: reset signer when gameplay ends
      setYellowMessageSigner(null)
      signerInitialized.current = false
      console.log('[Yellow] Message signer cleaned up')
    }
  }, [privySignTypedData, setYellowMessageSigner])
}
