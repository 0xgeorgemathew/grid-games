'use client'

import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ToastType = 'info' | 'success' | 'error' | 'warning'

export interface Toast {
  id: string
  message: string
  type: ToastType
  duration?: number
}

export interface ToastNotificationsProps {
  toasts: Toast[]
  onRemove: (id: string) => void
}

const toastStyles = {
  info: 'bg-tron-cyan/20 border-tron-cyan/50 text-tron-cyan',
  success: 'bg-green-500/20 border-green-500/50 text-green-400',
  error: 'bg-red-500/20 border-red-500/50 text-red-400',
  warning: 'bg-yellow-500/20 border-yellow-500/50 text-yellow-400',
}

export const ToastNotifications = React.memo(function ToastNotifications({
  toasts,
  onRemove,
}: ToastNotificationsProps) {
  return (
    <div className="fixed top-24 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: -20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 300, damping: 24 }}
            className={cn(
              'glass-panel-vibrant px-4 py-3 rounded-lg border shadow-lg',
              'flex items-center gap-3 min-w-[300px] max-w-md pointer-events-auto',
              toastStyles[toast.type]
            )}
          >
            <span className="flex-1 text-sm font-semibold">{toast.message}</span>
            <button
              onClick={() => onRemove(toast.id)}
              className="shrink-0 hover:bg-white/10 rounded p-1 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
})
