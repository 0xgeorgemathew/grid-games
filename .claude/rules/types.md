# Type System Documentation

TypeScript type organization, exports, and conventions for Grid Games frontend.

## Type Organization

```
frontend/game/
├── types/
│   └── trading.ts       # All HFT Battle types (139 lines)
├── stores/
│   └── trading-store.ts # Zustand store (768 lines)
├── config.ts            # Game constants (CoinType, crypto symbols)
└── scenes/
    └── TradingScene.ts  # Phaser scene (1289 lines)
```

## Exported Types (from types/trading.ts)

All core HFT Battle types are centralized in `frontend/game/types/trading.ts`:

| Type | Purpose | Exported |
|------|---------|----------|
| `CoinType` | 'call' \| 'put' \| 'gas' \| 'whale' | ✅ Yes |
| `Player` | Player state (dollars, score, scene dimensions) | ✅ Yes |
| `CoinSpawnEvent` | Server coin spawn event | ✅ Yes |
| `SliceEvent` | Server slice event | ✅ Yes |
| `OrderPlacedEvent` | Active order with 10s countdown | ✅ Yes |
| `SettlementEvent` | Settlement result after timer expires | ✅ Yes |
| `MatchFoundEvent` | Two players matched | ✅ Yes |
| `RoundStartEvent` | Round start notification | ✅ Yes |
| `RoundEndEvent` | Round end with summary | ✅ Yes |
| `GameOverEvent` | Game over with round history | ✅ Yes |
| `RoundSummary` | Per-round results for game over modal | ✅ Yes |
| `PriceData` | Binance price data | ✅ Yes |

## Missing Type Exports

The following types are defined but NOT exported from `types/trading.ts`:

| Type | Defined In | Used In | Issue |
|------|------------|---------|-------|
| `CoinConfig` | `config.ts` | `Token.ts`, `TradingScene.ts` | Inconsistent location |
| `CryptoSymbol` | `config.ts` (implied) | `trading-store.ts` | Not in types file |
| `Whale2XActivatedData` | Store/event | Multiple components | Event type not exported |

**Impact**: Type resolution requires importing from implementation files rather than type definitions.

## Recommendations

### 1. Consolidate All Types in types/trading.ts

Move these type definitions from `config.ts` to `types/trading.ts`:

```typescript
// Currently in config.ts - should move to types/trading.ts
export type CoinConfig = {
  type: CoinType
  color: number
  symbol: string
}

export type CryptoSymbol = 'btcusdt' | 'ethusdt' | 'solusdt'
```

### 2. Export Event Types

Add to `types/trading.ts`:

```typescript
export type Whale2XActivatedData = {
  playerId: string
  playerName: string
  durationMs: number
}
```

### 3. Type Naming Conventions

Current naming is inconsistent:

| Pattern | Examples | Recommendation |
|---------|----------|----------------|
| Event suffix | `CoinSpawnEvent`, `SliceEvent` | Keep - clear event types |
| Config suffix | `CoinConfig` | Keep - configuration objects |
| Data suffix | `Whale2XActivatedData` | Change to `Whale2XActivatedEvent` for consistency |

## Type Import Patterns

### Preferred Pattern (not yet implemented)

```typescript
// All types from single source
import type { CoinType, Player, CoinSpawnEvent, OrderPlacedEvent } from '@/game/types/trading'
```

### Current Pattern (scattered imports)

```typescript
// Core types from types/
import type { CoinType, Player } from '@/game/types/trading'

// Game constants from config (includes types)
import { COIN_CONFIGS, BTC_USDT_SYMBOL } from '@/game/config'

// Store types implied from usage
import type { Whale2XActivatedData } from '@/game/stores/trading-store' // NOT exported
```

## Related Documentation

- `.claude/rules/game-design.md` - Game mechanics that types model
- `.claude/rules/frontend.md` - Frontend architecture and conventions
