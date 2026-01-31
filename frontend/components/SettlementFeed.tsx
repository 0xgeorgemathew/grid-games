'use client';

import { useTradingStore } from '@/game/stores/trading-store';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { SettlementEvent } from '@/game/types/trading';

const COIN_COLORS: Record<string, string> = {
  call: 'text-green-400 border-green-500/30',
  put: 'text-red-400 border-red-500/30',
  gas: 'text-yellow-400 border-yellow-500/30',
  whale: 'text-purple-400 border-purple-500/30',
};

const RECENT_SETTLEMENTS_COUNT = 3;

function getPriceDirection(change: number): string {
  return change >= 0 ? '↑' : '↓';
}

function getResultStyles(isCorrect: boolean) {
  return {
    container: isCorrect ? 'bg-green-500/10 border-green-500/20' : 'bg-red-500/10 border-red-500/20',
    icon: isCorrect ? 'text-green-400' : 'text-red-400',
    iconText: isCorrect ? '✓' : '✗',
  };
}

function getPriceChangeColor(change: number): string {
  return change >= 0 ? 'text-green-400' : 'text-red-400';
}

interface SettlementItemProps {
  settlement: SettlementEvent;
  isLocalPlayer: boolean;
}

function SettlementItem({ settlement, isLocalPlayer }: SettlementItemProps) {
  const priceChange = settlement.finalPrice - settlement.priceAtOrder;
  const resultStyles = getResultStyles(settlement.isCorrect);
  const playerNameColor = isLocalPlayer ? 'text-cyan-300 font-semibold' : 'text-cyan-100/70';
  const coinColor = COIN_COLORS[settlement.coinType] ?? COIN_COLORS.call;

  return (
    <div
      className={cn('flex items-center justify-between gap-2 p-2 rounded border', resultStyles.container)}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {/* Result indicator */}
        <span className={cn('text-lg', resultStyles.icon)}>{resultStyles.iconText}</span>

        {/* Player name */}
        <span className={cn('text-xs truncate', playerNameColor)}>{settlement.playerName}</span>
      </div>

      <div className="flex items-center gap-2">
        {/* Coin type badge */}
        <Badge variant="outline" className={cn('text-xs px-1.5 py-0', coinColor)}>
          {settlement.coinType.toUpperCase()}
        </Badge>

        {/* Price movement */}
        <span className={cn('text-xs font-mono', getPriceChangeColor(priceChange))}>
          {getPriceDirection(priceChange)} {Math.abs(priceChange).toFixed(2)}
        </span>
      </div>
    </div>
  );
}

export function SettlementFeed() {
  const { pendingOrders, localPlayerId } = useTradingStore();

  const recentSettlements = useMemo(() => {
    const settlements = Array.from(pendingOrders.values());
    return settlements.slice(-RECENT_SETTLEMENTS_COUNT).reverse();
  }, [pendingOrders]);

  if (recentSettlements.length === 0) {
    return null;
  }

  return (
    <div className="absolute bottom-4 right-4 z-10 w-72">
      <Card className="border-cyan-500/20 bg-black/80 backdrop-blur">
        <CardContent className="p-3">
          <h3 className="text-xs font-semibold text-cyan-100/70 uppercase tracking-wider mb-2">
            Recent Settlements
          </h3>
          <div className="space-y-2">
            {recentSettlements.map((settlement) => (
              <SettlementItem
                key={settlement.orderId}
                settlement={settlement}
                isLocalPlayer={settlement.playerId === localPlayerId}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
