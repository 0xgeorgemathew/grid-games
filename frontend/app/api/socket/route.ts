import { NextRequest } from 'next/server'
import { Server as SocketIOServer } from 'socket.io'
import { Server as HTTPServer } from 'node:http'
import { Socket } from 'socket.io'
import { setupGameEvents } from './game-events'
import { nitroliteHandlers } from '@/lib/yellow/nitrolite-socket'

// Type for Nitrolite handlers
type NitroliteHandler = (socket: Socket, ...args: any[]) => Promise<void>

// Global singleton for Socket.IO server (attached to custom server)
declare global {
  var _socketIOServer: SocketIOServer | undefined
  var _socketIOCleanup: (() => void) | undefined
}

export const runtime = 'nodejs'

// GET handler - Socket.IO attaches as side-effect via upgrade request
export async function GET(req: NextRequest) {
  // This route exists solely for Socket.IO attachment
  // The actual WebSocket upgrade happens via the custom server in server.ts
  return new Response('Socket.IO server running on custom server', {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  })
}

// Export for use by custom server
// Returns: io instance, cleanup function, and RoomManager for emergency shutdown
export function initializeSocketIO(httpServer: HTTPServer): {
  io: SocketIOServer
  cleanup: () => void
  emergencyShutdown: () => void
} {
  if (global._socketIOServer) {
    return {
      io: global._socketIOServer,
      cleanup: global._socketIOCleanup || (() => {}),
      emergencyShutdown: () => {},
    }
  }

  // In production, use ALLOWED_ORIGINS or RAILWAY_PUBLIC_DOMAIN, otherwise use wildcard fallback for Railway
  const isProd = process.env.NODE_ENV === 'production'
  const originConfig = isProd
    ? process.env.ALLOWED_ORIGINS?.split(',') ||
      (process.env.RAILWAY_PUBLIC_DOMAIN ? [`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`] : ['*'])
    : process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000']

  // Warn if using wildcard in production
  if (isProd && originConfig.includes('*')) {
    console.warn(
      '[Socket.IO] Using wildcard CORS origin (*) - Set ALLOWED_ORIGINS or RAILWAY_PUBLIC_DOMAIN env var for production security'
    )
  }

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: originConfig,
      methods: ['GET', 'POST'],
      credentials: true,
    },
  })

  const { cleanup, emergencyShutdown } = setupGameEvents(io)

  // Register Nitrolite handlers
  io.on('connection', (socket) => {
    // Register each Nitrolite handler
    Object.entries(nitroliteHandlers).forEach(([event, handler]) => {
      socket.on(event, async (...args: any[]) => {
        try {
          // Handlers expect (socket: Socket, ...params) => Promise<void>
          await (handler as NitroliteHandler)(socket, ...args)
        } catch (error) {
          console.error(`[Nitrolite] Error in ${event}:`, error)
          socket.emit('nitrolite_error', {
            error: error instanceof Error ? error.message : 'Unknown error',
            event,
          })
        }
      })
    })
  })

  global._socketIOServer = io
  global._socketIOCleanup = cleanup

  return { io, cleanup, emergencyShutdown }
}

// Export cleanup function for graceful shutdown
export function cleanupSocketIO(): void {
  if (global._socketIOCleanup) {
    global._socketIOCleanup()
    global._socketIOCleanup = undefined
  }
  global._socketIOServer = undefined
}
