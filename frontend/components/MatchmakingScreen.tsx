'use client'

import { useState } from 'react'
import { useTradingStore } from '@/game/stores/trading-store'
import { motion, AnimatePresence } from 'framer-motion'
import { GridScanBackground } from '@/components/GridScanBackground'

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
  const { isConnected, isMatching, findMatch } = useTradingStore()
  const [playerName] = useState(() => {
    const name = TRADER_NAMES[Math.floor(Math.random() * TRADER_NAMES.length)]
    const suffix = Math.floor(Math.random() * 999)
    return `${name}${suffix}`
  })

  const handleEnter = () => {
    if (isConnected && !isMatching) {
      findMatch(playerName)
    }
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
        {/* Main Title - ENTER THE GRID - Vertical */}
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
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            >
              GRID
            </motion.h3>
          </div>
        </motion.div>

        {/* ENTER Button */}
        <motion.button
          onClick={handleEnter}
          disabled={!isConnected || isMatching}
          className="relative group"
          whileHover={{ scale: isConnected && !isMatching ? 1.02 : 1 }}
          whileTap={{ scale: isConnected && !isMatching ? 0.98 : 1 }}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3, duration: 0.6 }}
        >
          {/* Outer glow pulse */}
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
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />

          {/* Button body - 10% smaller */}
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
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            >
              <span className={isConnected && !isMatching ? 'text-cyan-300' : 'text-white/20'}>
                {isMatching ? 'ENTERING...' : 'ENTER'}
              </span>
            </motion.span>
          </div>

          {/* Hover inner glow */}
          {isConnected && !isMatching && (
            <motion.div
              className="absolute inset-0 rounded-lg"
              initial={{ opacity: 0 }}
              whileHover={{ opacity: 1 }}
              style={{
                background:
                  'radial-gradient(ellipse at center, rgba(0,217,255,0.15) 0%, transparent 70%)',
              }}
            />
          )}
        </motion.button>
      </div>

      {/* Subtle bottom dots - data stream */}
      <div className="fixed bottom-12 left-0 right-0 z-20 flex justify-center gap-2">
        {[...Array(7)].map((_, i) => (
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
