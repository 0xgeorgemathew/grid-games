'use client'

import { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { ActionButton } from '@/components/ui/ActionButton'
import { useSetLeverage, useGetLeverage } from '@/hooks/useENS'
import { LEVERAGE_OPTIONS, type LeverageOption } from '@/lib/ens'

interface SetLeverageProps {
  username: string
  onComplete: (leverage: LeverageOption) => void
  onSkip?: () => void
}

const LEVERAGE_COLORS: Record<LeverageOption, string> = {
  '1x': 'rgba(34, 197, 94, 0.8)', // Green - safe
  '2x': 'rgba(74, 222, 128, 0.8)', // Light green
  '5x': 'rgba(250, 204, 21, 0.8)', // Yellow - moderate
  '10x': 'rgba(251, 146, 60, 0.8)', // Orange - risky
  '20x': 'rgba(239, 68, 68, 0.8)', // Red - high risk
}

export function SetLeverage({ username, onComplete, onSkip }: SetLeverageProps) {
  const [selectedLeverage, setSelectedLeverage] = useState<LeverageOption>('2x')
  const { leverage: currentLeverage, isLoading: isLoadingCurrent } = useGetLeverage(username)
  const { setLeverage, isSetting, error } = useSetLeverage()

  const handleSave = useCallback(async () => {
    const success = await setLeverage(username, selectedLeverage)
    if (success) {
      onComplete(selectedLeverage)
    }
  }, [username, selectedLeverage, setLeverage, onComplete])

  const handleSkip = useCallback(() => {
    // If skipping, use current leverage or default to 5x
    onComplete(currentLeverage || '2x')
  }, [currentLeverage, onComplete])

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.4 }}
      className="flex flex-col items-center gap-6 w-full max-w-sm px-8 py-6 rounded-xl bg-black/40 backdrop-blur-sm border border-white/5 shadow-[0_0_30px_rgba(0,0,0,0.5)]"
    >
      {/* Header */}
      <div className="text-center">
        <motion.p
          className="text-purple-400 text-xs tracking-[0.3em] font-[family-name:var(--font-orbitron)] mb-2"
          animate={{ opacity: [0.7, 1, 0.7] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          SET YOUR LEVERAGE
        </motion.p>
        <p className="text-gray-400 text-xs tracking-wider">
          Higher leverage = higher risk & reward
        </p>
      </div>

      {/* Leverage Options */}
      <div className="w-full">
        <div className="flex gap-2 justify-center">
          {LEVERAGE_OPTIONS.map((option) => {
            const isSelected = selectedLeverage === option
            const color = LEVERAGE_COLORS[option]

            return (
              <motion.button
                key={option}
                onClick={() => setSelectedLeverage(option)}
                disabled={isSetting}
                className={`
                  relative px-4 py-3 rounded-lg
                  font-[family-name:var(--font-orbitron)] text-sm font-medium
                  transition-all duration-200
                  ${
                    isSelected
                      ? 'bg-black/80 border-2 shadow-[0_0_15px_rgba(34,211,238,0.1)]'
                      : 'bg-cyan-950/20 border border-cyan-900/30 hover:border-cyan-400/50 hover:bg-cyan-900/30'
                  }
                `}
                style={{
                  borderColor: isSelected ? color : undefined,
                  color: isSelected ? color : 'rgba(156, 163, 175, 0.8)',
                  textShadow: isSelected ? `0 0 10px ${color}80` : undefined,
                }}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                {/* Glow effect for selected */}
                {isSelected && (
                  <motion.div
                    className="absolute inset-0 rounded-lg pointer-events-none"
                    animate={{
                      boxShadow: [
                        `0 0 10px ${color}40`,
                        `0 0 25px ${color}60`,
                        `0 0 10px ${color}40`,
                      ],
                    }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  />
                )}
                <span className="relative">{option}</span>
              </motion.button>
            )
          })}
        </div>

        {/* Risk indicator */}
        <motion.div
          className="mt-4 text-center"
          key={selectedLeverage}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <p
            className="text-xs tracking-wider font-medium px-4 py-2 rounded bg-black/40 border border-white/5"
            style={{
              color: LEVERAGE_COLORS[selectedLeverage],
              borderColor: `${LEVERAGE_COLORS[selectedLeverage]}30`,
              boxShadow: `0 0 10px ${LEVERAGE_COLORS[selectedLeverage]}10`,
            }}
          >
            {selectedLeverage === '1x' && 'SAFE MODE - No multiplier'}
            {selectedLeverage === '2x' && 'LOW RISK - 2x gains/losses'}
            {selectedLeverage === '5x' && 'MODERATE - 5x gains/losses'}
            {selectedLeverage === '10x' && 'HIGH RISK - 10x gains/losses'}
            {selectedLeverage === '20x' && 'MAXIMUM RISK - 20x gains/losses'}
          </p>
        </motion.div>

        {/* Current leverage (if exists) */}
        {!isLoadingCurrent && currentLeverage && (
          <p className="text-gray-500 text-xs text-center mt-3 tracking-wider">
            Current: {currentLeverage}
          </p>
        )}

        {/* Error message */}
        {error && (
          <motion.p
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-red-400 text-xs text-center mt-2 tracking-wider"
          >
            {error}
          </motion.p>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-col items-center gap-3">
        <ActionButton
          onClick={handleSave}
          disabled={isSetting}
          isLoading={isSetting}
          color="purple"
        >
          {isSetting ? 'SAVING...' : 'SAVE LEVERAGE'}
        </ActionButton>

        {onSkip && (
          <button
            onClick={handleSkip}
            className="text-xs text-gray-500 hover:text-gray-400 transition-colors tracking-wider"
          >
            SKIP (USE DEFAULT)
          </button>
        )}
      </div>

      {/* Transaction pending message */}
      {isSetting && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-purple-400/70 text-xs text-center tracking-wider animate-pulse"
        >
          Processing Transaction...
        </motion.p>
      )}
    </motion.div>
  )
}
