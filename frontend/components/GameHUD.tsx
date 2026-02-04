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
  isLocal: boolean // Identifies if this is the local player
  playerNum: 1 | 2 // P1 or P2
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

const PlayerHealthBar = React.memo(
  function PlayerHealthBar({
    name,
    dollars,
    color,
    index,
    isLocal,
    playerNum,
  }: PlayerHealthBarProps) {
    // Health-based color gradient (Street Fighter: healthy=green, critical=red)
    const healthPercent = dollars / 10
    const healthColor = healthPercent > 0.6 ? 'green' : healthPercent > 0.3 ? 'yellow' : 'red'

    // Local player gets cyan glow indicator (Street Fighter: "YOU" badge)
    const localPlayerGlow = isLocal
      ? 'ring-1 ring-tron-cyan/30 shadow-[0_0_12px_rgba(0,243,255,0.2)]'
      : ''
    const localBadge = 'P' + playerNum

    // Health bar gradient classes
    const healthGradientClasses = {
      green: 'bg-gradient-to-r from-emerald-500 to-green-400',
      yellow: 'bg-gradient-to-r from-yellow-500 to-amber-400',
      red: 'bg-gradient-to-r from-red-600 to-red-500',
    }

    return (
      <motion.div
        variants={itemVariants}
        className={cn('space-y-1.5 relative rounded-lg', localPlayerGlow)}
        initial="hidden"
        animate="visible"
      >
        {/* Player badge (Street Fighter P1/P2 style) */}
        <div className="flex items-center justify-between gap-1">
          <motion.span
            className="font-bold tracking-wide truncate text-[10px] sm:text-xs md:text-sm text-white"
            animate={{
              textShadow:
                healthColor === 'red'
                  ? '0 0 10px rgba(255,68,68,0.8), 0 0 20px rgba(255,68,68,0.5)'
                  : '0 0 10px rgba(255,255,255,0.5)',
            }}
            transition={{ duration: 0.3 }}
          >
            {name}
          </motion.span>
          <span
            className={cn(
              'text-[8px] sm:text-[9px] font-bold px-1.5 py-0.5 rounded',
              isLocal ? 'bg-tron-cyan text-black' : 'bg-white/10 text-white/60'
            )}
          >
            {localBadge}
          </span>
        </div>

        {/* Health bar with gradient fill */}
        <div className="relative h-3 sm:h-4 bg-black/80 rounded-full overflow-hidden border border-white/20">
          <motion.div
            className={cn('h-full rounded-full', healthGradientClasses[healthColor])}
            initial={{ width: 0 }}
            animate={{ width: `${healthPercent * 100}%` }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          />
        </div>

        {/* Dollar counter with damage feedback */}
        <motion.span
          className={cn(
            'text-[10px] sm:text-xs font-mono font-bold text-center block',
            healthColor === 'red' ? 'text-red-400 animate-pulse' : 'text-white/80'
          )}
          key={dollars}
          initial={{ scale: 1.2 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.2 }}
        >
          ${dollars}
        </motion.span>
      </motion.div>
    )
  },
  (prevProps, nextProps) => {
    // Only re-render if relevant props changed
    return (
      prevProps.dollars === nextProps.dollars &&
      prevProps.color === nextProps.color &&
      prevProps.index === nextProps.index &&
      prevProps.isLocal === nextProps.isLocal &&
      prevProps.playerNum === nextProps.playerNum
    )
  }
)

// Define at module level (outside component) - prevents recreation on every render
const METER_GRADIENTS = {
  player1Advantage: 'linear-gradient(90deg, #00f3ff 0%, #00a8b3 100%)',
  player2Advantage: 'linear-gradient(90deg, #ff6b00 0%, #ff00ff 100%)',
  balanced: 'linear-gradient(90deg, #00f3ff 0%, #ff6b00 100%)',
} as const

function getMeterGradient(isPlayer1Advantage: boolean, isPlayer2Advantage: boolean): string {
  if (isPlayer1Advantage) return METER_GRADIENTS.player1Advantage
  if (isPlayer2Advantage) return METER_GRADIENTS.player2Advantage
  return METER_GRADIENTS.balanced
}

const TugOfWarMeter = React.memo(
  function TugOfWarMeter({ value, isPlayer1 }: { value: number; isPlayer1: boolean }) {
    const clampedValue = Math.max(TUG_OF_WAR_MIN, Math.min(TUG_OF_WAR_MAX, value))
    const absoluteValue = Math.abs(clampedValue)

    const isPlayer1Advantage = clampedValue < 0
    const isPlayer2Advantage = clampedValue > 0

    const gradient = getMeterGradient(isPlayer1Advantage, isPlayer2Advantage)
    const meterPosition = isPlayer1Advantage ? 'left-0 right-1/2' : 'left-1/2 right-0'
    const yourAdvantageColor = isPlayer1Advantage
      ? 'text-tron-cyan text-glow'
      : 'text-tron-white-dim'
    const opponentAdvantageColor = isPlayer2Advantage
      ? 'text-tron-orange text-glow-orange'
      : 'text-tron-white-dim'

    const yourLabel = isPlayer1 ? 'P1' : 'P2'
    const opponentLabel = isPlayer1 ? 'P2' : 'P1'

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
              background: gradient,
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
                background:
                  'linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)',
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
            className={cn(
              'text-[10px] sm:text-xs font-bold tracking-wider',
              opponentAdvantageColor
            )}
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
  },
  (prevProps, nextProps) => {
    return prevProps.value === nextProps.value && prevProps.isPlayer1 === nextProps.isPlayer1
  }
)

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
        className="absolute top-0 left-0 right-0 z-10 p-1.5 sm:p-2 lg:p-3 pointer-events-none"
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

              {/* Right: Help button - larger touch target */}
              <button
                onClick={() => setShowHowToPlay(true)}
                className="w-7 h-7 sm:w-6 sm:h-6 flex items-center justify-center hover:bg-tron-cyan/10 rounded transition-colors pointer-events-auto shrink-0"
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

            {/* Player Health Bars - Position-aware slots (P1 left, P2 right) */}
            <div className="grid grid-cols-2 gap-2 sm:gap-3">
              {(() => {
                // Define slots based on actual player positions (P1 left, P2 right)
                const playerSlots = [
                  {
                    player: isPlayer1 ? localPlayer : opponent,
                    color: 'green' as const,
                    isLocal: isPlayer1,
                  },
                  {
                    player: isPlayer1 ? opponent : localPlayer,
                    color: 'red' as const,
                    isLocal: !isPlayer1,
                  },
                ]

                return playerSlots.map(
                  (slot, index) =>
                    slot.player && (
                      <PlayerHealthBar
                        key={slot.player.id}
                        name={slot.player.name}
                        dollars={slot.player.dollars}
                        color={slot.color}
                        index={index}
                        isLocal={slot.isLocal}
                        playerNum={slot.isLocal ? (isPlayer1 ? 1 : 2) : isPlayer1 ? 2 : 1}
                      />
                    )
                )
              })()}
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
