import { NextRequest } from 'next/server'
import { Server as SocketIOServer } from 'socket.io'
import { Server as HTTPServer } from 'node:http'
import { setupGameEvents } from './game-events'

// Global singleton for Socket.IO server (attached to custom server)
declare global {
  var _socketIOServer: SocketIOServer | undefined
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
export function initializeSocketIO(httpServer: HTTPServer): SocketIOServer {
  if (global._socketIOServer) {
    return global._socketIOServer
  }

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
      methods: ['GET', 'POST'],
      credentials: true,
    },
  })

  setupGameEvents(io)
  global._socketIOServer = io

  return io
}
