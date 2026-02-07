#!/usr/bin/env bun
/**
 * Create audio sprite files from individual sound effects
 * Combines sounds with 100ms gaps and generates spritemap JSON
 */

import ffmpeg from 'fluent-ffmpeg'
import ffmpegPath from '@ffmpeg-installer/ffmpeg'
import ffprobePath from '@ffprobe-installer/ffprobe'
import { readFileSync, writeFileSync, mkdirSync, realpathSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

ffmpeg.setFfmpegPath(ffmpegPath.path)
ffmpeg.setFfprobePath(ffprobePath.path)

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = join(__dirname, '..')
const AUDIO_DIR = join(PROJECT_ROOT, 'public/audio')
const SOUNDS_DIR = join(AUDIO_DIR, 'sounds')

// Sound definitions with file names and desired output markers
// Ultra-simple 2-sound setup: swipe (movement), slice (coin hit)
const gameSounds = [
  { name: 'swipe', file: 'swosh-sword-swing.flac', start: 0, end: 0 }, // Full file (sword swipe on movement)
  { name: 'slice', file: 'boom.wav', start: 0, end: 0 }, // Full file (explosion when slicing coins)
]

const GAP = 0.1 // 100ms gap between sounds

/**
 * Get duration of an audio file using ffprobe
 */
function getDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        reject(err)
      } else {
        resolve(metadata.format.duration || 0)
      }
    })
  })
}

/**
 * Create audio sprite by concatenating audio segments with gaps
 */
async function createAudioSprite(
  sounds: Array<{ name: string; file: string; start: number; end: number }>,
  outputPath: string
): Promise<{ spritemap: Record<string, { start: number; end: number }> }> {
  console.log(`Creating audio sprite: ${outputPath}`)

  const spritemap: Record<string, { start: number; end: number }> = {}
  let currentTime = 0

  // Create a temporary list file for ffmpeg concat
  const tempDir = join(AUDIO_DIR, 'temp')
  mkdirSync(tempDir, { recursive: true })

  const concatListPath = join(tempDir, 'concat.txt')
  const segments: string[] = []

  for (const sound of sounds) {
    const inputPath = join(AUDIO_DIR, sound.file) // Files now in AUDIO_DIR directly
    let duration: number

    // If end is 0, use the entire file duration
    if (sound.end === 0) {
      const fileDuration = await getDuration(inputPath)
      duration = fileDuration - sound.start
    } else {
      duration = sound.end - sound.start
    }

    const segmentPath = join(tempDir, `${sound.name}.wav`)

    console.log(
      `  Processing ${sound.name}: ${sound.start}s - ${(sound.start + duration).toFixed(2)}s (${duration.toFixed(2)}s)`
    )

    // Extract segment from source file (or full file if end=0)
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .setStartTime(sound.start)
        .setDuration(duration)
        .output(segmentPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .run()
    })

    // Add to concat list (use absolute path for ffmpeg concat)
    const absSegmentPath = realpathSync(segmentPath)
    segments.push(`file '${absSegmentPath}'`)

    // Record spritemap entry
    spritemap[sound.name] = {
      start: Math.round(currentTime * 1000) / 1000,
      end: Math.round((currentTime + duration) * 1000) / 1000,
    }

    currentTime += duration + GAP

    // Add gap as silent audio
    const gapPath = join(tempDir, `${sound.name}_gap.wav`)
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input('anullsrc=r=44100:cl=mono')
        .inputFormat('lavfi')
        .setDuration(GAP)
        .output(gapPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .run()
    })

    const absGapPath = realpathSync(gapPath)
    segments.push(`file '${absGapPath}'`)
  }

  // Write concat list with absolute paths
  writeFileSync(concatListPath, segments.join('\n'))

  // Combine all segments
  const wavPath = outputPath.replace('.mp3', '.wav')
  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(concatListPath)
      .inputOptions('-f', 'concat')
      .inputOptions('-safe', '0')
      .outputOptions('-c', 'pcm_s16le') // Use PCM instead of copy to handle format mismatches
      .audioChannels(1)
      .audioFrequency(44100)
      .output(wavPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run()
  })

  // Convert to MP3
  await new Promise<void>((resolve, reject) => {
    ffmpeg(wavPath)
      .output(outputPath)
      .outputOptions('-b:a', '128k')
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run()
  })

  // Clean up temp files
  const { rm } = await import('fs/promises')
  await rm(tempDir, { recursive: true, force: true })

  return { spritemap }
}

/**
 * Generate JSON spritemap file
 */
function writeSpritemap(
  outputPath: string,
  spritemap: Record<string, { start: number; end: number }>,
  audioFile: string
) {
  const json = {
    spritemap,
    resources: [audioFile],
    url: audioFile,
  }
  writeFileSync(outputPath, JSON.stringify(json, null, 2))
  console.log(`Created spritemap: ${outputPath}`)
}

async function main() {
  console.log('🎵 Creating audio sprites for HFT Battle\n')

  // Create single game sprite with 2 sounds
  console.log('─────────────────────────────────────────')
  console.log('Creating game sounds sprite (2 sounds: swipe, slice)...')
  const gameResult = await createAudioSprite(gameSounds, join(AUDIO_DIR, 'sfx-game.mp3'))
  writeSpritemap(join(AUDIO_DIR, 'sfx-game.json'), gameResult.spritemap, 'sfx-game.mp3')

  console.log('\n✅ Audio sprites created successfully!')
  console.log('\nGenerated files:')
  console.log(`  📄 ${AUDIO_DIR}/sfx-game.json`)
  console.log(`  🎵 ${AUDIO_DIR}/sfx-game.mp3`)
  console.log('\nNote: Remove unused files (money-gain.wav, money-lost.wav) after testing')
}

main().catch(console.error)
