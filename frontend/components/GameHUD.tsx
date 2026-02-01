'use client'

import React, { useState, useEffect } from 'react'
import { useTradingStore } from '@/game/stores/trading-store'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { HowToPlayModal } from '@/components/HowToPlayModal'
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
        <Badge
          variant="outline"
          className={cn(
            'text-[10px] sm:text-xs px-1.5 py-0.5 font-mono shrink-0',
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
        </Badge>
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
    manualReconnect,
  } = useTradingStore()
  const [showHowToPlay, setShowHowToPlay] = useState(false)

  // Connect to price feed when game starts
  useEffect(() => {
    if (isPlaying && !isPriceConnected) {
      connectPriceFeed(selectedCrypto)
    }
  }, [isPlaying, isPriceConnected, selectedCrypto, connectPriceFeed])

  const handleCryptoChange = (symbol: CryptoSymbol) => {
    if (symbol !== selectedCrypto) {
      connectPriceFeed(symbol)
    }
  }

  const isPositive = priceData?.changePercent !== undefined && priceData.changePercent >= 0
  const priceColor = isPositive ? 'text-tron-cyan' : 'text-tron-orange'
  const priceGlow = isPositive
    ? '0 0 10px rgba(0, 243, 255, 0.8), 0 0 20px rgba(0, 243, 255, 0.4)'
    : '0 0 10px rgba(255, 107, 0, 0.8), 0 0 20px rgba(255, 107, 0, 0.4)'

  // Check if manual reconnect is needed
  const needsManualReconnect = priceError?.includes('Max retries')

  const localPlayer = players.find((p) => p.id === localPlayerId)
  const opponent = players.find((p) => p.id !== localPlayerId)

  return (
    <>
      <motion.div
        className="absolute top-0 left-0 right-0 z-10 p-2 sm:p-3 pointer-events-none"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <div className="max-w-3xl sm:max-w-4xl mx-auto space-y-2 sm:space-y-3">
          {/* Glassmorphic panel container */}
          <motion.div
            className="glass-panel-vibrant rounded-xl p-2 sm:p-3 relative"
            animate={{
              boxShadow: [
                '0 0 20px rgba(0,243,255,0.1), inset 0 0 20px rgba(0,243,255,0.03)',
                '0 0 30px rgba(0,243,255,0.15), inset 0 0 30px rgba(0,243,255,0.05)',
                '0 0 20px rgba(0,243,255,0.1), inset 0 0 20px rgba(0,243,255,0.03)',
              ],
            }}
            transition={{ duration: 3, repeat: Infinity }}
          >
            {/* Help button */}
            <button
              onClick={() => setShowHowToPlay(true)}
              className="absolute top-2 right-2 p-1.5 hover:bg-tron-cyan/10 rounded transition-colors pointer-events-auto"
            >
              <Info className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-tron-cyan" />
            </button>

            {/* Compact Price Bar - Inline */}
            <motion.div
              variants={itemVariants}
              className="flex items-center justify-between gap-1.5 sm:gap-2 mb-2"
              initial="hidden"
              animate="visible"
            >
              {/* Price Display */}
              <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1">
                <AnimatePresence mode="wait">
                  {priceData && (
                    <motion.div
                      key={`${priceData.price}-${priceData.symbol}`}
                      initial={{ scale: 1 }}
                      animate={{ scale: [1, 1.02, 1] }}
                      exit={{ scale: 1 }}
                      transition={{ duration: 0.3 }}
                      className="flex items-center gap-1.5 sm:gap-2 min-w-0"
                    >
                      <span className="text-[10px] sm:text-xs text-tron-white-dim uppercase tracking-wider shrink-0">
                        {CRYPTO_SYMBOLS[selectedCrypto]}:
                      </span>
                      <motion.span
                        className={cn(
                          'text-base sm:text-lg font-black font-mono truncate',
                          priceColor
                        )}
                        style={{
                          textShadow: priceGlow,
                        }}
                      >
                        ${formatPrice(priceData.price)}
                      </motion.span>
                      <motion.span
                        className={cn('text-xs sm:text-sm font-mono shrink-0', priceColor)}
                        style={{
                          textShadow: priceGlow,
                        }}
                        animate={{
                          opacity: [1, 0.7, 1],
                        }}
                        transition={{ duration: 2, repeat: Infinity }}
                      >
                        {priceData.changePercent >= 0 ? '+' : ''}
                        {priceData.changePercent.toFixed(2)}%
                      </motion.span>
                    </motion.div>
                  )}
                </AnimatePresence>

                {!priceData && (
                  <span className="text-xs text-tron-white-dim animate-pulse">Connecting...</span>
                )}
              </div>

              {/* Status & Crypto Selector */}
              <div className="flex items-center gap-1 pointer-events-auto shrink-0">
                {/* Connection Status */}
                <motion.div
                  className={cn(
                    'flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] sm:text-xs font-mono',
                    isPriceConnected
                      ? 'bg-tron-cyan/10 text-tron-cyan border border-tron-cyan/30'
                      : priceError
                        ? 'bg-red-500/10 text-red-400 border border-red-500/30'
                        : 'bg-tron-orange/10 text-tron-orange border border-tron-orange/30'
                  )}
                  animate={{
                    opacity: isPriceConnected ? [1, 0.7, 1] : priceError ? 1 : [0.5, 1, 0.5],
                  }}
                  transition={{ duration: 2, repeat: isPriceConnected ? Infinity : 0 }}
                >
                  <motion.div
                    className={cn(
                      'w-1 h-1 rounded-full',
                      isPriceConnected
                        ? 'bg-tron-cyan'
                        : priceError
                          ? 'bg-red-400'
                          : 'bg-tron-orange'
                    )}
                    animate={{
                      scale: isPriceConnected ? [1, 1.3, 1] : priceError ? 1 : [0.8, 1, 0.8],
                    }}
                    transition={{ duration: 1.5, repeat: isPriceConnected ? Infinity : 0 }}
                  />
                  {isPriceConnected ? 'LIVE' : priceError ? 'ERR' : 'CONN'}
                </motion.div>

                {/* Manual Reconnect Button */}
                {needsManualReconnect && (
                  <motion.button
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    onClick={manualReconnect}
                    className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors"
                  >
                    Reconnect
                  </motion.button>
                )}

                {/* Crypto Selector */}
                {(Object.keys(CRYPTO_SYMBOLS) as CryptoSymbol[]).map((symbol) => (
                  <button
                    key={symbol}
                    onClick={() => handleCryptoChange(symbol)}
                    className={cn(
                      'px-1.5 py-0.5 rounded text-[10px] sm:text-xs font-mono transition-all',
                      'border hover:scale-105 active:scale-95',
                      selectedCrypto === symbol
                        ? 'bg-tron-cyan/20 border-tron-cyan/50 text-tron-cyan shadow-[0_0_10px_rgba(0,243,255,0.3)]'
                        : 'border-tron-white/10 text-tron-white-dim hover:border-tron-cyan/30 hover:text-tron-cyan/70'
                    )}
                  >
                    {CRYPTO_SYMBOLS[symbol]}
                  </button>
                ))}
              </div>
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

      <HowToPlayModal isOpen={showHowToPlay} onClose={() => setShowHowToPlay(false)} />
    </>
  )
})
