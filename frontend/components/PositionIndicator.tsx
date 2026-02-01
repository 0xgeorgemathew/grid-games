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
            const direction = isCall ? 'up' : 'down'
            const timeLeft = Math.max(0, order.settlesAt - now)
            const progress = Math.min(1, timeLeft / 10000) // 10s window

            // Check if settled
            const settled = pendingOrders.get(order.orderId)
            const isWin = settled?.isCorrect

            return (
              <motion.div
                key={order.orderId}
                initial={{ y: 100, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 50, opacity: 0, scale: 0.9 }}
                transition={{ delay: index * 0.1 }}
                className={cn(
                  'glass-panel-vibrant rounded-lg p-3 mb-2',
                  settled
                    ? isWin
                      ? 'border-green-500/50'
                      : 'border-red-500/50'
                    : 'border-tron-cyan/30'
                )}
              >
                <div className="flex items-center justify-between">
                  {/* Entry Point & Direction */}
                  <div className="flex items-center gap-3">
                    <div className="flex flex-col">
                      <span className="text-xs text-tron-white-dim">Entry</span>
                      <span className="text-sm font-mono font-bold text-tron-cyan">
                        ${formatPrice(order.priceAtOrder)}
                      </span>
                    </div>

                    {/* Direction Arrow */}
                    <motion.div
                      className={cn(
                        'w-8 h-8 rounded-full flex items-center justify-center',
                        isCall ? 'bg-green-500/20' : 'bg-red-500/20'
                      )}
                      animate={!settled ? { y: [0, -3, 0, 3, 0] } : {}}
                      transition={!settled ? { duration: 1.5, repeat: Infinity } : {}}
                    >
                      {isCall ? (
                        <span className="text-green-400 text-lg">▲</span>
                      ) : (
                        <span className="text-red-400 text-lg">▼</span>
                      )}
                    </motion.div>

                    {/* Countdown / Result */}
                    {!settled ? (
                      <div className="flex flex-col">
                        <span className="text-xs text-tron-white-dim">Expires</span>
                        <span className="text-sm font-mono">{(timeLeft / 1000).toFixed(1)}s</span>
                      </div>
                    ) : (
                      <div
                        className={cn(
                          'flex items-center gap-1 px-2 py-1 rounded',
                          isWin ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                        )}
                      >
                        {isWin ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                        <span className="text-sm font-bold">{isWin ? '+$1' : '-$1'}</span>
                      </div>
                    )}
                  </div>

                  {/* Progress Bar */}
                  {!settled && (
                    <div className="flex-1 mx-4">
                      <div className="h-2 bg-black/50 rounded-full overflow-hidden">
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
                  )}

                  {/* Coin Type Badge */}
                  <div
                    className={cn(
                      'px-2 py-1 rounded text-xs font-bold font-mono',
                      order.coinType === 'call' && 'bg-green-500/20 text-green-400',
                      order.coinType === 'put' && 'bg-red-500/20 text-red-400',
                      order.coinType === 'whale' && 'bg-purple-500/20 text-purple-400'
                    )}
                  >
                    {order.coinType.toUpperCase()}
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
