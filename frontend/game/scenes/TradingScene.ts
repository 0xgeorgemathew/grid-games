import { Scene, GameObjects, Geom } from 'phaser';
import { useTradingStore, type PhaserEventBridge } from '../stores/trading-store';
import type { CoinType } from '../types/trading';

// Coin configuration for visual rendering
const COIN_CONFIG = {
  call: { color: 0x00ff00, symbol: '▲', radius: 28 },
  put: { color: 0xff0000, symbol: '▼', radius: 28 },
  gas: { color: 0xffff00, symbol: '⚡', radius: 28 },
  whale: { color: 0xffd700, symbol: '★', radius: 45 },
} as const;

export class TradingScene extends Scene {
  // Active game objects
  private coins: Map<string, Phaser.GameObjects.Container> = new Map();
  private particles: Phaser.GameObjects.Container[] = [];
  private opponentSlices: GameObjects.Text[] = [];

  // Blade rendering
  private bladePath: Geom.Point[] = [];
  private bladeGraphics!: GameObjects.Graphics;

  // Event bridge to React store
  private eventEmitter: Phaser.Events.EventEmitter;

  constructor() {
    super({ key: 'TradingScene' });
    this.eventEmitter = new Phaser.Events.EventEmitter();
  }

  create(): void {
    // Set physics world bounds
    this.physics.world.setBounds(0, 0, this.cameras.main.width, this.cameras.main.height);

    // Create blade graphics (reused each frame)
    this.bladeGraphics = this.add.graphics();

    // Track mouse movement for blade trail
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      this.bladePath.push(new Geom.Point(pointer.x, pointer.y));
      // Limit trail length for performance
      if (this.bladePath.length > 10) {
        this.bladePath.shift();
      }
    });

    // Expose event emitter to window for React bridge
    // Phaser.Events.EventEmitter implements our PhaserEventBridge interface
    (window as { phaserEvents?: PhaserEventBridge }).phaserEvents = this.eventEmitter as PhaserEventBridge;

    // Listen for store events
    this.eventEmitter.on('coin_spawn', this.handleCoinSpawn.bind(this));
    this.eventEmitter.on('opponent_slice', this.handleOpponentSlice.bind(this));
  }

  update(): void {
    this.updateCoinPhysics();
    this.drawBlade();
    this.checkCollisions();
    this.updateParticles();
    this.updateOpponentSlices();
  }

  private updateCoinPhysics(): void {
    const height = this.cameras.main.height;
    const coinsToRemove: string[] = [];

    this.coins.forEach((coin) => {
      const body = coin.getData('body') as Phaser.Physics.Arcade.Body;
      if (body) {
        // Apply gravity
        body.velocity.y += 0.15;
        // Apply rotation
        coin.rotation += coin.getData('rotationSpeed') || 0;
      }

      // Remove coins that fall below screen
      if (coin.y > height + 50) {
        coinsToRemove.push(coin.getData('id')!);
      }
    });

    coinsToRemove.forEach(id => this.removeCoin(id));
  }

  private drawBlade(): void {
    this.bladeGraphics.clear();
    if (this.bladePath.length < 2) return;

    // Draw outer glow (fade effect)
    for (let i = 0; i < this.bladePath.length - 1; i++) {
      const p1 = this.bladePath[i];
      const p2 = this.bladePath[i + 1];
      const alpha = i / this.bladePath.length;

      this.bladeGraphics.lineStyle(4, 0x00ffff, alpha);
      this.bladeGraphics.lineBetween(p1.x, p1.y, p2.x, p2.y);
    }

    // Draw inner core
    this.bladeGraphics.lineStyle(8, 0x00ffff, 0.3);
    for (let i = 0; i < this.bladePath.length - 1; i++) {
      const p1 = this.bladePath[i];
      const p2 = this.bladePath[i + 1];
      this.bladeGraphics.lineBetween(p1.x, p1.y, p2.x, p2.y);
    }
  }

  private checkCollisions(): void {
    if (this.bladePath.length < 2) return;

    const p1 = this.bladePath[this.bladePath.length - 2];
    const p2 = this.bladePath[this.bladePath.length - 1];
    const line = new Geom.Line(p1.x, p1.y, p2.x, p2.y);

    for (const [coinId, coin] of this.coins) {
      const type = coin.getData('type') as CoinType;
      const config = COIN_CONFIG[type];
      const circle = new Geom.Circle(coin.x, coin.y, config.radius);

      if (Geom.Intersects.LineToCircle(line, circle)) {
        this.sliceCoin(coinId, coin);
        break; // One slice per frame
      }
    }
  }

  // Particles now manage their own cleanup via tweens
  // This method exists for compatibility but particles auto-remove
  private updateParticles(): void {
    // Filter out destroyed containers (handles edge cases)
    this.particles = this.particles.filter(p => p.active);
  }

  private updateOpponentSlices(): void {
    for (let i = this.opponentSlices.length - 1; i >= 0; i--) {
      const text = this.opponentSlices[i];
      text.y -= 1;
      text.alpha -= 0.02;
      if (text.alpha <= 0) {
        text.destroy();
        this.opponentSlices.splice(i, 1);
      }
    }
  }

  private handleCoinSpawn(data: { coinId: string; coinType: CoinType; x: number; y: number }): void {
    const config = COIN_CONFIG[data.coinType];

    // Create coin container
    const coin = this.add.container(data.x, data.y);
    coin.setData('id', data.coinId);
    coin.setData('type', data.coinType);
    coin.setData('rotationSpeed', (Math.random() - 0.5) * 0.05);

    // Outer circle (border)
    const body = this.add.circle(0, 0, config.radius, config.color);
    body.setStrokeStyle(3, 0xffffff);

    // Inner circle (translucent fill)
    const inner = this.add.circle(0, 0, config.radius * 0.85, config.color);
    inner.setStrokeStyle(2, config.color);
    inner.setAlpha(0.7);

    // Symbol (arrow or icon)
    const symbol = this.add.text(0, 2, config.symbol, {
      fontSize: `${config.radius}px`,
      color: '#000000',
      fontStyle: 'bold',
    });
    symbol.setOrigin(0.5);

    coin.add([body, inner, symbol]);
    this.physics.add.existing(coin);

    // Configure physics
    const physicsBody = coin.body as Phaser.Physics.Arcade.Body;
    physicsBody.setVelocity((Math.random() - 0.5) * 2, Math.random() * 3 + 2);
    physicsBody.setGravity(0, data.coinType === 'whale' ? 0.1 : 0.15);

    this.coins.set(data.coinId, coin);
  }

  private handleOpponentSlice(data: { playerName: string; coinType: CoinType }): void {
    const config = COIN_CONFIG[data.coinType];
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

    // Screen flash effect
    this.cameras.main.flash(100, 255, 255, 255, false);
  }

  private sliceCoin(coinId: string, coin: Phaser.GameObjects.Container): void {
    const type = coin.getData('type') as CoinType;
    const config = COIN_CONFIG[type];
    const store = useTradingStore.getState();

    this.createExplosion(coin.x, coin.y, config.color);

    if (type === 'gas') {
      // Gas coins damage the slicer immediately
      this.cameras.main.flash(200, 255, 255, 0, false);
      store.sliceCoin(coinId, type, 0);
      this.removeCoin(coinId);
      return;
    }

    // TODO: Replace with real Binance price feed
    const currentPrice = 3400;
    store.sliceCoin(coinId, type, currentPrice);

    if (type === 'whale') {
      this.cameras.main.shake(200, 0.015);
      this.cameras.main.flash(100, 255, 215, 0, false);
    }

    this.removeCoin(coinId);
  }

  private removeCoin(coinId: string): void {
    const coin = this.coins.get(coinId);
    if (coin) {
      // Disable physics body before destroying to prevent memory leaks
      const body = coin.body as Phaser.Physics.Arcade.Body | undefined;
      if (body) {
        this.physics.world.disableBody(body);
      }
      coin.destroy();
      this.coins.delete(coinId);
    }
  }

  private createExplosion(x: number, y: number, color: number): void {
    const container = this.add.container(x, y);
    const particleCount = 12;

    for (let i = 0; i < particleCount; i++) {
      const particle = this.add.circle(0, 0, 4, color);
      const angle = (Math.PI * 2 / particleCount) * i;
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

    // Track container for cleanup - fade out over same duration as particles
    this.tweens.add({
      targets: container,
      alpha: 0,
      duration: 300,
      ease: 'Power2',
      onComplete: () => {
        container.destroy();
        const idx = this.particles.indexOf(container);
        if (idx !== -1) this.particles.splice(idx, 1);
      },
    });

    this.particles.push(container);
  }

  shutdown(): void {
    this.eventEmitter.destroy();
    this.coins.clear();
    this.opponentSlices.forEach(t => t.destroy());
  }
}
