'use client'

import React from 'react'
import { motion } from 'framer-motion'
import { useTradingStore } from '@/game/stores/trading-store'
import { cn } from '@/lib/utils'

export const GameOverModal = React.memo(function GameOverModal() {
  const { isGameOver, gameOverData, localPlayerId, players, playAgain } = useTradingStore()

  if (!isGameOver || !gameOverData) return null

  const isWinner = gameOverData.winnerId === localPlayerId
  const p1 = players.find((p) => p.id === players[0]?.id)
  const p2 = players.find((p) => p.id === players[1]?.id)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-40 flex items-center justify-center"
    >
      <motion.div
        initial={{ scale: 0.8, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 24 }}
        className="glass-panel-vibrant rounded-2xl p-8 max-w-lg mx-4 text-center max-h-[90vh] overflow-y-auto"
      >
        {/* Victory/Defeat Header */}
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.2, type: 'spring', stiffness: 400 }}
          className="text-6xl mb-4"
        >
          {isWinner ? '🎉' : '😢'}
        </motion.div>

        <h2
          className={cn(
            'text-3xl font-black mb-2',
            isWinner ? 'text-tron-cyan' : 'text-tron-orange'
          )}
        >
          {isWinner ? 'VICTORY!' : 'DEFEAT'}
        </h2>

        <p className="text-white/70 mb-6">{gameOverData.winnerName} wins the game!</p>

        {/* Round Summaries */}
        <div className="mb-6 text-left">
          <h3 className="text-lg font-bold text-white/90 mb-3 border-b border-white/20 pb-2">
            Round Summary
          </h3>
          <div className="space-y-2">
            {gameOverData.rounds.map((round) => {
              const p1Gain =
                round.player1Gained > 0
                  ? `+$${round.player1Gained}`
                  : `-$${Math.abs(round.player1Gained)}`
              const p2Gain =
                round.player2Gained > 0
                  ? `+$${round.player2Gained}`
                  : `-$${Math.abs(round.player2Gained)}`
              const roundWinner = round.isTie
                ? 'TIE'
                : round.winnerId === localPlayerId
                  ? 'You Won'
                  : `${p2?.name || 'Opponent'} Won`

              return (
                <div
                  key={round.roundNumber}
                  className="bg-black/40 rounded-lg p-3 flex justify-between items-center"
                >
                  <div className="text-sm">
                    <span className="text-white/60">Round {round.roundNumber}:</span>
                    <span
                      className={cn(
                        'ml-2 font-bold',
                        round.isTie
                          ? 'text-white'
                          : round.winnerId === localPlayerId
                            ? 'text-tron-cyan'
                            : 'text-tron-orange'
                      )}
                    >
                      {roundWinner}
                    </span>
                  </div>
                  <div className="text-xs text-white/60">
                    <span
                      className={cn(round.player1Gained >= 0 ? 'text-green-400' : 'text-red-400')}
                    >
                      {p1?.name || 'P1'}: {p1Gain}
                    </span>
                    <span className="mx-2">|</span>
                    <span
                      className={cn(round.player2Gained >= 0 ? 'text-green-400' : 'text-red-400')}
                    >
                      {p2?.name || 'P2'}: {p2Gain}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Final Score */}
        <div className="mb-6 text-white/70 text-sm">
          Final Score: {gameOverData.player1Wins} - {gameOverData.player2Wins}
        </div>

        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={playAgain}
          className={cn(
            'px-8 py-3 rounded-lg font-bold text-black',
            'bg-tron-cyan hover:bg-tron-cyan/80',
            'shadow-[0_0_20px_rgba(0,243,255,0.5)]'
          )}
        >
          PLAY AGAIN
        </motion.button>
      </motion.div>
    </motion.div>
  )
})
