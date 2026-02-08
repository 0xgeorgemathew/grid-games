/**
 * Global TypeScript declarations
 * =============================
 *
 * Extends global Window interface with project-specific types.
 */

import type { PrivyUser, Wallet } from '@privy-io/react-auth'

declare global {
  interface Window {
    // Privy user reference for Yellow authentication
    // Set by MatchmakingScreen when user logs in
    privyUser?: PrivyUser

    // Actual Privy wallet with signing methods for Yellow authentication
    // Set by MatchmakingScreen when user logs in
    // NOTE: This is the actual Wallet instance from useWallets(), not user.wallet (which is just metadata)
    privyWallet?: Wallet

    // Phaser event bridge for React ↔ Phaser communication
    phaserEvents?: {
      emit(event: string, ...args: unknown[]): void
      on(event: string, listener: (...args: unknown[]) => void): void
      off(event: string, listener: (...args: unknown[]) => void): void
      destroy?(): void
    }
  }
}

export {}
