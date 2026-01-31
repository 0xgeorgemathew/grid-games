# Frontend Conventions

## Architecture

- **Single-monolith**: Next.js App Router hosts both frontend and Socket.IO server
- **Phaser**: Game canvas (client-side physics only)
- **React/ShadCN**: UI overlays only - never mix with Phaser DOM
- **Zustand**: State management in `stores/`
- **Socket.IO**: Real-time multiplayer at `/api/socket`

## File Structure

```
frontend/
├── app/
│   ├── api/socket/route.ts    # Socket.IO server (game logic)
│   └── page.tsx               # Main pages
├── components/                # React UI components (ShadCN)
├── game/
│   ├── scenes/                # Phaser scenes
│   ├── stores/                # Zustand stores
│   └── types/                 # TypeScript types
└── lib/                       # Utilities
```

## Patterns

- **Game scenes**: Extend `Phaser.Scene`, use `window.phaserEvents` for React bridge
- **API routes**: Export GET/POST handlers; Socket.IO attaches as side-effect
- **State**: Logic in stores; components are visual only
