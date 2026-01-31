import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';
import type { EventEmitter } from 'events';
import type {
  Player,
  CoinSpawnEvent,
  SliceEvent,
  SettlementEvent,
  MatchFoundEvent,
  GameOverEvent,
  CoinType,
} from '../types/trading';

declare global {
  interface Window {
    phaserEvents?: EventEmitter;
  }
}

interface TradingState {
  // Connection
  socket: Socket | null;
  isConnected: boolean;
  isMatching: boolean;
  isPlaying: boolean;

  // Room/Players
  roomId: string | null;
  localPlayerId: string | null;
  isPlayer1: boolean; // Track position for tug-of-war calculation
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
      console.log('Connected to game server');
      set({ isConnected: true, localPlayerId: socket.id });
    });

    socket.on('disconnect', () => {
      set({ isConnected: false });
    });

    socket.on('waiting_for_match', () => {
      set({ isMatching: true });
    });

    socket.on('match_found', (data: MatchFoundEvent) => {
      console.log('Match found!', data);
      const isPlayer1 = data.players[0]?.id === socket.id;
      set({
        isMatching: false,
        isPlaying: true,
        roomId: data.roomId,
        players: data.players,
        isPlayer1,
        localPlayerId: socket.id,
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
    set({ socket: null, isConnected: false, isPlaying: false });
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
    const { isPlayer1 } = get();
    const impact = settlement.coinType === 'whale' ? 20 : 10;
    const direction = isPlayer1 ? -1 : 1;
    const delta = settlement.isCorrect ? direction * impact : -direction * impact;

    set((state) => ({
      pendingOrders: new Map(state.pendingOrders).set(settlement.orderId, settlement),
      tugOfWar: state.tugOfWar + delta,
    }));
  },

  handlePlayerHit: (data) => {
    const { isPlayer1 } = get();
    const tugOfWarDelta = isPlayer1 ? data.damage : -data.damage;

    set((state) => ({
      players: state.players.map((p) =>
        p.id === data.playerId ? { ...p, health: Math.max(0, p.health - data.damage) } : p
      ),
      tugOfWar: state.tugOfWar + tugOfWarDelta,
    }));
  },

  handleGameOver: (data) => {
    const { localPlayerId } = get();
    const isWinner = data.winnerId === localPlayerId;
    alert(isWinner ? '🎉 You WIN!' : `😢 ${data.winnerName} wins! Better luck next time.`);
    get().resetGame();
  },

  resetGame: () => ({
    roomId: null,
    players: [],
    tugOfWar: 0,
    pendingOrders: new Map(),
    isPlaying: false,
    isMatching: false,
  }),
}));
