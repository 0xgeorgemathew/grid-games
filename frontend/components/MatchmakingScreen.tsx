'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTradingStore } from '@/game/stores/trading-store'
import { motion, AnimatePresence } from 'framer-motion'
import { GridScanBackground } from '@/components/GridScanBackground'
import { usePrivy } from '@privy-io/react-auth'
import { getChannelManager } from '@/lib/yellow/channel-manager'
import { ActionButton } from '@/components/ui/ActionButton'
import { ClaimUsername } from '@/components/ens/ClaimUsername'
import { SetLeverage } from '@/components/ens/SetLeverage'
import { PlayerName } from '@/components/ens/PlayerName'
import { useUserName, useGetLeverage } from '@/hooks/useENS'
import type { LeverageOption } from '@/lib/ens'

const BOTTOM_DOTS_COUNT = 7

type MatchState =
  | 'login'
  | 'checkingUsername'
  | 'claimUsername'
  | 'setLeverage'
  | 'claim'
  | 'checking'
  | 'insufficient'
  | 'ready'
  | 'entering'

export function MatchmakingScreen() {
  const { ready, authenticated, login, logout, user } = usePrivy()
  const { isConnected, isMatching, findMatch, connect } = useTradingStore()
  const channelManager = getChannelManager()

  const [matchState, setMatchState] = useState<MatchState>('login')
  const [usdcBalance, setUsdcBalance] = useState<string>('0')
  const [isClaiming, setIsClaiming] = useState(false)

  // ENS state
  const [claimedUsername, setClaimedUsername] = useState<string | null>(null)
  const [selectedLeverage, setSelectedLeverage] = useState<LeverageOption>('2x')

  // Get user's leverage from ENS
  const { leverage: ensLeverage } = useGetLeverage(claimedUsername)

  // Store actions
  const setUserLeverage = useTradingStore((state) => state.setUserLeverage)

  // Check if user already has a username using getFullName()
  const walletAddress = user?.wallet?.address as `0x${string}` | undefined
  const {
    label: existingUsername,
    hasName,
    isLoading: isCheckingUsername,
    hasChecked,
  } = useUserName(walletAddress)

  // Connect to Socket.IO when component mounts
  useEffect(() => {
    connect()
  }, [connect])

  // Update match state based on auth - check for existing username
  useEffect(() => {
    if (authenticated && user?.wallet && hasChecked) {
      if (hasName && existingUsername) {
        // User already has a username, skip to balance check
        setClaimedUsername(existingUsername)
        checkBalance()
      } else if (!isCheckingUsername) {
        // No username found, prompt to claim
        setMatchState('claimUsername')
      }
    } else if (authenticated && user?.wallet && !hasChecked) {
      setMatchState('checkingUsername')
    } else if (!authenticated) {
      setMatchState('login')
      setClaimedUsername(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, user?.wallet, existingUsername, hasName, hasChecked, isCheckingUsername])

  // Update user leverage in store when leverage changes or username is claimed
  useEffect(() => {
    if (ensLeverage) {
      setUserLeverage(ensLeverage)
      setSelectedLeverage(ensLeverage)
    } else if (claimedUsername) {
      // Default to 2x if no leverage set
      setUserLeverage('2x')
    }
  }, [ensLeverage, claimedUsername, setUserLeverage])

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

          const result = await channelManager.checkBalance(user.wallet.address)
          setUsdcBalance(result.formatted || '0')

          if (result.hasEnough) {
            setMatchState('ready')
            return
          }
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

  const checkBalance = useCallback(async () => {
    if (!user?.wallet) return

    setMatchState('checking')
    try {
      const result = await channelManager.checkBalance(user.wallet.address)
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
  }, [user?.wallet, channelManager])

  const handleEnter = async () => {
    if (!isConnected || isMatching || !user?.wallet) return

    setMatchState('entering')

    // Final balance check before entering
    const balanceResult = await channelManager.checkBalance(user.wallet.address)
    if (!balanceResult.hasEnough) {
      setUsdcBalance(balanceResult.formatted || '0')
      setMatchState('insufficient')
      return
    }

    // Proceed with matchmaking - pass username or wallet address
    const playerName = claimedUsername || user.wallet.address
    findMatch(playerName, user.wallet.address)
  }

  // ENS callbacks
  const handleUsernameClaimed = useCallback((username: string) => {
    setClaimedUsername(username)
    setMatchState('setLeverage')
  }, [])

  const handleLeverageSet = useCallback(
    (leverage: LeverageOption) => {
      setSelectedLeverage(leverage)
      checkBalance()
    },
    [checkBalance]
  )

  const handleSkipUsername = useCallback(() => {
    // Skip username claiming and go to balance check
    checkBalance()
  }, [checkBalance])

  const handleSkipLeverage = useCallback(() => {
    // Skip leverage setting and go to balance check
    checkBalance()
  }, [checkBalance])

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

          {/* Show player name if claimed */}
          {claimedUsername && matchState !== 'claimUsername' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-4 flex flex-col items-center"
            >
              {/* Enhanced label row with better visibility */}
              <div className="flex items-center gap-3 mb-3">
                <motion.p
                  className="text-cyan-400/70 text-[10px] tracking-[0.25em] font-medium"
                  animate={{
                    textShadow: [
                      '0 0 5px rgba(0, 243, 255, 0.2)',
                      '0 0 10px rgba(0, 243, 255, 0.4)',
                      '0 0 5px rgba(0, 243, 255, 0.2)',
                    ],
                  }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                >
                  PLAYING AS
                </motion.p>
                <motion.div className="h-3 w-px bg-cyan-400/30" />
                {/* Larger, more visible settings button */}
                <motion.button
                  onClick={() => setMatchState('setLeverage')}
                  whileHover={{ scale: 1.15, rotate: 90 }}
                  whileTap={{ scale: 0.95 }}
                  className="text-cyan-400/60 hover:text-cyan-400 transition-colors p-2 rounded-full hover:bg-cyan-900/30"
                  title="Set Leverage"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                  </svg>
                </motion.button>
              </div>

              {/* Username with larger size and enhanced glow */}
              <motion.div className="relative" whileHover={{ scale: 1.05 }}>
                {/* Background glow ring */}
                <motion.div
                  className="absolute inset-0 rounded-full blur-xl"
                  animate={{
                    background: [
                      'radial-gradient(ellipse at center, rgba(0, 243, 255, 0.15) 0%, transparent 70%)',
                      'radial-gradient(ellipse at center, rgba(0, 243, 255, 0.25) 0%, transparent 70%)',
                      'radial-gradient(ellipse at center, rgba(0, 243, 255, 0.15) 0%, transparent 70%)',
                    ],
                  }}
                  transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                />
                <PlayerName
                  username={claimedUsername}
                  className="text-cyan-300 text-2xl tracking-wider relative z-10"
                />
              </motion.div>
            </motion.div>
          )}
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
                <ActionButton onClick={login} color="cyan">
                  LOGIN WITH GOOGLE
                </ActionButton>
              </motion.div>
            )}

            {matchState === 'checkingUsername' && (
              <motion.div
                key="checkingUsername"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.4 }}
                className="flex flex-col items-center gap-3"
              >
                <p className="text-cyan-400 text-xs tracking-wider animate-pulse">
                  CHECKING IDENTITY...
                </p>
              </motion.div>
            )}

            {matchState === 'claimUsername' && (
              <ClaimUsername
                key="claimUsername"
                onClaimed={handleUsernameClaimed}
                onSkip={handleSkipUsername}
              />
            )}

            {matchState === 'setLeverage' && claimedUsername && (
              <SetLeverage
                key="setLeverage"
                username={claimedUsername}
                onComplete={handleLeverageSet}
                onSkip={handleSkipLeverage}
              />
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
                  {selectedLeverage !== '5x' && ` • ${selectedLeverage} LEVERAGE`}
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
