# Price & Settlement Architecture

## Design Philosophy

**Simplicity over precision**: Always use latest available price, not historical price at exact timestamp.

## Data Flow

```
Binance WebSocket (aggTrade stream)
        ↓
┌───────────────────────────────────────┐
│  Server (game-events.ts)              │
│  - PriceFeedManager.getLatestPrice()  │
│  - Settlement uses latest price        │
└───────────────┬───────────────────────┘
                │
      Settlement Event
        { finalPrice }
                ↓
┌───────────────────────────────────────┐
│  Client (trading-store.ts)            │
│  - Separate Binance connection        │
│  - UI displays real-time prices        │
└───────────────────────────────────────┘
```

## Key Principles

1. **Latest Price Only**: Never search by timestamp
2. **Server Authority**: Server calculates all settlements
3. **Dual Connections**: Server and client maintain separate Binance connections
4. **Simple Resolution**: `finalPrice - priceAtOrder` determines winner

## Why This Works

- **Reliability**: No timestamp lookups, no clock drift, no buffer underruns
- **Simplicity**: Easy to understand, test, and maintain
- **User Experience**: Settlements always work, game never breaks
- **Fairness**: Both players affected equally by price selection
