'use client'

import { useTradingStore } from '@/game/stores/trading-store'
import { Badge } from '@/components/ui/badge'
import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import type { SettlementEvent } from '@/game/types/trading'
import { motion, AnimatePresence } from 'framer-motion'

// Vibrant color scheme for coin types
const COIN_STYLES: Record<string, { bg: string; text: string; border: string; glow: string }> = {
  call: {
    bg: 'bg-green-500/10',
    text: 'text-green-400',
    border: 'border-green-500/40',
    glow: 'shadow-[0_0_15px_rgba(74,222,128,0.4)]',
  },
  put: {
    bg: 'bg-red-500/10',
    text: 'text-red-400',
    border: 'border-red-500/40',
    glow: 'shadow-[0_0_15px_rgba(248,113,113,0.4)]',
  },
  gas: {
    bg: 'bg-yellow-500/10',
    text: 'text-yellow-400',
    border: 'border-yellow-500/40',
    glow: 'shadow-[0_0_15px_rgba(250,204,21,0.4)]',
  },
  whale: {
    bg: 'bg-purple-500/10',
    text: 'text-purple-400',
    border: 'border-purple-500/40',
    glow: 'shadow-[0_0_15px_rgba(192,132,252,0.4)]',
  },
}

const RECENT_SETTLEMENTS_COUNT = 3

function getPriceDirection(change: number): string {
  return change >= 0 ? '↑' : '↓'
}

// Animation variants for list items
const listVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.12,
    },
  },
}

const itemVariants = {
  hidden: {
    x: 100,
    opacity: 0,
    scale: 0.9,
  },
  visible: {
    x: 0,
    opacity: 1,
    scale: 1,
    transition: {
      type: 'spring' as const,
      stiffness: 300,
      damping: 25,
    },
  },
  exit: {
    x: -50,
    opacity: 0,
    scale: 0.95,
    transition: {
      duration: 0.2,
    },
  },
}

interface SettlementItemProps {
  settlement: SettlementEvent
  isLocalPlayer: boolean
  index: number
}

function SettlementItem({ settlement, isLocalPlayer, index }: SettlementItemProps) {
  const priceChange = settlement.finalPrice - settlement.priceAtOrder
  const isWin = settlement.isCorrect

  const coinStyle = COIN_STYLES[settlement.coinType] ?? COIN_STYLES.call
  const playerNameColor = isLocalPlayer ? 'text-tron-cyan font-bold' : 'text-tron-white-dim'
  const priceChangeColor = priceChange >= 0 ? 'text-green-400' : 'text-red-400'

  // Dollar amount display
  const dollarAmount = settlement.coinType === 'whale' ? 2 : 1
  const dollarChange = isWin ? `+$${dollarAmount}` : `-$${dollarAmount}`
  const dollarColor = isWin ? 'text-green-400' : 'text-red-400'

  return (
    <motion.div
      variants={itemVariants}
      layout
      className={cn(
        'relative overflow-hidden rounded-lg border backdrop-blur-sm',
        isWin ? 'settlement-win' : 'settlement-loss'
      )}
    >
      {/* Animated shimmer effect for local player wins */}
      {isLocalPlayer && isWin && (
        <motion.div
          className="absolute inset-0 pointer-events-none"
          animate={{
            x: ['-100%', '200%'],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: 'linear',
          }}
          style={{
            background: 'linear-gradient(90deg, transparent, rgba(57,255,20,0.2), transparent)',
          }}
        />
      )}

      <div className="relative flex items-center justify-between gap-2 p-2.5">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* Result indicator with bounce animation */}
          <motion.div
            className={cn(
              'flex items-center justify-center w-6 h-6 rounded-full text-sm font-bold',
              isWin ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
            )}
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{
              type: 'spring',
              stiffness: 500,
              damping: 20,
              delay: index * 0.05,
            }}
          >
            {isWin ? '✓' : '✗'}
          </motion.div>

          {/* Player name */}
          <span className={cn('text-xs truncate', playerNameColor)}>{settlement.playerName}</span>

          {/* Dollar amount display for local player */}
          {isLocalPlayer && (
            <motion.div
              className={cn('px-2 py-1 rounded text-sm font-bold font-mono', isWin ? 'bg-green-500/20' : 'bg-red-500/20')}
              initial={{ scale: 1.2 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 500, damping: 20 }}
            >
              <span className={dollarColor}>{dollarChange}</span>
            </motion.div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Coin type badge with glow */}
          <Badge
            variant="outline"
            className={cn(
              'text-xs px-2 py-0.5 font-mono font-bold',
              coinStyle.bg,
              coinStyle.text,
              coinStyle.border,
              coinStyle.glow
            )}
          >
            <motion.span
              animate={{
                textShadow: isWin
                  ? ['0 0 5px currentColor', '0 0 15px currentColor', '0 0 5px currentColor']
                  : '0 0 5px currentColor',
              }}
              transition={{
                duration: 2,
                repeat: isWin ? Infinity : 0,
              }}
            >
              {settlement.coinType.toUpperCase()}
            </motion.span>
          </Badge>

          {/* Price movement with animated direction */}
          <div className="flex items-center gap-1">
            <motion.span
              className={cn('text-sm font-mono font-bold', priceChangeColor)}
              animate={{
                y: isWin ? [0, -2, 0] : [0, 2, 0],
              }}
              transition={{
                duration: 0.5,
                delay: 0.2 + index * 0.05,
              }}
            >
              {getPriceDirection(priceChange)}
            </motion.span>
            <motion.span
              className={cn('text-xs font-mono', priceChangeColor)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 + index * 0.05 }}
            >
              {Math.abs(priceChange).toFixed(2)}
            </motion.span>
          </div>
        </div>
      </div>

      {/* Subtle corner accent */}
      <div
        className={cn(
          'absolute bottom-0 right-0 w-3 h-3 border-r-2 border-b-2 rounded-br',
          isWin ? 'border-green-500/50' : 'border-red-500/50'
        )}
      />
    </motion.div>
  )
}

export function SettlementFeed() {
  const { pendingOrders, localPlayerId } = useTradingStore()
  const recentSettlements = useMemo(() => {
    const settlements = Array.from(pendingOrders.values())
    return settlements.slice(-RECENT_SETTLEMENTS_COUNT).reverse()
  }, [pendingOrders])

  if (recentSettlements.length === 0) {
    return null
  }

  return (
    <motion.div
      className="absolute bottom-0 right-0 left-0 sm:bottom-4 sm:right-4 sm:left-auto sm:w-80 z-10 p-2 sm:p-0"
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{
        type: 'spring' as const,
        stiffness: 300,
        damping: 30,
        delay: 0.5,
      }}
    >
      {/* Gradient border card */}
      <div className="gradient-border-cyan-magenta">
        <div className="glass-panel-vibrant rounded-xl p-3">
          {/* Header with animated glow */}
          <motion.div
            className="flex items-center gap-2 mb-3"
            animate={{
              borderColor: ['rgba(0,243,255,0.2)', 'rgba(255,0,255,0.3)', 'rgba(0,243,255,0.2)'],
            }}
            transition={{ duration: 3, repeat: Infinity }}
          >
            <motion.div
              className="w-2 h-2 rounded-full bg-tron-cyan"
              animate={{
                scale: [1, 1.3, 1],
                opacity: [0.5, 1, 0.5],
              }}
              transition={{ duration: 1.5, repeat: Infinity }}
            />
            <h3 className="text-xs font-bold text-tron-cyan/80 uppercase tracking-[0.15em]">
              Recent Settlements
            </h3>
          </motion.div>

          {/* Settlements list with animations */}
          <motion.div
            variants={listVariants}
            initial="hidden"
            animate="visible"
            className="space-y-2"
          >
            <AnimatePresence mode="popLayout">
              {recentSettlements.map((settlement, index) => (
                <SettlementItem
                  key={settlement.orderId}
                  settlement={settlement}
                  isLocalPlayer={settlement.playerId === localPlayerId}
                  index={index}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        </div>
      </div>
    </motion.div>
  )
}
