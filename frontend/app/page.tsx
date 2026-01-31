'use client';

import { useTradingStore } from '@/game/stores/trading-store';
import { MatchmakingScreen } from '@/components/MatchmakingScreen';
import { GameHUD } from '@/components/GameHUD';
import { SettlementFeed } from '@/components/SettlementFeed';
import GameCanvas from '@/components/GameCanvas';
import { useEffect } from 'react';

export default function Home() {
  const { isPlaying, connect, resetGame } = useTradingStore();

  useEffect(() => {
    // Connect to socket on mount
    connect();

    // Cleanup on unmount
    return () => {
      resetGame();
    };
  }, [connect, resetGame]);

  if (!isPlaying) {
    return <MatchmakingScreen />;
  }

  return (
    <div className="min-h-screen bg-tron-black relative overflow-hidden">
      <GameHUD />
      <GameCanvas scene="TradingScene" />
      <SettlementFeed />
    </div>
  );
}
