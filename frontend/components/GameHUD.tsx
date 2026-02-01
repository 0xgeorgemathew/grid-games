'use client'

import React, { useState, useEffect } from 'react'
import { useTradingStore } from '@/game/stores/trading-store'
import { Progress } from '@/components/ui/progress'
import { HowToPlayModal } from '@/components/HowToPlayModal'
import { SettlementFlash } from '@/components/SettlementFlash'
import { CountUp } from '@/components/CountUp'
import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'
import { formatPrice } from '@/lib/formatPrice'
import type { CryptoSymbol } from '@/game/stores/trading-store'

const CRYPTO_SYMBOLS: Record<CryptoSymbol, string> = {
  btcusdt: 'BTC',
} as const

const TUG_OF_WAR_MIN = -100
const TUG_OF_WAR_MAX = 100
const PROGRESS_HEIGHT = 'h-2'
const PROGRESS_BG = 'bg-black/50'

type PlayerColor = 'green' | 'red'

interface PlayerHealthBarProps {
  name: string
  dollars: number
  color: PlayerColor
  index: number
}

// Animation variants for staggered entrance
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.15,
      delayChildren: 0.2,
    },
  },
}

const itemVariants = {
  hidden: { y: -20, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: {
      type: 'spring' as const,
      stiffness: 300,
      damping: 24,
    },
  },
}

function PlayerHealthBar({ name, dollars, color, index }: PlayerHealthBarProps) {
  const colorClasses = {
    green: {
      text: 'text-tron-cyan',
      border: 'border-green-500/40',
      progress: 'health-gradient-green shadow-[0_0_15px_rgba(57,255,20,0.6)]',
      glow: 'pulse-glow-green',
    },
    red: {
      text: 'text-tron-orange',
      border: 'border-red-500/40',
      progress: 'health-gradient-red shadow-[0_0_15px_rgba(255,23,68,0.6)]',
      glow: 'pulse-glow-red',
    },
  } as const

  const classes = colorClasses[color]
  const isLowDollars = dollars <= 3
  const dollarsColor = isLowDollars
    ? color === 'green'
      ? 'text-red-400'
      : 'text-orange-300'
    : classes.text

  return (
    <motion.div variants={itemVariants} className="space-y-1.5" initial="hidden" animate="visible">
      <div className="flex items-center justify-between gap-1">
        <motion.span
          className={cn('font-bold text-xs sm:text-sm tracking-wide truncate', dollarsColor)}
          animate={{
            textShadow: isLowDollars
              ? `0 0 10px ${color === 'green' ? 'rgba(255,68,68,0.8)' : 'rgba(255,107,0,0.8)'}, 0 0 20px ${color === 'green' ? 'rgba(255,68,68,0.5)' : 'rgba(255,107,0,0.5)'}`
              : '0 0 10px rgba(0,243,255,0.5)',
          }}
          transition={{ duration: 0.3 }}
        >
          {name}
        </motion.span>
        <div
          className={cn(
            'text-[10px] sm:text-xs px-2 py-0.5 font-mono shrink-0 border rounded',
            classes.border,
            isLowDollars ? 'animate-pulse' : ''
          )}
        >
          <AnimatePresence mode="wait">
            <motion.span
              key={dollars}
              initial={{ scale: 1.3, color: isLowDollars ? '#ff4444' : '#00f3ff' }}
              animate={{ scale: 1, color: isLowDollars ? '#ff4444' : '#00f3ff' }}
              exit={{ scale: 0.8 }}
              transition={{ type: 'spring', stiffness: 500, damping: 20 }}
              className={cn(isLowDollars ? 'text-red-400' : classes.text)}
            >
              ${dollars}
            </motion.span>
          </AnimatePresence>
        </div>
      </div>
      <div className="relative">
        <Progress
          value={dollars * 10} // Max is 10 dollars, progress needs 0-100
          className={cn(PROGRESS_HEIGHT, PROGRESS_BG, 'overflow-hidden border border-white/10')}
          indicatorClassName={cn(classes.progress, isLowDollars ? classes.glow : '')}
        />
        {/* Glow overlay for critical dollars */}
        <AnimatePresence>
          {isLowDollars && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: [0.3, 0.6, 0.3] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1, repeat: Infinity }}
              className="absolute inset-0 pointer-events-none"
              style={{
                background: `radial-gradient(circle, ${color === 'green' ? 'rgba(255,68,68,0.3)' : 'rgba(255,107,0,0.3)'} 0%, transparent 70%)`,
              }}
            />
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

function TugOfWarMeter({ value, isPlayer1 }: { value: number; isPlayer1: boolean }) {
  const clampedValue = Math.max(TUG_OF_WAR_MIN, Math.min(TUG_OF_WAR_MAX, value))
  const absoluteValue = Math.abs(clampedValue)

  const isPlayer1Advantage = clampedValue < 0
  const isPlayer2Advantage = clampedValue > 0

  // Dynamic meter color based on advantage
  const getMeterGradient = () => {
    if (isPlayer1Advantage) {
      return 'linear-gradient(90deg, #00f3ff 0%, #00a8b3 100%)'
    }
    if (isPlayer2Advantage) {
      return 'linear-gradient(90deg, #ff6b00 0%, #ff00ff 100%)'
    }
    return 'linear-gradient(90deg, #00f3ff 0%, #ff6b00 100%)'
  }

  const meterPosition = isPlayer1Advantage ? 'left-0 right-1/2' : 'left-1/2 right-0'
  const yourAdvantageColor = isPlayer1Advantage ? 'text-tron-cyan text-glow' : 'text-tron-white-dim'
  const opponentAdvantageColor = isPlayer2Advantage
    ? 'text-tron-orange text-glow-orange'
    : 'text-tron-white-dim'

  const yourLabel = isPlayer1 ? 'YOU' : 'OPP'
  const opponentLabel = isPlayer1 ? 'OPP' : 'YOU'

  return (
    <motion.div variants={itemVariants} className="relative" initial="hidden" animate="visible">
      {/* Market Momentum label - hidden on mobile */}
      <div className="flex items-center justify-center gap-2 mb-1 hidden sm:flex">
        <motion.span
          className="text-[10px] text-tron-cyan/60 uppercase tracking-[0.2em] font-semibold"
          animate={{
            textShadow: [
              '0 0 5px rgba(0,243,255,0.3)',
              '0 0 15px rgba(0,243,255,0.6)',
              '0 0 5px rgba(0,243,255,0.3)',
            ],
          }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          Market Momentum
        </motion.span>
      </div>

      {/* Meter container */}
      <div className="relative h-2 bg-black/60 rounded-full overflow-hidden border border-tron-cyan/30 shadow-[0_0_20px_rgba(0,243,255,0.15)]">
        {/* Grid pattern overlay */}
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: `linear-gradient(transparent 95%, rgba(0,243,255,0.3) 95%), linear-gradient(90deg, transparent 95%, rgba(0,243,255,0.3) 95%)`,
            backgroundSize: '10px 10px',
          }}
        />

        {/* Center indicator - animated */}
        <motion.div
          className="absolute left-1/2 top-0 bottom-0 w-0.5 z-10"
          style={{ backgroundColor: '#00f3ff' }}
          animate={{
            boxShadow: [
              '0 0 5px #00f3ff',
              '0 0 15px #00f3ff, 0 0 30px rgba(0,243,255,0.5)',
              '0 0 5px #00f3ff',
            ],
          }}
          transition={{ duration: 2, repeat: Infinity }}
        />

        {/* Fill based on tug of war - animated with spring */}
        <motion.div
          className={cn('absolute top-0 bottom-0', meterPosition)}
          style={{
            width: `${absoluteValue}%`,
            background: getMeterGradient(),
          }}
          animate={{
            width: [`${absoluteValue * 0.95}%`, `${absoluteValue}%`, `${absoluteValue * 0.95}%`],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        >
          {/* Shimmer effect */}
          <motion.div
            className="absolute inset-0"
            animate={{
              x: ['-100%', '200%'],
            }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              ease: 'linear',
            }}
            style={{
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)',
            }}
          />
        </motion.div>
      </div>

      {/* Labels with animated highlighting */}
      <div className="flex justify-between mt-1.5 px-1">
        <motion.span
          className={cn('text-[10px] sm:text-xs font-bold tracking-wider', yourAdvantageColor)}
          animate={{
            scale: isPlayer1Advantage ? [1, 1.05, 1] : 1,
          }}
          transition={{ duration: 1.5, repeat: isPlayer1Advantage ? Infinity : 0 }}
        >
          {yourLabel}
        </motion.span>
        <motion.span
          className={cn('text-[10px] sm:text-xs font-bold tracking-wider', opponentAdvantageColor)}
          animate={{
            scale: isPlayer2Advantage ? [1, 1.05, 1] : 1,
          }}
          transition={{ duration: 1.5, repeat: isPlayer2Advantage ? Infinity : 0 }}
        >
          {opponentLabel}
        </motion.span>
      </div>
    </motion.div>
  )
}

export const GameHUD = React.memo(function GameHUD() {
  const {
    players,
    localPlayerId,
    isPlayer1,
    tugOfWar,
    priceData,
    isPriceConnected,
    selectedCrypto,
    connectPriceFeed,
    isPlaying,
    priceError,
  } = useTradingStore()
  const [showHowToPlay, setShowHowToPlay] = useState(false)

  // Connect to price feed when game starts
  useEffect(() => {
    if (isPlaying && !isPriceConnected) {
      connectPriceFeed(selectedCrypto)
    }
  }, [isPlaying, isPriceConnected, selectedCrypto, connectPriceFeed])

  const isPositive = priceData?.changePercent !== undefined && priceData.changePercent >= 0
  const priceColor = isPositive ? 'text-tron-cyan' : 'text-tron-orange'
  const priceGlow = isPositive
    ? '0 0 10px rgba(0, 243, 255, 0.8), 0 0 20px rgba(0, 243, 255, 0.4)'
    : '0 0 10px rgba(255, 107, 0, 0.8), 0 0 20px rgba(255, 107, 0, 0.4)'

  const localPlayer = players.find((p) => p.id === localPlayerId)
  const opponent = players.find((p) => p.id !== localPlayerId)

  return (
    <>
      <SettlementFlash />
      <HowToPlayModal isOpen={showHowToPlay} onClose={() => setShowHowToPlay(false)} />
      <motion.div
        className="absolute top-0 left-0 right-0 z-10 p-2 sm:p-3 pointer-events-none"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <div className="max-w-3xl sm:max-w-4xl mx-auto space-y-2 sm:space-y-3">
          {/* Glassmorphic panel container */}
          <motion.div
            className="glass-panel-vibrant rounded-xl p-2 sm:p-3"
            animate={{
              boxShadow: [
                '0 0 20px rgba(0,243,255,0.1), inset 0 0 20px rgba(0,243,255,0.03)',
                '0 0 30px rgba(0,243,255,0.15), inset 0 0 30px rgba(0,243,255,0.05)',
                '0 0 20px rgba(0,243,255,0.1), inset 0 0 20px rgba(0,243,255,0.03)',
              ],
            }}
            transition={{ duration: 3, repeat: Infinity }}
          >
            {/* Price Bar - Centered with minimal indicators */}
            <motion.div
              variants={itemVariants}
              className="flex items-center justify-center gap-4 mb-2"
              initial="hidden"
              animate="visible"
            >
              {/* Left: Connection dot only */}
              <div className="w-6 flex justify-center shrink-0">
                <motion.div
                  className={cn(
                    'w-2 h-2 rounded-full',
                    isPriceConnected ? 'bg-tron-cyan' : priceError ? 'bg-red-400' : 'bg-tron-orange'
                  )}
                  animate={{
                    scale: isPriceConnected
                      ? [1, 1.4, 1]
                      : priceError
                        ? [1, 1.2, 1]
                        : [0.8, 1, 0.8],
                    opacity: isPriceConnected ? [1, 0.7, 1] : 1,
                  }}
                  transition={{
                    duration: isPriceConnected ? 1.5 : 0.5,
                    repeat: isPriceConnected ? Infinity : 3,
                  }}
                  style={{
                    boxShadow: isPriceConnected
                      ? '0 0 8px rgba(0, 243, 255, 0.8)'
                      : priceError
                        ? '0 0 8px rgba(248, 113, 113, 0.8)'
                        : '0 0 8px rgba(255, 107, 0, 0.8)',
                  }}
                />
              </div>

              {/* Center: BTC price - no AnimatePresence, no blinking */}
              {priceData ? (
                <div className="flex items-center gap-2 sm:gap-3">
                  <span className="text-sm sm:text-base text-tron-white-dim uppercase tracking-[0.2em] font-bold shrink-0">
                    {CRYPTO_SYMBOLS[selectedCrypto]}
                  </span>

                  <CountUp
                    value={priceData.price}
                    className={cn(
                      'text-2xl sm:text-4xl font-black font-mono tracking-tight',
                      priceColor
                    )}
                    style={{
                      textShadow: isPositive
                        ? '0 0 20px rgba(0, 243, 255, 0.8), 0 0 40px rgba(0, 243, 255, 0.4)'
                        : '0 0 20px rgba(255, 107, 0, 0.8), 0 0 40px rgba(255, 107, 0, 0.4)',
                    }}
                  />

                  <motion.span
                    className={cn(
                      'text-sm sm:text-lg font-bold font-mono shrink-0 px-2 py-0.5 rounded',
                      isPositive ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                    )}
                    style={{
                      textShadow: priceGlow,
                    }}
                    animate={{
                      opacity: [1, 0.8, 1],
                    }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  >
                    {priceData.changePercent >= 0 ? '+' : ''}
                    {priceData.changePercent.toFixed(2)}%
                  </motion.span>
                </div>
              ) : (
                <motion.span
                  animate={{ opacity: [0.3, 0.7, 0.3] }}
                  transition={{ duration: 1, repeat: Infinity }}
                  className="text-sm text-tron-white-dim animate-pulse"
                >
                  Connecting...
                </motion.span>
              )}

              {/* Right: Help button */}
              <button
                onClick={() => setShowHowToPlay(true)}
                className="w-6 h-6 flex items-center justify-center hover:bg-tron-cyan/10 rounded transition-colors pointer-events-auto shrink-0"
              >
                <Info className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-tron-cyan" />
              </button>
            </motion.div>

            {/* Divider */}
            <motion.div
              className="h-px bg-gradient-to-r from-transparent via-tron-cyan/50 to-transparent"
              animate={{ opacity: [0.3, 0.6, 0.3] }}
              transition={{ duration: 2, repeat: Infinity }}
            />

            {/* Player Health Bars - Always side-by-side */}
            <div className="grid grid-cols-2 gap-2 sm:gap-3">
              {localPlayer && (
                <PlayerHealthBar
                  name={localPlayer.name}
                  dollars={localPlayer.dollars}
                  color="green"
                  index={0}
                />
              )}
              {opponent && (
                <PlayerHealthBar
                  name={opponent.name}
                  dollars={opponent.dollars}
                  color="red"
                  index={1}
                />
              )}
            </div>

            {/* Divider */}
            <motion.div
              className="h-px bg-gradient-to-r from-transparent via-tron-cyan/50 to-transparent"
              animate={{
                opacity: [0.3, 0.6, 0.3],
              }}
              transition={{ duration: 2, repeat: Infinity }}
            />

            {/* Tug of War Meter - Compact */}
            <TugOfWarMeter value={tugOfWar} isPlayer1={isPlayer1} />
          </motion.div>
        </div>
      </motion.div>
    </>
  )
})
