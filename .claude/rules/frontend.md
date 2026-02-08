# Frontend Conventions

## Architecture

- **Single-monolith**: Next.js App Router hosts both frontend and Socket.IO server
- **Phaser**: Game canvas (client-side physics only)
- **React/ShadCN**: UI overlays only - never mix with Phaser DOM
- **Zustand**: State management in `stores/`
- **Socket.IO**: Real-time multiplayer at `/api/socket`
- **ENS Integration**: Player identity via `.grid.eth` subdomains with leverage/stats
- **Yellow/Nitrolite**: L2 payment channels for instant settlements

## File Structure

```
frontend/
├── app/
│   ├── api/
│   │   ├── socket/route.ts    # Socket.IO server (game logic)
│   │   ├── ens/               # ENS integration API
│   │   ├── yellow/            # Yellow/Nitrolite channels
│   │   └── page.tsx           # Main pages
├── components/                # React UI components (ShadCN)
│   ├── ens/                   # ENS components
│   └── ui/                    # UI primitives
├── game/
│   ├── scenes/                # Phaser scenes
│   ├── systems/               # Game systems (extracted)
│   ├── stores/                # Zustand stores
│   ├── types/                 # TypeScript types
│   ├── config.ts              # Game configuration
│   └── constants.ts           # Game constants
├── hooks/                     # React hooks (useENS)
├── lib/                       # Utilities (ENS, Yellow)
└── providers.tsx              # App providers (Privy, wagmi, Query)
```

## Patterns

- **Game scenes**: Extend `Phaser.Scene`, use `window.phaserEvents` for React bridge
- **API routes**: Export GET/POST handlers; Socket.IO attaches as side-effect
- **State**: Logic in stores; components are visual only
- **Game systems**: Extracted rendering/particle/audio logic to `frontend/game/systems/`
- **ENS integration**: Text records for leverage/stats, reverse lookup for usernames
- **Yellow channels**: L2 payment channels for instant settlements
