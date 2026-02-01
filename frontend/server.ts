import { createServer } from 'node:http'
import next from 'next'
import { initializeSocketIO } from './app/api/socket/route'

const dev = process.env.NODE_ENV !== 'production'
const hostname = 'localhost'
const port = parseInt(process.env.PORT || '3000', 10)

const app = next({ dev, hostname, port })
const handler = app.getRequestHandler()

app.prepare().then(() => {
  const httpServer = createServer(handler)

  // Initialize Socket.IO server using the API route export
  initializeSocketIO(httpServer)

  httpServer
    .once('error', (err) => {
      console.error(err)
      process.exit(1)
    })
    .listen(port, () => {
      // Server ready
    })
})
