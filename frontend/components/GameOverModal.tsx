'use client'

import React from 'react'
import { motion } from 'framer-motion'
import { useTradingStore } from '@/game/stores/trading-store'
import { cn } from '@/lib/utils'
import { PlayerName } from '@/components/ens/PlayerName'

const GLOW_ANIMATION = {
  textShadow: [
    '0 0 20px rgba(0,217,255,0.4)',
    '0 0 40px rgba(0,217,255,0.8)',
    '0 0 20px rgba(0,217,255,0.4)',
  ] as string[],
  transition: { duration: 2, repeat: Infinity, ease: 'easeInOut' },
} as const

export const GameOverModal = React.memo(function GameOverModal() {
  const { isGameOver, gameOverData, localPlayerId, playAgain, players } = useTradingStore()
  const [showModal, setShowModal] = React.useState(false)

  // Delay showing modal to allow RoundEndFlash to finish
  React.useEffect(() => {
    if (isGameOver && gameOverData) {
      const timer = setTimeout(() => {
        setShowModal(true)
      }, 3500) // 3.5s delay (RoundEndFlash is 3s)
      return () => clearTimeout(timer)
    } else {
      setShowModal(false)
    }
  }, [isGameOver, gameOverData])

  if (!showModal || !gameOverData) return null

  const isWinner = gameOverData.winnerId === localPlayerId

  // Helper to get round result from local player's perspective
  const getRoundResult = (round: (typeof gameOverData.rounds)[0]) => {
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

  // Get final wallet balances
  const localPlayer = players.find((p) => p.id === localPlayerId)
  const opponent = players.find((p) => p.id !== localPlayerId)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[60] flex items-center justify-center"
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
          <div className="text-white/70 mt-2 text-sm tracking-[0.2em] flex items-center justify-center gap-2">
            <PlayerName
              username={
                !gameOverData.winnerName.startsWith('0x') ? gameOverData.winnerName : undefined
              }
              address={
                gameOverData.winnerName.startsWith('0x') ? gameOverData.winnerName : undefined
              }
              className="text-white"
            />
            <span>WINS THE GAME</span>
          </div>
        </motion.div>

        {/* ROUND SUMMARY - Vertical Stacked Text */}
        <div className="mb-6">
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="flex flex-col items-center gap-2 mb-4"
          >
            <h3 className="font-[family-name:var(--font-orbitron)] text-sm tracking-[0.2em] text-white/60">
              ROUND
            </h3>
            <motion.h3
              className="font-[family-name:var(--font-orbitron)] text-xl tracking-[0.2em] text-tron-cyan"
              animate={GLOW_ANIMATION.textShadow}
              transition={GLOW_ANIMATION.transition}
            >
              SUMMARY
            </motion.h3>
            {/* Animated data stream line */}
            <motion.div
              className="h-px bg-gradient-to-r from-transparent via-cyan-400 to-transparent w-32"
              animate={{ opacity: [0.3, 1, 0.3], scaleX: [0.8, 1, 0.8] }}
              transition={{ duration: 2, repeat: Infinity }}
            />
          </motion.div>

          {/* Round Cards - Local Player Perspective */}
          <div className="space-y-3">
            {gameOverData.rounds.map((round, index) => {
              const result = getRoundResult(round)
              const amountText =
                result.amount > 0
                  ? `+$${result.amount}`
                  : result.amount < 0
                    ? `-$${Math.abs(result.amount)}`
                    : ''

              return (
                <motion.div
                  key={round.roundNumber}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.4 + index * 0.1 }}
                  whileHover={{
                    scale: 1.02,
                    borderColor: result.isWin ? 'rgba(0, 243, 255, 0.6)' : 'rgba(255, 107, 0, 0.6)',
                  }}
                  className={cn(
                    'relative rounded-lg p-4 border backdrop-blur-sm overflow-hidden group',
                    result.isWin
                      ? 'border-cyan-400/30 bg-cyan-950/20'
                      : result.isLoss
                        ? 'border-orange-400/30 bg-orange-950/20'
                        : 'border-white/10 bg-white/5'
                  )}
                >
                  {/* Grid background overlay */}
                  <div className="absolute inset-0 opacity-10 tron-grid pointer-events-none" />

                  {/* Scanline effect on hover */}
                  <motion.div
                    className="absolute inset-0 pointer-events-none"
                    initial={{ opacity: 0 }}
                    whileHover={{ opacity: 1 }}
                  >
                    <motion.div
                      className="w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"
                      animate={{ y: ['0%', '100%'] }}
                      transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                    />
                  </motion.div>

                  <div className="relative flex justify-between items-center">
                    <div className="text-left">
                      <span
                        className={cn(
                          'font-[family-name:var(--font-orbitron)] text-xs tracking-widest block mb-1',
                          result.isWin
                            ? 'text-cyan-400/80'
                            : result.isLoss
                              ? 'text-orange-400/80'
                              : 'text-white/60'
                        )}
                      >
                        ROUND {round.roundNumber}
                      </span>
                      <span
                        className={cn(
                          'font-[family-name:var(--font-orbitron)] text-sm tracking-[0.2em]',
                          result.isWin
                            ? 'text-tron-cyan'
                            : result.isLoss
                              ? 'text-tron-orange'
                              : 'text-white/60'
                        )}
                      >
                        YOU {result.text}
                      </span>
                    </div>
                    {amountText && (
                      <motion.span
                        className={cn(
                          'font-[family-name:var(--font-orbitron)] text-xl font-bold tracking-[0.2em]',
                          result.isWin ? 'text-tron-cyan' : 'text-tron-orange'
                        )}
                        animate={
                          result.isWin
                            ? {
                                textShadow: [
                                  '0 0 15px rgba(0,243,255,0.5)',
                                  '0 0 30px rgba(0,243,255,0.8)',
                                  '0 0 15px rgba(0,243,255,0.5)',
                                ],
                              }
                            : {
                                textShadow: [
                                  '0 0 15px rgba(255,107,0,0.5)',
                                  '0 0 30px rgba(255,107,0,0.8)',
                                  '0 0 15px rgba(255,107,0,0.5)',
                                ],
                              }
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

        {/* Final Tally Section */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
          className="mb-6 bg-black/40 border border-white/10 rounded-xl p-4"
        >
          <h3 className="font-[family-name:var(--font-orbitron)] text-xs tracking-[0.2em] text-white/50 mb-3 uppercase">
            Final Tally
          </h3>
          <div className="grid grid-cols-2 gap-4">
            {/* Local Player Tally */}
            <motion.div
              whileHover={{ scale: 1.02 }}
              className={cn(
                'relative flex flex-col items-center p-3 rounded-lg border backdrop-blur-sm overflow-hidden group',
                isWinner
                  ? 'border-cyan-400/30 bg-cyan-950/20'
                  : 'border-orange-400/30 bg-orange-950/20'
              )}
            >
              {/* Grid background overlay */}
              <div className="absolute inset-0 opacity-10 tron-grid pointer-events-none" />
              {/* Scanline effect on hover */}
              <motion.div
                className="absolute inset-0 pointer-events-none"
                initial={{ opacity: 0 }}
                whileHover={{ opacity: 1 }}
              >
                <motion.div
                  className="w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"
                  animate={{ y: ['0%', '100%'] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                />
              </motion.div>
              <span
                className={cn(
                  'text-[10px] mb-1 tracking-[0.2em] relative z-10',
                  isWinner ? 'text-cyan-400/80' : 'text-orange-400/80'
                )}
              >
                YOU
              </span>
              <motion.span
                className={cn(
                  'font-[family-name:var(--font-orbitron)] text-xl font-bold tracking-[0.2em] relative z-10',
                  isWinner ? 'text-tron-cyan' : 'text-tron-orange'
                )}
                animate={{
                  textShadow: isWinner
                    ? [
                        '0 0 15px rgba(0,243,255,0.5)',
                        '0 0 30px rgba(0,243,255,0.8)',
                        '0 0 15px rgba(0,243,255,0.5)',
                      ]
                    : [
                        '0 0 15px rgba(255,107,0,0.5)',
                        '0 0 30px rgba(255,107,0,0.8)',
                        '0 0 15px rgba(255,107,0,0.5)',
                      ],
                }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              >
                ${localPlayer?.dollars ?? 0}
              </motion.span>
            </motion.div>
            {/* Opponent Tally */}
            <motion.div
              whileHover={{ scale: 1.02 }}
              className={cn(
                'relative flex flex-col items-center p-3 rounded-lg border backdrop-blur-sm overflow-hidden group',
                isWinner
                  ? 'border-orange-400/30 bg-orange-950/20'
                  : 'border-cyan-400/30 bg-cyan-950/20'
              )}
            >
              {/* Grid background overlay */}
              <div className="absolute inset-0 opacity-10 tron-grid pointer-events-none" />
              {/* Scanline effect on hover */}
              <motion.div
                className="absolute inset-0 pointer-events-none"
                initial={{ opacity: 0 }}
                whileHover={{ opacity: 1 }}
              >
                <motion.div
                  className="w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"
                  animate={{ y: ['0%', '100%'] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                />
              </motion.div>
              <span
                className={cn(
                  'text-[10px] mb-1 tracking-[0.2em] flex items-center gap-2 relative z-10',
                  isWinner ? 'text-orange-400/80' : 'text-cyan-400/80'
                )}
              >
                {opponent?.name ? (
                  <PlayerName
                    username={!opponent.name.startsWith('0x') ? opponent.name : undefined}
                    address={opponent.name.startsWith('0x') ? opponent.name : undefined}
                    className={isWinner ? 'text-orange-400/80' : 'text-cyan-400/80'}
                  />
                ) : (
                  'OPPONENT'
                )}
              </span>
              <motion.span
                className={cn(
                  'font-[family-name:var(--font-orbitron)] text-xl font-bold tracking-[0.2em] relative z-10',
                  isWinner ? 'text-tron-orange' : 'text-tron-cyan'
                )}
                animate={{
                  textShadow: isWinner
                    ? [
                        '0 0 15px rgba(255,107,0,0.5)',
                        '0 0 30px rgba(255,107,0,0.8)',
                        '0 0 15px rgba(255,107,0,0.5)',
                      ]
                    : [
                        '0 0 15px rgba(0,243,255,0.5)',
                        '0 0 30px rgba(0,243,255,0.8)',
                        '0 0 15px rgba(0,243,255,0.5)',
                      ],
                }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              >
                ${opponent?.dollars ?? 0}
              </motion.span>
            </motion.div>
          </div>
        </motion.div>

        {/* Final Score */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="mb-6 text-white/70 text-sm tracking-[0.2em] font-[family-name:var(--font-orbitron)]"
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
              className="font-[family-name:var(--font-orbitron)] text-sm tracking-[0.2em] font-medium block text-tron-cyan"
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
