'use client'

import React from 'react'
import { useTradingStore } from '@/game/stores/trading-store'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'

const TUG_OF_WAR_MIN = -100
const TUG_OF_WAR_MAX = 100
const PROGRESS_HEIGHT = 'h-3'
const PROGRESS_BG = 'bg-black/50'

type PlayerColor = 'green' | 'red'

interface PlayerHealthBarProps {
  name: string
  health: number
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

function PlayerHealthBar({ name, health, color, index }: PlayerHealthBarProps) {
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
  const isLowHealth = health < 30
  const healthColor = isLowHealth
    ? color === 'green'
      ? 'text-red-400'
      : 'text-orange-300'
    : classes.text

  return (
    <motion.div variants={itemVariants} className="space-y-2" initial="hidden" animate="visible">
      <div className="flex items-center justify-between">
        <motion.span
          className={cn('font-bold text-sm sm:text-base tracking-wide', healthColor)}
          animate={{
            textShadow: isLowHealth
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
            'text-xs px-2 py-0.5 font-mono',
            classes.border,
            isLowHealth ? 'animate-pulse' : ''
          )}
        >
          <AnimatePresence mode="wait">
            <motion.span
              key={health}
              initial={{ scale: 1.3, color: isLowHealth ? '#ff4444' : '#00f3ff' }}
              animate={{ scale: 1, color: isLowHealth ? '#ff4444' : '#00f3ff' }}
              exit={{ scale: 0.8 }}
              transition={{ type: 'spring', stiffness: 500, damping: 20 }}
              className={cn(isLowHealth ? 'text-red-400' : classes.text)}
            >
              {health} HP
            </motion.span>
          </AnimatePresence>
        </Badge>
      </div>
      <div className="relative">
        <Progress
          value={health}
          className={cn(PROGRESS_HEIGHT, PROGRESS_BG, 'overflow-hidden border border-white/10')}
          indicatorClassName={cn(classes.progress, isLowHealth ? classes.glow : '')}
        />
        {/* Glow overlay for critical health */}
        <AnimatePresence>
          {isLowHealth && (
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

  const yourLabel = isPlayer1 ? 'YOUR ADVANTAGE' : 'OPPONENT ADVANTAGE'
  const opponentLabel = isPlayer1 ? 'OPPONENT ADVANTAGE' : 'YOUR ADVANTAGE'

  return (
    <motion.div
      variants={itemVariants}
      className="relative pt-3 pb-1"
      initial="hidden"
      animate="visible"
    >
      <div className="flex items-center justify-center gap-2 mb-2">
        <motion.span
          className="text-xs text-tron-cyan/60 uppercase tracking-[0.2em] font-semibold"
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
      <div className="relative h-3 bg-black/60 rounded-full overflow-hidden border border-tron-cyan/30 shadow-[0_0_20px_rgba(0,243,255,0.15)]">
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
          className="absolute left-1/2 top-0 bottom-0 w-1 z-10"
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
      <div className="flex justify-between mt-2 px-1">
        <motion.span
          className={cn('text-xs font-bold tracking-wider', yourAdvantageColor)}
          animate={{
            scale: isPlayer1Advantage ? [1, 1.05, 1] : 1,
          }}
          transition={{ duration: 1.5, repeat: isPlayer1Advantage ? Infinity : 0 }}
        >
          {yourLabel}
        </motion.span>
        <motion.span
          className={cn('text-xs font-bold tracking-wider', opponentAdvantageColor)}
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
  const { players, localPlayerId, isPlayer1, tugOfWar } = useTradingStore()

  const localPlayer = players.find((p) => p.id === localPlayerId)
  const opponent = players.find((p) => p.id !== localPlayerId)

  return (
    <motion.div
      className="absolute top-0 left-0 right-0 z-10 p-3 sm:p-5 pointer-events-none"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <div className="max-w-4xl mx-auto space-y-3 sm:space-y-5">
        {/* Glassmorphic panel container */}
        <motion.div
          className="glass-panel-vibrant rounded-xl p-3 sm:p-4"
          animate={{
            boxShadow: [
              '0 0 20px rgba(0,243,255,0.1), inset 0 0 20px rgba(0,243,255,0.03)',
              '0 0 30px rgba(0,243,255,0.15), inset 0 0 30px rgba(0,243,255,0.05)',
              '0 0 20px rgba(0,243,255,0.1), inset 0 0 20px rgba(0,243,255,0.03)',
            ],
          }}
          transition={{ duration: 3, repeat: Infinity }}
        >
          {/* Player Health Bars */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-10">
            {localPlayer && (
              <PlayerHealthBar
                name={localPlayer.name}
                health={localPlayer.health}
                color="green"
                index={0}
              />
            )}
            {opponent && (
              <PlayerHealthBar
                name={opponent.name}
                health={opponent.health}
                color="red"
                index={1}
              />
            )}
          </div>

          {/* Divider */}
          <motion.div
            className="my-3 h-px bg-gradient-to-r from-transparent via-tron-cyan/50 to-transparent"
            animate={{
              opacity: [0.3, 0.6, 0.3],
            }}
            transition={{ duration: 2, repeat: Infinity }}
          />

          {/* Tug of War Meter */}
          <TugOfWarMeter value={tugOfWar} isPlayer1={isPlayer1} />
        </motion.div>
      </div>
    </motion.div>
  )
})
