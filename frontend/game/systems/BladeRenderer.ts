import { Scene, GameObjects, Geom } from 'phaser'

export const BLADE_CONFIG = {
  color: 0x00f3ff,
  mobileCoreWidth: 4,
  mobileGlowWidth: 20,
  mobileMidWidth: 10,
  desktopCoreWidth: 3,
  desktopGlowWidth: 15,
  desktopMidWidth: 8,
} as const

export class BladeRenderer {
  private scene: Scene
  private isMobile: boolean
  
  private bladePath: Geom.Point[] = []
  private bladeGraphics: GameObjects.Graphics
  private bladeVelocity = { x: 0, y: 0 }
  private lastBladePoint: Geom.Point | null = null
  private reusableBladePoint = new Geom.Point(0, 0)

  private readonly MOBILE_TRAIL_LENGTH = 20
  private readonly DESKTOP_TRAIL_LENGTH = 10

  constructor(scene: Scene, isMobile: boolean) {
    this.scene = scene
    this.isMobile = isMobile
    this.bladeGraphics = scene.add.graphics()
    this.bladeGraphics.setDepth(1000)
  }

  /**
   * Get the current blade path
   */
  getBladePath(): Geom.Point[] {
    return this.bladePath
  }

  /**
   * Get the blade velocity
   */
  getBladeVelocity(): { x: number; y: number } {
    return this.bladeVelocity
  }

  /**
   * Update blade trail from pointer movement
   */
  updateBladePath(pointerX: number, pointerY: number): void {
    this.reusableBladePoint.x = pointerX
    this.reusableBladePoint.y = pointerY

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
  }

  /**
   * Clear the blade trail
   */
  clearBladePath(): void {
    this.bladePath = []
    this.lastBladePoint = null
  }

  /**
   * Draw the blade trail
   */
  draw(emitTrailCallback: (x: number, y: number) => void): void {
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

    emitTrailCallback(head.x, head.y)

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

  /**
   * Destroy the blade renderer
   */
  destroy(): void {
    this.bladeGraphics.destroy()
  }
}
