'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTradingStore } from '@/game/stores/trading-store'
import { cn } from '@/lib/utils'
import type { OrderPlacedEvent } from '@/game/types/trading'

const ORDER_CARD_SIZE = 70
const SETTLEMENT_TIME = 5000 // 5 seconds

const COIN_STYLES: Record<string, { bg: string; border: string; glow: string; icon: string }> = {
  call: {
    bg: 'bg-tron-cyan/10',
    border: 'border-tron-cyan/40',
    glow: 'shadow-[0_0_15px_rgba(0,243,255,0.3)]',
    icon: '▲',
  },
  put: {
    bg: 'bg-tron-orange/10',
    border: 'border-tron-orange/40',
    glow: 'shadow-[0_0_15px_rgba(255,107,0,0.3)]',
    icon: '▼',
  },
  whale: {
    bg: 'bg-yellow-500/10',
    border: 'border-yellow-500/40',
    glow: 'shadow-[0_0_20px_rgba(255,215,0,0.4)]',
    icon: '🐋',
  },
}

// Animation variants
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
}

const itemVariants = {
  hidden: {
    y: 100,
    opacity: 0,
    scale: 0.8,
  },
  visible: {
    y: 0,
    opacity: 1,
    scale: 1,
    transition: {
      type: 'spring' as const,
      stiffness: 400,
      damping: 25,
    },
  },
  exit: {
    scale: 0.8,
    opacity: 0,
    transition: {
      duration: 0.2,
    },
  },
}

interface OrderCardProps {
  order: OrderPlacedEvent
  isLocalPlayer: boolean
  index: number
  onSettle: (orderId: string) => void
}

function OrderCard({ order, isLocalPlayer, index, onSettle }: OrderCardProps) {
  const [timeRemaining, setTimeRemaining] = useState(SETTLEMENT_TIME)
  const [isSettling, setIsSettling] = useState(false)
  const [result, setResult] = useState<'win' | 'loss' | null>(null)

  const coinStyle = COIN_STYLES[order.coinType] ?? COIN_STYLES.call
  const isLocalPlayerCard = isLocalPlayer

  useEffect(() => {
    const startTime = Date.now()
    const endTime = order.settlesAt

    const updateCountdown = () => {
      const remaining = Math.max(0, endTime - Date.now())
      setTimeRemaining(remaining)

      if (remaining === 0 && !isSettling) {
        // Simulate settlement result (in real implementation, this comes from server)
        setIsSettling(true)
        const isWin = Math.random() > 0.5 // Placeholder - real result comes from server
        setResult(isWin ? 'win' : 'loss')

        // Remove after showing result
        setTimeout(() => {
          onSettle(order.orderId)
        }, 800)
      } else if (remaining > 0) {
        requestAnimationFrame(updateCountdown)
      }
    }

    const rafId = requestAnimationFrame(updateCountdown)
    return () => cancelAnimationFrame(rafId)
  }, [order.settlesAt, isSettling, onSettle, order.orderId])

  const timePercent = (timeRemaining / SETTLEMENT_TIME) * 100
  const isUrgent = timeRemaining < 2000 // Less than 2 seconds

  return (
    <motion.div
      variants={itemVariants}
      className={cn(
        'relative order-card pointer-events-auto',
        coinStyle.bg,
        coinStyle.border,
        coinStyle.glow,
        isLocalPlayerCard && 'ring-1 ring-tron-cyan/30'
      )}
      style={{
        minWidth: ORDER_CARD_SIZE,
        height: ORDER_CARD_SIZE,
      }}
    >
      {/* Coin icon */}
      <motion.div
        className={cn(
          'absolute top-2 left-1/2 -translate-x-1/2 text-lg sm:text-xl',
          isUrgent && 'animate-pulse'
        )}
        animate={{
          scale: isUrgent ? [1, 1.2, 1] : 1,
        }}
        transition={{ duration: 0.5, repeat: isUrgent ? Infinity : 0 }}
      >
        {coinStyle.icon}
      </motion.div>

      {/* Countdown timer */}
      <motion.div
        className={cn(
          'absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-xl sm:text-2xl font-bold font-mono',
          isUrgent ? 'text-yellow-400' : 'text-tron-white'
        )}
        animate={{
          scale: isUrgent ? [1, 1.1, 1] : 1,
        }}
        transition={{ duration: 0.3, repeat: isUrgent ? Infinity : 0 }}
      >
        {(timeRemaining / 1000).toFixed(1)}
      </motion.div>

      {/* Progress ring */}
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 100 100">
        <circle
          cx="50"
          cy="50"
          r="48"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={cn(
            'opacity-20',
            order.coinType === 'call' ? 'text-tron-cyan' : 'text-tron-orange'
          )}
        />
        <motion.circle
          cx="50"
          cy="50"
          r="48"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={cn(
            order.coinType === 'call' ? 'text-tron-cyan' : 'text-tron-orange',
            isUrgent && 'text-yellow-400'
          )}
          style={{
            strokeDasharray: 2 * Math.PI * 48,
            strokeDashoffset: 2 * Math.PI * 48 * (1 - timePercent / 100),
          }}
        />
      </svg>

      {/* Settlement result overlay */}
      <AnimatePresence>
        {result && (
          <motion.div
            className="absolute inset-0 flex items-center justify-center text-2xl font-bold"
            initial={{ scale: 0, rotate: -180, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            exit={{ scale: 1.5, opacity: 0 }}
            transition={{
              type: 'spring',
              stiffness: 500,
              damping: 20,
            }}
          >
            <span className={result === 'win' ? 'text-green-400' : 'text-red-400'}>
              {result === 'win' ? '✓' : '✗'}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Player indicator (small dot for opponent) */}
      {!isLocalPlayerCard && (
        <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-tron-orange/50" />
      )}
    </motion.div>
  )
}

export function PendingOrdersBar() {
  const { activeOrders, localPlayerId } = useTradingStore()
  const orders = useMemo(() => Array.from(activeOrders.values()), [activeOrders])
  const [settledOrderIds, setSettledOrderIds] = useState<Set<string>>(new Set())

  const handleSettle = (orderId: string) => {
    setSettledOrderIds((prev) => new Set(prev).add(orderId))
  }

  const visibleOrders = orders.filter((o) => !settledOrderIds.has(o.orderId))

  if (visibleOrders.length === 0) {
    return null
  }

  return (
    <motion.div
      className={cn(
        'absolute bottom-0 right-0 left-0 z-10 p-2 pointer-events-none sm:bottom-2 sm:right-4 sm:left-auto sm:w-auto',
        // Leave space for SettlementFeed on desktop
        'sm:max-w-[calc(100%-340px)]'
      )}
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <div className="glass-panel-vibrant rounded-lg p-2 pointer-events-auto">
        <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto pb-1 sm:pb-0 scrollbar-thin scrollbar-thumb-tron-cyan/20">
          <AnimatePresence mode="popLayout">
            {visibleOrders.map((order, index) => (
              <OrderCard
                key={order.orderId}
                order={order}
                isLocalPlayer={order.playerId === localPlayerId}
                index={index}
                onSettle={handleSettle}
              />
            ))}
          </AnimatePresence>
        </div>

        {/* Label */}
        <div className="mt-1 text-center">
          <span className="text-xs text-tron-cyan/60 uppercase tracking-wider">Pending Orders</span>
        </div>
      </div>
    </motion.div>
  )
}
