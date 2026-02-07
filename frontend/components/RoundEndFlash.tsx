'use client'

import { useTradingStore } from '@/game/stores/trading-store'
import { motion, AnimatePresence } from 'framer-motion'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { PlayerName } from '@/components/ens/PlayerName'

const FLASH_DURATION = 5000 // 5 seconds for round end (reduced from 7s for better game pace)

type RoundData = {
  roundNumber: number
  winnerId: string | null
  isTie: boolean
  player1Gained: number
  player2Gained: number
}

/**
 * RoundEndFlash - Shows round end results with gained/lost amounts
 * High-contrast design with glass panels and Tron theme colors
 */
export function RoundEndFlash() {
  const { player1Wins, player2Wins, currentRound, localPlayerId, players } = useTradingStore()

  // Track round end state
  const [visibleRound, setVisibleRound] = useState<number | null>(null)
  const [isVisible, setIsVisible] = useState(false)
  const [roundData, setRoundData] = useState<RoundData | null>(null)

  // Listen for round_end events
  useEffect(() => {
    const handleRoundEnd = (event: Event) => {
      const customEvent = event as CustomEvent<RoundData>
      const data = customEvent.detail

      setRoundData(data)
      setVisibleRound(data.roundNumber)

      const showTimer = setTimeout(() => setIsVisible(true), 0)
      const hideTimer = setTimeout(() => {
        setIsVisible(false)
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

    window.addEventListener('round_end_flash', handleRoundEnd)

    return () => {
      window.removeEventListener('round_end_flash', handleRoundEnd)
    }
  }, [visibleRound])

  if (!isVisible || !roundData || !localPlayerId) return null

  const data = roundData
  const localPlayer = players.find((p) => p.id === localPlayerId)
  const opponent = players.find((p) => p.id !== localPlayerId)
  const playerIds = players.map((p) => p.id)

  const isLocalPlayer1 = localPlayerId === playerIds[0]
  const localGained = isLocalPlayer1 ? data.player1Gained : data.player2Gained
  const opponentGained = isLocalPlayer1 ? data.player2Gained : data.player1Gained
  const isWin = data.winnerId === localPlayerId
  const isLoss = data.winnerId && !data.isTie && !isWin

  // Score display
  const scoreDisplay = `${player1Wins}-${player2Wins}`

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          className="fixed inset-0 z-50 flex flex-col pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          {/* Semi-transparent backdrop for contrast */}
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          />

          {/* Ambient glow based on result */}
          <motion.div
            className={cn(
              'absolute inset-0 transition-colors duration-500',
              data.isTie ? 'bg-tron-cyan/5' : isWin ? 'bg-tron-cyan/10' : 'bg-tron-orange/10'
            )}
            animate={{
              opacity: [0, 0.3, 0.2, 0],
            }}
            transition={{
              duration: FLASH_DURATION / 1000,
              ease: 'easeOut',
            }}
          />

          {/* TOP ZONE: Round badge + gains + score */}
          <motion.div
            className="flex flex-col items-center gap-5 mt-32 sm:mt-40 relative z-10"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
          >
            {/* Round number badge */}
            <motion.div
              className="glass-panel-vibrant px-5 py-2 rounded-full border border-tron-cyan/30"
              initial={{ y: -10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.05 }}
            >
              <span className="text-xs font-[family-name:var(--font-orbitron)] text-tron-cyan tracking-[0.2em] font-bold">
                ROUND {data.roundNumber}
              </span>
            </motion.div>

            {/* Gained/lost amounts */}
            <motion.div
              className="flex items-center gap-10"
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.1 }}
            >
              {/* Local player result */}
              <div className="flex flex-col items-center">
                <span className="text-[10px] text-tron-white-dim uppercase tracking-[0.2em] mb-1.5 font-semibold">
                  YOU
                </span>
                <motion.span
                  className={cn(
                    'font-[family-name:var(--font-orbitron)] text-xl font-bold tracking-[0.2em]',
                    localGained > 0
                      ? 'text-tron-cyan'
                      : localGained < 0
                        ? 'text-tron-orange'
                        : 'text-tron-white-dim'
                  )}
                  animate={
                    localGained > 0
                      ? {
                          textShadow: [
                            '0 0 15px rgba(0,243,255,0.5)',
                            '0 0 30px rgba(0,243,255,0.8)',
                            '0 0 15px rgba(0,243,255,0.5)',
                          ],
                        }
                      : localGained < 0
                        ? {
                            textShadow: [
                              '0 0 15px rgba(255,107,0,0.5)',
                              '0 0 30px rgba(255,107,0,0.8)',
                              '0 0 15px rgba(255,107,0,0.5)',
                            ],
                          }
                        : undefined
                  }
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                >
                  {localGained > 0
                    ? `+$${localGained}`
                    : localGained < 0
                      ? `-$${Math.abs(localGained)}`
                      : '$0'}
                </motion.span>
              </div>

              {/* Divider */}
              <div className="h-14 w-px bg-gradient-to-b from-transparent via-tron-white/30 to-transparent" />

              {/* Opponent result */}
              <div className="flex flex-col items-center">
                <span className="text-[10px] text-tron-white-dim uppercase tracking-[0.2em] mb-1.5 font-semibold">
                  {opponent?.name ? (
                    <PlayerName
                      username={!opponent.name.startsWith('0x') ? opponent.name : undefined}
                      address={opponent.name.startsWith('0x') ? opponent.name : undefined}
                      className="text-tron-white-dim"
                    />
                  ) : (
                    'OPPONENT'
                  )}
                </span>
                <motion.span
                  className={cn(
                    'font-[family-name:var(--font-orbitron)] text-xl font-bold tracking-[0.2em]',
                    opponentGained > 0
                      ? 'text-tron-cyan'
                      : opponentGained < 0
                        ? 'text-tron-orange'
                        : 'text-tron-white-dim'
                  )}
                  animate={
                    opponentGained > 0
                      ? {
                          textShadow: [
                            '0 0 15px rgba(0,243,255,0.5)',
                            '0 0 30px rgba(0,243,255,0.8)',
                            '0 0 15px rgba(0,243,255,0.5)',
                          ],
                        }
                      : opponentGained < 0
                        ? {
                            textShadow: [
                              '0 0 15px rgba(255,107,0,0.5)',
                              '0 0 30px rgba(255,107,0,0.8)',
                              '0 0 15px rgba(255,107,0,0.5)',
                            ],
                          }
                        : undefined
                  }
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                >
                  {opponentGained > 0
                    ? `+$${opponentGained}`
                    : opponentGained < 0
                      ? `-$${Math.abs(opponentGained)}`
                      : '$0'}
                </motion.span>
              </div>
            </motion.div>

            {/* Score panel */}
            <motion.div
              className="glass-panel-vibrant flex items-center gap-3 px-5 py-2.5 rounded-lg border border-tron-white/10"
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.15 }}
            >
              <span className="text-xs text-tron-white-dim uppercase tracking-[0.15em] font-semibold">
                Best of Three
              </span>
              <div className="h-4 w-px bg-tron-white/20" />
              <span className="text-xl font-[family-name:var(--font-orbitron)] text-tron-white font-bold tracking-wider">
                {scoreDisplay}
              </span>
            </motion.div>
          </motion.div>

          {/* CENTER ZONE: Result card with glass panel */}
          <motion.div className="absolute inset-0 flex items-center justify-center p-6">
            <motion.div
              className={cn(
                'glass-panel-vibrant rounded-2xl px-10 py-8 border-2 relative overflow-hidden',
                data.isTie
                  ? 'border-tron-white/30'
                  : isWin
                    ? 'border-tron-cyan/50'
                    : 'border-tron-orange/50'
              )}
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{
                delay: 0.2,
                type: 'spring',
                stiffness: 200,
                damping: 15,
              }}
            >
              {/* Animated corner accents */}
              {!data.isTie && (
                <>
                  <motion.div
                    className={cn(
                      'absolute top-0 left-0 w-16 h-16 border-l-2 border-t-2',
                      isWin ? 'border-tron-cyan' : 'border-tron-orange'
                    )}
                    animate={{
                      opacity: [0.4, 1, 0.4],
                      scale: [1, 1.1, 1],
                    }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                      ease: 'easeInOut',
                    }}
                  />
                  <motion.div
                    className={cn(
                      'absolute bottom-0 right-0 w-16 h-16 border-r-2 border-b-2',
                      isWin ? 'border-tron-cyan' : 'border-tron-orange'
                    )}
                    animate={{
                      opacity: [0.4, 1, 0.4],
                      scale: [1, 1.1, 1],
                    }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                      ease: 'easeInOut',
                      delay: 1,
                    }}
                  />
                </>
              )}

              {/* Result text */}
              <motion.h2
                className={cn(
                  'font-[family-name:var(--font-orbitron)] text-4xl sm:text-5xl font-black tracking-[0.15em] text-center leading-tight',
                  data.isTie ? 'text-tron-white' : isWin ? 'text-tron-cyan' : 'text-tron-orange'
                )}
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.35, duration: 0.4 }}
                style={
                  data.isTie
                    ? {
                        textShadow:
                          '0 0 20px rgba(255, 255, 255, 0.4), 0 0 40px rgba(255, 255, 255, 0.2)',
                      }
                    : isWin
                      ? {
                          textShadow:
                            '0 0 20px rgba(0, 217, 255, 0.4), 0 0 40px rgba(0, 217, 255, 0.2)',
                        }
                      : {
                          textShadow:
                            '0 0 20px rgba(255, 107, 0, 0.4), 0 0 40px rgba(255, 107, 0, 0.2)',
                        }
                }
              >
                {data.isTie ? 'ROUND TIED' : isWin ? 'YOU WON' : 'OPPONENT WON'}
              </motion.h2>

              {/* Subtext for clarity */}
              <motion.p
                className="text-sm sm:text-base text-tron-white-dim uppercase tracking-[0.2em] text-center mt-3 font-semibold"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.45 }}
              >
                {data.isTie ? 'No Change' : isWin ? 'Round Complete' : 'Round Lost'}
              </motion.p>
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
