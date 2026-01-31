'use client';

import { useState } from 'react';
import { useTradingStore } from '@/game/stores/trading-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const GAME_RULES = [
  { color: 'text-cyan-400', text: '<strong className="text-cyan-100">Coins</strong> spawn randomly - slice to predict' },
  { color: 'text-green-400', text: '<strong className="text-green-400">CALL</strong> = Price goes UP' },
  { color: 'text-red-400', text: '<strong className="text-red-400">PUT</strong> = Price goes DOWN' },
  { color: 'text-yellow-400', text: '<strong className="text-yellow-400">GAS</strong> = Volatile (2x risk/reward)' },
  { color: 'text-purple-400', text: '<strong className="text-purple-400">WHALE</strong> = Large impact (20 HP)' },
  { color: 'text-cyan-400', text: 'Correct predictions deal damage • First to 0 HP loses' },
] as const;

const MAX_PLAYER_NAME_LENGTH = 20;

export function MatchmakingScreen() {
  const { isConnected, isMatching, findMatch } = useTradingStore();
  const [playerName, setPlayerName] = useState('');

  const canFindMatch = isConnected && playerName.trim() && !isMatching;
  const statusColor = isConnected ? 'bg-green-400' : 'bg-red-500';
  const statusText = isConnected ? 'Connected' : 'Connecting...';

  const handleFindMatch = () => {
    if (canFindMatch) {
      findMatch(playerName.trim());
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md border-cyan-500/30 bg-black/80 backdrop-blur">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-cyan-400">HFT BATTLE</CardTitle>
          <CardDescription className="text-cyan-200/70">
            High-frequency trading game • Predict and profit
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Connection Status */}
          <div className="flex items-center gap-2">
            <div className={cn('h-2 w-2 rounded-full', statusColor)} />
            <span className="text-sm text-cyan-100/70">{statusText}</span>
          </div>

          {/* Player Name Input */}
          <div className="space-y-2">
            <label htmlFor="playerName" className="text-sm font-medium text-cyan-100">
              Enter your trader name
            </label>
            <Input
              id="playerName"
              type="text"
              placeholder="e.g. Apex Trader"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              disabled={!isConnected || isMatching}
              onKeyDown={(e) => e.key === 'Enter' && handleFindMatch()}
              className="bg-black/50 border-cyan-500/30 text-cyan-100 placeholder:text-cyan-100/30 focus:border-cyan-400"
              maxLength={MAX_PLAYER_NAME_LENGTH}
            />
          </div>

          {/* Find Match Button */}
          <Button
            onClick={handleFindMatch}
            disabled={!canFindMatch}
            className="w-full bg-cyan-500 hover:bg-cyan-400 text-black font-semibold"
          >
            {isMatching ? 'Finding opponent...' : 'Find Match'}
          </Button>

          {/* Game Rules */}
          <div className="space-y-3 pt-4 border-t border-cyan-500/20">
            <h3 className="text-sm font-semibold text-cyan-300">How to Play</h3>
            <ul className="space-y-2 text-sm text-cyan-100/70">
              {GAME_RULES.map((rule, index) => (
                <li key={index} className="flex items-start gap-2">
                  <span className={cn(rule.color, 'mt-0.5')}>•</span>
                  <span dangerouslySetInnerHTML={{ __html: rule.text }} />
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
