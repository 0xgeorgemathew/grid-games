---
name: game-component
description: Scaffold Phaser scenes with React integration following HFT Battle patterns
disableModelInvocation: false
---

# Game Component Skill

Scaffold Phaser game scenes with proper React integration, following established HFT Battle patterns.

## When to Use

Use this skill when:
- Creating new Phaser scenes (e.g., BattleScene, MenuScene)
- Adding game features with Phaser + React integration
- Setting up multiplayer game rooms with Socket.IO
- Implementing game UI overlays

## Workflow

### 1. Requirements Gathering

Ask the user:
- **Scene type**: Game scene, UI scene, menu scene?
- **Core features**: Physics, multiplayer, animations, particles?
- **Multiplayer**: Will this use Socket.IO? If yes, what events?
- **Mobile support**: Responsive scaling needed?

### 2. Discovery (ULTRATHINK)

Use code-explorer agent to find similar scenes:
```
Task with subagent_type="feature-dev:code-explorer"
Prompt: "Find Phaser scenes similar to [scene type] and analyze their structure, patterns, and integration points"
```

Analyze:
- TradingScene.ts for multiplayer + physics
- GridScene.ts for grid-based gameplay
- GameCanvasClient.tsx for React bridge patterns

### 3. Scene Generation

Create scene file following `frontend.md` conventions:
- Extend `Phaser.Scene`
- Implement proper lifecycle (preload → create → update)
- Add spatial hash grid if physics/collisions needed
- Set up React bridge via `window.phaserEvents`
- Add object pooling for particles/frequently created objects
- Include mobile detection and responsive scaling
- Clean shutdown pattern (remove listeners, destroy objects)

### 4. Configuration

Add scene config to `game/config.ts`:
```typescript
export const getSceneConfig = (sceneType: string) => {
  const configs: Record<string, Phaser.Types.Core.SceneConfig> = {
    NewScene: {
      key: 'NewScene',
      active: false,
      scene: NewScene
    },
    // ... existing scenes
  }
  return configs[sceneType]
}
```

### 5. Type Safety

Update `GameCanvasClient.tsx` scene union:
```typescript
type SceneType = 'TradingScene' | 'GridScene' | 'NewScene'
```

### 6. Socket.IO Integration (if multiplayer)

Add events to `app/api/socket/route.ts`:
- Room join/leave logic
- Game state synchronization
- Player action handlers
- Disconnect cleanup

Document suggested events in skill output.

### 7. Quality Checks

Auto-format runs via hooks. Verify:
- ✓ No Phaser DOM mixing (React overlays only)
- ✓ Event listeners removed in shutdown()
- ✓ Objects properly destroyed
- ✓ Spatial hash grid for O(1) collisions
- ✓ Object pooling for particles
- ✓ React bridge typed events

## Templates

### Spatial Hash Grid (TradingScene.ts:132-194)

```typescript
private spatialHash = new Map<string, Phaser.GameObjects.Rectangle[]>()
private cellSize = 64

private hashKey(x: number, y: number): string {
  const cellX = Math.floor(x / this.cellSize)
  const cellY = Math.floor(y / this.cellSize)
  return `${cellX},${cellY}`
}

private insertIntoHash(obj: Phaser.GameObjects.Rectangle) {
  const key = this.hashKey(obj.x, obj.y)
  if (!this.spatialHash.has(key)) {
    this.spatialHash.set(key, [])
  }
  this.spatialHash.get(key)!.push(obj)
}

private queryHash(x: number, y: number, radius: number) {
  // Efficient spatial queries
}
```

### Object Pool Pattern (TradingScene.ts:54-56, 468-511)

```typescript
private particlePool: Phaser.GameObjects.Rectangle[] = []
private readonly POOL_SIZE = 100

create() {
  // Pre-allocate particles
  for (let i = 0; i < this.POOL_SIZE; i++) {
    const particle = this.add.rectangle(0, 0, 8, 8, 0xffffff)
    particle.setVisible(false)
    particle.setActive(false)
    this.particlePool.push(particle)
  }
}

private spawnParticle(x: number, y: number) {
  const particle = this.particlePool.find(p => !p.active)
  if (particle) {
    particle.setPosition(x, y)
    particle.setVisible(true)
    particle.setActive(true)
    // Animate, then return to pool
  }
}
```

### React Bridge (TradingScene.ts:101-111)

```typescript
private setupReactBridge() {
  window.phaserEvents = new EventEmitter()

  // Emit game state to React
  const emitGameState = () => {
    window.phaserEvents?.emit('gameState', {
      score: this.score,
      timeRemaining: this.timeRemaining
    })
  }

  this.time.addEvent({
    delay: 100,
    callback: emitGameState,
    loop: true
  })
}
```

### Shutdown Pattern (TradingScene.ts:229-243)

```typescript
shutdown() {
  // Remove all event listeners
  this.events.off('shutdown')

  // Destroy Phaser objects
  this.particles.forEach(p => p.destroy())
  this.coins.forEach(c => c.destroy())

  // Clear Socket.IO listeners
  this.socket?.off('gameUpdate')

  // Clear timers
  this.gameTimer?.remove()
  this.spawnTimer?.remove()

  // Clear spatial hash
  this.spatialHash.clear()
}
```

### Mobile Detection (TradingScene.ts:88-92)

```typescript
private isMobile() {
  return window.innerWidth < 768
}

create() {
  const scale = this.isMobile() ? 0.6 : 1.0
  this.cameras.main.setZoom(scale)
}
```

## Common Patterns

### Scene Factory Pattern (GameCanvasClient.tsx:16-24)

```typescript
const getSceneClass = (sceneType: string) => {
  const scenes: Record<string, typeof Phaser.Scene> = {
    TradingScene: () => import('../game/scenes/TradingScene'),
    GridScene: () => import('../game/scenes/GridScene'),
    NewScene: () => import('../game/scenes/NewScene')
  }
  return scenes[sceneType]
}
```

### Socket.IO Event Guards

```typescript
import type { CoinType } from '@/game/types/coins'

// Validate coin type
const isValidCoinType = (type: string): type is CoinType => {
  return ['bitcoin', 'ethereum', 'solana'].includes(type)
}

// Handle player input
socket.on('collectCoin', (data: unknown) => {
  if (!isValidCoinData(data)) return
  // Process...
})
```

### Scene Ready Guard (trading-store.ts:206-212)

```typescript
const sceneReady = computed(() => {
  return gameRef.current?.scene.scenes.includes(
    gameRef.current?.scene.getScene('TradingScene')
  )
})

// Use in effects
useEffect(() => {
  if (!sceneReady) return
  // Safe to access scene
}, [sceneReady])
```

## Integration with Existing Framework

This skill respects:
- ✅ `.claude/rules/frontend.md` - Phaser/React separation, Zustand for state
- ✅ `.claude/rules/workflows.md` - Multi-agent coordination patterns
- ✅ `.claude/rules/ultrathink.md` - Maximum reasoning depth

Can invoke:
- `feature-dev:code-explorer` - Analyze existing scenes
- `feature-dev:code-architect` - Design complex scene architecture

## Output Format

After scene generation, provide:

1. **File created**: `frontend/game/scenes/NewScene.ts`
2. **Config updated**: `game/config.ts` (show diff)
3. **Types updated**: `GameCanvasClient.tsx` (show diff)
4. **Socket.IO events** (if applicable):
   - Server-side additions needed in `app/api/socket/route.ts`
   - Event types to add to `game/types/socket.ts`
5. **React integration**:
   - Events emitted via `window.phaserEvents`
   - Zustand store suggestions
6. **Testing checklist**:
   - Scene loads without errors
   - React bridge works
   - Socket events fire (if multiplayer)
   - Mobile responsive
   - No memory leaks (check shutdown)

## Example Usage

```
User: "Create a BattleScene with power-ups and multiplayer"

Skill execution:
1. Ask: Single player or multiplayer? What power-ups?
2. Launch code-explorer agent to analyze TradingScene (multiplayer) and GridScene (gameplay)
3. Generate BattleScene.ts with:
   - Spatial hash grid for player/projectile collisions
   - Object pool for particles
   - Socket.IO integration for player state
   - Power-up spawn system
   - React bridge for UI overlays
4. Update config.ts and GameCanvasClient.tsx
5. Document Socket.IO events needed
6. Auto-format via hooks
7. Provide testing checklist
```

## Success Criteria

- Scene follows HFT Battle patterns
- No Phaser/React DOM mixing
- Proper cleanup (no memory leaks)
- Spatial hash for collisions (if physics)
- Object pooling (if frequent creation)
- Mobile responsive
- Socket.IO events typed and validated (if multiplayer)
- Auto-formatted and type-checked (via hooks)
