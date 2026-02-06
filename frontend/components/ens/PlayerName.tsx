'use client'

import { motion } from 'framer-motion'
import { formatENSName } from '@/lib/ens'

interface PlayerNameProps {
  username?: string | null
  address?: string
  showFull?: boolean
  className?: string
  enableGlow?: boolean
}

/**
 * Component to display a player's name with TRON holographic effect.
 * Shows ENS name if available, otherwise truncated address.
 */
export function PlayerName({
  username,
  address,
  showFull = false,
  className = '',
  enableGlow = true,
}: PlayerNameProps) {
  if (username) {
    const displayName = showFull ? formatENSName(username) : username

    return enableGlow ? (
      <motion.span
        className={`font-[family-name:var(--font-orbitron)] inline-block ${className}`}
        animate={{
          textShadow: [
            '0 0 10px rgba(0, 243, 255, 0.3)',
            '0 0 20px rgba(0, 243, 255, 0.6)',
            '0 0 10px rgba(0, 243, 255, 0.3)',
          ],
        }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      >
        {displayName}
        {!showFull && (
          <motion.span
            className="text-cyan-400"
            animate={{
              textShadow: [
                '0 0 15px rgba(0, 243, 255, 0.5)',
                '0 0 25px rgba(0, 243, 255, 0.8)',
                '0 0 15px rgba(0, 243, 255, 0.5)',
              ],
            }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          >
            .grid.eth
          </motion.span>
        )}
      </motion.span>
    ) : (
      <span className={`font-[family-name:var(--font-orbitron)] ${className}`}>
        {displayName}
        {!showFull && <span className="text-cyan-400">.grid.eth</span>}
      </span>
    )
  }

  if (address) {
    const truncated = `${address.slice(0, 6)}...${address.slice(-4)}`
    return (
      <span className={`font-mono ${className}`} title={address}>
        {truncated}
      </span>
    )
  }

  return <span className={`text-gray-500 ${className}`}>Unknown</span>
}
