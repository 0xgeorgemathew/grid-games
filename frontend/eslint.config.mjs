import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const nextConfig = require('eslint-config-next')

const config = [{ ignores: ['.next/**'] }, ...nextConfig]

export default config
