'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { useTradingStore } from '@/game/stores/trading-store'
import { Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useEffect, useState } from 'react'
import { formatPrice } from '@/lib/formatPrice'

export function PositionIndicator() {
  const { activeOrders, localPlayerId, pendingOrders } = useTradingStore()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let raf: number
    const tick = () => {
      setNow(Date.now())
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  // Get local player's active orders
  const localOrders = Array.from(activeOrders.values())
    .filter((order) => order.playerId === localPlayerId)
    .sort((a, b) => a.settlesAt - b.settlesAt)
    .slice(0, 3) // Max 3 visible

  return (
    <div className="absolute bottom-0 left-0 right-0 z-10 p-3 pointer-events-none">
      <div className="max-w-2xl mx-auto">
        <AnimatePresence>
          {localOrders.map((order, index) => {
            const isCall = order.coinType === 'call'
            const timeLeft = Math.max(0, order.settlesAt - now)
            const progress = Math.min(1, timeLeft / 10000) // 10s window

            // Check if settled
            const settled = pendingOrders.get(order.orderId)
            const isWin = settled?.isCorrect

            // Check if order timed out (no settlement received)
            const isTimedOut = !settled && timeLeft === 0

            // Determine amount based on coin type
            const amount = order.coinType === 'whale' ? 2 : 1

            // Border and glow styles based on state
            const borderStyle = isTimedOut
              ? 'border-2 border-yellow-500/60 shadow-[0_0_20px_rgba(234,179,8,0.3)]'
              : settled
                ? isWin
                  ? 'border-2 border-green-500/60 shadow-[0_0_25px_rgba(74,222,128,0.4)]'
                  : 'border-2 border-red-500/60 shadow-[0_0_25px_rgba(248,113,113,0.4)]'
                : 'border border-tron-cyan/30'

            return (
              <motion.div
                key={order.orderId}
                initial={{ y: 100, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 50, opacity: 0, scale: 0.9 }}
                transition={{ delay: index * 0.1 }}
                className={cn(
                  'glass-panel-vibrant rounded-xl p-3 mb-2 relative overflow-hidden',
                  borderStyle
                )}
              >
                {/* Animated glow effect for wins/losses */}
                {settled && (
                  <motion.div
                    className="absolute inset-0 pointer-events-none"
                    animate={{
                      opacity: [0.1, 0.2, 0.1],
                    }}
                    transition={{
                      duration: 1,
                      repeat: 2,
                    }}
                    style={{
                      background: isWin
                        ? 'radial-gradient(circle at center, rgba(74,222,128,0.2) 0%, transparent 70%)'
                        : 'radial-gradient(circle at center, rgba(248,113,113,0.2) 0%, transparent 70%)',
                    }}
                  />
                )}

                <div className="relative flex items-center justify-between gap-3">
                  {/* Left: Entry Point & Direction */}
                  <div className="flex items-center gap-3">
                    {/* Direction indicator - more prominent */}
                    <motion.div
                      className={cn(
                        'w-10 h-10 rounded-lg flex items-center justify-center relative',
                        isCall ? 'bg-green-500/20' : 'bg-red-500/20',
                        settled && (isWin ? 'bg-green-500/30' : 'bg-red-500/30')
                      )}
                      animate={!settled && !isTimedOut ? { y: [0, -4, 0, 4, 0] } : {}}
                      transition={
                        !settled && !isTimedOut ? { duration: 1.5, repeat: Infinity } : {}
                      }
                    >
                      {isCall ? (
                        <span className="text-green-400 text-xl">▲</span>
                      ) : (
                        <span className="text-red-400 text-xl">▼</span>
                      )}

                      {/* Pulse ring for pending orders */}
                      {!settled && !isTimedOut && (
                        <motion.div
                          className={cn(
                            'absolute inset-0 rounded-lg',
                            isCall ? 'border border-green-400' : 'border border-red-400'
                          )}
                          animate={{
                            scale: [1, 1.3, 1],
                            opacity: [0.5, 0, 0.5],
                          }}
                          transition={{
                            duration: 1.5,
                            repeat: Infinity,
                          }}
                        />
                      )}
                    </motion.div>

                    {/* Entry price */}
                    <div className="flex flex-col">
                      <span className="text-[10px] text-tron-white-dim uppercase tracking-wider">
                        Entry
                      </span>
                      <span className="text-base font-mono font-bold text-tron-cyan drop-shadow-[0_0_8px_rgba(0,243,255,0.5)]">
                        ${formatPrice(order.priceAtOrder)}
                      </span>
                    </div>
                  </div>

                  {/* Center: Progress bar (pending) or Result badge (settled) */}
                  <div className="flex-1 flex items-center justify-center">
                    {!settled && !isTimedOut ? (
                      // Countdown with progress bar
                      <div className="w-full flex flex-col items-center gap-1">
                        <div className="flex items-center justify-between w-full">
                          <span className="text-[10px] text-tron-white-dim">Expires</span>
                          <motion.span
                            className={cn(
                              'text-lg font-mono font-bold',
                              timeLeft < 3000 ? 'text-yellow-400' : 'text-tron-cyan'
                            )}
                            animate={
                              timeLeft < 3000
                                ? {
                                    scale: [1, 1.1, 1],
                                    opacity: [1, 0.7, 1],
                                  }
                                : {}
                            }
                            transition={
                              timeLeft < 3000
                                ? { duration: 0.5, repeat: Infinity }
                                : {}
                            }
                          >
                            {(timeLeft / 1000).toFixed(1)}s
                          </motion.span>
                        </div>
                        <div className="h-2 bg-black/50 rounded-full overflow-hidden w-full">
                          <motion.div
                            className={cn(
                              'h-full',
                              isCall
                                ? 'bg-gradient-to-r from-green-500 to-green-400'
                                : 'bg-gradient-to-r from-red-500 to-red-400'
                            )}
                            initial={{ width: '100%' }}
                            animate={{ width: `${progress * 100}%` }}
                            transition={{ duration: 0.1 }}
                          />
                        </div>
                      </div>
                    ) : isTimedOut ? (
                      // Timed out state
                      <div className="flex flex-col items-center">
                        <span className="text-xs text-yellow-400 font-bold">Timed Out</span>
                        <span className="text-lg text-yellow-400">?</span>
                      </div>
                    ) : (
                      // SETTLED STATE - Prominent result display
                      <motion.div
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                        className={cn(
                          'flex items-center gap-2 px-3 py-1.5 rounded-lg',
                          isWin
                            ? 'bg-green-500/20 border border-green-500/40'
                            : 'bg-red-500/20 border border-red-500/40'
                        )}
                      >
                        {/* Large result icon */}
                        <motion.div
                          animate={
                            isWin
                              ? {
                                  scale: [1, 1.2, 1],
                                  rotate: [0, 10, -10, 0],
                                }
                              : {
                                  scale: [1, 1.1, 1],
                                  x: [0, -3, 3, 0],
                                }
                          }
                          transition={{
                            duration: 0.5,
                            delay: 0.1,
                          }}
                        >
                          {isWin ? (
                            <Check className="w-6 h-6 text-green-400 drop-shadow-[0_0_8px_rgba(74,222,128,0.8)]" />
                          ) : (
                            <X className="w-6 h-6 text-red-400 drop-shadow-[0_0_8px_rgba(248,113,113,0.8)]" />
                          )}
                        </motion.div>

                        {/* Amount with sign */}
                        <span
                          className={cn(
                            'text-xl font-black font-mono',
                            isWin
                              ? 'text-green-400 drop-shadow-[0_0_10px_rgba(74,222,128,0.8)]'
                              : 'text-red-400 drop-shadow-[0_0_10px_rgba(248,113,113,0.8)]'
                          )}
                        >
                          {isWin ? `+$${amount}` : `-$${amount}`}
                        </span>
                      </motion.div>
                    )}
                  </div>

                  {/* Right: Coin type badge */}
                  <div
                    className={cn(
                      'px-2 py-1.5 rounded-lg text-xs font-bold font-mono shrink-0',
                      order.coinType === 'call' && 'bg-green-500/20 text-green-400 border border-green-500/30',
                      order.coinType === 'put' && 'bg-red-500/20 text-red-400 border border-red-500/30',
                      order.coinType === 'whale' && 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                    )}
                  >
                    {order.coinType === 'whale' ? '🐋' : order.coinType.toUpperCase()}
                  </div>
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </div>
  )
}
