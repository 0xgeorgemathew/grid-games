'use client'

import React from 'react'
import { motion } from 'framer-motion'
import { useTradingStore } from '@/game/stores/trading-store'
import { cn } from '@/lib/utils'

const GLOW_ANIMATION = {
  textShadow: [
    '0 0 20px rgba(0,217,255,0.4)',
    '0 0 40px rgba(0,217,255,0.8)',
    '0 0 20px rgba(0,217,255,0.4)',
  ] as string[],
  transition: { duration: 2, repeat: Infinity, ease: 'easeInOut' },
} as const

export const GameOverModal = React.memo(function GameOverModal() {
  const { isGameOver, gameOverData, localPlayerId, playAgain } = useTradingStore()

  if (!isGameOver || !gameOverData) return null

  const isWinner = gameOverData.winnerId === localPlayerId

  // Helper to get round result from local player's perspective
  const getRoundResult = (round: typeof gameOverData.rounds[0]) => {
    if (round.isTie) return { text: 'TIE', amount: 0, isWin: false, isLoss: false }
    if (round.winnerId === localPlayerId) {
      return { text: 'WON', amount: round.playerLost || 0, isWin: true, isLoss: false }
    }
    // Local player lost - show negative of what winner gained
    return {
      text: 'LOST',
      amount: -(round.playerLost || 0),
      isWin: false,
      isLoss: true,
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 bg-black/90 backdrop-blur-sm z-40 flex items-center justify-center"
    >
      <motion.div
        initial={{ scale: 0.8, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 24 }}
        className="glass-panel-vibrant rounded-2xl p-8 max-w-lg mx-4 text-center max-h-[90vh] overflow-y-auto"
      >
        {/* Victory/Defeat Header - Orbitron with Glow */}
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.2, type: 'spring', stiffness: 400 }}
          className="mb-6"
        >
          <motion.h2
            className={cn(
              'font-[family-name:var(--font-orbitron)] text-4xl sm:text-5xl font-black tracking-[0.15em]',
              isWinner ? 'text-tron-cyan' : 'text-tron-orange'
            )}
            animate={isWinner ? GLOW_ANIMATION.textShadow : undefined}
            transition={GLOW_ANIMATION.transition}
          >
            {isWinner ? 'VICTORY' : 'DEFEAT'}
          </motion.h2>
          <p className="text-white/70 mt-2 text-sm tracking-widest">
            {gameOverData.winnerName} WINS THE GAME
          </p>
        </motion.div>

        {/* ROUND SUMMARY - Vertical Stacked Text */}
        <div className="mb-6">
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="flex flex-col items-center gap-1 mb-4"
          >
            <h3 className="font-[family-name:var(--font-orbitron)] text-sm tracking-[0.3em] text-white/60">
              ROUND
            </h3>
            <motion.h3
              className="font-[family-name:var(--font-orbitron)] text-lg tracking-[0.25em] text-cyan-400"
              animate={GLOW_ANIMATION.textShadow}
              transition={GLOW_ANIMATION.transition}
            >
              SUMMARY
            </motion.h3>
          </motion.div>

          {/* Round Cards - Local Player Perspective */}
          <div className="space-y-2">
            {gameOverData.rounds.map((round, index) => {
              const result = getRoundResult(round)
              const amountText =
                result.amount > 0 ? `+$${result.amount}` : result.amount < 0 ? `-$${Math.abs(result.amount)}` : ''

              return (
                <motion.div
                  key={round.roundNumber}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.4 + index * 0.1 }}
                  className={cn(
                    'relative rounded-lg p-4 border backdrop-blur-sm',
                    result.isWin
                      ? 'border-cyan-400/30 bg-cyan-950/20'
                      : result.isLoss
                        ? 'border-orange-400/30 bg-orange-950/20'
                        : 'border-white/10 bg-white/5'
                  )}
                >
                  <div className="flex justify-between items-center">
                    <div className="text-left">
                      <span className="text-white/40 text-xs tracking-widest block mb-1">
                        ROUND {round.roundNumber}
                      </span>
                      <span
                        className={cn(
                          'font-[family-name:var(--font-orbitron)] text-sm tracking-wider',
                          result.isWin
                            ? 'text-cyan-300'
                            : result.isLoss
                              ? 'text-orange-300'
                              : 'text-white/60'
                        )}
                      >
                        YOU {result.text}
                      </span>
                    </div>
                    {amountText && (
                      <motion.span
                        className={cn(
                          'font-[family-name:var(--font-orbitron)] text-lg font-bold tracking-wider',
                          result.isWin ? 'text-green-400' : 'text-red-400'
                        )}
                        animate={
                          result.isWin
                            ? {
                                textShadow: [
                                  '0 0 10px rgba(74,222,128,0.3)',
                                  '0 0 20px rgba(74,222,128,0.6)',
                                  '0 0 10px rgba(74,222,128,0.3)',
                                ],
                              }
                            : undefined
                        }
                        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                      >
                        {amountText}
                      </motion.span>
                    )}
                  </div>
                </motion.div>
              )
            })}
          </div>
        </div>

        {/* Final Score */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="mb-6 text-white/70 text-sm tracking-widest font-[family-name:var(--font-orbitron)]"
        >
          FINAL SCORE: {gameOverData.player1Wins} - {gameOverData.player2Wins}
        </motion.div>

        {/* PLAY AGAIN Button - Tron Style */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={playAgain}
          className="relative group"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.9 }}
        >
          <motion.div
            className="absolute inset-0 rounded-lg"
            animate={{
              boxShadow: [
                '0 0 20px rgba(0,217,255,0.3)',
                '0 0 60px rgba(0,217,255,0.6)',
                '0 0 20px rgba(0,217,255,0.3)',
              ],
            }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          />
          <div className="relative px-12 py-3 bg-black/40 backdrop-blur-md border border-cyan-400/30 rounded">
            <motion.span
              className="font-[family-name:var(--font-orbitron)] text-sm tracking-[0.3em] font-medium block text-cyan-300"
              animate={{
                textShadow: [
                  '0 0 10px rgba(0,217,255,0.5)',
                  '0 0 20px rgba(0,217,255,0.8)',
                  '0 0 10px rgba(0,217,255,0.5)',
                ],
              }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            >
              PLAY AGAIN
            </motion.span>
          </div>
          {/* Hover inner glow */}
          <motion.div
            className="absolute inset-0 rounded-lg"
            initial={{ opacity: 0 }}
            whileHover={{ opacity: 1 }}
            style={{
              background:
                'radial-gradient(ellipse at center, rgba(0,217,255,0.15) 0%, transparent 70%)',
            }}
          />
        </motion.button>
      </motion.div>
    </motion.div>
  )
})
