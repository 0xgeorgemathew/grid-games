'use client'

import GameCanvas from '@/components/GameCanvas'

export default function GridTestPage() {
  return (
    <div className="min-h-screen bg-tron-black flex items-center justify-center p-8">
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-cyan-100">GridScene Test</h1>
        <p className="text-cyan-100/70">Test if this simple scene stutters like TradingScene</p>
        <GameCanvas scene="GridScene" />
      </div>
    </div>
  )
}
