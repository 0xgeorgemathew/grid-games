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
import type { Player } from '@/game/types/trading'

const CRYPTO_SYMBOLS: Record<CryptoSymbol, string> = {
  btcusdt: 'BTC',
} as const

// Format time as seconds only
function formatTime(seconds: number): string {
  return seconds.toString()
}

const PULSE_ANIMATION = {
  opacity: [0.3, 0.6, 0.3] as number[],
  transition: { duration: 2, repeat: Infinity },
} as const

type PlayerColor = 'green' | 'red'

interface PlayerHealthBarProps {
  name: string
  dollars: number
  color: PlayerColor
  index: number
  label: PlayerLabel
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.15, delayChildren: 0.2 },
  },
}

const itemVariants = {
  hidden: { y: -20, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: { type: 'spring' as const, stiffness: 300, damping: 24 },
  },
}

function getPriceColor(changePercent: number): { color: string; glow: string } {
  const isPositive = changePercent >= 0
  return {
    color: isPositive ? 'text-tron-cyan' : 'text-tron-orange',
    glow: isPositive
      ? '0 0 10px rgba(0, 243, 255, 0.8), 0 0 20px rgba(0, 243, 255, 0.4)'
      : '0 0 10px rgba(255, 107, 0, 0.8), 0 0 20px rgba(255, 107, 0, 0.4)',
  }
}

type PlayerLabel = 'YOU' | 'OPP'

interface PlayerSlot {
  player: Player | undefined
  label: PlayerLabel
}

function getPlayerSlots(localPlayer: Player | null, opponent: Player | null): PlayerSlot[] {
  // Fixed layout: OPP always left, YOU always right
  return [
    {
      player: opponent ?? undefined,
      label: 'OPP',
    },
    {
      player: localPlayer ?? undefined,
      label: 'YOU',
    },
  ]
}

const ConnectionStatusDot = React.memo(function ConnectionStatusDot({
  isPriceConnected,
  priceError,
}: {
  isPriceConnected: boolean
  priceError: string | null
}) {
  const colorClass = isPriceConnected
    ? 'bg-tron-cyan'
    : priceError
      ? 'bg-red-400'
      : 'bg-tron-orange'

  return (
    <motion.div
      className={cn('w-2 h-2 rounded-full', colorClass)}
      animate={{
        scale: isPriceConnected ? [1, 1.4, 1] : priceError ? [1, 1.2, 1] : [0.8, 1, 0.8],
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
  )
})

const PlayerHealthBar = React.memo(
  function PlayerHealthBar({ name, dollars, color, index, label }: PlayerHealthBarProps) {
    const healthPercent = dollars / 10
    const healthColor = healthPercent > 0.6 ? 'green' : healthPercent > 0.3 ? 'yellow' : 'red'

    const isYou = label === 'YOU'

    const healthGradientClasses = {
      green: 'bg-gradient-to-r from-emerald-500 to-green-400',
      yellow: 'bg-gradient-to-r from-yellow-500 to-amber-400',
      red: 'bg-gradient-to-r from-red-600 to-red-500',
    }

    return (
      <motion.div
        variants={itemVariants}
        className={cn(
          'space-y-1.5 relative rounded-lg',
          isYou ? 'border-r-2 border-tron-cyan/50' : ''
        )}
        initial="hidden"
        animate="visible"
      >
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
          {isYou ? (
            <span className="text-[10px] sm:text-xs font-black px-2 py-0.5 rounded bg-tron-cyan text-black shadow-[0_0_10px_rgba(0,243,255,0.5)]">
              YOU
            </span>
          ) : (
            <span className="text-[8px] sm:text-[9px] font-bold px-1.5 py-0.5 rounded bg-white/10 text-white/50">
              OPP
            </span>
          )}
        </div>

        <div className="relative h-3 sm:h-4 bg-black/80 rounded-full overflow-hidden border border-white/20">
          <motion.div
            className={cn('h-full rounded-full', healthGradientClasses[healthColor])}
            initial={{ width: 0 }}
            animate={{ width: `${healthPercent * 100}%` }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          />
        </div>

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
    return (
      prevProps.dollars === nextProps.dollars &&
      prevProps.color === nextProps.color &&
      prevProps.index === nextProps.index &&
      prevProps.label === nextProps.label &&
      prevProps.name === nextProps.name
    )
  }
)

const RoundHeader = React.memo(function RoundHeader({
  currentRound,
  player1Wins,
  player2Wins,
  isSuddenDeath,
  roundTimeRemaining,
  isPlayer1,
}: {
  currentRound: number
  player1Wins: number
  player2Wins: number
  isSuddenDeath: boolean
  roundTimeRemaining: number
  isPlayer1: boolean
}) {
  const roundSeconds = Math.ceil(roundTimeRemaining / 1000)
  const timeClass = roundSeconds <= 10 ? 'text-red-400 animate-pulse' : 'text-white'

  const roundDisplay = isSuddenDeath ? '⚡ FINAL ROUND' : `ROUND ${currentRound}`

  // Perspective-aware win display: if isPlayer1, your wins = player1Wins; else your wins = player2Wins
  const yourWins = isPlayer1 ? player1Wins : player2Wins
  const oppWins = isPlayer1 ? player2Wins : player1Wins

  return (
    <motion.div
      variants={itemVariants}
      className="flex items-center justify-between px-2 py-1.5 bg-black/20 rounded-lg border border-white/10"
      initial="hidden"
      animate="visible"
    >
      {/* Round Badge */}
      <div
        className={cn(
          'px-3 py-1 rounded font-black text-xs tracking-wider',
          isSuddenDeath
            ? 'bg-red-500/20 text-red-400 border border-red-500/50'
            : 'bg-tron-cyan/20 text-tron-cyan border border-tron-cyan/50'
        )}
        style={{
          textShadow: isSuddenDeath
            ? '0 0 10px rgba(239,68,68,0.8)'
            : '0 0 10px rgba(0,243,255,0.5)',
        }}
      >
        {roundDisplay}
      </div>

      {/* Timer - Large digital display */}
      <div className="flex items-center gap-2">
        <span className="text-white/40 text-sm">⏱️</span>
        <span
          className={cn('text-2xl sm:text-3xl font-mono font-black tracking-wider', timeClass)}
          style={{ textShadow: '0 0 15px rgba(255,255,255,0.3)' }}
        >
          {formatTime(roundSeconds)}
        </span>
      </div>

      {/* Win Counter */}
      <div className="flex items-center gap-3">
        <span
          className={cn(
            'text-xs font-bold px-2 py-1 rounded',
            oppWins > yourWins ? 'bg-tron-cyan/20 text-tron-cyan' : 'bg-white/10 text-white/60'
          )}
        >
          OPP: {oppWins}
        </span>
        <span className="text-white/30">:</span>
        <span
          className={cn(
            'text-xs font-bold px-2 py-1 rounded',
            yourWins > oppWins ? 'bg-tron-orange/20 text-tron-orange' : 'bg-white/10 text-white/60'
          )}
        >
          YOU: {yourWins}
        </span>
      </div>
    </motion.div>
  )
})


export const GameHUD = React.memo(function GameHUD() {
  const {
    players,
    localPlayerId,
    isPlayer1,
    priceData,
    isPriceConnected,
    selectedCrypto,
    connectPriceFeed,
    isPlaying,
    priceError,
    currentRound,
    player1Wins,
    player2Wins,
    isSuddenDeath,
    roundTimeRemaining,
  } = useTradingStore()

  const [showHowToPlay, setShowHowToPlay] = useState(false)

  useEffect(() => {
    if (isPlaying && !isPriceConnected) {
      connectPriceFeed(selectedCrypto)
    }
  }, [isPlaying, isPriceConnected, selectedCrypto, connectPriceFeed])

  const { color: priceColor, glow: priceGlow } = getPriceColor(priceData?.changePercent ?? 0)

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
          <motion.div
            className="glass-panel-vibrant rounded-xl overflow-hidden"
            animate={{
              boxShadow: [
                '0 0 20px rgba(0,243,255,0.1), inset 0 0 20px rgba(0,243,255,0.03)',
                '0 0 30px rgba(0,243,255,0.15), inset 0 0 30px rgba(0,243,255,0.05)',
                '0 0 20px rgba(0,243,255,0.1), inset 0 0 20px rgba(0,243,255,0.03)',
              ],
            }}
            transition={{ duration: 3, repeat: Infinity }}
          >
            {/* Price Bar - Top Section */}
            <motion.div
              variants={itemVariants}
              className="p-2 sm:p-3"
              initial="hidden"
              animate="visible"
            >
              <motion.div
                variants={itemVariants}
                className="flex items-center justify-center gap-4"
                initial="hidden"
                animate="visible"
              >
                <div className="w-6 flex justify-center shrink-0">
                  <ConnectionStatusDot
                    isPriceConnected={isPriceConnected}
                    priceError={priceError}
                  />
                </div>

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
                      style={{ textShadow: priceGlow }}
                    />

                    <motion.span
                      className={cn(
                        'text-sm sm:text-lg font-bold font-mono shrink-0 px-2 py-0.5 rounded',
                        priceData.changePercent >= 0
                          ? 'bg-green-500/20 text-green-400'
                          : 'bg-red-500/20 text-red-400'
                      )}
                      style={{ textShadow: priceGlow }}
                      animate={{ opacity: [1, 0.8, 1] }}
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

                <button
                  onClick={() => setShowHowToPlay(true)}
                  className="w-7 h-7 sm:w-6 sm:h-6 flex items-center justify-center hover:bg-tron-cyan/10 rounded transition-colors pointer-events-auto shrink-0"
                >
                  <Info className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-tron-cyan" />
                </button>
              </motion.div>
            </motion.div>

            <motion.div
              className="h-px bg-gradient-to-r from-transparent via-tron-cyan/50 to-transparent"
              animate={{ opacity: [0.3, 0.6, 0.3] }}
              transition={{ duration: 2, repeat: Infinity }}
            />

            {/* Main Game Area - When playing */}
            {isPlaying && (
              <>
                {/* Round Header - NEW */}
                <RoundHeader
                  currentRound={currentRound}
                  player1Wins={player1Wins}
                  player2Wins={player2Wins}
                  isSuddenDeath={isSuddenDeath}
                  roundTimeRemaining={roundTimeRemaining}
                  isPlayer1={isPlayer1}
                />

                {/* Divider */}
                <motion.div
                  className="h-px bg-gradient-to-r from-transparent via-tron-cyan/30 to-transparent mx-2"
                  animate={{ opacity: [0.2, 0.5, 0.2] }}
                  transition={{ duration: 2, repeat: Infinity }}
                />

                {/* Health Bars Section */}
                <motion.div
                  variants={itemVariants}
                  className="p-2 sm:p-3"
                  initial="hidden"
                  animate="visible"
                >
                  <div className="grid grid-cols-2 gap-2 sm:gap-3">
                    {getPlayerSlots(localPlayer, opponent).map(
                      (slot, index) =>
                        slot.player && (
                          <PlayerHealthBar
                            key={slot.player.id}
                            name={slot.player.name}
                            dollars={slot.player.dollars}
                            color={slot.label === 'YOU' ? 'green' : 'red'}
                            index={index}
                            label={slot.label}
                          />
                        )
                    )}
                  </div>
                </motion.div>

              </>
            )}
          </motion.div>
        </div>
      </motion.div>
    </>
  )
})
