'use client'

import { useState } from 'react'
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

export function MatchmakingScreen() {
  const { ready, authenticated, login, logout } = usePrivy()
  const { isConnected, isMatching, findMatch } = useTradingStore()
  const [playerName] = useState(() => {
    const name = TRADER_NAMES[Math.floor(Math.random() * TRADER_NAMES.length)]
    const suffix = Math.floor(Math.random() * 999)
    return `${name}${suffix}`
  })
  const [usdcClaimed, setUsdcClaimed] = useState(false)

  const handleEnter = () => {
    if (isConnected && !isMatching) {
      findMatch(playerName)
    }
  }

  const handleClaimFaucet = () => {
    setUsdcClaimed(true)
  }

  // Show loading while Privy initializes
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

      {/* Animated scanline overlay */}
      <div className="fixed inset-0 pointer-events-none z-10 opacity-15">
        <motion.div
          className="w-full h-px bg-cyan-400"
          animate={{
            y: ['-10%', '110%'],
          }}
          transition={{
            duration: 3,
            repeat: Infinity,
            ease: 'linear',
          }}
        />
      </div>

      {/* Main Content */}
      <div className="relative z-20 flex flex-col items-center gap-12 px-6">
        {/* Main Title - ENTER THE GRID */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.2, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="text-center"
        >
          <div className="flex flex-col items-center gap-1">
            <h1 className="font-[family-name:var(--font-orbitron)] text-xl sm:text-2xl md:text-3xl lg:text-4xl font-bold tracking-[0.25em] text-white">
              ENTER
            </h1>
            <h2 className="font-[family-name:var(--font-orbitron)] text-xl sm:text-2xl md:text-3xl lg:text-4xl font-bold tracking-[0.25em] text-white">
              THE
            </h2>
            <motion.h3
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
            </motion.h3>
          </div>
        </motion.div>

        {/* Auth Section */}
        <div className="flex flex-col items-center gap-4">
          <AnimatePresence mode="wait">
            {!authenticated ? (
              // Login Screen
              <motion.div
                key="login"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.4 }}
                className="flex flex-col items-center gap-4"
              >
                <p className="text-gray-400 text-sm tracking-wider">
                  CONNECT TO PLAY
                </p>
                <LoginButton onClick={login} />
              </motion.div>
            ) : !usdcClaimed ? (
              // Faucet Screen - only show GET 10 USDC
              <motion.div
                key="faucet"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.4 }}
                className="flex flex-col items-center gap-3"
              >
                <FaucetButton onClick={handleClaimFaucet} />
              </motion.div>
            ) : (
              // Ready to play - show ENTER
              <motion.div
                key="match"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.4 }}
                className="flex flex-col items-center gap-3"
              >
                <p className="text-green-400 text-xs tracking-wider">✓ 10 USDC CLAIMED</p>
                <EnterButton
                  isConnected={true}
                  isMatching={isMatching}
                  onClick={handleEnter}
                />
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
            animate={{
              opacity: [0.2, 1, 0.2],
              scaleY: [1, 2, 1],
            }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              delay: i * 0.15,
              ease: 'easeInOut',
            }}
          />
        ))}
      </div>
    </div>
  )
}

// Faucet Button Component
function FaucetButton({ onClick }: { onClick: () => void }) {
  return (
    <motion.button
      onClick={onClick}
      className="relative group"
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <motion.div
        className="absolute inset-0 rounded-lg"
        animate={{
          boxShadow: [
            '0 0 20px rgba(34,197,94,0.3)',
            '0 0 60px rgba(34,197,94,0.6)',
            '0 0 20px rgba(34,197,94,0.3)',
          ],
        }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      />
      <div className="relative px-12 py-3 bg-black/40 backdrop-blur-md border border-green-400/30 rounded">
        <motion.span
          className="font-[family-name:var(--font-orbitron)] text-[10px] tracking-[0.3em] font-medium block text-green-300"
          animate={{
            textShadow: [
              '0 0 10px rgba(34,197,94,0.5)',
              '0 0 20px rgba(34,197,94,0.8)',
              '0 0 10px rgba(34,197,94,0.5)',
            ],
          }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        >
          GET 10 USDC
        </motion.span>
      </div>
    </motion.button>
  )
}

// Login Button Component
function LoginButton({ onClick }: { onClick: () => void }) {
  return (
    <motion.button
      onClick={onClick}
      className="relative group"
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <motion.div
        className="absolute inset-0 rounded-lg"
        animate={{
          boxShadow: [
            '0 0 20px rgba(99,102,241,0.3)',
            '0 0 60px rgba(99,102,241,0.6)',
            '0 0 20px rgba(99,102,241,0.3)',
          ],
        }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      />
      <div className="relative px-12 py-3 bg-black/40 backdrop-blur-md border border-indigo-400/30 rounded">
        <motion.span
          className="font-[family-name:var(--font-orbitron)] text-[10px] tracking-[0.3em] font-medium block text-indigo-300"
          animate={{
            textShadow: [
              '0 0 10px rgba(99,102,241,0.5)',
              '0 0 20px rgba(99,102,241,0.8)',
              '0 0 10px rgba(99,102,241,0.5)',
            ],
          }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        >
          LOGIN WITH GOOGLE
        </motion.span>
      </div>
    </motion.button>
  )
}

// Enter Button Component
function EnterButton({
  isConnected,
  isMatching,
  onClick,
}: {
  isConnected: boolean
  isMatching: boolean
  onClick: () => void
}) {
  return (
    <motion.button
      onClick={onClick}
      disabled={!isConnected || isMatching}
      className="relative group"
      whileHover={{ scale: isConnected && !isMatching ? 1.02 : 1 }}
      whileTap={{ scale: isConnected && !isMatching ? 0.98 : 1 }}
    >
      <motion.div
        className="absolute inset-0 rounded-lg"
        animate={{
          boxShadow:
            isConnected && !isMatching
              ? [
                  '0 0 20px rgba(0,217,255,0.3)',
                  '0 0 60px rgba(0,217,255,0.6)',
                  '0 0 20px rgba(0,217,255,0.3)',
                ]
              : '0 0 10px rgba(255,255,255,0.1)',
        }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      />
      <div className="relative px-12 py-3 bg-black/40 backdrop-blur-md border border-cyan-400/30 rounded">
        <motion.span
          className="font-[family-name:var(--font-orbitron)] text-[10px] tracking-[0.3em] font-medium block"
          animate={
            isConnected && !isMatching
              ? {
                  textShadow: [
                    '0 0 10px rgba(0,217,255,0.5)',
                    '0 0 20px rgba(0,217,255,0.8)',
                    '0 0 10px rgba(0,217,255,0.5)',
                  ],
                }
              : {}
          }
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        >
          <span className={isConnected && !isMatching ? 'text-cyan-300' : 'text-white/20'}>
            {isMatching ? 'ENTERING...' : 'ENTER'}
          </span>
        </motion.span>
      </div>
    </motion.button>
  )
}
