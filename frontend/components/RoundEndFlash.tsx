'use client'

import { useTradingStore } from '@/game/stores/trading-store'
import { motion, AnimatePresence } from 'framer-motion'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

const FLASH_DURATION = 3000 // 3 seconds for round end (longer than 1.2s for orders)

type RoundData = {
  roundNumber: number
  winnerId: string | null
  isTie: boolean
  player1Gained: number
  player2Gained: number
}

/**
 * RoundEndFlash - Shows round end results with gained/lost amounts
 * Displays round number, winner, and dollar changes for both players
 */
export function RoundEndFlash() {
  const { player1Wins, player2Wins, currentRound, localPlayerId, players } = useTradingStore()

  // Track round end state - stores the round that just ended
  const [visibleRound, setVisibleRound] = useState<number | null>(null)
  const [isVisible, setIsVisible] = useState(false)
  const [roundData, setRoundData] = useState<RoundData | null>(null)

  // Listen for round_end events via custom event
  useEffect(() => {
    const handleRoundEnd = (event: Event) => {
      const customEvent = event as CustomEvent<RoundData>
      const data = customEvent.detail

      // Store the round data in state (not ref - this affects rendering)
      setRoundData(data)
      setVisibleRound(data.roundNumber)

      // Show flash
      const showTimer = setTimeout(() => setIsVisible(true), 0)
      const hideTimer = setTimeout(() => {
        setIsVisible(false)
        // Clear after hiding
        setTimeout(() => {
          if (visibleRound === data.roundNumber) {
            setVisibleRound(null)
            setRoundData(null)
          }
        }, 500)
      }, FLASH_DURATION)

      return () => {
        clearTimeout(showTimer)
        clearTimeout(hideTimer)
      }
    }

    // Add event listener for custom round_end event
    window.addEventListener('round_end_flash', handleRoundEnd)

    return () => {
      window.removeEventListener('round_end_flash', handleRoundEnd)
    }
  }, [visibleRound])

  // Emit the custom event in handleRoundEnd (we'll modify trading-store to do this)
  // For now, we'll also check currentRound changes as a fallback
  useEffect(() => {
    if (currentRound > 1 && visibleRound !== currentRound - 1) {
      // Round changed, likely ended - this is a fallback mechanism
      // The primary mechanism should be the custom event
    }
  }, [currentRound, visibleRound])

  if (!isVisible || !roundData || !localPlayerId) return null

  const data = roundData
  const localPlayer = players.find((p) => p.id === localPlayerId)
  const opponent = players.find((p) => p.id !== localPlayerId)
  const playerIds = players.map((p) => p.id)

  // Determine if local player is player 1 or player 2
  const isLocalPlayer1 = localPlayerId === playerIds[0]

  // Get gained amount for local player
  const localGained = isLocalPlayer1 ? data.player1Gained : data.player2Gained
  const opponentGained = isLocalPlayer1 ? data.player2Gained : data.player1Gained

  // Determine result
  let resultText = ''
  let resultColor = ''
  if (data.isTie) {
    resultText = 'ROUND TIED'
    resultColor = 'text-tron-white'
  } else if (data.winnerId === localPlayerId) {
    resultText = 'YOU WON THE ROUND'
    resultColor = 'text-green-400'
  } else {
    resultText = 'OPPONENT WON THE ROUND'
    resultColor = 'text-red-400'
  }

  // Score display
  const scoreDisplay = `${player1Wins}-${player2Wins}`

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          {/* Subtle background glow based on result */}
          <motion.div
            className={cn(
              'absolute inset-0',
              data.isTie ? 'bg-tron-white/5' : data.winnerId === localPlayerId ? 'bg-green-500/8' : 'bg-red-500/8'
            )}
            animate={{
              opacity: [0, 0.2, 0.15, 0],
            }}
            transition={{
              duration: FLASH_DURATION / 1000,
              ease: 'easeOut',
            }}
          />

          {/* Main result display */}
          <motion.div
            initial={{ scale: 0.8, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: -20 }}
            transition={{
              duration: 0.4,
              ease: 'easeOut',
            }}
            className="relative flex flex-col items-center gap-4"
          >
            {/* Round number badge */}
            <motion.div
              className="px-4 py-1.5 rounded-full bg-tron-cyan/20 border border-tron-cyan/40"
              initial={{ y: -10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.1 }}
            >
              <span className="text-sm font-bold text-tron-cyan tracking-wider">
                ROUND {data.roundNumber}
              </span>
            </motion.div>

            {/* Result text */}
            <motion.h2
              className={cn('text-4xl sm:text-5xl font-black tracking-tight', resultColor)}
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.15, type: 'spring', stiffness: 300 }}
              style={{
                textShadow: data.isTie
                  ? '0 0 30px rgba(255, 255, 255, 0.5)'
                  : data.winnerId === localPlayerId
                    ? '0 0 40px rgba(74, 222, 128, 0.8)'
                    : '0 0 40px rgba(248, 113, 113, 0.8)',
              }}
            >
              {resultText}
            </motion.h2>

            {/* Gained/lost amounts */}
            <motion.div
              className="flex items-center gap-8"
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2 }}
            >
              {/* Local player result */}
              <div className="flex flex-col items-center">
                <span className="text-[10px] text-tron-white-dim uppercase tracking-wider mb-1">
                  You
                </span>
                <span
                  className={cn(
                    'text-3xl font-black font-mono',
                    localGained > 0
                      ? 'text-green-400 drop-shadow-[0_0_10px_rgba(74,222,128,0.7)]'
                      : localGained < 0
                        ? 'text-red-400 drop-shadow-[0_0_10px_rgba(248,113,113,0.7)]'
                        : 'text-tron-white-dim'
                  )}
                >
                  {localGained > 0 ? `+$${localGained}` : localGained < 0 ? `-$${Math.abs(localGained)}` : '$0'}
                </span>
              </div>

              {/* Divider */}
              <div className="h-12 w-px bg-tron-white/20" />

              {/* Opponent result */}
              <div className="flex flex-col items-center">
                <span className="text-[10px] text-tron-white-dim uppercase tracking-wider mb-1">
                  {opponent?.name || 'Opponent'}
                </span>
                <span
                  className={cn(
                    'text-3xl font-black font-mono',
                    opponentGained > 0
                      ? 'text-green-400 drop-shadow-[0_0_10px_rgba(74,222,128,0.7)]'
                      : opponentGained < 0
                        ? 'text-red-400 drop-shadow-[0_0_10px_rgba(248,113,113,0.7)]'
                        : 'text-tron-white-dim'
                  )}
                >
                  {opponentGained > 0
                    ? `+$${opponentGained}`
                    : opponentGained < 0
                      ? `-$${Math.abs(opponentGained)}`
                      : '$0'}
                </span>
              </div>
            </motion.div>

            {/* Score */}
            <motion.div
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-black/40 border border-tron-white/10"
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.25 }}
            >
              <span className="text-sm text-tron-white-dim">Best of Three</span>
              <div className="h-4 w-px bg-tron-white/20" />
              <span className="text-lg font-bold text-tron-white">{scoreDisplay}</span>
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
