import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const nextConfig = require('eslint-config-next')

// eslint-config-next v16+ exports flat config format directly
export default nextConfig
