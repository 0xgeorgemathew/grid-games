# Type System Documentation

TypeScript type organization, exports, and conventions for Grid Games frontend.

## Type Organization

```
frontend/game/
├── types/
│   └── trading.ts       # All HFT Battle types (184 lines)
├── stores/
│   └── trading-store.ts # Zustand store (887 lines)
├── config.ts            # Game configuration (Phaser config, grid dimensions)
├── constants.ts         # Game constants (economy, timing) - SEPARATED from config
├── systems/             # Game systems (extracted from scenes)
└── scenes/
    └── TradingScene.ts  # Phaser scene (614 lines, down from 1289)
```

## Exported Types (from types/trading.ts)

All core HFT Battle types are centralized in `frontend/game/types/trading.ts`:

| Type | Purpose | Exported |
|------|---------|----------|
| `CoinType` | 'call' \| 'put' \| 'gas' \| 'whale' | ✅ Yes |
| `Player` | Player state (dollars, score, scene dimensions, leverage) | ✅ Yes |
| `CoinSpawnEvent` | Server coin spawn event | ✅ Yes |
| `SliceEvent` | Server slice event | ✅ Yes |
| `OrderPlacedEvent` | Active order with countdown | ✅ Yes |
| `SettlementEvent` | Settlement result after timer expires | ✅ Yes |
| `MatchFoundEvent` | Two players matched | ✅ Yes |
| `RoundStartEvent` | Round start notification | ✅ Yes |
| `RoundEndEvent` | Round end with summary | ✅ Yes |
| `GameOverEvent` | Game over with round history | ✅ Yes |
| `RoundSummary` | Per-round results for game over modal | ✅ Yes |
| `PriceData` | Binance price data | ✅ Yes |
| `LobbyPlayer` | Lobby player for matchmaking | ✅ Yes |
| `LobbyPlayersEvent` | Lobby players list event | ✅ Yes |
| `LobbyUpdatedEvent` | Lobby update broadcast | ✅ Yes |

## Type Organization Updates

**Previously Missing Types (Now Exported):**
- `CoinConfig` - Now exported from `types/trading.ts` (visual and physics configuration)
- `CryptoSymbol` - Simplified to `'btcusdt'` only (defined in trading-store.ts)

**New Event Types:**
- `LobbyPlayer` - Player in matchmaking lobby
- `LobbyPlayersEvent` - List of waiting players
- `LobbyUpdatedEvent` - Lobby state changes

**ENS Integration Types:**
- `LeverageOption` - Player leverage setting (1, 2, 5, 10, 20)
- Stored in ENS text record `games.grid.leverage`
- Fetched via `frontend/lib/ens.ts`

**Yellow Channel Types:**
- Defined in `frontend/lib/yellow/` directory
- Nitrolite-specific types for payment channels
- State channel management types

## Type Import Patterns

### Current Pattern (improved)

```typescript
// Core types from types/
import type { CoinType, Player, LobbyPlayer } from '@/game/types/trading'

// Game configuration
import { COIN_CONFIGS, GRID_CONFIG } from '@/game/config'

// Game constants (economy, timing)
import { STARTING_CASH, ROUND_DURATION_MS } from '@/game/constants'

// ENS types
import type { LeverageOption } from '@/lib/ens'

// Yellow channel types
import type { ChannelState, NitroliteChannel } from '@/lib/yellow/channel-manager'
```

## Related Documentation

- `.claude/rules/game-design.md` - Game mechanics that types model
- `.claude/rules/frontend.md` - Frontend architecture and conventions
- `ens-code-usage.md` - ENS integration and leverage types

## Related Documentation

- `.claude/rules/game-design.md` - Game mechanics that types model
- `.claude/rules/frontend.md` - Frontend architecture and conventions
