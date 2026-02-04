import { Scene, GameObjects, Geom, Physics } from 'phaser'
import { useTradingStore, type PhaserEventBridge } from '../stores/trading-store'
import type { CoinType } from '../types/trading'
import { Token } from '../objects/Token'
import { DEFAULT_BTC_PRICE } from '@/lib/formatPrice'

// =============================================================================
// Particle System
// =============================================================================

interface TrailParticle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
}

interface SliceParticle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  color: number
}

class ParticleSystem {
  private trailParticles: TrailParticle[] = []
  private sliceParticles: SliceParticle[] = []
  private readonly MAX_TRAIL = 50
  private readonly MAX_SLICE = 200
  private trailGraphics: GameObjects.Graphics
  private sliceGraphics: GameObjects.Graphics

  constructor(scene: Scene) {
    this.trailGraphics = scene.add.graphics()
    this.trailGraphics.setDepth(999)
    this.sliceGraphics = scene.add.graphics()
    this.sliceGraphics.setDepth(1001)
  }

  emitTrail(x: number, y: number, count: number = 2): void {
    for (let i = 0; i < count; i++) {
      if (this.trailParticles.length >= this.MAX_TRAIL) break

      const angle = Math.random() * Math.PI * 2
      const speed = 50 + Math.random() * 50

      this.trailParticles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 300,
        maxLife: 300,
      })
    }
  }

  emitSlice(x: number, y: number, color: number, count: number = 20): void {
    for (let i = 0; i < count; i++) {
      if (this.sliceParticles.length >= this.MAX_SLICE) break

      const angle = Math.random() * Math.PI * 2
      const speed = 100 + Math.random() * 200

      this.sliceParticles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 50,
        life: 500,
        maxLife: 500,
        color,
      })
    }
  }

  update(delta: number): void {
    this.updateTrail(delta)
    this.updateSlice(delta)
  }

  private updateTrail(delta: number): void {
    for (let i = this.trailParticles.length - 1; i >= 0; i--) {
      const p = this.trailParticles[i]
      p.x += p.vx * (delta / 1000)
      p.y += p.vy * (delta / 1000)
      p.life -= delta

      if (p.life <= 0) {
        this.trailParticles.splice(i, 1)
      }
    }

    this.trailGraphics.clear()
    this.trailGraphics.setBlendMode(Phaser.BlendModes.ADD)

    for (const p of this.trailParticles) {
      const alpha = (p.life / p.maxLife) * 0.5
      const size = (p.life / p.maxLife) * 6

      this.trailGraphics.fillStyle(0xffffff, alpha)
      this.trailGraphics.fillCircle(p.x, p.y, size * 0.5)

      this.trailGraphics.fillStyle(0x00f3ff, alpha * 0.6)
      this.trailGraphics.fillCircle(p.x, p.y, size)
    }
  }

  private updateSlice(delta: number): void {
    const gravity = 500

    for (let i = this.sliceParticles.length - 1; i >= 0; i--) {
      const p = this.sliceParticles[i]
      p.vy += gravity * (delta / 1000)
      p.x += p.vx * (delta / 1000)
      p.y += p.vy * (delta / 1000)
      p.life -= delta

      if (p.life <= 0) {
        this.sliceParticles.splice(i, 1)
      }
    }

    this.sliceGraphics.clear()
    this.sliceGraphics.setBlendMode(Phaser.BlendModes.ADD)

    for (const p of this.sliceParticles) {
      const alpha = (p.life / p.maxLife) * 0.8
      const size = (p.life / p.maxLife) * 8

      this.sliceGraphics.fillStyle(p.color, alpha * 0.5)
      this.sliceGraphics.fillCircle(p.x, p.y, size)

      this.sliceGraphics.fillStyle(0xffffff, alpha)
      this.sliceGraphics.fillCircle(p.x, p.y, size * 0.4)
    }
  }

  destroy(): void {
    this.trailGraphics.destroy()
    this.sliceGraphics.destroy()
  }
}

// =============================================================================
// Visual Configuration
// =============================================================================

const BLADE_CONFIG = {
  color: 0x00f3ff,
  mobileCoreWidth: 4,
  mobileGlowWidth: 20,
  mobileMidWidth: 10,
  desktopCoreWidth: 3,
  desktopGlowWidth: 15,
  desktopMidWidth: 8,
} as const

const GRID_CONFIG = {
  color: 0x00f3ff,
  bgColor: 0x0a0a0a,
  size: 60,
} as const

// Coin configuration for visual rendering (NEON ARCADE TERMINAL theme)
export const COIN_CONFIG = {
  call: {
    color: 0x39ff14, // Electric Lime (bullish)
    symbol: '₿',
    arrow: '▲',
    radius: 28,
    innerColor: 0x2ecc00, // Darker lime inner
  },
  put: {
    color: 0xff1744, // Neon Red (bearish)
    symbol: '₿',
    arrow: '▼',
    radius: 28,
    innerColor: 0xcc0033, // Darker red inner
  },
  gas: {
    color: 0xffd700, // Hazard gold
    symbol: '⚡',
    arrow: '',
    radius: 28,
    innerColor: 0xff8c00, // Orange inner
  },
  whale: {
    color: 0xff00ff, // Legendary Magenta
    symbol: '★',
    arrow: '',
    radius: 40,
    innerColor: 0xcc00cc, // Deep magenta inner
  },
} as const

export class TradingScene extends Scene {
  // Game objects
  private tokenPool!: Physics.Arcade.Group
  private opponentSlices: GameObjects.Text[] = []
  private damageIndicators: GameObjects.Text[] = []
  private sliceArrows: GameObjects.Text[] = []
  private electricalArcs: GameObjects.Graphics[] = []

  // Blade rendering
  private bladePath: Geom.Point[] = []
  private bladeGraphics!: GameObjects.Graphics
  private bladeVelocity = { x: 0, y: 0 }
  private lastBladePoint: Geom.Point | null = null

  // Grid
  private gridGraphics!: GameObjects.Graphics

  // Collision detection
  private collisionLine = new Geom.Line(0, 0, 0, 0)
  private collisionCircle = new Geom.Circle(0, 0, 0)
  private spatialGrid = new Map<string, Set<string>>()
  private readonly CELL_SIZE = 60

  // Particle system
  private particles!: ParticleSystem

  // Split effect pool
  private splitEffectPool: {
    left: GameObjects.Graphics
    right: GameObjects.Graphics
    leftContainer: GameObjects.Container
    rightContainer: GameObjects.Container
  }[] = []
  private readonly SPLIT_POOL_SIZE = 10

  // Whale 2X
  private whale2XIndicator: GameObjects.Text | null = null
  private whale2XExpiresAt = 0

  // State
  private isShutdown = false
  private isMobile = false
  private eventEmitter: Phaser.Events.EventEmitter
  private reusableBladePoint = new Geom.Point(0, 0)

  // Constants
  private readonly MOBILE_TRAIL_LENGTH = 20
  private readonly DESKTOP_TRAIL_LENGTH = 10

  constructor() {
    super({ key: 'TradingScene' })
    this.eventEmitter = new Phaser.Events.EventEmitter()
  }

  create(): void {
    this.isMobile = this.sys.game.device.os.android || this.sys.game.device.os.iOS
    this.physics.world.setBounds(0, 0, this.cameras.main.width, this.cameras.main.height)

    // Create graphics
    this.bladeGraphics = this.add.graphics()
    this.bladeGraphics.setDepth(1000)

    this.particles = new ParticleSystem(this)

    this.gridGraphics = this.add.graphics()
    this.gridGraphics.setDepth(-1)
    this.drawGridBackground()

    this.generateCachedTextures()

    // Token pool
    this.tokenPool = this.physics.add.group({
      classType: Token,
      runChildUpdate: true,
      maxSize: 50,
      active: true,
      createCallback: (token) => {
        const t = token as Token
        t.setVisible(false)
        t.setActive(false)
      },
    })

    this.eventEmitter.on('coin_spawn', this.handleCoinSpawn.bind(this))
    this.eventEmitter.on('opponent_slice', this.handleOpponentSlice.bind(this))
    this.eventEmitter.on('whale_2x_activated', this.handleWhale2XActivated.bind(this))

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      this.reusableBladePoint.x = pointer.x
      this.reusableBladePoint.y = pointer.y

      if (
        !this.lastBladePoint ||
        this.lastBladePoint.x !== this.reusableBladePoint.x ||
        this.lastBladePoint.y !== this.reusableBladePoint.y
      ) {
        const pathPoint = new Geom.Point(this.reusableBladePoint.x, this.reusableBladePoint.y)
        this.bladePath.push(pathPoint)

        const maxTrailLength = this.isMobile ? this.MOBILE_TRAIL_LENGTH : this.DESKTOP_TRAIL_LENGTH
        if (this.bladePath.length > maxTrailLength) {
          this.bladePath.shift()
        }
        this.lastBladePoint = pathPoint
      }
    })

    this.input.on('pointerup', () => this.clearBladeTrail())
    this.input.on('pointerout', () => this.clearBladeTrail())
    ;(window as { phaserEvents?: PhaserEventBridge }).phaserEvents = this
      .eventEmitter as PhaserEventBridge
    ;(window as { setSceneReady?: (ready: boolean) => void }).setSceneReady = (ready: boolean) => {
      useTradingStore.getState().isSceneReady = ready
    }
    ;(window as unknown as { setSceneReady?: (ready: boolean) => void }).setSceneReady?.(true)

    const updateDimensions = () => {
      if (!this.isCameraAvailable()) return
      ;(window as { sceneDimensions?: { width: number; height: number } }).sceneDimensions = {
        width: this.cameras.main.width,
        height: this.cameras.main.height,
      }
    }

    this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
      if (!this.isCameraAvailable()) return

      this.physics.world.setBounds(0, 0, gameSize.width, gameSize.height)
      this.cameras.main.setViewport(0, 0, gameSize.width, gameSize.height)
      this.drawGridBackground()
      updateDimensions()
    })

    updateDimensions()
    setTimeout(updateDimensions, 100)
    setTimeout(updateDimensions, 300)
    setTimeout(updateDimensions, 500)
  }

  update(): void {
    if (this.isShutdown) return

    const delta = 1000 / 60

    this.updateGrid()
    this.updateCoinPhysics()
    this.particles.update(delta)
    this.drawBlade()
    this.checkCollisions()
    this.updateTextObjects(this.opponentSlices, -1, -0.02)
    this.updateTextObjects(this.damageIndicators, -1.5, -0.02)
    this.updateTextObjects(this.sliceArrows, 0, 0)
    this.updateWhale2XIndicator()
  }

  private updateTextObjects(arr: GameObjects.Text[], vy: number, alphaDelta: number): void {
    for (let i = arr.length - 1; i >= 0; i--) {
      const text = arr[i]
      text.y += vy
      text.alpha += alphaDelta
      if (text.alpha <= 0) {
        text.destroy()
        arr.splice(i, 1)
      }
    }
  }

  // Spatial hash helpers
  private getCellKey(x: number, y: number): string {
    const cellX = Math.floor(x / this.CELL_SIZE)
    const cellY = Math.floor(y / this.CELL_SIZE)
    return `${cellX},${cellY}`
  }

  private addCoinToGrid(coinId: string, x: number, y: number): void {
    const key = this.getCellKey(x, y)
    if (!this.spatialGrid.has(key)) {
      this.spatialGrid.set(key, new Set())
    }
    this.spatialGrid.get(key)!.add(coinId)
  }

  private removeCoinFromGrid(coinId: string, x: number, y: number): void {
    const key = this.getCellKey(x, y)
    const cell = this.spatialGrid.get(key)
    if (cell) {
      cell.delete(coinId)
      if (cell.size === 0) {
        this.spatialGrid.delete(key)
      }
    }
  }

  private getCoinsNearLine(p1: Geom.Point, p2: Geom.Point): Set<string> {
    const nearbyCoins = new Set<string>()

    // Get all cells the line passes through
    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    const steps = Math.max(Math.abs(dx), Math.abs(dy)) / this.CELL_SIZE + 1

    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0 : i / steps
      const x = p1.x + dx * t
      const y = p1.y + dy * t
      const key = this.getCellKey(x, y)

      // Check current cell and adjacent cells (3x3 grid)
      const [cx, cy] = key.split(',').map(Number)
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const neighborKey = `${cx + ox},${cy + oy}`
          const cell = this.spatialGrid.get(neighborKey)
          if (cell) {
            cell.forEach((coinId) => nearbyCoins.add(coinId))
          }
        }
      }
    }

    return nearbyCoins
  }

  // Rebuild spatial grid (called once per frame before collision checks)
  private rebuildSpatialGrid(): void {
    this.spatialGrid.clear()

    this.tokenPool.getChildren().forEach((token) => {
      const tokenObj = token as Token
      if (!tokenObj.active) return
      const coinId = tokenObj.getData('id')
      this.addCoinToGrid(coinId, tokenObj.x, tokenObj.y)
    })
  }

  private drawGridBackground(): void {
    const width = this.cameras.main.width
    const height = this.cameras.main.height

    this.gridGraphics.fillStyle(GRID_CONFIG.bgColor, 1)
    this.gridGraphics.fillRect(0, 0, width, height)
  }

  private updateGrid(): void {
    const width = this.cameras.main.width
    const height = this.cameras.main.height
    const time = this.time.now / 1000
    const pulseIntensity = 0.15 + Math.sin(time * 2) * 0.05

    this.gridGraphics.clear()
    this.gridGraphics.setBlendMode(Phaser.BlendModes.NORMAL)
    this.gridGraphics.fillStyle(GRID_CONFIG.bgColor, 1)
    this.gridGraphics.fillRect(0, 0, width, height)

    this.gridGraphics.setBlendMode(Phaser.BlendModes.ADD)

    const numVerticalLines = Math.ceil(width / GRID_CONFIG.size)
    const numHorizontalLines = Math.ceil(height / GRID_CONFIG.size)

    // Vertical lines
    for (let i = 0; i <= numVerticalLines; i++) {
      const x = i * GRID_CONFIG.size
      this.gridGraphics.lineStyle(6, GRID_CONFIG.color, pulseIntensity * 0.15)
      this.gridGraphics.lineBetween(x, 0, x, height)
      this.gridGraphics.lineStyle(3, GRID_CONFIG.color, pulseIntensity * 0.4)
      this.gridGraphics.lineBetween(x, 0, x, height)
      this.gridGraphics.lineStyle(1, GRID_CONFIG.color, pulseIntensity)
      this.gridGraphics.lineBetween(x, 0, x, height)
    }

    // Horizontal lines
    for (let j = 0; j <= numHorizontalLines; j++) {
      const y = j * GRID_CONFIG.size
      this.gridGraphics.lineStyle(6, GRID_CONFIG.color, pulseIntensity * 0.15)
      this.gridGraphics.lineBetween(0, y, width, y)
      this.gridGraphics.lineStyle(3, GRID_CONFIG.color, pulseIntensity * 0.4)
      this.gridGraphics.lineBetween(0, y, width, y)
      this.gridGraphics.lineStyle(1, GRID_CONFIG.color, pulseIntensity)
      this.gridGraphics.lineBetween(0, y, width, y)
    }

    // Intersections
    for (let i = 0; i <= numVerticalLines; i++) {
      for (let j = 0; j <= numHorizontalLines; j++) {
        const x = i * GRID_CONFIG.size
        const y = j * GRID_CONFIG.size

        this.gridGraphics.fillStyle(GRID_CONFIG.color, pulseIntensity * 1.25)
        this.gridGraphics.fillCircle(x, y, 6)

        this.gridGraphics.fillStyle(0xffffff, pulseIntensity * 2.5)
        this.gridGraphics.fillCircle(x, y, 2.5)
      }
    }
  }

  private generateCachedTextures(): void {
    const textureKeys: Array<CoinType> = ['call', 'put', 'gas', 'whale']

    textureKeys.forEach((type) => {
      const config = COIN_CONFIG[type]
      const diameter = config.radius * 2 + 8 // Extra padding for glow

      // Create a container to hold all elements
      const container = this.add.container(0, 0)

      // 1. Create graphics for coin body
      const graphics = this.add.graphics()

      // Draw outer bloom glow (larger, softer glow)
      const glowColor = Phaser.Display.Color.IntegerToColor(config.color)
      for (let r = config.radius + 4; r >= config.radius; r--) {
        const alpha = ((config.radius + 4 - r) / 4) * 0.3
        graphics.fillStyle(config.color, alpha)
        graphics.fillCircle(0, 0, r)
      }

      // Draw coin body (radial gradient)
      const centerColor = config.color
      const edgeColor = Phaser.Display.Color.IntegerToColor(config.color).darken(30).color

      for (let r = config.radius; r >= 0; r -= 2) {
        const t = r / config.radius
        const color = Phaser.Display.Color.Interpolate.ColorWithColor(
          Phaser.Display.Color.ValueToColor(centerColor),
          Phaser.Display.Color.ValueToColor(edgeColor),
          config.radius,
          t
        )
        graphics.fillStyle(color.color, 1 - t * 0.2)
        graphics.fillCircle(0, 0, r)
      }

      // Draw metallic shine (top-left highlight)
      graphics.fillStyle(0xffffff, 0.25)
      graphics.fillCircle(-config.radius * 0.3, -config.radius * 0.3, config.radius * 0.4)

      // Draw inner ring (concentric at 60% radius, white stroke)
      const innerRingRadius = config.radius * 0.6
      graphics.lineStyle(2, 0xffffff, 0.5)
      graphics.strokeCircle(0, 0, innerRingRadius)

      // Draw inner circle with gradient
      const innerRadius = config.radius * 0.75
      const innerCenter = config.innerColor
      const innerEdge = Phaser.Display.Color.IntegerToColor(config.innerColor).darken(15).color

      for (let r = innerRadius; r >= 0; r -= 1.5) {
        const t = r / innerRadius
        const color = Phaser.Display.Color.Interpolate.ColorWithColor(
          Phaser.Display.Color.ValueToColor(innerCenter),
          Phaser.Display.Color.ValueToColor(innerEdge),
          innerRadius,
          t
        )
        graphics.fillStyle(color.color, 0.98)
        graphics.fillCircle(0, 0, r)
      }

      container.add(graphics)

      // 2. Draw symbol (₿, ⚡, or ★) - white with glow for contrast
      const symbol = this.add
        .text(0, 2, config.symbol, {
          fontSize: `${config.radius * 1.0}px`,
          color: '#FFFFFF',
          fontStyle: 'bold',
          fontFamily: 'Arial, sans-serif',
          shadow: {
            offsetX: 0,
            offsetY: 0,
            blur: 10,
            color: '#FFFFFF',
            stroke: false,
            fill: true,
          },
        })
        .setOrigin(0.5)
      container.add(symbol)

      // 3. Draw arrow (if applicable)
      if (config.arrow) {
        const arrowY = config.arrow === '▲' ? -config.radius * 0.5 : config.radius * 0.5
        const arrowColor = config.arrow === '▲' ? '#39ff14' : '#ff1744'

        const arrow = this.add
          .text(0, arrowY, config.arrow, {
            fontSize: `${config.radius * 0.5}px`,
            color: arrowColor,
            fontStyle: 'bold',
            shadow: {
              offsetX: 0,
              offsetY: 0,
              blur: 6,
              color: arrowColor,
              stroke: false,
              fill: true,
            },
          })
          .setOrigin(0.5)
        container.add(arrow)
      }

      // 4. Generate texture from container
      // Create a render texture to capture the container
      const renderTexture = this.make.renderTexture({ width: diameter, height: diameter }, false)
      renderTexture.draw(container, diameter / 2, diameter / 2)
      renderTexture.saveTexture(`texture_${type}`)
      renderTexture.destroy()

      // Cleanup
      container.destroy()
    })
  }

  private updateCoinPhysics(): void {
    if (!this.tokenPool) return

    const sceneHeight = this.cameras.main.height

    this.tokenPool.getChildren().forEach((token) => {
      const t = token as Token
      if (!t.active) return

      const coinId = t.getData('id')
      const gridX = (t.getData('gridX') as number) ?? t.x
      const gridY = (t.getData('gridY') as number) ?? t.y

      if (t.y > sceneHeight + 200) {
        this.removeCoinFromGrid(coinId, gridX, gridY)
        t.setActive(false)
        t.setVisible(false)
        if (t.body) t.body.stop()
        return
      }

      if (Math.abs(t.x - gridX) > 1 || Math.abs(t.y - gridY) > 1) {
        this.removeCoinFromGrid(coinId, gridX, gridY)
        this.addCoinToGrid(coinId, t.x, t.y)
        t.setData('gridX', t.x)
        t.setData('gridY', t.y)
      }
    })
  }

  private removeCoin(coinId: string): void {
    // Find token in pool
    const token = this.tokenPool.getChildren().find((t) => {
      const tokenObj = t as Token
      return tokenObj.getData('id') === coinId && tokenObj.active
    }) as Token | undefined

    if (token) {
      // Get tracked grid position (not current position)
      const gridX = (token.getData('gridX') as number) ?? token.x
      const gridY = (token.getData('gridY') as number) ?? token.y

      // Remove from spatial grid using tracked position
      this.removeCoinFromGrid(coinId, gridX, gridY)

      // Disable physics before returning to pool
      if (token.body) {
        this.physics.world.disableBody(token.body)
      }

      // Return to pool
      token.setActive(false)
      token.setVisible(false)
    }
  }

  shutdown(): void {
    this.isShutdown = true
    this.tweens.killAll()

    this.bladeGraphics?.destroy()
    this.particles.destroy()
    this.gridGraphics?.destroy()

    this.electricalArcs.forEach((arc) => arc.destroy())
    this.electricalArcs.length = 0

    this.scale.off('resize')

    const setReady = (window as unknown as { setSceneReady?: (ready: boolean) => void })
      .setSceneReady
    setReady?.(false)
    delete (window as unknown as { setSceneReady?: (ready: boolean) => void }).setSceneReady
    delete (window as { phaserEvents?: PhaserEventBridge }).phaserEvents

    this.tokenPool.clear(true, true)
    this.eventEmitter.destroy()
    this.spatialGrid.clear()

    this.opponentSlices.forEach((t) => t.destroy())
    this.opponentSlices.length = 0

    this.input.off('pointermove')
    this.input.off('pointerup')
    this.input.off('pointerout')

    this.bladePath = []
    this.lastBladePoint = null

    this.splitEffectPool.forEach((e) => {
      e.left.destroy()
      e.right.destroy()
      e.leftContainer.destroy()
      e.rightContainer.destroy()
    })
    this.splitEffectPool.length = 0

    this.damageIndicators.forEach((t) => t.destroy())
    this.damageIndicators.length = 0

    this.sliceArrows.forEach((t) => t.destroy())
    this.sliceArrows.length = 0

    this.whale2XIndicator?.destroy()
    this.whale2XIndicator = null
  }

  private drawBlade(): void {
    this.bladeGraphics.clear()
    if (this.bladePath.length < 2) return

    const head = this.bladePath[this.bladePath.length - 1]
    const prev = this.bladePath[this.bladePath.length - 2]
    const dx = head.x - prev.x
    const dy = head.y - prev.y
    const velocity = Math.sqrt(dx * dx + dy * dy) * 60

    this.bladeVelocity.x = dx
    this.bladeVelocity.y = dy

    const isHighVelocity = velocity > 500
    const motionBlurMultiplier = isHighVelocity ? 1.2 : 1.0

    this.particles.emitTrail(head.x, head.y, 2)

    this.bladeGraphics.setBlendMode(Phaser.BlendModes.ADD)

    const coreWidth = this.isMobile ? BLADE_CONFIG.mobileCoreWidth : BLADE_CONFIG.desktopCoreWidth
    const glowWidth = this.isMobile ? BLADE_CONFIG.mobileGlowWidth : BLADE_CONFIG.desktopGlowWidth
    const midWidth = this.isMobile ? BLADE_CONFIG.mobileMidWidth : BLADE_CONFIG.desktopMidWidth

    // Glow layer
    for (let i = 0; i < this.bladePath.length - 1; i++) {
      const p1 = this.bladePath[i]
      const p2 = this.bladePath[i + 1]
      const t = i / (this.bladePath.length - 1)
      const alpha = t * t * 0.3

      this.bladeGraphics.lineStyle(glowWidth * motionBlurMultiplier, BLADE_CONFIG.color, alpha)
      this.bladeGraphics.beginPath()
      this.bladeGraphics.moveTo(p1.x, p1.y)
      this.bladeGraphics.lineTo(p2.x, p2.y)
      this.bladeGraphics.strokePath()
    }

    // Mid layer
    for (let i = 0; i < this.bladePath.length - 1; i++) {
      const p1 = this.bladePath[i]
      const p2 = this.bladePath[i + 1]
      const t = i / (this.bladePath.length - 1)
      const alpha = t * t * 0.6

      this.bladeGraphics.lineStyle(midWidth * motionBlurMultiplier, BLADE_CONFIG.color, alpha)
      this.bladeGraphics.beginPath()
      this.bladeGraphics.moveTo(p1.x, p1.y)
      this.bladeGraphics.lineTo(p2.x, p2.y)
      this.bladeGraphics.strokePath()
    }

    // Core layer
    for (let i = 0; i < this.bladePath.length - 1; i++) {
      const p1 = this.bladePath[i]
      const p2 = this.bladePath[i + 1]
      const t = i / (this.bladePath.length - 1)
      const alpha = t * t * t

      this.bladeGraphics.lineStyle(coreWidth, 0xffffff, alpha * 0.9)
      this.bladeGraphics.beginPath()
      this.bladeGraphics.moveTo(p1.x, p1.y)
      this.bladeGraphics.lineTo(p2.x, p2.y)
      this.bladeGraphics.strokePath()
    }

    this.bladeGraphics.setDepth(1000)
  }

  private emitSliceParticles(x: number, y: number, color: number, count: number = 20): void {
    this.particles.emitSlice(x, y, color, count)
  }

  private checkCollisions(): void {
    // Check collisions whenever blade has points (no gesture state check)
    if (this.bladePath.length < 2) return

    // Guard against shutdown - tokenPool may be destroyed
    if (!this.tokenPool) return

    const p1 = this.bladePath[this.bladePath.length - 2]
    const p2 = this.bladePath[this.bladePath.length - 1]

    // Reuse line instance (update coordinates instead of creating new)
    this.collisionLine.setTo(p1.x, p1.y, p2.x, p2.y)

    // Get nearby coins from spatial grid
    const nearbyCoinIds = this.getCoinsNearLine(p1, p2)

    // Track sliced coins this frame to prevent double-slicing
    const slicedThisFrame = new Set<string>()

    // Iterate pool and check nearby coins
    for (const token of this.tokenPool.getChildren()) {
      const tokenObj = token as Token
      if (!tokenObj.active) continue

      const coinId = tokenObj.getData('id')
      if (!nearbyCoinIds.has(coinId) || slicedThisFrame.has(coinId)) continue

      const type = tokenObj.getData('type') as CoinType
      const config = COIN_CONFIG[type]

      this.collisionCircle.setTo(tokenObj.x, tokenObj.y, config.radius)

      if (Geom.Intersects.LineToCircle(this.collisionLine, this.collisionCircle)) {
        this.sliceCoin(coinId, tokenObj)
        slicedThisFrame.add(coinId)
        // NOTE: No break here - allows multi-coin combos in single fast swipe
      }
    }
  }

  private clearBladeTrail(): void {
    this.bladePath = []
    this.lastBladePoint = null
  }

  private isCameraAvailable(): boolean {
    return this.cameras?.main !== undefined
  }

  private handleCoinSpawn(data: {
    coinId: string
    coinType: CoinType
    x: number
    y: number
  }): void {
    if (this.isShutdown || !this.tokenPool) return

    const config = COIN_CONFIG[data.coinType]
    if (!config) return

    const token = this.tokenPool.get(data.x, data.y) as Token
    if (!token) return

    if (token.body && token.body.enable) {
      token.body.enable = true
    }

    token.spawn(data.x, data.y, data.coinType, data.coinId, config, this.isMobile)

    token.setData('gridX', token.x)
    token.setData('gridY', token.y)

    this.addCoinToGrid(data.coinId, token.x, token.y)
  }

  private handleOpponentSlice(data: { playerName: string; coinType: CoinType }): void {
    // Guard against events firing after scene shutdown
    if (this.isShutdown || !this.add || !this.cameras) return

    const config = COIN_CONFIG[data.coinType]

    // Use percentage-based margins for mobile compatibility
    const margin = Math.min(100, this.cameras.main.width * 0.15)

    // Convert color number to hex string
    const colorHex = '#' + config.color.toString(16).padStart(6, '0')

    const text = this.add
      .text(
        Phaser.Math.Between(margin, this.cameras.main.width - margin),
        Phaser.Math.Between(margin, this.cameras.main.height - margin),
        `${data.playerName}: ${data.coinType.toUpperCase()}!`,
        {
          fontSize: this.isMobile ? '28px' : '20px',
          fontStyle: 'bold',
          fontFamily: 'Arial, sans-serif',
          color: colorHex,
          stroke: '#000000',
          strokeThickness: 4,
          shadow: {
            offsetX: 0,
            offsetY: 0,
            blur: 8,
            color: colorHex,
            stroke: false,
            fill: true,
          },
        }
      )
      .setOrigin(0.5)

    this.opponentSlices.push(text)
    this.cameras.main.flash(100, 255, 255, 255, false)
  }

  private showDamageIndicator(x: number, y: number, amount: number, isGain: boolean): void {
    // Guard against events firing after scene shutdown
    if (this.isShutdown || !this.add || !this.cameras) return

    const color = isGain ? 0x4ade80 : 0xf87171 // green-400 or red-400
    const colorHex = '#' + color.toString(16).padStart(6, '0')
    const sign = amount > 0 ? '+' : ''

    const text = this.add
      .text(x, y, `${sign}$${amount}`, {
        fontSize: this.isMobile ? '24px' : '18px',
        fontStyle: 'bold',
        fontFamily: 'Arial, sans-serif',
        color: colorHex,
        stroke: '#000000',
        strokeThickness: 3,
        shadow: {
          offsetX: 0,
          offsetY: 0,
          blur: 6,
          color: colorHex,
          stroke: false,
          fill: true,
        },
      })
      .setOrigin(0.5)
      .setDepth(1003) // Above electrical arcs (1002)

    this.damageIndicators.push(text)
  }

  private sliceCoin(coinId: string, coin: Token): void {
    const type = coin.getData('type') as CoinType
    const config = COIN_CONFIG[type]
    const store = useTradingStore.getState()

    this.emitSliceParticles(coin.x, coin.y, config.color, 20)
    this.createDirectionalArrow(coin.x, coin.y, type)
    this.createSplitEffect(coin.x, coin.y, config.color, config.radius, type)

    if (type === 'gas') {
      store.sliceCoin(coinId, type, 0)
      this.removeCoin(coinId)
      return
    }

    const currentPrice = store.priceData?.price ?? DEFAULT_BTC_PRICE
    store.sliceCoin(coinId, type, currentPrice)

    if (type === 'whale') {
      this.cameras.main.shake(200, 0.015)
    }

    this.removeCoin(coinId)
  }

  private getSplitEffectFromPool(): {
    left: Phaser.GameObjects.Graphics
    right: Phaser.GameObjects.Graphics
    leftContainer: Phaser.GameObjects.Container
    rightContainer: Phaser.GameObjects.Container
  } | null {
    const effect = this.splitEffectPool.pop()
    if (effect) {
      effect.left.setVisible(true)
      effect.right.setVisible(true)
      effect.leftContainer.setVisible(true)
      effect.rightContainer.setVisible(true)
    }
    return effect || null
  }

  private returnSplitEffectToPool(effect: {
    left: Phaser.GameObjects.Graphics
    right: Phaser.GameObjects.Graphics
    leftContainer: Phaser.GameObjects.Container
    rightContainer: Phaser.GameObjects.Container
  }): void {
    effect.left.setVisible(false)
    effect.right.setVisible(false)
    effect.leftContainer.setVisible(false)
    effect.rightContainer.setVisible(false)
    // Limit pool size to prevent memory bloat
    if (this.splitEffectPool.length < this.SPLIT_POOL_SIZE) {
      this.splitEffectPool.push(effect)
    } else {
      // Pool full, destroy the objects
      effect.left.destroy()
      effect.right.destroy()
      effect.leftContainer.destroy()
      effect.rightContainer.destroy()
    }
  }

  private createSplitEffect(
    x: number,
    y: number,
    color: number,
    radius: number,
    coinType?: CoinType
  ): void {
    const pooled = this.getSplitEffectFromPool()

    const leftHalf = pooled?.left || this.add.graphics()
    const rightHalf = pooled?.right || this.add.graphics()
    const leftContainer = pooled?.leftContainer || this.add.container(x, y)
    const rightContainer = pooled?.rightContainer || this.add.container(x, y)

    if (!pooled) {
      // Only create graphics if not from pool
      // Draw left semicircle with enhanced glow
      leftHalf.fillStyle(color, 1)
      leftHalf.beginPath()
      leftHalf.arc(0, 0, radius, Math.PI, Math.PI * 2)
      leftHalf.fillPath()

      // Add glow effect
      leftHalf.lineStyle(3, color, 0.5)
      leftHalf.beginPath()
      leftHalf.arc(0, 0, radius + 2, Math.PI, Math.PI * 2)
      leftHalf.strokePath()

      leftContainer.add(leftHalf)

      // Draw right semicircle with enhanced glow
      rightHalf.fillStyle(color, 1)
      rightHalf.beginPath()
      rightHalf.arc(0, 0, radius, 0, Math.PI)
      rightHalf.fillPath()

      // Add glow effect
      rightHalf.lineStyle(3, color, 0.5)
      rightHalf.beginPath()
      rightHalf.arc(0, 0, radius + 2, 0, Math.PI)
      rightHalf.strokePath()

      rightContainer.add(rightHalf)
    }

    // Update positions
    leftContainer.setPosition(x, y)
    rightContainer.setPosition(x, y)
    leftContainer.setAlpha(1)
    rightContainer.setAlpha(1)
    leftContainer.setRotation(0)
    rightContainer.setRotation(0)

    // Track completion separately
    let leftComplete = false
    let rightComplete = false

    const handleComplete = () => {
      // Guard against shutdown - pool may be destroyed
      if (this.isShutdown) {
        // Clean up non-pooled effects to prevent leaks
        if (!pooled) {
          leftContainer?.destroy()
          rightContainer?.destroy()
        }
        return
      }

      if (pooled) {
        // Only return when BOTH complete
        if (leftComplete && rightComplete) {
          this.returnSplitEffectToPool(pooled)
        }
      } else {
        // Non-pooled: each cleans up its own container
        leftContainer?.destroy()
        rightContainer?.destroy()
      }
    }

    // Animate halves flying apart with more dramatic movement
    const flyDistance = coinType === 'whale' ? 60 : 40
    const rotationAmount = coinType === 'whale' ? 1.5 : 1

    this.tweens.add({
      targets: leftContainer,
      x: x - flyDistance,
      y: y + flyDistance * 0.5,
      rotation: -rotationAmount,
      alpha: 0,
      duration: 400,
      ease: 'Power2',
      onComplete: () => {
        leftComplete = true
        handleComplete()
      },
    })

    this.tweens.add({
      targets: rightContainer,
      x: x + flyDistance,
      y: y - flyDistance * 0.5,
      rotation: rotationAmount,
      alpha: 0,
      duration: 400,
      ease: 'Power2',
      onComplete: () => {
        rightComplete = true
        handleComplete()
      },
    })

    // Add electrical arc effect for GAS coins
    if (coinType === 'gas') {
      this.createElectricalArc(x, y, color)
    }

    // Stronger bloom flash for all coins
    this.cameras.main.flash(100, (color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff, false)
  }

  private createElectricalArc(x: number, y: number, color: number): void {
    // Create electrical arc effect using jagged lines
    const arcGraphics = this.add.graphics()
    this.electricalArcs.push(arcGraphics) // Track for cleanup

    arcGraphics.setDepth(1002)
    arcGraphics.lineStyle(2, 0xffffff, 0.8)
    arcGraphics.setBlendMode(Phaser.BlendModes.ADD)

    const numArcs = Phaser.Math.Between(3, 5)
    const arcLength = 50

    for (let i = 0; i < numArcs; i++) {
      const angle = (Math.PI * 2 * i) / numArcs
      let currentX = x
      let currentY = y

      arcGraphics.beginPath()
      arcGraphics.moveTo(currentX, currentY)

      // Create jagged path
      const segments = Phaser.Math.Between(3, 6)
      for (let j = 0; j < segments; j++) {
        const segmentLength = arcLength / segments
        const jitter = Phaser.Math.FloatBetween(-0.3, 0.3) // Random angle jitter
        const newAngle = angle + jitter
        currentX += Math.cos(newAngle) * segmentLength
        currentY += Math.sin(newAngle) * segmentLength
        arcGraphics.lineTo(currentX, currentY)
      }

      arcGraphics.strokePath()
    }

    // Fade out and destroy
    this.tweens.add({
      targets: arcGraphics,
      alpha: 0,
      duration: 200,
      ease: 'Power2',
      onComplete: () => {
        // Double-check guard: scene may have shut down during tween
        if (this.isShutdown) return

        arcGraphics.destroy()
        // Remove from tracking array
        const idx = this.electricalArcs.indexOf(arcGraphics)
        if (idx >= 0) this.electricalArcs.splice(idx, 1)
      },
    })
  }

  private createDirectionalArrow(x: number, y: number, coinType: CoinType): void {
    if (this.isShutdown || !this.add || !this.cameras) return

    const config = COIN_CONFIG[coinType]
    let text: string
    let color = config.color
    let fontSize = this.isMobile ? '28px' : '22px' // Smaller for longer text

    // Determine text based on coin type
    if (coinType === 'call') {
      text = 'LONG - BTC'
    } else if (coinType === 'put') {
      text = 'Short BTC'
    } else if (coinType === 'gas') {
      text = 'PENALTY'
      color = 0xffd700 // Gold
      fontSize = this.isMobile ? '32px' : '26px'
    } else if (coinType === 'whale') {
      text = '2X'
      color = 0xff00ff // Magenta
      fontSize = this.isMobile ? '48px' : '40px'
    } else {
      text = config.arrow
      fontSize = this.isMobile ? '48px' : '36px'
    }

    const colorHex = '#' + color.toString(16).padStart(6, '0')

    const textObj = this.add
      .text(x, y, text, {
        fontSize,
        fontStyle: 'bold',
        fontFamily: 'Arial, sans-serif',
        color: colorHex,
        stroke: '#000000',
        strokeThickness: 6,
        shadow: {
          offsetX: 0,
          offsetY: 0,
          blur: 12,
          color: colorHex,
          stroke: false,
          fill: true,
        },
      })
      .setOrigin(0.5)
      .setDepth(1004)

    this.sliceArrows.push(textObj)

    // Slower fade - 2000ms instead of 800ms
    this.tweens.add({
      targets: textObj,
      y: y - 80,
      alpha: 0,
      duration: 2000, // Changed from 800
      ease: 'Power2',
      onComplete: () => {
        if (!this.isShutdown) {
          textObj.destroy()
          const idx = this.sliceArrows.indexOf(textObj)
          if (idx >= 0) this.sliceArrows.splice(idx, 1)
        }
      },
    })
  }

  private handleWhale2XActivated(data: {
    playerId: string
    playerName: string
    durationMs: number
    isLocalPlayer: boolean
  }): void {
    if (!data.isLocalPlayer) return // Only show for local player

    this.whale2XExpiresAt = Date.now() + data.durationMs

    // Create or update indicator
    if (!this.whale2XIndicator) {
      this.whale2XIndicator = this.add
        .text(this.cameras.main.width / 2, 100, '2X ACTIVE!', {
          fontSize: '48px',
          fontStyle: 'bold',
          color: '#ff00ff',
          stroke: '#000000',
          strokeThickness: 8,
        })
        .setOrigin(0.5)
        .setDepth(1005)
    }

    // Pulse animation
    this.tweens.add({
      targets: this.whale2XIndicator,
      scale: { from: 1, to: 1.2 },
      alpha: { from: 1, to: 0.7 },
      duration: 500,
      yoyo: true,
      repeat: -1,
    })
  }

  private updateWhale2XIndicator(): void {
    if (this.whale2XIndicator && Date.now() > this.whale2XExpiresAt) {
      this.whale2XIndicator.destroy()
      this.whale2XIndicator = null
    }
  }
}
