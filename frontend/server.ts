import { createServer } from 'node:http'
import next from 'next'
import { initializeSocketIO } from './app/api/socket/route'

const dev = process.env.NODE_ENV !== 'production'
const hostname = process.env.HOSTNAME || (dev ? 'localhost' : '0.0.0.0')
const port = parseInt(process.env.PORT || '3000', 10)

const app = next({ dev, hostname, port })
const handler = app.getRequestHandler()

app.prepare().then(() => {
  const httpServer = createServer(handler)

  // Initialize Socket.IO server using the API route export
  initializeSocketIO(httpServer)

  httpServer
    .once('error', (err) => {
      console.error('Failed to start server:', err)
      process.exit(1)
    })
    .listen(port, hostname, () => {
      console.log(`> Ready on http://${hostname}:${port}`)
      console.log('> Socket.IO server attached')
    })
})
