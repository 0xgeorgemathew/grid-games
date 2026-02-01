'use client'

import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTradingStore } from '@/game/stores/trading-store'
import { cn } from '@/lib/utils'
import type { CryptoSymbol } from '@/game/stores/trading-store'

const CRYPTO_SYMBOLS: Record<CryptoSymbol, string> = {
  btcusdt: 'BTC',
} as const

function formatPrice(price: number): string {
  if (price < 1) return price.toFixed(6)
  if (price < 100) return price.toFixed(4)
  return price.toFixed(2)
}

export function PriceTicker() {
  const { priceData, isPriceConnected, selectedCrypto, connectPriceFeed, isPlaying, priceError, manualReconnect } =
    useTradingStore()

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

  return (
    <motion.div
      className="absolute top-0 left-0 right-0 z-10 p-2 sm:p-3 pointer-events-none"
      initial={{ y: -50, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.3, type: 'spring', stiffness: 300, damping: 30 }}
    >
      <div className="max-w-4xl mx-auto">
        <div className="glass-panel-vibrant rounded-lg p-2 sm:p-3 flex flex-col sm:flex-row items-center justify-between gap-2 sm:gap-4">
          {/* Price Display */}
          <div className="flex items-center gap-3">
            <AnimatePresence mode="wait">
              {priceData && (
                <motion.div
                  key={`${priceData.price}-${priceData.symbol}`}
                  initial={{ scale: 1 }}
                  animate={{ scale: [1, 1.02, 1] }}
                  exit={{ scale: 1 }}
                  transition={{ duration: 0.3 }}
                  className="flex items-center gap-2 sm:gap-3"
                >
                  <span className="text-xs text-tron-white-dim uppercase tracking-wider">
                    {CRYPTO_SYMBOLS[selectedCrypto]}/USD:
                  </span>
                  <motion.span
                    className={cn('text-sm sm:text-base font-bold font-mono', priceColor)}
                    style={{
                      textShadow: priceGlow,
                    }}
                  >
                    ${formatPrice(priceData.price)}
                  </motion.span>
                  <motion.span
                    className={cn('text-xs sm:text-sm font-mono', priceColor)}
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
              <span className="text-sm text-tron-white-dim animate-pulse">Connecting...</span>
            )}
          </div>

          {/* Connection Status & Crypto Selector */}
          <div className="flex items-center gap-2 pointer-events-auto">
            {/* Connection Indicator */}
            <motion.div
              className={cn(
                'flex items-center gap-1.5 px-2 py-1 rounded text-xs font-mono',
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
                  'w-1.5 h-1.5 rounded-full',
                  isPriceConnected ? 'bg-tron-cyan' : priceError ? 'bg-red-400' : 'bg-tron-orange'
                )}
                animate={{
                  scale: isPriceConnected ? [1, 1.3, 1] : priceError ? 1 : [0.8, 1, 0.8],
                }}
                transition={{ duration: 1.5, repeat: isPriceConnected ? Infinity : 0 }}
              />
              {isPriceConnected ? 'LIVE' : priceError ? 'ERROR' : 'CONNECTING'}
            </motion.div>

            {/* Manual Reconnect Button */}
            {needsManualReconnect && (
              <motion.button
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                onClick={manualReconnect}
                className="px-2 py-1 rounded text-xs font-mono bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors"
              >
                Reconnect
              </motion.button>
            )}

            {/* Crypto Selector */}
            <div className="flex gap-1">
              {(Object.keys(CRYPTO_SYMBOLS) as CryptoSymbol[]).map((symbol) => (
                <button
                  key={symbol}
                  onClick={() => handleCryptoChange(symbol)}
                  className={cn(
                    'px-2 py-1 rounded text-xs font-mono transition-all',
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
          </div>
        </div>
      </div>
    </motion.div>
  )
}
