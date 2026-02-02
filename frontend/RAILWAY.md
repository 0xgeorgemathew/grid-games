# Railway Deployment Guide

This document covers deployment configuration for Railway.

## Environment Variables

### Required

| Variable   | Description                     | Example      |
| ---------- | ------------------------------- | ------------ |
| `NODE_ENV` | Set to `production` for Railway | `production` |

### Optional (Recommended)

| Variable                | Description                                                     | Example                                           |
| ----------------------- | --------------------------------------------------------------- | ------------------------------------------------- |
| `ALLOWED_ORIGINS`       | Comma-separated list of allowed CORS origins                    | `https://your-domain.com,https://app.railway.app` |
| `RAILWAY_PUBLIC_DOMAIN` | Auto-set by Railway, used for CORS if `ALLOWED_ORIGINS` not set | `your-app.railway.app`                            |
| `DEBUG_FUNDS`           | Enable fund transfer logging (set `true` for debugging)         | `true`                                            |

### CORS Configuration

The Socket.IO server uses the following priority for CORS origins in production:

1. `ALLOWED_ORIGINS` environment variable (if set)
2. `RAILWAY_PUBLIC_DOMAIN` with `https://` prefix (auto-set by Railway)
3. Wildcard `*` (fallback, shows warning in logs)

**Warning:** Using wildcard CORS (`*`) is not recommended for production. Set `ALLOWED_ORIGINS` explicitly.

## Health Check

Railway uses `/api/health` for health checks. The endpoint returns:

```json
{
  "status": "healthy",
  "timestamp": "2025-01-01T00:00:00.000Z",
  "uptime": 123.456
}
```

Configuration in `railway.json`:

- Health check path: `/api/health`
- Grace period: 30 seconds (allows app to start before checks begin)

## Scene Dimensions

The game client sends scene dimensions (`sceneWidth`, `sceneHeight`) when matchmaking. This allows the server to spawn coins at dynamic positions relative to the client's viewport size.

- Default fallback: 500x800 (if dimensions not sent)
- Spawn position: `sceneHeight + 100` (100px below viewport bottom)
- X position: Random with 100px margins from edges

## Troubleshooting

### Coins Not Appearing

If coins don't appear after deployment:

1. Check browser console for Phaser errors
2. Verify scene dimensions are sent in `find_match` event
3. Check server logs for `spawnCoin` calls
4. Verify `/api/health` returns 200 OK

### Swipe Gestures Not Working

If swipe gestures don't respond:

1. Check browser console for `NaN` velocity warnings (should be none after fix)
2. Ensure `pointer.velocity` is initialized before use
3. Test with mouse and touch input

### CORS Errors

If Socket.IO connection fails:

1. Set `ALLOWED_ORIGINS` to your domain
2. Check Railway logs for CORS warnings
3. Verify `RAILWAY_PUBLIC_DOMAIN` is set (auto-populated by Railway)

## Deployment Commands

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Initialize (if not already configured)
railway init

# Deploy
railway up

# View logs
railway logs

# Open live URL
railway domain
```

## Local Testing

To test Railway configuration locally:

```bash
# Simulate production environment
NODE_ENV=production ALLOWED_ORIGINS=http://localhost:3000 bun run dev

# Test health endpoint
curl http://localhost:3000/api/health
```
