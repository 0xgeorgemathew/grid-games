// Yellow Network App Session Events
// Socket.IO event handlers for Yellow App Sessions (off-chain state management)

import { Server as SocketIOServer } from 'socket.io'
import { Socket } from 'socket.io'
import type { Address } from 'viem'

import { getRPCClient } from '@/lib/yellow/rpc-client'
import { YELLOW_TOKEN, YELLOW_APPLICATION_NAME, APP_SESSION_CONFIG } from '@/lib/yellow/config'

import {
  authenticate,
  reAuthenticate,
  isSessionExpired,
  getSessionTimeRemaining,
  formatSessionDuration,
  type AuthenticatedSession,
} from '@/lib/yellow/authentication'

import {
  createGameAppSession,
  createSessionKeySigner,
  prepareAppSessionParams,
  type GameAppSession,
  type HFTBattleGameState,
  type CreateGameSessionParams,
} from '@/lib/yellow/app-session-manager'

// =============================================================================
// Types
// ============================================================================

/**
 * Player authentication data
 */
interface PlayerAuthData {
  walletAddress: Address
  isAuthenticated: boolean
  authSession?: AuthenticatedSession
  sessionExpiresAt?: number
  walletSigner?: (params: {
    domain: { name: string }
    types: any
    primaryType: string
    message: any
  }) => Promise<string>
}

/**
 * Pending signature collection for round updates
 */
interface PendingSignatureCollection {
  method: 'submit_app_state' | 'close_app_session' | 'create_app_session'
  requestId: number
  timestamp: number
  payloadString: string
  sortedAddresses: Address[]
  signatures: Map<Address, string> // Maps address to signature
  resolve: (value: { signatures: string[]; requestId: number; timestamp: number }) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

/**
 * App session room data
 */
interface AppSessionRoom {
  id: string
  player1Id: string
  player2Id: string
  player1Address: Address
  player2Address: Address
  player1Name: string
  player2Name: string
  appSession?: GameAppSession
  gameState: HFTBattleGameState
  status: 'authenticating' | 'creating' | 'active' | 'settling' | 'closed'
  createdAt: number
}

// =============================================================================
// Room Management
// ============================================================================

class AppSessionRoomManager {
  private rooms = new Map<string, AppSessionRoom>()
  private playerAuth = new Map<string, PlayerAuthData>()
  private socketToPlayer = new Map<string, string>()
  // Track pending signature collections for round updates
  private pendingSignatureCollections = new Map<string, PendingSignatureCollection>()

  createRoom(params: {
    id: string
    player1Id: string
    player2Id: string
    player1Address: Address
    player2Address: Address
    player1Name: string
    player2Name: string
  }): AppSessionRoom {
    const room: AppSessionRoom = {
      id: params.id,
      player1Id: params.player1Id,
      player2Id: params.player2Id,
      player1Address: params.player1Address,
      player2Address: params.player2Address,
      player1Name: params.player1Name,
      player2Name: params.player2Name,
      gameState: {
        game: 'hft-battle',
        mode: 'best-of-three',
        round: 0,
        player1Address: params.player1Address,
        player2Address: params.player2Address,
        player1Wins: 0,
        player2Wins: 0,
        player1Score: 10,
        player2Score: 10,
        status: 'active',
      },
      status: 'creating',
      createdAt: Date.now(),
    }

    this.rooms.set(params.id, room)
    this.socketToPlayer.set(params.player1Id, params.player1Address)
    this.socketToPlayer.set(params.player2Id, params.player2Address)

    return room
  }

  getRoom(roomId: string): AppSessionRoom | undefined {
    return this.rooms.get(roomId)
  }

  getRoomBySocket(socketId: string): AppSessionRoom | undefined {
    for (const room of this.rooms.values()) {
      if (room.player1Id === socketId || room.player2Id === socketId) {
        return room
      }
    }
    return undefined
  }

  updateRoom(roomId: string, updates: Partial<AppSessionRoom>): void {
    const room = this.rooms.get(roomId)
    if (room) {
      Object.assign(room, updates)
    }
  }

  deleteRoom(roomId: string): void {
    const room = this.rooms.get(roomId)
    if (room) {
      this.socketToPlayer.delete(room.player1Id)
      this.socketToPlayer.delete(room.player2Id)
    }
    this.rooms.delete(roomId)
  }

  setPlayerAuth(socketId: string, authData: PlayerAuthData): void {
    this.playerAuth.set(socketId, authData)
  }

  getPlayerAuth(socketId: string): PlayerAuthData | undefined {
    return this.playerAuth.get(socketId)
  }

  getPlayerAddress(socketId: string): Address | undefined {
    return this.playerAuth.get(socketId)?.walletAddress
  }

  cleanup(): void {
    this.rooms.clear()
    this.playerAuth.clear()
    this.socketToPlayer.clear()
    // Clean up any pending signature collections
    for (const collection of this.pendingSignatureCollections.values()) {
      clearTimeout(collection.timeout)
    }
    this.pendingSignatureCollections.clear()
  }

  /**
   * Request session key signatures from both players for round updates
   *
   * This creates a pending collection and emits requests to both players.
   * The promise resolves when both players have submitted their signatures.
   *
   * @param io - Socket.IO server instance
   * @param roomId - The room ID
   * @param method - The RPC method being called
   * @param params - The parameters for the RPC call
   * @returns Promise that resolves with both signatures in sorted address order
   */
  async requestSessionKeySignatures(
    io: SocketIOServer,
    roomId: string,
    method: 'submit_app_state' | 'close_app_session',
    params: any
  ): Promise<{ signatures: string[]; requestId: number; timestamp: number }> {
    const room = this.rooms.get(roomId)
    if (!room) {
      throw new Error('Room not found')
    }

    const requestId = Date.now()
    const timestamp = requestId
    const sortedAddresses = [
      room.player1Address.toLowerCase(),
      room.player2Address.toLowerCase(),
    ].sort() as Address[]

    // Build the payload that clients will sign
    const payload = [requestId, method, params, timestamp] as [number, string, any, number]
    const payloadString = JSON.stringify(payload)

    console.log('[App Session] Requesting session key signatures:', {
      method,
      requestId,
      timestamp,
      sortedAddresses,
      payloadString,
    })

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingSignatureCollections.delete(`${method}_${requestId}`)
        reject(new Error(`Signature collection timeout: ${method}`))
      }, 30000) // 30 second timeout

      const collection: PendingSignatureCollection = {
        method,
        requestId,
        timestamp,
        payloadString,
        sortedAddresses,
        signatures: new Map(),
        resolve,
        reject,
        timeout,
      }

      this.pendingSignatureCollections.set(`${method}_${requestId}`, collection)

      // Emit signature requests to both players
      const player1Socket = io.of('/').sockets.get(room.player1Id)
      const player2Socket = io.of('/').sockets.get(room.player2Id)

      const signatureRequest = {
        method,
        requestId,
        timestamp,
        payloadString,
        sortedAddresses,
      }

      if (player1Socket) {
        player1Socket.emit('yellow_request_session_key_signature', signatureRequest)
        console.log('[App Session] Sent signature request to player 1:', room.player1Id)
      }

      if (player2Socket) {
        player2Socket.emit('yellow_request_session_key_signature', signatureRequest)
        console.log('[App Session] Sent signature request to player 2:', room.player2Id)
      }
    })
  }

  /**
   * Handle incoming session key signature from a client
   *
   * @param socketId - The socket ID of the submitting player
   * @param data - The signature submission data
   * @returns True if the collection is complete (both signatures received)
   */
  handleSubmitSessionKeySignature(
    io: SocketIOServer,
    socketId: string,
    data: {
      method: 'submit_app_state' | 'close_app_session' | 'create_app_session'
      signature: string
      requestId: number
      timestamp: number
    }
  ): boolean {
    const requestKey = `${data.method}_${data.requestId}`
    const collection = this.pendingSignatureCollections.get(requestKey)

    if (!collection) {
      console.warn('[App Session] No pending signature collection for:', requestKey)
      return false
    }

    // Find which player submitted this signature
    const room = Array.from(this.rooms.values()).find(
      (r) => r.player1Id === socketId || r.player2Id === socketId
    )

    if (!room) {
      console.warn('[App Session] No room found for socket:', socketId)
      return false
    }

    const playerAddress = room.player1Id === socketId ? room.player1Address : room.player2Address
    collection.signatures.set(playerAddress.toLowerCase() as Address, data.signature)

    console.log('[App Session] Received session key signature:', {
      method: data.method,
      requestId: data.requestId,
      playerAddress: playerAddress.toLowerCase(),
      signaturePrefix: data.signature.slice(0, 10) + '...',
      collectedCount: collection.signatures.size,
      requiredCount: collection.sortedAddresses.length,
    })

    // Check if we have all signatures
    if (collection.signatures.size === collection.sortedAddresses.length) {
      clearTimeout(collection.timeout)

      // Build signatures array in sorted address order
      const signatures = collection.sortedAddresses.map(
        (addr) => collection.signatures.get(addr.toLowerCase() as Address)!
      )

      console.log('[App Session] All signatures collected:', {
        method: data.method,
        requestId: data.requestId,
        signatureCount: signatures.length,
      })

      collection.resolve({
        signatures,
        requestId: collection.requestId,
        timestamp: collection.timestamp,
      })
      this.pendingSignatureCollections.delete(requestKey)
      return true
    }

    return false
  }

  /**
   * Request wallet signatures from both players for create_app_session
   *
   * This creates a pending collection and emits requests to both players.
   * The promise resolves when both players have submitted their signatures.
   *
   * CRITICAL: Unlike session key signatures (used for submit_app_state),
   * create_app_session requires MAIN WALLET signatures because the
   * participants array contains wallet addresses per Yellow's spec.
   *
   * @param io - Socket.IO server instance
   * @param roomId - The room ID
   * @param method - The RPC method (create_app_session)
   * @param params - The signature request parameters
   * @returns Promise that resolves with both signatures in sorted address order
   */
  async requestWalletSignatures(
    io: SocketIOServer,
    roomId: string,
    method: 'create_app_session',
    params: {
      payloadString: string
      requestId: number
      timestamp: number
      sortedAddresses: Address[]
    }
  ): Promise<{ signatures: string[]; requestId: number; timestamp: number }> {
    const room = this.rooms.get(roomId)
    if (!room) {
      throw new Error('Room not found')
    }

    const { payloadString, requestId, timestamp, sortedAddresses } = params

    console.log('[App Session] Requesting wallet signatures:', {
      method,
      requestId,
      timestamp,
      sortedAddresses,
      payloadStringLength: payloadString.length,
    })

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingSignatureCollections.delete(`${method}_${requestId}`)
        reject(new Error(`Wallet signature collection timeout: ${method}`))
      }, 30000) // 30 second timeout

      const collection: PendingSignatureCollection = {
        method,
        requestId,
        timestamp,
        payloadString,
        sortedAddresses: sortedAddresses.map((a) => a.toLowerCase()) as Address[],
        signatures: new Map(),
        resolve,
        reject,
        timeout,
      }

      this.pendingSignatureCollections.set(`${method}_${requestId}`, collection)

      // Emit signature requests to both players
      const player1Socket = io.of('/').sockets.get(room.player1Id)
      const player2Socket = io.of('/').sockets.get(room.player2Id)

      // Determine which address belongs to which player
      const player1IsFirst = sortedAddresses[0].toLowerCase() === room.player1Address.toLowerCase()

      const signatureRequest = {
        method,
        requestId,
        timestamp,
        payloadString,
        sortedAddresses,
        // Tell each player which address is theirs
        yourAddress: room.player1Address.toLowerCase(),
      }

      if (player1Socket) {
        player1Socket.emit('yellow_request_wallet_signature', signatureRequest)
        console.log('[App Session] Sent wallet signature request to player 1:', {
          socketId: room.player1Id,
          yourAddress: room.player1Address.toLowerCase(),
          isInFirstPosition: player1IsFirst,
        })
      }

      if (player2Socket) {
        player2Socket.emit('yellow_request_wallet_signature', {
          ...signatureRequest,
          yourAddress: room.player2Address.toLowerCase(),
        })
        console.log('[App Session] Sent wallet signature request to player 2:', {
          socketId: room.player2Id,
          yourAddress: room.player2Address.toLowerCase(),
          isInFirstPosition: !player1IsFirst,
        })
      }
    })
  }

  /**
   * Handle incoming wallet signature from a client
   *
   * @param socketId - The socket ID of the submitting player
   * @param data - The signature submission data
   * @returns True if the collection is complete (both signatures received)
   */
  handleSubmitWalletSignature(
    io: SocketIOServer,
    socketId: string,
    data: {
      method: 'create_app_session'
      signature: string
      requestId: number
      timestamp: number
      address: Address // The wallet address that signed
    }
  ): boolean {
    const requestKey = `${data.method}_${data.requestId}`
    const collection = this.pendingSignatureCollections.get(requestKey)

    if (!collection) {
      console.warn('[App Session] No pending wallet signature collection for:', requestKey)
      return false
    }

    // Find which player submitted this signature
    const room = Array.from(this.rooms.values()).find(
      (r) => r.player1Id === socketId || r.player2Id === socketId
    )

    if (!room) {
      console.warn('[App Session] No room found for socket:', socketId)
      return false
    }

    // Verify the address matches the player's wallet address
    const playerAddress = room.player1Id === socketId ? room.player1Address : room.player2Address
    if (playerAddress.toLowerCase() !== data.address.toLowerCase()) {
      console.error('[App Session] Wallet address mismatch:', {
        socketId,
        expectedAddress: playerAddress.toLowerCase(),
        providedAddress: data.address.toLowerCase(),
      })
      return false
    }

    collection.signatures.set(playerAddress.toLowerCase() as Address, data.signature)

    console.log('[App Session] Received wallet signature:', {
      method: data.method,
      requestId: data.requestId,
      playerAddress: playerAddress.toLowerCase(),
      signaturePrefix: data.signature.slice(0, 10) + '...',
      collectedCount: collection.signatures.size,
      requiredCount: collection.sortedAddresses.length,
    })

    // Check if we have all signatures
    if (collection.signatures.size === collection.sortedAddresses.length) {
      clearTimeout(collection.timeout)

      // Build signatures array in sorted address order
      const signatures = collection.sortedAddresses.map(
        (addr) => collection.signatures.get(addr.toLowerCase() as Address)!
      )

      console.log('[App Session] All wallet signatures collected:', {
        method: data.method,
        requestId: data.requestId,
        signatureCount: signatures.length,
      })

      collection.resolve({
        signatures,
        requestId: collection.requestId,
        timestamp: collection.timestamp,
      })
      this.pendingSignatureCollections.delete(requestKey)
      return true
    }

    return false
  }
}

// =============================================================================
// Event Handlers
// ============================================================================

/**
 * Setup Yellow App Session event handlers
 */
export function setupAppSessionEvents(io: SocketIOServer, socket: Socket): void {
  const manager = new AppSessionRoomManager()

  /**
   * Authenticate with Yellow Network
   *
   * Flow:
   * 1. Client sends auth_request with wallet address
   * 2. Server generates session key
   * 3. Server calls auth_request (public endpoint)
   * 4. Server receives challenge
   * 5. Server asks client to sign EIP-712 challenge
   * 6. Client sends signature
   * 7. Server calls auth_verify
   * 8. Server receives JWT token
   */
  socket.on(
    'yellow_authenticate',
    async (
      data: {
        walletAddress: Address
        signTypedData?: (params: {
          domain: { name: string }
          types: any
          primaryType: string
          message: any
        }) => Promise<string>
      },
      callback
    ) => {
      try {
        const { walletAddress, signTypedData } = data

        console.log('[App Session] Authentication request from:', walletAddress)

        if (!walletAddress || !walletAddress.startsWith('0x')) {
          callback({ success: false, error: 'Invalid wallet address' })
          return
        }

        // Check if we can sign EIP-712 (should be done on client side)
        if (!signTypedData) {
          // Ask client to sign EIP-712 challenge
          callback({
            success: false,
            error: 'EIP-712 signing required',
            needsSignature: true,
            message: 'Please sign the authentication challenge with your wallet',
          })
          return
        }

        // Complete authentication flow
        const authSession = await authenticate(signTypedData, {
          address: walletAddress,
          application: YELLOW_APPLICATION_NAME,
          // Create mutable copy of allowances (APP_SESSION_CONFIG is readonly due to 'as const')
          allowances: [...APP_SESSION_CONFIG.allowances],
          scope: 'app.create,app.submit,transfer',
          sessionDuration: 60 * 60 * 1000, // 1 hour
        })

        // Store auth data including wallet signer for app session creation
        manager.setPlayerAuth(socket.id, {
          walletAddress,
          isAuthenticated: true,
          authSession,
          sessionExpiresAt: authSession.expiresAt,
          walletSigner: signTypedData,
        })

        // CRITICAL: Store JWT in RPC client for authenticated RPC calls
        // The JWT is required for submit_app_state, close_app_session, get_app_sessions
        const rpcClient = getRPCClient()
        rpcClient.setAuthToken(authSession.jwtToken)
        console.log('[App Session] JWT token stored in RPC client for authenticated calls')

        console.log('[App Session] Authentication successful:', {
          walletAddress,
          sessionKey: authSession.sessionKeyAddress,
          expiresIn: formatSessionDuration(authSession.expiresAt - Date.now()),
        })

        callback({
          success: true,
          walletAddress: authSession.address,
          sessionKey: authSession.sessionKeyAddress,
          expiresIn: authSession.expiresAt - Date.now(),
        })
      } catch (error) {
        console.error('[App Session] Authentication failed:', error)
        callback({
          success: false,
          error: error instanceof Error ? error.message : 'Authentication failed',
        })
      }
    }
  )

  /**
   * Re-authenticate with existing JWT
   */
  socket.on(
    'yellow_re_authenticate',
    async (
      data: {
        jwtToken: string
      },
      callback
    ) => {
      try {
        const { jwtToken } = data

        const result = await reAuthenticate(jwtToken)

        manager.setPlayerAuth(socket.id, {
          walletAddress: result.address as Address,
          isAuthenticated: true,
          sessionExpiresAt: Date.now() + 60 * 60 * 1000, // Assume 1 hour
        })

        // CRITICAL: Store JWT in RPC client for authenticated RPC calls
        const rpcClient = getRPCClient()
        rpcClient.setAuthToken(jwtToken)
        console.log('[App Session] JWT token stored in RPC client after re-authentication')

        callback({
          success: true,
          address: result.address,
        })
      } catch (error) {
        callback({
          success: false,
          error: error instanceof Error ? error.message : 'Re-authentication failed',
        })
      }
    }
  )

  /**
   * Create app session for a game
   */
  socket.on(
    'yellow_create_app_session',
    async (
      data: {
        player2SocketId: string
        stakeAmount?: number
      },
      callback
    ) => {
      try {
        const auth1 = manager.getPlayerAuth(socket.id)
        if (!auth1?.isAuthenticated) {
          callback({ success: false, error: 'Not authenticated' })
          return
        }

        const auth2 = manager.getPlayerAuth(data.player2SocketId)
        if (!auth2?.isAuthenticated || !auth2.walletAddress) {
          callback({ success: false, error: 'Opponent not authenticated' })
          return
        }

        const player1Address = auth1.walletAddress
        const player2Address = auth2.walletAddress

        console.log('[App Session] Creating app session:', {
          player1: player1Address,
          player2: player2Address,
        })

        // Notify opponent to sign
        const opponentSocket = io.of('/').sockets.get(data.player2SocketId)
        if (!opponentSocket) {
          callback({ success: false, error: 'Opponent not found' })
          return
        }

        // Create room
        const roomId = `appsession-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
        const room = manager.createRoom({
          id: roomId,
          player1Id: socket.id,
          player2Id: data.player2SocketId,
          player1Address,
          player2Address,
          player1Name: 'Player 1',
          player2Name: 'Player 2',
        })

        manager.updateRoom(roomId, { status: 'creating' })

        // Both players need to sign the creation request with their MAIN WALLETS
        // CRITICAL: create_app_session requires main wallet signatures, NOT session key signatures
        // Per Yellow's official docs: participants array contains wallet addresses,
        // so signatures must be from main wallets (not session keys)
        // Session keys are only used for subsequent submit_app_state/close_app_session calls
        //
        // Reference: https://docs.yellow.org/docs/protocol/off-chain/app-sessions
        // "Array of all participant wallet addresses"

        const stakeAmount = data.stakeAmount || 10 // Default 10 USDC

        try {
          // CRITICAL FIX: Prepare app session params with MAIN WALLET addresses as participants
          // Per Yellow's official spec, the participants array must contain wallet addresses.
          // The create_app_session call must be signed by main wallets (not session keys).
          const createParams = prepareAppSessionParams({
            player1Address,
            player2Address,
            stakeAmount,
            // Session key addresses are NOT used in participants array anymore
            // They're only needed for subsequent state updates
          })

          // Get the RPC client to build the request
          const rpcClient = getRPCClient()

          // Build the request payload that clients will sign
          const id = Date.now()
          const timestamp = id
          const method = 'create_app_session'
          const finalParams = [createParams] // create_app_session wraps params in array
          const payload = [id, method, finalParams, timestamp] as [number, string, unknown, number]
          const payloadString = JSON.stringify(payload)

          // The participants array contains sorted wallet addresses
          const walletAddresses = createParams.definition.participants as Address[]

          console.log('[App Session] Requesting wallet signatures for create_app_session:', {
            sortedWalletAddresses: walletAddresses,
            player1Wallet: player1Address,
            player2Wallet: player2Address,
          })

          // Request wallet signatures from both clients
          const { signatures } = await manager.requestWalletSignatures(
            io,
            roomId,
            'create_app_session',
            {
              payloadString,
              requestId: id,
              timestamp,
              sortedAddresses: walletAddresses,
            }
          )

          console.log('[App Session] Both wallet signatures received, calling create_app_session')

          // Call create_app_session with the collected signatures
          const response = await rpcClient.call<any>(
            'create_app_session',
            createParams,
            signatures,
            { requestId: id, timestamp }
          )

          // Extract app session data from response
          const appSessionId = response.app_session_id
          const status = response.status
          const version = response.version

          // Create game state for the room
          const gameState = {
            game: 'hft-battle' as const,
            mode: 'best-of-three' as const,
            round: 0,
            player1Address,
            player2Address,
            player1Wins: 0,
            player2Wins: 0,
            player1Score: 10, // Starting game dollars
            player2Score: 10,
            status: 'active' as const,
            lastMove: Date.now(),
          }

          // Create a minimal app session object for the room
          const appSession = {
            appSessionId,
            definition: createParams.definition,
            allocations: createParams.allocations,
            gameState,
            status,
            version,
            createdAt: Date.now(),
          }

          manager.updateRoom(roomId, {
            appSession,
            gameState,
            status: 'active',
          })

          console.log('[App Session] Created:', {
            appSessionId,
            status,
            version,
          })

          // Notify both players
          io.to(socket.id).emit('yellow_app_session_created', {
            roomId,
            appSessionId,
            gameState,
            youAre: 'player1',
          })

          io.to(data.player2SocketId).emit('yellow_app_session_created', {
            roomId,
            appSessionId,
            gameState,
            youAre: 'player2',
          })

          callback({
            success: true,
            roomId,
            appSessionId,
            gameState,
          })
        } catch (error) {
          console.error('[App Session] Creation failed:', error)
          manager.deleteRoom(roomId)
          callback({
            success: false,
            error: error instanceof Error ? error.message : 'Failed to create app session',
          })
        }
      } catch (error) {
        console.error('[App Session] Create handler error:', error)
        callback({
          success: false,
          error: error instanceof Error ? error.message : 'Internal error',
        })
      }
    }
  )

  /**
   * Update app session state after a round
   *
   * CRITICAL: This now properly collects session key signatures from BOTH players
   * before submitting to Yellow Network. Using the same signature for both players
   * will cause "unknown participant" errors.
   */
  socket.on(
    'yellow_update_round',
    async (
      data: {
        roomId: string
        round: number
        player1Score: number
        player2Score: number
        player1Wins: number
        player2Wins: number
      },
      callback
    ) => {
      try {
        const room = manager.getRoom(data.roomId)
        if (!room) {
          callback({ success: false, error: 'Room not found' })
          return
        }

        if (!room.appSession) {
          callback({ success: false, error: 'App session not found' })
          return
        }

        const auth1 = manager.getPlayerAuth(room.player1Id)
        const auth2 = manager.getPlayerAuth(room.player2Id)
        if (!auth1?.authSession || !auth2?.authSession) {
          callback({ success: false, error: 'Both players must be authenticated' })
          return
        }

        console.log('[App Session] Updating round:', {
          appSessionId: room.appSession.appSessionId,
          round: data.round,
        })

        // Set JWT token in RPC client for authenticated call
        const rpcClient = getRPCClient()
        if (auth1.authSession.jwtToken) {
          rpcClient.setAuthToken(auth1.authSession.jwtToken)
        }

        // Build the submit_app_state parameters
        // CRITICAL FIX: Use HUMAN-READABLE format per Yellow official docs
        // The docs specify: "Amount in human-readable format (e.g., '100.0')"
        const totalScore = data.player1Score + data.player2Score
        const totalPot = 20 // 20 USDC

        const player1Payout = (data.player1Score / totalScore) * totalPot
        const player2Payout = (data.player2Score / totalScore) * totalPot

        const sortedAddresses = [
          room.player1Address.toLowerCase(),
          room.player2Address.toLowerCase(),
        ].sort()
        const isPlayer1First = sortedAddresses[0] === room.player1Address.toLowerCase()

        const allocations = [
          {
            participant: sortedAddresses[0],
            asset: YELLOW_TOKEN,
            amount: String(isPlayer1First ? player1Payout : player2Payout),
          },
          {
            participant: sortedAddresses[1],
            asset: YELLOW_TOKEN,
            amount: String(isPlayer1First ? player2Payout : player1Payout),
          },
        ]

        const gameState = {
          game: 'hft-battle' as const,
          mode: 'best-of-three' as const,
          round: data.round,
          player1Address: room.player1Address,
          player2Address: room.player2Address,
          player1Wins: data.player1Wins,
          player2Wins: data.player2Wins,
          player1Score: data.player1Score,
          player2Score: data.player2Score,
          status: 'active' as const,
          lastMove: Date.now(),
        }

        const submitParams = {
          app_session_id: room.appSession.appSessionId,
          intent: 'operate' as const,
          version: (room.appSession.version || 1) + 1,
          allocations,
          session_data: JSON.stringify(gameState),
        }

        // CRITICAL: Request session key signatures from BOTH clients
        // Each client signs with their own session key, giving us 2 distinct signatures
        console.log('[App Session] Requesting session key signatures from both players')
        const { signatures, requestId, timestamp } = await manager.requestSessionKeySignatures(
          io,
          data.roomId,
          'submit_app_state',
          submitParams
        )

        console.log('[App Session] Both signatures collected, calling submit_app_state')

        // Call submit_app_state with both signatures
        const result = await rpcClient.call<any>('submit_app_state', submitParams, signatures, {
          requestId,
          timestamp,
        })

        // Update room state
        manager.updateRoom(data.roomId, {
          gameState: {
            ...room.gameState,
            round: data.round,
            player1Score: data.player1Score,
            player2Score: data.player2Score,
            player1Wins: data.player1Wins,
            player2Wins: data.player2Wins,
          },
          appSession: {
            ...room.appSession!,
            version: result.version,
            allocations: result.allocations || allocations,
          },
        })

        console.log('[App Session] Round updated:', {
          newVersion: result.version,
          allocations: result.allocations || allocations,
        })

        // Notify both players
        io.to(data.roomId).emit('yellow_round_updated', {
          appSessionId: room.appSession.appSessionId,
          version: result.version,
          allocations: result.allocations || allocations,
          gameState: room.gameState,
        })

        callback({
          success: true,
          version: result.version,
          allocations: result.allocations || allocations,
        })
      } catch (error) {
        console.error('[App Session] Round update failed:', error)
        callback({
          success: false,
          error: error instanceof Error ? error.message : 'Round update failed',
        })
      }
    }
  )

  /**
   * Close app session and settle
   *
   * CRITICAL: This now properly collects session key signatures from BOTH players
   * before closing the app session with Yellow Network.
   */
  socket.on(
    'yellow_close_session',
    async (
      data: {
        roomId: string
      },
      callback
    ) => {
      try {
        const room = manager.getRoom(data.roomId)
        if (!room) {
          callback({ success: false, error: 'Room not found' })
          return
        }

        if (!room.appSession) {
          callback({ success: false, error: 'App session not found' })
          return
        }

        const auth1 = manager.getPlayerAuth(room.player1Id)
        const auth2 = manager.getPlayerAuth(room.player2Id)
        if (!auth1?.authSession || !auth2?.authSession) {
          callback({ success: false, error: 'Both players must be authenticated' })
          return
        }

        console.log('[App Session] Closing session:', {
          appSessionId: room.appSession.appSessionId,
        })

        // Set JWT token in RPC client for authenticated call
        const rpcClient = getRPCClient()
        if (auth1.authSession.jwtToken) {
          rpcClient.setAuthToken(auth1.authSession.jwtToken)
        }

        // Determine winner
        const player1Won = room.gameState.player1Wins > room.gameState.player2Wins
        // CRITICAL FIX: Use HUMAN-READABLE format per Yellow official docs
        // The docs specify: "Amount in human-readable format (e.g., '100.0')"
        const totalPot = 20 // 20 USDC

        const sortedAddresses = [
          room.player1Address.toLowerCase(),
          room.player2Address.toLowerCase(),
        ].sort()
        const isPlayer1First = sortedAddresses[0] === room.player1Address.toLowerCase()

        const allocations = [
          {
            participant: sortedAddresses[0],
            asset: YELLOW_TOKEN,
            amount: String(
              (player1Won && isPlayer1First) || (!player1Won && !isPlayer1First) ? totalPot : 0
            ),
          },
          {
            participant: sortedAddresses[1],
            asset: YELLOW_TOKEN,
            amount: String(
              (player1Won && !isPlayer1First) || (!player1Won && isPlayer1First) ? totalPot : 0
            ),
          },
        ]

        const closeParams = {
          app_session_id: room.appSession.appSessionId,
          allocations,
          session_data: JSON.stringify(room.gameState),
        }

        // CRITICAL: Request session key signatures from BOTH clients
        console.log('[App Session] Requesting session key signatures from both players for close')
        const { signatures, requestId, timestamp } = await manager.requestSessionKeySignatures(
          io,
          data.roomId,
          'close_app_session',
          closeParams
        )

        console.log('[App Session] Both signatures collected, calling close_app_session')

        // Call close_app_session with both signatures
        const result = await rpcClient.call<any>('close_app_session', closeParams, signatures, {
          requestId,
          timestamp,
        })

        manager.updateRoom(data.roomId, { status: 'closed' })

        console.log('[App Session] Session closed:', {
          appSessionId: result.app_session_id,
          status: result.status,
        })

        // Notify both players
        io.to(data.roomId).emit('yellow_session_closed', {
          appSessionId: room.appSession.appSessionId,
          winnerAddress: player1Won ? room.player1Address : room.player2Address,
          loserAddress: player1Won ? room.player2Address : room.player1Address,
          finalScore: room.gameState,
          winnerPayout: totalPot.toFixed(2),
          loserPayout: '0.00',
        })

        callback({
          success: true,
          appSessionId: result.app_session_id,
          winnerAddress: player1Won ? room.player1Address : room.player2Address,
          loserAddress: player1Won ? room.player2Address : room.player1Address,
          winnerPayout: totalPot.toFixed(2),
          loserPayout: '0.00',
        })
      } catch (error) {
        console.error('[App Session] Close failed:', error)
        callback({
          success: false,
          error: error instanceof Error ? error.message : 'Session close failed',
        })
      }
    }
  )

  /**
   * Get session status
   */
  socket.on(
    'yellow_session_status',
    async (
      data: {
        roomId?: string
      },
      callback
    ) => {
      try {
        if (data.roomId) {
          const room = manager.getRoom(data.roomId)
          callback({
            success: true,
            room: room
              ? {
                  id: room.id,
                  status: room.status,
                  gameState: room.gameState,
                  appSessionId: room.appSession?.appSessionId,
                }
              : null,
          })
        } else {
          const auth = manager.getPlayerAuth(socket.id)
          callback({
            success: true,
            authenticated: auth?.isAuthenticated || false,
            walletAddress: auth?.walletAddress,
            sessionExpiresAt: auth?.sessionExpiresAt,
          })
        }
      } catch (error) {
        callback({
          success: false,
          error: error instanceof Error ? error.message : 'Status check failed',
        })
      }
    }
  )

  /**
   * Handle session key signature submission from clients
   *
   * This event is triggered when a client signs a request for round updates
   * or session closing. The server collects both signatures before proceeding.
   */
  socket.on(
    'yellow_session_key_signature_submit',
    async (data: {
      method: 'submit_app_state' | 'close_app_session' | 'create_app_session'
      signature: string
      requestId: number
      timestamp: number
    }) => {
      try {
        console.log('[App Session] Received session key signature from client:', {
          socketId: socket.id,
          method: data.method,
          signaturePrefix: data.signature.slice(0, 10) + '...',
          requestId: data.requestId,
          timestamp: data.timestamp,
        })

        const isComplete = manager.handleSubmitSessionKeySignature(io, socket.id, data)

        if (isComplete) {
          console.log('[App Session] Both signatures collected, request complete:', {
            method: data.method,
            requestId: data.requestId,
          })
        }
      } catch (error) {
        console.error('[App Session] Signature submission failed:', error)
      }
    }
  )

  /**
   * Handle wallet signature submission from clients
   *
   * This event is triggered when a client signs a request for app session creation.
   * The server collects both wallet signatures before proceeding.
   * CRITICAL: Unlike session key signatures, these are from main wallets.
   */
  socket.on(
    'yellow_wallet_signature_submit',
    async (data: {
      method: 'create_app_session'
      signature: string
      requestId: number
      timestamp: number
      address: Address // The wallet address that signed
    }) => {
      try {
        console.log('[App Session] Received wallet signature from client:', {
          socketId: socket.id,
          method: data.method,
          signaturePrefix: data.signature.slice(0, 10) + '...',
          requestId: data.requestId,
          timestamp: data.timestamp,
          address: data.address,
        })

        const isComplete = manager.handleSubmitWalletSignature(io, socket.id, data)

        if (isComplete) {
          console.log('[App Session] Both wallet signatures collected, request complete:', {
            method: data.method,
            requestId: data.requestId,
          })
        }
      } catch (error) {
        console.error('[App Session] Wallet signature submission failed:', error)
      }
    }
  )

  /**
   * Cleanup on disconnect
   */
  socket.on('disconnect', () => {
    // Note: Don't delete rooms immediately on disconnect
    // The other player may still be connected
    // Rooms will be cleaned up when both players disconnect or session is closed
  })
}

/**
 * Get the RPC client instance
 */
export function getAppSessionRPCClient() {
  return getRPCClient()
}

/**
 * Cleanup all app sessions
 */
export function cleanupAppSessions(manager: AppSessionRoomManager): void {
  manager.cleanup()
}
