'use client'

import { useTradingStore } from '@/game/stores/trading-store'
import { MatchmakingScreen } from '@/components/MatchmakingScreen'
import { GameHUD } from '@/components/GameHUD'
import { PositionIndicator } from '@/components/PositionIndicator'
import { GameCanvasBackground } from '@/components/GameCanvasBackground'
import { ToastNotifications } from '@/components/ToastNotifications'
import { GameOverModal } from '@/components/GameOverModal'
import GameCanvas from '@/components/GameCanvas'
import { useEffect } from 'react'

export default function Home() {
  const { isPlaying, connect, resetGame, disconnectPriceFeed, toasts, removeToast } =
    useTradingStore()

  useEffect(() => {
    // Connect to socket on mount
    connect()

    // Cleanup on unmount
    return () => {
      resetGame()
      disconnectPriceFeed()
    }
  }, [connect, resetGame, disconnectPriceFeed])

  return (
    <div className="h-dvh w-screen bg-tron-black relative overflow-hidden">
      {/* ToastNotifications - ALWAYS visible, regardless of game state */}
      <ToastNotifications toasts={toasts} onRemove={removeToast} />

      {/* Game Over Modal - shows when game ends */}
      <GameOverModal />

      {!isPlaying ? (
        <MatchmakingScreen />
      ) : (
        <>
          {/* Background */}
          <GameCanvasBackground />

          {/* Top UI Layer */}
          <GameHUD />

          {/* Game Canvas - Phaser Scene */}
          <GameCanvas scene="TradingScene" />

          {/* Bottom UI Layer */}
          <PositionIndicator />
        </>
      )}
    </div>
  )
}
