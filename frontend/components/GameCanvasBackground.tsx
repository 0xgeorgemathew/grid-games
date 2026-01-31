'use client'

import { useState, useEffect, useRef } from 'react'

// Candle particle configuration
const CANDLE_COUNT = 25
const CANDLE_SPEED_MIN = 0.5
const CANDLE_SPEED_MAX = 2

interface CandleParticle {
  id: number
  x: number // percent
  width: number // px
  height: number // px
  y: number // percent (0-100)
  speed: number // px per frame
  isBull: boolean
}

function generateCandle(id: number, screenWidth: number): CandleParticle {
  return {
    id,
    x: Math.random() * 100, // percent
    width: 5 + Math.random() * 10, // 5-15px
    height: 20 + Math.random() * 50, // 20-70px
    y: -10 - Math.random() * 50, // start above screen
    speed: CANDLE_SPEED_MIN + Math.random() * (CANDLE_SPEED_MAX - CANDLE_SPEED_MIN),
    isBull: Math.random() > 0.5,
  }
}

interface CandleParticleProps {
  candle: CandleParticle
  onReset: (id: number, screenWidth: number) => void
}

function CandleParticle({ candle, onReset }: CandleParticleProps) {
  const [y, setY] = useState(candle.y)

  useEffect(() => {
    let animationFrameId: number
    let currentY = candle.y

    const animate = () => {
      // Always move downward (positive Y direction)
      currentY += candle.speed * 0.5 // Scaled for smoother animation
      setY(currentY)

      // Reset if off screen (y > 120%)
      if (currentY > 120) {
        onReset(candle.id, window.innerWidth)
        return
      }

      animationFrameId = requestAnimationFrame(animate)
    }

    animationFrameId = requestAnimationFrame(animate)

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId)
      }
    }
  }, [candle, onReset])

  const color = candle.isBull
    ? 'rgba(0, 243, 255, 0.08)' // cyan for bull
    : 'rgba(255, 107, 0, 0.08)' // orange for bear

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: `${candle.x}%`,
        top: `${y}%`,
        width: `${candle.width}px`,
        height: `${candle.height}px`,
        backgroundColor: color,
      }}
    />
  )
}

export function GameCanvasBackground() {
  const [candles, setCandles] = useState<CandleParticle[]>(() => {
    const screenWidth = window.innerWidth
    const initialCandles = Array.from({ length: CANDLE_COUNT }, (_, i) =>
      generateCandle(i, screenWidth)
    )
    // Distribute initial candles vertically
    return initialCandles.map((candle) => ({
      ...candle,
      y: Math.random() * 100,
    }))
  })

  const handleResetCandle = (id: number, screenWidth: number) => {
    setCandles((prev) =>
      prev.map((candle) =>
        candle.id === id
          ? {
              ...generateCandle(id, screenWidth),
              y: -10 - Math.random() * 30, // Start above screen
            }
          : candle
      )
    )
  }

  return (
    <div className="fixed inset-0 pointer-events-none z-0 bg-gradient-to-b from-tron-black via-[#0a0a0f] to-[#050508]">
      {/* Falling candlesticks */}
      {candles.map((candle) => (
        <CandleParticle key={candle.id} candle={candle} onReset={handleResetCandle} />
      ))}
    </div>
  )
}
