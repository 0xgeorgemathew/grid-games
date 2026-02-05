// Yellow Network state channel types for HFT Battle
// MVP: Server-side signing, simple state tracking

export type ChannelStatus = 'INITIAL' | 'ACTIVE' | 'FINAL' | 'DISPUTED'

export interface Allocation {
  participant: string // Wallet address
  asset: 'usdc'
  amount: string // 6 decimals (1 USDC = "1000000")
}

export interface PlayerInfo {
  address: string
  name: string
  connected: boolean
}

export interface ChannelState {
  version: number
  status: ChannelStatus
  channelId: string
  createdAt: number

  // Game-specific state
  currentRound: number
  player1Wins: number
  player2Wins: number
  lastUpdate: number

  // Financial state (Yellow format)
  allocations: Allocation[]

  // Metadata
  players: PlayerInfo[]
}

export interface ChannelCreateRequest {
  player1Address: string
  player1Name: string
  player2Address: string
  player2Name: string
  stakeAmount: string // USDC amount with 6 decimals, e.g., "1000000" = 1 USDC
}

export interface ChannelCreateResponse {
  channelId: string
  initialState: ChannelState
  depositTxHash?: string
}

export interface ChannelDepositResponse {
  channelId: string
  status: ChannelStatus
  bothDeposited: boolean
}

export interface StateUpdateRequest {
  channelId: string
  version: number
  allocations: Allocation[]
  roundResults?: {
    roundNumber: number
    winnerId: string
    player1Dollars: number
    player2Dollars: number
  }
}

export interface StateUpdateResponse {
  channelId: string
  version: number
  status: ChannelStatus
  signature?: string
}

export interface ChannelSettleResponse {
  channelId: string
  finalState: ChannelState
  settleTxHash: string
  player1Payout: string
  player2Payout: string
}
