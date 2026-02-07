import { Scene } from 'phaser'

type AudioSpriteSound = Phaser.Sound.BaseSound & {
  play(markerName: string, config?: Phaser.Types.Sound.SoundConfig): boolean
}

export class AudioManager {
  private scene: Scene
  private gameSfx: AudioSpriteSound | null = null
  private isMuted: boolean = false
  private isLoaded: boolean = false
  private currentSwipeSound: any = null
  private swipeDuckTween: Phaser.Tweens.Tween | null = null
  private isUnlocked: boolean = false

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

  /**
   * Set unlocked state from Phaser's built-in unlock mechanism.
   * Phaser handles the user gesture chain correctly for both Android and iOS.
   */
  setUnlocked(unlocked: boolean): void {
    this.isUnlocked = unlocked
  }

  playSwipe(): void {
    if (this.isMuted || !this.isLoaded || !this.gameSfx) return

    try {
      const played = this.gameSfx.play('swipe', { volume: 0.5 })
      if (played) {
        // Track the most recent swipe sound for ducking
        this.currentSwipeSound = this.gameSfx
      }
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

  playSliceAt(x: number, screenWidth: number): void {
    if (this.isMuted || !this.isLoaded || !this.gameSfx) return

    try {
      // Duck any ongoing swipe sound
      this.duckSwipe()

      // Calculate pan: -1 (left) to +1 (right) based on screen position
      const pan = (x / screenWidth - 0.5) * 2

      this.gameSfx.play('slice', {
        volume: 0.6, // Slightly louder for impact
        pan // -1 (left) to +1 (right)
      })
    } catch (error) {
      console.warn('[AudioManager] Failed to play positional slice sound:', error)
    }
  }

  private duckSwipe(): void {
    if (!this.currentSwipeSound) return

    // Kill any existing duck tween to prevent conflicts
    this.swipeDuckTween?.stop()

    // Fade down to 30% volume over 50ms, hold, then fade back up
    this.swipeDuckTween = this.scene.tweens.add({
      targets: this.currentSwipeSound,
      volume: 0.15, // 30% of 0.5 = 0.15
      duration: 50,
      yoyo: true,
      hold: 80, // Stay ducked for 80ms
      onComplete: () => {
        this.currentSwipeSound = null
      }
    })
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted
    this.scene.sound.mute = muted
  }

  isAudioLoaded(): boolean {
    return this.isLoaded
  }

  destroy(): void {
    this.swipeDuckTween?.stop()
    this.swipeDuckTween = null
    this.currentSwipeSound = null
    this.gameSfx?.destroy()
    this.gameSfx = null
    this.isLoaded = false
  }
}
