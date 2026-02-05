import { Scene, GameObjects } from 'phaser'

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

export class ParticleSystem {
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
