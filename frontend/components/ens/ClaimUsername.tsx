'use client'

import { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { ActionButton } from '@/components/ui/ActionButton'
import { useCheckAvailability, useRegisterSubdomain } from '@/hooks/useENS'
import { validateUsername, formatENSName } from '@/lib/ens'

interface ClaimUsernameProps {
  onClaimed: (username: string) => void
  onSkip?: () => void
}

export function ClaimUsername({ onClaimed, onSkip }: ClaimUsernameProps) {
  const [username, setUsername] = useState('')
  const [showValidation, setShowValidation] = useState(false)
  
  const { available: isAvailable, isLoading: isChecking, error: availabilityError } = useCheckAvailability(username)
  const { register, isRegistering, error: registerError } = useRegisterSubdomain()
  
  const validation = validateUsername(username)
  
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')
    setUsername(value)
    setShowValidation(value.length > 0)
  }, [])
  
  const handleClaim = useCallback(async () => {
    if (!validation.isValid || !isAvailable) return
    
    const success = await register(username)
    if (success) {
      onClaimed(username)
    }
  }, [username, validation.isValid, isAvailable, register, onClaimed])
  
  const canClaim = validation.isValid && isAvailable && !isChecking && !isRegistering
  const error = registerError || (showValidation && (validation.error || availabilityError))
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.4 }}
      className="flex flex-col items-center gap-6 w-full max-w-sm"
    >
      {/* Header */}
      <div className="text-center">
        <motion.p
          className="text-cyan-400 text-xs tracking-[0.3em] font-[family-name:var(--font-orbitron)] mb-2"
          animate={{ opacity: [0.7, 1, 0.7] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          CLAIM YOUR IDENTITY
        </motion.p>
        <p className="text-gray-400 text-xs tracking-wider">
          Choose a unique username for the grid
        </p>
      </div>
      
      {/* Input Container */}
      <div className="w-full">
        <div className="relative">
          {/* Glow effect */}
          <motion.div
            className="absolute inset-0 rounded-lg"
            animate={{
              boxShadow: username && canClaim
                ? ['0 0 20px rgba(34,197,94,0.3)', '0 0 40px rgba(34,197,94,0.5)', '0 0 20px rgba(34,197,94,0.3)']
                : ['0 0 10px rgba(0,217,255,0.2)', '0 0 20px rgba(0,217,255,0.3)', '0 0 10px rgba(0,217,255,0.2)']
            }}
            transition={{ duration: 2, repeat: Infinity }}
          />
          
          {/* Input */}
          <input
            type="text"
            value={username}
            onChange={handleInputChange}
            placeholder="Enter username"
            maxLength={32}
            className={`
              relative w-full px-4 py-3 
              bg-black/60 backdrop-blur-md 
              border rounded-lg
              font-[family-name:var(--font-orbitron)] text-sm tracking-wider
              text-white placeholder-gray-500
              focus:outline-none transition-colors
              ${error ? 'border-red-400/50' : canClaim ? 'border-green-400/50' : 'border-cyan-400/30'}
            `}
            disabled={isRegistering}
          />
          
          {/* Status indicator */}
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            {isChecking && (
              <motion.div
                className="w-4 h-4 border-2 border-cyan-400/50 border-t-cyan-400 rounded-full"
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              />
            )}
            {!isChecking && isAvailable && validation.isValid && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="text-green-400 text-lg"
              >
                ✓
              </motion.span>
            )}
            {!isChecking && username && !isAvailable && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="text-red-400 text-lg"
              >
                ✗
              </motion.span>
            )}
          </div>
        </div>
        
        {/* Preview */}
        {username && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center text-gray-500 text-xs mt-2 tracking-wider"
          >
            {formatENSName(username)}
          </motion.p>
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
          onClick={handleClaim}
          disabled={!canClaim}
          isLoading={isRegistering}
          color={canClaim ? 'green' : 'cyan'}
        >
          {isRegistering ? 'CLAIMING...' : 'CLAIM USERNAME'}
        </ActionButton>
        
        {onSkip && (
          <button
            onClick={onSkip}
            className="text-xs text-gray-500 hover:text-gray-400 transition-colors tracking-wider"
          >
            SKIP FOR NOW
          </button>
        )}
      </div>
      
      {/* Transaction pending message */}
      {isRegistering && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-cyan-400/70 text-xs text-center tracking-wider animate-pulse"
        >
          Confirm transaction in your wallet...
        </motion.p>
      )}
    </motion.div>
  )
}
