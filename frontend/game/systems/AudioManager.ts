import { Scene } from 'phaser'

type AudioSpriteSound = Phaser.Sound.BaseSound & {
  play(markerName: string, config?: Phaser.Types.Sound.SoundConfig): boolean
}

export class AudioManager {
  private scene: Scene
  private gameSfx: AudioSpriteSound | null = null
  private isMuted: boolean = false
  private isLoaded: boolean = false
  private lastSwipeTime: number = 0
  private readonly SWIPE_THROTTLE_MS = 150 // Minimum time between swipe sounds

  constructor(scene: Scene) {
    this.scene = scene
  }

  preload(): void {
    if (this.isLoaded) return

    // Load audio sprite with MP3 and WAV fallback
    this.scene.load.audioSprite('sfx-game', 'audio/sfx-game.json', [
      'audio/sfx-game.mp3',
      'audio/sfx-game.wav',
    ])
  }

  create(): void {
    if (this.isLoaded) return

    try {
      this.gameSfx = this.scene.sound.addAudioSprite('sfx-game')
      this.isLoaded = true
    } catch (error) {
      console.warn('[AudioManager] Failed to create audio sprite:', error)
    }
  }

  playSwipe(): void {
    if (this.isMuted || !this.isLoaded || !this.gameSfx) return

    const now = this.scene.time.now
    if (now - this.lastSwipeTime < this.SWIPE_THROTTLE_MS) return

    this.lastSwipeTime = now
    try {
      this.gameSfx.play('swipe', { volume: 0.4 })
    } catch (error) {
      console.warn('[AudioManager] Failed to play swipe sound:', error)
    }
  }

  playSlice(): void {
    if (this.isMuted || !this.isLoaded || !this.gameSfx) return

    try {
      this.gameSfx.play('slice', { volume: 0.5 })
    } catch (error) {
      console.warn('[AudioManager] Failed to play slice sound:', error)
    }
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted
    this.scene.sound.mute = muted
  }

  isAudioLoaded(): boolean {
    return this.isLoaded
  }

  destroy(): void {
    this.gameSfx?.destroy()
    this.gameSfx = null
    this.isLoaded = false
  }
}
