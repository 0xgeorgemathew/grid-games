'use client'

import { useTradingStore } from '@/game/stores/trading-store'
import { motion, AnimatePresence } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

const FLASH_DURATION = 1200 // 1.2 seconds

/**
 * SettlementFlash - Shows simple +$1 or -$1 overlay when orders settle
 * Only local player's result is shown, with green for win / red for loss
 */
export function SettlementFlash() {
  const { latestSettlement, players, localPlayerId } = useTradingStore()
  const [isVisible, setIsVisible] = useState(false)
  const lastShownIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!latestSettlement || !localPlayerId) {
      lastShownIdRef.current = null
      return
    }

    // Only show if this is a new settlement
    if (latestSettlement.orderId !== lastShownIdRef.current) {
      lastShownIdRef.current = latestSettlement.orderId

      // Show immediately via timeout callback (async setState)
      const showTimer = setTimeout(() => setIsVisible(true), 0)

      // Hide after duration via timeout callback (async setState)
      const hideTimer = setTimeout(() => setIsVisible(false), FLASH_DURATION)

      return () => {
        clearTimeout(showTimer)
        clearTimeout(hideTimer)
      }
    }
  }, [latestSettlement, localPlayerId])

  if (!latestSettlement || !isVisible || !localPlayerId) return null

  // Determine if local player won
  const amount = latestSettlement.coinType === 'whale' ? 2 : 1
  const isLocalPlayerWinner = latestSettlement.isCorrect
    ? latestSettlement.playerId === localPlayerId
    : players.find((p) => p.id !== latestSettlement.playerId)?.id === localPlayerId

  const localResult = isLocalPlayerWinner ? `+$${amount}` : `-$${amount}`
  const resultColor = isLocalPlayerWinner ? 'text-green-400' : 'text-red-400'

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* Subtle background glow */}
          <motion.div
            className={cn(
              'absolute inset-0',
              isLocalPlayerWinner ? 'bg-green-500/5' : 'bg-red-500/5'
            )}
            animate={{
              opacity: [0, 0.3, 0],
            }}
            transition={{
              duration: FLASH_DURATION / 1000,
              ease: 'easeOut',
            }}
          />

          {/* Result display - simple and centered */}
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: [1, 1.2, 1], opacity: 1 }}
            exit={{ scale: 1.5, opacity: 0 }}
            transition={{
              duration: FLASH_DURATION / 1000,
              ease: 'easeOut',
            }}
            className="relative"
          >
            <motion.span
              className={cn(
                'text-7xl sm:text-8xl font-black font-mono tracking-tight block',
                resultColor
              )}
              style={{
                textShadow: isLocalPlayerWinner
                  ? '0 0 30px rgba(74, 222, 128, 0.8), 0 0 60px rgba(74, 222, 128, 0.4)'
                  : '0 0 30px rgba(248, 113, 113, 0.8), 0 0 60px rgba(248, 113, 113, 0.4)',
              }}
              animate={{
                scale: [1, 1.1, 1],
              }}
              transition={{
                duration: 0.3,
                repeat: 2,
                ease: 'easeInOut',
              }}
            >
              {localResult}
            </motion.span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
