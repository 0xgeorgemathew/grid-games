'use client'

import { motion } from 'framer-motion'

const BUTTON_TRANSITION = { duration: 2, repeat: Infinity, ease: 'easeInOut' as const }

const COLOR_CONFIG = {
  indigo: { border: 'border-indigo-400/30', text: 'text-indigo-300', glow: 'rgba(99,102,241,0.6)' },
  green: { border: 'border-green-400/30', text: 'text-green-300', glow: 'rgba(34,197,94,0.6)' },
  cyan: { border: 'border-cyan-400/30', text: 'text-cyan-300', glow: 'rgba(0,217,255,0.6)' },
  yellow: { border: 'border-yellow-400/30', text: 'text-yellow-300', glow: 'rgba(250,204,21,0.6)' },
  purple: { border: 'border-purple-400/30', text: 'text-purple-300', glow: 'rgba(168,85,247,0.6)' },
}

export type ActionButtonColor = keyof typeof COLOR_CONFIG

export type ActionButtonProps = {
  children: React.ReactNode
  onClick: () => void
  color: ActionButtonColor
  isLoading?: boolean
  disabled?: boolean
  size?: 'sm' | 'md'
}

export function ActionButton({
  children,
  onClick,
  color,
  isLoading = false,
  disabled = false,
  size = 'md',
}: ActionButtonProps) {
  const config = COLOR_CONFIG[color]
  const isInteractive = !isLoading && !disabled

  const paddingClass = size === 'sm' ? 'px-8 py-2' : 'px-12 py-3'
  const textSize = size === 'sm' ? 'text-[9px]' : 'text-[10px]'

  return (
    <motion.button
      onClick={onClick}
      disabled={disabled || isLoading}
      className="relative group"
      whileHover={isInteractive ? { scale: 1.02 } : undefined}
      whileTap={isInteractive ? { scale: 0.98 } : undefined}
    >
      <motion.div
        className="absolute inset-0 rounded-lg"
        animate={{
          boxShadow: isInteractive
            ? [`0 0 20px ${config.glow}40`, `0 0 60px ${config.glow}`, `0 0 20px ${config.glow}40`]
            : '0 0 10px rgba(255,255,255,0.1)',
        }}
        transition={BUTTON_TRANSITION}
      />
      <div
        className={`relative ${paddingClass} bg-black/40 backdrop-blur-md border ${config.border} rounded`}
      >
        <motion.span
          className={`font-[family-name:var(--font-orbitron)] ${textSize} tracking-[0.3em] font-medium block ${config.text}`}
          animate={
            isInteractive
              ? {
                  textShadow: [
                    `0 0 10px ${config.glow}80`,
                    `0 0 20px ${config.glow}`,
                    `0 0 10px ${config.glow}80`,
                  ],
                }
              : {}
          }
          transition={BUTTON_TRANSITION}
        >
          {children}
        </motion.span>
      </div>
    </motion.button>
  )
}
