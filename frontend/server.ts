import { createServer } from 'node:http'
import next from 'next'
import { initializeSocketIO, cleanupSocketIO } from './app/api/socket/route'

const dev = process.env.NODE_ENV !== 'production'
const hostname = process.env.HOSTNAME || (dev ? 'localhost' : '0.0.0.0')
const port = parseInt(process.env.PORT || '3000', 10)

const app = next({ dev, hostname, port })
const handler = app.getRequestHandler()

// Store emergency shutdown for error handling
let emergencyShutdown: (() => void) | undefined

app.prepare().then(() => {
  const httpServer = createServer(handler)

  // Initialize Socket.IO server using the API route export
  const socketIO = initializeSocketIO(httpServer)
  emergencyShutdown = socketIO.emergencyShutdown

  httpServer
    .once('error', (err) => {
      console.error('Failed to start server:', err)
      // Cleanup Socket.IO before exit
      cleanupSocketIO()
      process.exit(1)
    })
    .listen(port, hostname, () => {
      console.log(`> Ready on http://${hostname}:${port}`)
      console.log('> Socket.IO server attached')
    })

  // Graceful shutdown - settle pending orders before closing
  const shutdown = (signal: string) => {
    console.log(`\n${signal} received, shutting down gracefully...`)

    // First, settle all pending orders in active games
    if (emergencyShutdown) {
      emergencyShutdown()
    }

    // Then cleanup Socket.IO
    cleanupSocketIO()

    // Finally close HTTP server
    httpServer.close(() => {
      console.log('> Server closed')
      process.exit(0)
    })

    // Force shutdown after 10s (should be plenty for settlement)
    setTimeout(() => process.exit(1), 10000)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
})
