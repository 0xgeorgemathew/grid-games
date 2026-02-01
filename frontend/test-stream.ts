// Run with: bun run test-stream.ts

const STREAM_URL = 'wss://stream.binance.com:9443/ws/btcusdt@aggTrade'

// ANSI Colors for Console
const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const RESET = '\x1b[0m'
const DIM = '\x1b[2m'

console.log(`${DIM}Connecting to Binance Stream (HFT Battle Config)...${RESET}`)

const ws = new WebSocket(STREAM_URL)

ws.onopen = () => {
  console.log(`${GREEN}✅ Connected! Listening for BTC/USDT trades...${RESET}\n`)
  console.log('TYPE  | PRICE        | SIZE       | VALUE')
  console.log('------------------------------------------------')
}

ws.onmessage = (event) => {
  try {
    const raw = JSON.parse(event.data.toString())

    // 1. Process Raw Data -> Game Format
    // 'm' (isBuyerMaker) = true means the MAKER was a BUYER, so the TAKER SOLD.
    // Therefore: m:true = SELL (Red), m:false = BUY (Green)
    const isSell = raw.m

    const trade = {
      price: parseFloat(raw.p),
      size: parseFloat(raw.q),
      side: isSell ? 'SELL' : 'BUY',
      time: raw.T,
    }

    // 2. Format Output (What you want to see)
    const color = isSell ? RED : GREEN
    const sideStr = isSell ? 'SELL' : 'BUY ' // padded
    const priceStr = trade.price.toFixed(2)
    const valueStr = (trade.price * trade.size).toFixed(2)

    // Only show significant trades to reduce noise (optional game logic)
    // or just log everything to test the stream speed
    console.log(
      `${color}${sideStr}  $${priceStr}   ${trade.size.toFixed(4)} BTC   ($${valueStr})${RESET}`
    )
  } catch (err) {
    console.error('Parse Error:', err)
  }
}

ws.onerror = (error) => {
  // Common in India/Bangalore due to ISP blocks
  console.error(`${RED}❌ WebSocket Error.${RESET}`)
  console.error(`${DIM}If this hangs or fails immediately, try turning on a VPN.${RESET}`)
}

ws.onclose = () => {
  console.log('\nConnection Closed.')
}
