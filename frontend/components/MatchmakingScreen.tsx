'use client'

import { useState, useEffect } from 'react'
import { useTradingStore } from '@/game/stores/trading-store'
import { motion, AnimatePresence } from 'framer-motion'
import { GridScanBackground } from '@/components/GridScanBackground'
import { usePrivy } from '@privy-io/react-auth'

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

export function MatchmakingScreen() {
  const { ready, authenticated, login, logout, user } = usePrivy()
  const { isConnected, isMatching, findMatch, connect } = useTradingStore()
  const [playerName] = useState(() => {
    const name = TRADER_NAMES[Math.floor(Math.random() * TRADER_NAMES.length)]
    const suffix = Math.floor(Math.random() * 999)
    return `${name}${suffix}`
  })
  const [usdcClaimed, setUsdcClaimed] = useState(false)
  const [isClaiming, setIsClaiming] = useState(false)

  // Connect to Socket.IO when component mounts
  useEffect(() => {
    connect()
  }, [connect])

  const handleEnter = () => {
    if (isConnected && !isMatching) {
      findMatch(playerName)
    }
  }

  const handleClaimFaucet = async () => {
    if (!authenticated || !ready || !user?.wallet) {
      alert('Please login first.')
      return
    }

    setIsClaiming(true)
    try {
      // Claim USDC directly to user's embedded wallet (gas sponsored by server)
      const claimResponse = await fetch('/api/claim-usdc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userWalletAddress: user.wallet.address,
          userId: user.id,
        }),
      })

      const claimData = await claimResponse.json()

      if (claimResponse.ok) {
        setUsdcClaimed(true)
      } else {
        alert('Claim failed: ' + (claimData.error || 'Unknown error'))
      }
    } catch {
      alert('Something went wrong. Please try again.')
    } finally {
      setIsClaiming(false)
    }
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
            {!authenticated ? (
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
            ) : !usdcClaimed ? (
              <motion.div
                key="faucet"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.4 }}
                className="flex flex-col items-center gap-3"
              >
                <ActionButton onClick={handleClaimFaucet} isLoading={isClaiming} color="green">
                  {isClaiming ? 'CLAIMING...' : 'GET 0.1 USDC'}
                </ActionButton>
              </motion.div>
            ) : (
              <motion.div
                key="match"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.4 }}
                className="flex flex-col items-center gap-3"
              >
                <p className="text-green-400 text-xs tracking-wider">✓ 0.1 USDC CLAIMED</p>
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
  color: 'indigo' | 'green' | 'cyan'
  isLoading?: boolean
  disabled?: boolean
}

const COLOR_CONFIG = {
  indigo: { border: 'border-indigo-400/30', text: 'text-indigo-300', glow: 'rgba(99,102,241,0.6)' },
  green: { border: 'border-green-400/30', text: 'text-green-300', glow: 'rgba(34,197,94,0.6)' },
  cyan: { border: 'border-cyan-400/30', text: 'text-cyan-300', glow: 'rgba(0,217,255,0.6)' },
}

function ActionButton({ children, onClick, color, isLoading = false, disabled = false }: ActionButtonProps) {
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
      <div className={`relative px-12 py-3 bg-black/40 backdrop-blur-md border ${config.border} rounded`}>
        <motion.span
          className={`font-[family-name:var(--font-orbitron)] text-[10px] tracking-[0.3em] font-medium block ${config.text}`}
          animate={
            isInteractive
              ? {
                  textShadow: [`0 0 10px ${config.glow}80`, `0 0 20px ${config.glow}`, `0 0 10px ${config.glow}80`],
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
