# HFT Battle: Neon Trader - Implementation Plan

## Overview

**Real-time PvP multiplayer HFT trading game** using Next.js + Phaser + ShadCN. All game logic runs in Next.js (no separate backend). Two players compete by predicting price movements.

**Game Rules:**
- **Player 1** swipes a coin (makes prediction: Call=up, Put=down)
- After T+5 seconds, prediction settles based on Binance price
- **If correct**: Opponent takes damage
- **If incorrect**: You take damage
- Both players see the same falling coins in real-time
- **Tug of War** shows relative score position

**Tech Stack:**
- Next.js (App Router) - API routes + Socket.IO server
- Phaser - Game canvas with coins/physics
- ShadCN - UI components
- Socket.IO - Real-time multiplayer sync
- Zustand - State management
- Binance WebSocket - Live price feed

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Next.js App (Single Monolith)                                                │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │ App Router (Frontend Pages)                                         ││
│  │ - /game - Matchmaking & game page                                   ││
│  │ - Components (ShadCN)                                               ││
│  └─────────────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │ API Routes (Game Logic)                                             ││
│  │ - /api/socket - Socket.IO server                                   ││
│  │ - /api/binance - Binance WebSocket proxy                           ││
│  │ - Matchmaking logic                                                ││
│  │ - Room management                                                  ││
│  │ - Settlement logic                                                 ││
│  └─────────────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │ Phaser Game Layer                                                   ││
│  │ - Falling coins (synced via Socket.IO)                             ││
│  │ - Blade trail + collision                                          ││
│  │ - Particle effects                                                 ││
│  └─────────────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │ State & Data                                                        ││
│  │ - Zustand store                                                    ││
│  │ - Socket.IO client                                                 ││
│  │ - Binance price feed                                              ││
│  └─────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Next.js Socket.IO Server

### 1.1 Install Dependencies

```bash
cd frontend
npm install socket.io zustand
npm install --save-dev @types/socket.io
```

### 1.2 Create Socket.IO Server

**File**: `frontend/app/api/socket/route.ts`

```typescript
import { NextRequest } from 'next/server';
import { Server as SocketIOServer } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { Socket as NetSocket } from 'net';

interface SocketServer extends HTTPServer {
  io?: SocketIOServer;
}

interface SocketWithIO extends NetSocket {
  server: SocketServer;
}

// Global Socket.IO instance (preserved across hot reloads in dev)
const ioHandler = (req: NextRequest) => {
  if (!(req as any).socket.server.io) {
    console.log('Initializing Socket.IO server...');

    const httpServer: SocketServer = (req as any).socket.server;
    const io = new SocketIOServer(httpServer, {
      path: '/api/socket',
      addTrailingSlash: false,
      cors: {
        origin: ['http://localhost:3001'],
        methods: ['GET', 'POST'],
        credentials: true,
      },
    });

    (req as any).socket.server.io = io;

    // Setup game event handlers
    setupGameEvents(io);
  }

  return (req as any).socket.server.io;
};

function setupGameEvents(io: SocketIOServer) {
  // Game rooms
  const rooms = new Map<string, GameRoom>();
  const waitingPlayers = new Map<string, WaitingPlayer>();

  interface GameRoom {
    roomId: string;
    players: Map<string, PlayerState>;
    coins: Map<string, Coin>;
    pendingOrders: Map<string, PendingOrder>;
    tugOfWar: number;
    currentSymbol: string;
  }

  interface PlayerState {
    id: string;
    name: string;
    health: number;
    score: number;
  }

  interface WaitingPlayer {
    name: string;
    socket: any;
  }

  interface Coin {
    id: string;
    type: 'call' | 'put' | 'gas' | 'whale';
    x: number;
    y: number;
  }

  interface PendingOrder {
    id: string;
    playerId: string;
    playerName: string;
    coinType: 'call' | 'put' | 'whale';
    priceAtOrder: number;
    settlesAt: number;
  }

  io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    socket.on('find_match', ({ playerName }: { playerName: string }) => {
      // Check for waiting player
      for (const [waitingId, waiting] of waitingPlayers.entries()) {
        if (waitingId !== socket.id && waiting.socket.connected) {
          // Create room
          const roomId = `room-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          const room: GameRoom = {
            roomId,
            players: new Map([
              [socket.id, { id: socket.id, name: playerName, health: 100, score: 0 }],
              [waitingId, { id: waitingId, name: waiting.name, health: 100, score: 0 }],
            ]),
            coins: new Map(),
            pendingOrders: new Map(),
            tugOfWar: 0,
            currentSymbol: 'ethusdt',
          };

          rooms.set(roomId, room);

          // Join both to room
          socket.join(roomId);
          waiting.socket.join(roomId);

          // Notify both
          io.to(roomId).emit('match_found', {
            roomId,
            players: [
              { id: socket.id, name: playerName },
              { id: waitingId, name: waiting.name },
            ],
          });

          // Remove from waiting
          waitingPlayers.delete(waitingId);

          // Start coin spawning
          startGameLoop(io, roomId);
          return;
        }
      }

      // No match - add to waiting
      waitingPlayers.set(socket.id, { name: playerName, socket });
      socket.emit('waiting_for_match');
    });

    socket.on('slice_coin', (data: { coinId: string; coinType: string; priceAtSlice: number }) => {
      // Find player's room
      for (const [roomId, room] of rooms) {
        if (room.players.has(socket.id)) {
          handleSlice(io, roomId, socket.id, data, room);
          break;
        }
      }
    });

    socket.on('disconnect', () => {
      waitingPlayers.delete(socket.id);
      for (const [roomId, room] of rooms) {
        if (room.players.has(socket.id)) {
          io.to(roomId).emit('opponent_disconnected');
          rooms.delete(roomId);
        }
      }
    });
  });

  function handleSlice(
    io: SocketIOServer,
    roomId: string,
    playerId: string,
    data: { coinId: string; coinType: string; priceAtSlice: number },
    room: GameRoom
  ) {
    // Remove coin
    room.coins.delete(data.coinId);

    // Handle gas immediately (penalty to slicer)
    if (data.coinType === 'gas') {
      const player = room.players.get(playerId);
      if (player) {
        player.health -= 10;
        room.tugOfWar += playerId === Array.from(room.players.keys())[0] ? 10 : -10;
      }
      io.to(roomId).emit('player_hit', { playerId, damage: 10, reason: 'gas' });
      return;
    }

    // Create pending order
    const order: PendingOrder = {
      id: `order-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      playerId,
      playerName: room.players.get(playerId)?.name || 'Unknown',
      coinType: data.coinType as 'call' | 'put' | 'whale',
      priceAtOrder: data.priceAtSlice,
      settlesAt: Date.now() + 5000,
    };

    room.pendingOrders.set(order.id, order);

    // Broadcast slice to show opponent
    io.to(roomId).emit('coin_sliced', {
      playerId,
      playerName: room.players.get(playerId)?.name,
      coinType: data.coinType,
    });

    // Schedule settlement
    setTimeout(() => settleOrder(io, roomId, order.id, room), 5000);
  }

  function settleOrder(io: SocketIOServer, roomId: string, orderId: string, room: GameRoom) {
    const order = room.pendingOrders.get(orderId);
    if (!order) return;

    // Get current price (from Binance or mock)
    const currentPrice = 3400; // TODO: Get from price feed
    const priceChange = (currentPrice - order.priceAtOrder) / order.priceAtOrder;

    // Determine if correct
    let isCorrect = false;
    if (order.coinType === 'call') isCorrect = priceChange > 0;
    else if (order.coinType === 'put') isCorrect = priceChange < 0;
    else if (order.coinType === 'whale') isCorrect = Math.random() < 0.8;

    // Apply results
    const impact = order.coinType === 'whale' ? 20 : 10;
    const playerIds = Array.from(room.players.keys());
    const isPlayer1 = order.playerId === playerIds[0];

    if (isCorrect) {
      // Correct - opponent takes damage
      const opponentId = playerIds.find(id => id !== order.playerId)!;
      const opponent = room.players.get(opponentId);
      if (opponent) opponent.health -= impact;
      room.tugOfWar += isPlayer1 ? -impact : impact;
    } else {
      // Wrong - slicer takes damage
      const player = room.players.get(order.playerId);
      if (player) player.health -= impact;
      room.tugOfWar += isPlayer1 ? impact : -impact;
    }

    room.pendingOrders.delete(orderId);

    // Broadcast settlement
    io.to(roomId).emit('order_settled', {
      orderId,
      playerId: order.playerId,
      playerName: order.playerName,
      coinType: order.coinType,
      isCorrect,
      priceAtOrder: order.priceAtOrder,
      finalPrice: currentPrice,
    });

    // Check game over
    checkGameOver(io, roomId, room);
  }

  function checkGameOver(io: SocketIOServer, roomId: string, room: GameRoom) {
    for (const [playerId, player] of room.players) {
      if (player.health <= 0) {
        const winner = Array.from(room.players.values()).find(p => p.health > 0);
        io.to(roomId).emit('game_over', {
          winnerId: winner?.id,
          winnerName: winner?.name,
          roomId,
        });
        setTimeout(() => rooms.delete(roomId), 5000);
        return;
      }
    }
  }

  function startGameLoop(io: SocketIOServer, roomId: string) {
    const spawnInterval = setInterval(() => {
      const room = rooms.get(roomId);
      if (!room || !io.of('/api/socket').adapter.rooms.has(roomId)) {
        clearInterval(spawnInterval);
        return;
      }

      // Spawn random coin
      const types = ['call', 'call', 'put', 'put', 'gas', 'whale'];
      const type = types[Math.floor(Math.random() * types.length)] as any;
      const coinId = `coin-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const coin = {
        id: coinId,
        type,
        x: 100 + Math.random() * 400,
        y: -50,
      };

      room.coins.set(coinId, coin);

      io.to(roomId).emit('coin_spawn', coin);
    }, 1500);

    // End game after 3 minutes
    setTimeout(() => {
      const room = rooms.get(roomId);
      if (room) {
        const winner = Array.from(room.players.values()).reduce((a, b) => a.health > b.health ? a : b);
        io.to(roomId).emit('game_over', {
          winnerId: winner.id,
          winnerName: winner.name,
          reason: 'time_limit',
        });
        rooms.delete(roomId);
      }
      clearInterval(spawnInterval);
    }, 180000);
  }
}

export { ioHandler as GET, ioHandler as POST };
```

---

## Phase 2: Frontend Types & Store

### 2.1 Create Types

**File**: `frontend/game/types/trading.ts`

```typescript
export type CoinType = 'call' | 'put' | 'gas' | 'whale';

export interface Player {
  id: string;
  name: string;
  health: number;
  score: number;
}

export interface CoinSpawnEvent {
  coinId: string;
  coinType: CoinType;
  x: number;
  y: number;
}

export interface SliceEvent {
  playerId: string;
  playerName: string;
  coinType: CoinType;
}

export interface SettlementEvent {
  orderId: string;
  playerId: string;
  playerName: string;
  coinType: CoinType;
  isCorrect: boolean;
  priceAtOrder: number;
  finalPrice: number;
}
```

### 2.2 Create Zustand Store

**File**: `frontend/game/stores/trading-store.ts`

```typescript
import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';
import type {
  Player,
  CoinSpawnEvent,
  SliceEvent,
  SettlementEvent,
  CoinType,
} from '../types/trading';

interface TradingState {
  // Connection
  isConnected: boolean;
  isMatching: boolean;
  isPlaying: boolean;

  // Room/Players
  roomId: string | null;
  localPlayerId: string | null;
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
  handleGameOver: (data: any) => void;
  resetGame: () => void;
}

export const useTradingStore = create<TradingState>((set, get) => ({
  isConnected: false,
  isMatching: false,
  isPlaying: false,
  roomId: null,
  localPlayerId: null,
  players: [],
  tugOfWar: 0,
  pendingOrders: new Map(),

  connect: () => {
    const socket = io('http://localhost:3001/api/socket', {
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

    socket.on('match_found', (data: { roomId: string; players: Player[] }) => {
      console.log('Match found!', data);
      set({
        isMatching: false,
        isPlaying: true,
        roomId: data.roomId,
        players: data.players,
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

    socket.on('game_over', (data: any) => {
      get().handleGameOver(data);
    });

    socket.on('player_hit', (data: any) => {
      if (data.playerId === socket.id) {
        console.log('You took damage!', data);
      }
    });

    socket.on('opponent_disconnected', () => {
      alert('Opponent disconnected. Returning to lobby...');
      get().resetGame();
    });

    set({ socket });
  },

  disconnect: () => {
    const { socket } = get() as any;
    socket?.disconnect();
    set({ socket: null, isConnected: false, isPlaying: false });
  },

  findMatch: (playerName: string) => {
    const { socket } = get() as any;
    socket?.emit('find_match', { playerName });
    set({ isMatching: true });
  },

  spawnCoin: (coin) => {
    (window as any).phaserEvents?.emit('coin_spawn', coin);
  },

  sliceCoin: (coinId, coinType, priceAtSlice) => {
    const { socket, localPlayerId } = get() as any;
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

    (window as any).phaserEvents?.emit('opponent_slice', slice);
  },

  handleSettlement: (settlement) => {
    set((state) => {
      const newOrders = new Map(state.pendingOrders);
      newOrders.set(settlement.orderId, settlement);
      return { pendingOrders: newOrders };
    });

    const { localPlayerId, tugOfWar } = get();
    const impact = settlement.coinType === 'whale' ? 20 : 10;
    const players = (get() as any).players || [];
    const playerIds = players.map((p: Player) => p.id);
    const isPlayer1 = settlement.playerId === playerIds[0];

    if (settlement.playerId === localPlayerId) {
      set({ tugOfWar: tugOfWar + (settlement.isCorrect ? -impact : impact) });
    } else {
      set({ tugOfWar: tugOfWar + (settlement.isCorrect ? impact : -impact) });
    }
  },

  handleGameOver: (data) => {
    const { players, localPlayerId } = get();
    const winner = players.find((p: Player) => p.id === data.winnerId);

    if (winner?.id === localPlayerId) {
      alert(`🎉 You WIN!`);
    } else {
      alert(`😢 ${data.winnerName} wins! Better luck next time.`);
    }

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
```

---

## Phase 3: Phaser TradingScene

### 3.1 Create TradingScene

**File**: `frontend/game/scenes/TradingScene.ts`

```typescript
import { Scene, ArcadePhysics, Geom, GameObjects } from 'phaser';
import { useTradingStore } from '../stores/trading-store';
import type { CoinType } from '../types/trading';

export class TradingScene extends Scene {
  private coins: Map<string, Phaser.GameObjects.Container> = new Map();
  private bladePath: Geom.Point[] = [];
  private bladeGraphics: GameObjects.Graphics;
  private particles: Phaser.GameObjects.Container[] = [];
  private opponentSlices: GameObjects.Text[] = [];
  private eventEmitter: Phaser.Events.EventEmitter;

  private readonly COIN_CONFIG = {
    call: { color: 0x00ff00, symbol: '▲', radius: 28 },
    put: { color: 0xff0000, symbol: '▼', radius: 28 },
    gas: { color: 0xffff00, symbol: '⚡', radius: 28 },
    whale: { color: 0xffd700, symbol: '★', radius: 45 },
  };

  constructor() {
    super({ key: 'TradingScene' });
    this.eventEmitter = new Phaser.Events.EventEmitter();
  }

  create() {
    this.physics.world.setBounds(0, 0, this.cameras.main.width, this.cameras.main.height);
    this.bladeGraphics = this.add.graphics();

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      this.bladePath.push(new Geom.Point(pointer.x, pointer.y));
      if (this.bladePath.length > 10) this.bladePath.shift();
    });

    (window as any).phaserEvents = this.eventEmitter;

    this.eventEmitter.on('coin_spawn', this.handleCoinSpawn.bind(this));
    this.eventEmitter.on('opponent_slice', this.handleOpponentSlice.bind(this));
  }

  update(time: number, delta: number) {
    // Update coin physics
    this.coins.forEach((coin) => {
      const body = coin.getData('body') as ArcadePhysics.Arcade.Body;
      if (body) {
        body.velocity.y += 0.15;
        coin.rotation += coin.getData('rotationSpeed') || 0;
      }
      if (coin.y > this.cameras.main.height + 50) {
        this.removeCoin(coin.getData('id')!);
      }
    });

    this.drawBlade();
    this.checkCollisions();

    // Update particles
    this.particles.forEach((particle, index) => {
      particle.alpha -= 0.02;
      if (particle.alpha <= 0) {
        particle.destroy();
        this.particles.splice(index, 1);
      }
    });

    // Update opponent slice indicators
    this.opponentSlices.forEach((text, index) => {
      text.y -= 1;
      text.alpha -= 0.02;
      if (text.alpha <= 0) {
        text.destroy();
        this.opponentSlices.splice(index, 1);
      }
    });
  }

  private handleCoinSpawn(data: { coinId: string; coinType: CoinType; x: number; y: number }) {
    const config = this.COIN_CONFIG[data.coinType];

    const coin = this.add.container(data.x, data.y);
    coin.setData('id', data.coinId);
    coin.setData('type', data.coinType);
    coin.setData('rotationSpeed', (Math.random() - 0.5) * 0.05);

    const body = this.add.circle(0, 0, config.radius, config.color);
    body.setStrokeStyle(3, 0xffffff);

    const inner = this.add.circle(0, 0, config.radius * 0.85, config.color);
    inner.setStrokeStyle(2, config.color);
    inner.setAlpha(0.7);

    const symbol = this.add.text(0, 2, config.symbol, {
      fontSize: `${config.radius}px`,
      color: '#000000',
      fontStyle: 'bold',
    });
    symbol.setOrigin(0.5);

    coin.add([body, inner, symbol]);
    this.physics.add.existing(coin);

    const physicsBody = coin.body as ArcadePhysics.Arcade.Body;
    physicsBody.setVelocity((Math.random() - 0.5) * 2, Math.random() * 3 + 2);
    physicsBody.setGravity(0, data.coinType === 'whale' ? 0.1 : 0.15);

    this.coins.set(data.coinId, coin);
  }

  private handleOpponentSlice(data: { playerName: string; coinType: CoinType }) {
    const config = this.COIN_CONFIG[data.coinType];
    const colorHex = '#' + config.color.toString(16).padStart(6, '0');

    const x = Phaser.Math.Between(100, this.cameras.main.width - 100);
    const y = Phaser.Math.Between(100, this.cameras.main.height - 100);

    const text = this.add.text(x, y, `${data.playerName}: ${data.coinType}!`, {
      fontSize: '20px',
      fontStyle: 'bold',
      color: colorHex,
      stroke: '#000000',
      strokeThickness: 4,
    });
    text.setOrigin(0.5);

    this.opponentSlices.push(text);
    this.cameras.main.flash(100, 255, 255, 255, false);
  }

  private drawBlade() {
    this.bladeGraphics.clear();
    if (this.bladePath.length < 2) return;

    for (let i = 0; i < this.bladePath.length - 1; i++) {
      const p1 = this.bladePath[i];
      const p2 = this.bladePath[i + 1];
      const alpha = i / this.bladePath.length;

      this.bladeGraphics.lineStyle(4, 0x00ffff, alpha);
      this.bladeGraphics.lineBetween(p1.x, p1.y, p2.x, p2.y);
    }

    this.bladeGraphics.lineStyle(8, 0x00ffff, 0.3);
    for (let i = 0; i < this.bladePath.length - 1; i++) {
      const p1 = this.bladePath[i];
      const p2 = this.bladePath[i + 1];
      this.bladeGraphics.lineBetween(p1.x, p1.y, p2.x, p2.y);
    }
  }

  private checkCollisions() {
    if (this.bladePath.length < 2) return;

    const p1 = this.bladePath[this.bladePath.length - 2];
    const p2 = this.bladePath[this.bladePath.length - 1];
    const line = new Geom.Line(p1.x, p1.y, p2.x, p2.y);

    for (const [coinId, coin] of this.coins) {
      const config = this.COIN_CONFIG[coin.getData('type')];
      const circle = new Geom.Circle(coin.x, coin.y, config.radius);

      if (Geom.Intersects.LineToCircle(line, circle)) {
        this.sliceCoin(coinId, coin);
      }
    }
  }

  private sliceCoin(coinId: string, coin: Phaser.GameObjects.Container) {
    const type = coin.getData('type') as CoinType;
    const config = this.COIN_CONFIG[type];
    const store = useTradingStore.getState();

    this.createExplosion(coin.x, coin.y, config.color);

    if (type === 'gas') {
      this.cameras.main.flash(200, 255, 255, 0, false);
      store.sliceCoin(coinId, type, 0);
      this.removeCoin(coinId);
      return;
    }

    const currentPrice = 3400; // TODO: Get from price feed
    store.sliceCoin(coinId, type, currentPrice);

    if (type === 'whale') {
      this.cameras.main.shake(200, 0.015);
      this.cameras.main.flash(100, 255, 215, 0, false);
    }

    this.removeCoin(coinId);
  }

  private removeCoin(coinId: string) {
    const coin = this.coins.get(coinId);
    if (coin) {
      coin.destroy();
      this.coins.delete(coinId);
    }
  }

  private createExplosion(x: number, y: number, color: number) {
    const container = this.add.container(x, y);

    for (let i = 0; i < 12; i++) {
      const particle = this.add.circle(0, 0, 4, color);
      const angle = (Math.PI * 2 / 12) * i;
      const distance = 40 + Math.random() * 20;

      this.tweens.add({
        targets: particle,
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance,
        alpha: 0,
        scale: 0,
        duration: 300,
        ease: 'Power2',
        onComplete: () => particle.destroy(),
      });

      container.add(particle);
    }

    this.particles.push(container);
  }

  shutdown() {
    this.eventEmitter.destroy();
    this.coins.clear();
    this.opponentSlices.forEach(t => t.destroy());
  }
}
```

---

## Phase 4: ShadCN UI Components

### 4.1 Setup ShadCN

```bash
cd frontend
npx shadcn@latest init
npx shadcn@latest add button card progress badge input
```

### 4.2 MatchmakingScreen Component

**File**: `frontend/components/MatchmakingScreen.tsx`

```tsx
'use client';

import { useState } from 'react';
import { useTradingStore } from '@/game/stores/trading-store';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export function MatchmakingScreen() {
  const [playerName, setPlayerName] = useState('');
  const { isConnected, findMatch, isMatching } = useTradingStore();

  const handleStart = () => {
    if (!playerName.trim()) return;
    findMatch(playerName);
  };

  if (!isConnected) {
    return (
      <Card className="p-8 text-center">
        <p className="text-muted-foreground">Connecting...</p>
      </Card>
    );
  }

  if (isMatching) {
    return (
      <Card className="p-8 text-center">
        <div className="animate-pulse">
          <p className="text-lg font-bold">Finding opponent...</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-8 text-center space-y-6">
      <div>
        <h1 className="text-4xl font-bold bg-gradient-to-r from-green-500 via-yellow-500 to-red-500 bg-clip-text text-transparent">
          HFT Battle
        </h1>
        <p className="text-muted-foreground mt-2">Neon Trader PvP</p>
      </div>

      <div className="text-left space-y-2 text-sm text-muted-foreground">
        <p>🟢 GREEN (▲) — Predict price UP</p>
        <p>🔴 RED (▼) — Predict price DOWN</p>
        <p>🟡 YELLOW (⚡) — Gas penalty</p>
        <p>🟠 GOLD (★) — Whale bonus (80% win!)</p>
        <p className="font-bold">⚔️ Correct = Opponent damage | Wrong = Your damage</p>
      </div>

      <Input
        placeholder="Your name"
        value={playerName}
        onChange={(e) => setPlayerName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleStart()}
      />

      <Button onClick={handleStart} size="lg" className="w-full" disabled={!playerName.trim()}>
        Find Match
      </Button>
    </Card>
  );
}
```

### 4.3 GameHUD Component

**File**: `frontend/components/GameHUD.tsx`

```tsx
'use client';

import { useTradingStore } from '@/game/stores/trading-store';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/game/lib/utils';

export function GameHUD() {
  const { localPlayerId, players, tugOfWar } = useTradingStore();

  const localPlayer = players.find(p => p.id === localPlayerId);
  const opponent = players.find(p => p.id !== localPlayerId);

  const ourAdvantage = -tugOfWar;
  const tugPercent = 50 + ourAdvantage;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="text-center">
          <p className="text-sm font-bold">{localPlayer?.name || 'You'}</p>
          <div className="flex items-center gap-2">
            <div className="w-24 h-2 bg-gray-800 rounded overflow-hidden">
              <div
                className="h-full bg-green-500 transition-all"
                style={{ width: `${localPlayer?.health || 100}%` }}
              />
            </div>
            <span className="text-xs">{localPlayer?.health || 100}</span>
          </div>
        </div>

        <Badge variant="outline">VS</Badge>

        <div className="text-center">
          <p className="text-sm font-bold">{opponent?.name || 'Opponent'}</p>
          <div className="flex items-center gap-2">
            <span className="text-xs">{opponent?.health || 100}</span>
            <div className="w-24 h-2 bg-gray-800 rounded overflow-hidden">
              <div
                className="h-full bg-red-500 transition-all"
                style={{ width: `${opponent?.health || 100}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="relative">
        <div className="absolute inset-0 flex justify-between px-3 text-xs font-bold text-white/80 z-10">
          <span>You</span>
          <span>Opponent</span>
        </div>
        <Progress
          value={tugPercent}
          className="h-6"
          indicatorClassName={cn(
            'transition-all duration-300',
            tugPercent > 50 ? 'bg-green-500' : 'bg-red-500'
          )}
        />
      </div>
    </div>
  );
}
```

### 4.4 SettlementFeed Component

**File**: `frontend/components/SettlementFeed.tsx`

```tsx
'use client';

import { useTradingStore } from '@/game/stores/trading-store';
import type { SettlementEvent } from '../types/trading';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/game/lib/utils';

export function SettlementFeed() {
  const { pendingOrders, localPlayerId } = useTradingStore();

  const recent = Array.from(pendingOrders.values())
    .sort((a, b) => b.orderId.localeCompare(a.orderId))
    .slice(0, 3);

  if (recent.length === 0) return null;

  return (
    <div className="flex gap-2 overflow-x-auto pb-2">
      {recent.map((s) => {
        const isOurs = s.playerId === localPlayerId;
        const colorClass = s.isCorrect ? 'border-green-500 bg-green-500/10' : 'border-red-500 bg-red-500/10';

        return (
          <Card key={s.orderId} className={cn('min-w-48 p-2', colorClass)}>
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold truncate max-w-[100px]">{s.playerName}</span>
              <Badge variant={s.isCorrect ? 'default' : 'destructive'} className="text-xs">
                {s.isCorrect ? '✓' : '✗'}
              </Badge>
            </div>
            <div className="text-xs mt-1">
              {s.coinType}: {s.priceAtOrder.toFixed(2)} → {s.finalPrice.toFixed(2)}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
```

---

## Phase 5: Main Page

### 5.1 Update Main Page

**File**: `frontend/app/page.tsx`

```tsx
'use client';

import { useEffect } from 'react';
import { GameCanvas } from '@/components/GameCanvas';
import { MatchmakingScreen } from '@/components/MatchmakingScreen';
import { GameHUD } from '@/components/GameHUD';
import { SettlementFeed } from '@/components/SettlementFeed';
import { useTradingStore } from '@/game/stores/trading-store';
import { Button } from '@/components/ui/button';

export default function TradingGamePage() {
  const { isConnected, connect, disconnect, isPlaying } = useTradingStore();

  useEffect(() => {
    connect();
    return () => disconnect();
  }, []);

  if (!isPlaying) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <MatchmakingScreen />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="p-4 border-b bg-card">
        <GameHUD />
        <SettlementFeed />
      </div>

      <div className="flex-1 relative">
        <GameCanvas scene="TradingScene" />
      </div>

      <div className="p-4 border-t bg-card">
        <Button onClick={() => window.location.reload()} variant="outline">
          Forfeit Match
        </Button>
      </div>
    </div>
  );
}
```

### 5.2 Update GameCanvas

**File**: `frontend/components/GameCanvas.tsx`

```tsx
export function GameCanvas({ scene = 'GridScene' }: { scene?: string }) {
  // ... existing code, add scene prop support
  const SceneClass = scene === 'TradingScene' ? TradingScene : GridScene;
  // ...
}
```

---

## Critical Files

| File | Purpose |
|------|---------|
| `frontend/app/api/socket/route.ts` | **Socket.IO server** (matchmaking, rooms, settlement) |
| `frontend/game/types/trading.ts` | TypeScript types |
| `frontend/game/stores/trading-store.ts` | Zustand + Socket.IO client |
| `frontend/game/scenes/TradingScene.ts` | **Phaser PvP scene** (coins, blade, multiplayer sync) |
| `frontend/components/MatchmakingScreen.tsx` | ShadCN matchmaking UI |
| `frontend/components/GameHUD.tsx` | Health bars, tug of war |
| `frontend/components/SettlementFeed.tsx` | Settlement notifications |
| `frontend/app/page.tsx` | Main game page |

---

## Verification Steps

```bash
cd frontend
npm install socket.io zustand
npx shadcn@latest init
npx shadcn@latest add button card progress badge input
npm run dev
```

1. **Open 2 browser windows** to `localhost:3001`
2. **Window 1**: Enter "Alice", click Find Match
3. **Window 2**: Enter "Bob", click Find Match
4. Both enter game, see synced coins
5. Slice coins, see opponent's predictions
6. Settlement after 5 seconds
7. Health/tug of war updates

---

## Implementation Order

1. **Socket.IO Server** (30 min) - API route with matchmaking
2. **Types & Store** (30 min) - Zustand with Socket.IO client
3. **ShadCN Setup** (15 min) - Init and components
4. **Phaser Scene** (45 min) - Coins, blade, multiplayer sync
5. **UI Components** (30 min) - Matchmaking, HUD, feed
6. **Page Integration** (15 min) - Assembly and testing

**Total**: ~2.5-3 hours
