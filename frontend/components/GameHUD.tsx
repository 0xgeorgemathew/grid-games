'use client';

import { useTradingStore } from '@/game/stores/trading-store';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const TUG_OF_WAR_MIN = -100;
const TUG_OF_WAR_MAX = 100;
const PROGRESS_HEIGHT = 'h-3';
const PROGRESS_BG = 'bg-black/50';

type PlayerColor = 'green' | 'red';

interface PlayerHealthBarProps {
  name: string;
  health: number;
  color: PlayerColor;
}

function PlayerHealthBar({ name, health, color }: PlayerHealthBarProps) {
  const colorClasses = {
    green: {
      text: 'text-green-400',
      border: 'border-green-500/30',
      progress: 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]',
    },
    red: {
      text: 'text-red-400',
      border: 'border-red-500/30',
      progress: 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]',
    },
  } as const;

  const classes = colorClasses[color];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className={cn('font-semibold text-sm', classes.text)}>{name}</span>
        <Badge variant="outline" className={cn('text-xs', classes.border, classes.text)}>
          {health} HP
        </Badge>
      </div>
      <Progress
        value={health}
        className={cn(PROGRESS_HEIGHT, PROGRESS_BG)}
        indicatorClassName={classes.progress}
      />
    </div>
  );
}

function TugOfWarMeter({ value, isPlayer1 }: { value: number; isPlayer1: boolean }) {
  const clampedValue = Math.max(TUG_OF_WAR_MIN, Math.min(TUG_OF_WAR_MAX, value));
  const absoluteValue = Math.abs(clampedValue);

  const isPlayer1Advantage = clampedValue < 0;
  const isPlayer2Advantage = clampedValue > 0;

  const meterColor = isPlayer1Advantage ? 'bg-cyan-500' : 'bg-orange-500';
  const meterPosition = isPlayer1Advantage ? 'left-0 right-1/2' : 'left-1/2 right-0';

  const yourAdvantageColor = isPlayer1Advantage ? 'text-cyan-400' : 'text-cyan-100/30';
  const opponentAdvantageColor = isPlayer2Advantage ? 'text-orange-400' : 'text-cyan-100/30';

  const yourLabel = isPlayer1 ? 'Your Advantage' : 'Opponent Advantage';
  const opponentLabel = isPlayer1 ? 'Opponent Advantage' : 'Your Advantage';

  return (
    <div className="relative pt-2">
      <div className="flex items-center justify-center gap-2 mb-1">
        <span className="text-xs text-cyan-100/50 uppercase tracking-wider">Market Momentum</span>
      </div>
      <div className="relative h-2 bg-black/50 rounded-full overflow-hidden border border-cyan-500/20">
        {/* Center indicator */}
        <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-cyan-400 -translate-x-1/2 z-10" />
        {/* Fill based on tug of war */}
        <div
          className={cn(
            'absolute top-0 bottom-0 transition-all duration-500 shadow-[0_0_15px_rgba(0,243,255,0.4)]',
            meterPosition,
            meterColor
          )}
          style={{ width: `${absoluteValue}%` }}
        />
      </div>
      <div className="flex justify-between mt-1">
        <span className={cn('text-xs font-semibold', yourAdvantageColor)}>{yourLabel}</span>
        <span className={cn('text-xs font-semibold', opponentAdvantageColor)}>{opponentLabel}</span>
      </div>
    </div>
  );
}

export function GameHUD() {
  const { players, localPlayerId, isPlayer1, tugOfWar } = useTradingStore();

  const localPlayer = players.find((p) => p.id === localPlayerId);
  const opponent = players.find((p) => p.id !== localPlayerId);

  return (
    <div className="absolute top-0 left-0 right-0 z-10 p-4 pointer-events-none">
      <div className="max-w-4xl mx-auto space-y-4">
        {/* Player Health Bars */}
        <div className="grid grid-cols-2 gap-8">
          {localPlayer && <PlayerHealthBar name={localPlayer.name} health={localPlayer.health} color="green" />}
          {opponent && <PlayerHealthBar name={opponent.name} health={opponent.health} color="red" />}
        </div>

        {/* Tug of War Meter */}
        <TugOfWarMeter value={tugOfWar} isPlayer1={isPlayer1} />
      </div>
    </div>
  );
}
