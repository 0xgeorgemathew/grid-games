import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';
import type {
  Player,
  CoinSpawnEvent,
  SliceEvent,
  SettlementEvent,
  MatchFoundEvent,
  GameOverEvent,
  CoinType,
} from '../types/trading';

// Event bridge interface for React ↔ Phaser communication
// Both Phaser.Events.EventEmitter and Node's EventEmitter implement this subset
export interface PhaserEventBridge {
  emit(event: string, ...args: unknown[]): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
  destroy?(): void;
}

declare global {
  interface Window {
    phaserEvents?: PhaserEventBridge;
  }
}

// Game constants
const STANDARD_DAMAGE = 10;
const WHALE_DAMAGE = 20;
const TUG_OF_WAR_MIN = -100;
const TUG_OF_WAR_MAX = 100;

interface TradingState {
  // Connection
  socket: Socket | null;
  isConnected: boolean;
  isMatching: boolean;
  isPlaying: boolean;

  // Room/Players
  roomId: string | null;
  localPlayerId: string | null;
  isPlayer1: boolean;
  players: Player[];

  // Game state
  tugOfWar: number;
  pendingOrders: Map<string, SettlementEvent>;

  // Actions
  connect: () => void;
  disconnect: () => void;
  findMatch: (playerName: string) => void;
  spawnCoin: (coin: CoinSpawnEvent) => void;
  sliceCoin: (coinId: string, coinType: CoinType, priceAtSlice: number) => void;
  handleSlice: (slice: SliceEvent) => void;
  handleSettlement: (settlement: SettlementEvent) => void;
  handleGameOver: (data: GameOverEvent) => void;
  handlePlayerHit: (data: { playerId: string; damage: number; reason: string }) => void;
  resetGame: () => void;
}

function getDamageForCoinType(coinType: CoinType): number {
  return coinType === 'whale' ? WHALE_DAMAGE : STANDARD_DAMAGE;
}

function calculateTugOfWarDelta(isPlayer1: boolean, isCorrect: boolean, damage: number): number {
  // Tug of war: correct = beneficial for this player, incorrect = harmful
  const delta = isCorrect ? -damage : damage;
  return isPlayer1 ? delta : -delta;
}

function applyDamageToPlayer(players: Player[], playerId: string, damage: number): Player[] {
  return players.map((p) =>
    p.id === playerId ? { ...p, health: Math.max(0, p.health - damage) } : p
  );
}

function getTargetPlayerId(settlement: SettlementEvent, players: Player[]): string | undefined {
  // Correct prediction damages opponent, incorrect damages self
  if (settlement.isCorrect) {
    return players.find((p) => p.id !== settlement.playerId)?.id;
  }
  return settlement.playerId;
}

export const useTradingStore = create<TradingState>((set, get) => ({
  socket: null,
  isConnected: false,
  isMatching: false,
  isPlaying: false,
  roomId: null,
  localPlayerId: null,
  isPlayer1: false,
  players: [],
  tugOfWar: 0,
  pendingOrders: new Map(),

  connect: () => {
    const socket = io({
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => {
      set({ isConnected: true, localPlayerId: socket.id });
    });

    socket.on('disconnect', () => {
      set({ isConnected: false });
    });

    socket.on('waiting_for_match', () => {
      set({ isMatching: true });
    });

    socket.on('match_found', (data: MatchFoundEvent) => {
      const isPlayer1 = data.players[0]?.id === socket.id;
      set({
        isMatching: false,
        isPlaying: true,
        roomId: data.roomId,
        players: data.players,
        isPlayer1,
      });
    });

    socket.on('coin_spawn', (coin: CoinSpawnEvent) => {
      get().spawnCoin(coin);
    });

    socket.on('coin_sliced', (slice: SliceEvent) => {
      get().handleSlice(slice);
    });

    socket.on('order_settled', (settlement: SettlementEvent) => {
      get().handleSettlement(settlement);
    });

    socket.on('game_over', (data: GameOverEvent) => {
      get().handleGameOver(data);
    });

    socket.on('player_hit', (data: { playerId: string; damage: number; reason: string }) => {
      get().handlePlayerHit(data);
    });

    socket.on('opponent_disconnected', () => {
      alert('Opponent disconnected. Returning to lobby...');
      get().resetGame();
    });

    set({ socket });
  },

  disconnect: () => {
    const { socket } = get();
    socket?.disconnect();
    get().resetGame();
    set({ socket: null, isConnected: false });
  },

  findMatch: (playerName: string) => {
    const { socket } = get();
    socket?.emit('find_match', { playerName });
    set({ isMatching: true });
  },

  spawnCoin: (coin) => {
    window.phaserEvents?.emit('coin_spawn', coin);
  },

  sliceCoin: (coinId, coinType, priceAtSlice) => {
    const { socket, localPlayerId } = get();
    if (!socket || !localPlayerId) return;

    socket.emit('slice_coin', {
      coinId,
      coinType,
      priceAtSlice,
    });
  },

  handleSlice: (slice) => {
    const { localPlayerId } = get();
    if (slice.playerId === localPlayerId) return;

    window.phaserEvents?.emit('opponent_slice', slice);
  },

  handleSettlement: (settlement) => {
    const { isPlayer1, players, pendingOrders } = get();
    const damage = getDamageForCoinType(settlement.coinType);

    const tugOfWarDelta = calculateTugOfWarDelta(isPlayer1, settlement.isCorrect, damage);
    const targetPlayerId = getTargetPlayerId(settlement, players);

    set({
      pendingOrders: new Map(pendingOrders).set(settlement.orderId, settlement),
      tugOfWar: Math.max(TUG_OF_WAR_MIN, Math.min(TUG_OF_WAR_MAX, get().tugOfWar + tugOfWarDelta)),
      players: targetPlayerId ? applyDamageToPlayer(players, targetPlayerId, damage) : players,
    });
  },

  handlePlayerHit: (data) => {
    const { isPlayer1, players, tugOfWar } = get();
    const tugOfWarDelta = calculateTugOfWarDelta(isPlayer1, false, data.damage);

    set({
      players: applyDamageToPlayer(players, data.playerId, data.damage),
      tugOfWar: Math.max(TUG_OF_WAR_MIN, Math.min(TUG_OF_WAR_MAX, tugOfWar + tugOfWarDelta)),
    });
  },

  handleGameOver: (data) => {
    const { localPlayerId } = get();
    const isWinner = data.winnerId === localPlayerId;
    alert(isWinner ? '🎉 You WIN!' : `😢 ${data.winnerName} wins! Better luck next time.`);
    get().resetGame();
  },

  resetGame: () => {
    set({
      roomId: null,
      players: [],
      tugOfWar: 0,
      pendingOrders: new Map(),
      isPlaying: false,
      isMatching: false,
    });
  },
}));
