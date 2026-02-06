'use client'

import { formatENSName } from '@/lib/ens'

interface PlayerNameProps {
  username?: string | null
  address?: string
  showFull?: boolean
  className?: string
}

/**
 * Component to display a player's name.
 * Shows ENS name if available, otherwise truncated address.
 */
export function PlayerName({
  username,
  address,
  showFull = false,
  className = '',
}: PlayerNameProps) {
  if (username) {
    const displayName = showFull ? formatENSName(username) : username
    return (
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
