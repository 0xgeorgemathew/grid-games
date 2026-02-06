/**
 * ENS Hooks for Grid Games
 * 
 * Mixed mode implementation:
 * - Reads: Ethers.js
 * - Register: Server API
 * - SetLeverage: Client-Side (Privy useSendTransaction for Gas Sponsorship)
 */

'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { usePrivy, useWallets, useSendTransaction } from '@privy-io/react-auth'
import { ethers } from 'ethers'
import { encodeFunctionData, type Hex, type Address } from 'viem'
import { baseSepolia } from 'viem/chains'
import {
  L2_REGISTRAR,
  L2_REGISTRY,
  registryAbi,
  validateUsername,
  LEVERAGE_KEY,
  type LeverageOption,
} from '@/lib/ens'

// Base Sepolia RPC URL
const BASE_SEPOLIA_RPC = 'https://sepolia.base.org'

// Create ethers provider for reads
function getProvider() {
  return new ethers.JsonRpcProvider(BASE_SEPOLIA_RPC)
}

// Registrar ABI (ethers format)
const REGISTRAR_ABI_ETHERS = [
  'function getFullName(address addr) view returns (string)',
  'function getName(address addr) view returns (string)',
  'function available(string label) view returns (bool)',
  'function register(string label, address owner)',
]

// Registry ABI (ethers format)
const REGISTRY_ABI_ETHERS = [
  'function text(bytes32 node, string key) view returns (string)',
  'function setText(bytes32 node, string key, string value)',
  'function baseNode() view returns (bytes32)',
  'function makeNode(bytes32 parentNode, string label) pure returns (bytes32)',
]

// Get registrar contract (ethers)
function getRegistrarContract() {
  return new ethers.Contract(L2_REGISTRAR, REGISTRAR_ABI_ETHERS, getProvider())
}

// Get registry contract (ethers)
function getRegistryContract() {
  return new ethers.Contract(L2_REGISTRY, REGISTRY_ABI_ETHERS, getProvider())
}

/**
 * Hook to check if user has a name (reverse resolution)
 */
export function useUserName(address: string | undefined) {
  const [name, setName] = useState<string | null>(null)
  const [label, setLabel] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [hasChecked, setHasChecked] = useState(false)

  const refresh = useCallback(async () => {
    if (!address) {
      setName(null)
      setLabel(null)
      setHasChecked(true)
      return
    }

    setHasChecked(false)
    setIsLoading(true)
    try {
      const contract = getRegistrarContract()
      
      const fullName = await contract.getFullName(address)

      if (fullName && fullName.length > 0) {
        setName(fullName)
        setLabel(fullName.split('.')[0])
      } else {
        setName(null)
        setLabel(null)
      }
    } catch (error) {
      console.error('Error fetching name:', error)
      setName(null)
      setLabel(null)
    } finally {
      setIsLoading(false)
      setHasChecked(true)
    }
  }, [address])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { name, label, isLoading, hasChecked, hasName: !!name, refresh }
}

/**
 * Hook to check availability
 */
export function useCheckAvailability(label: string) {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!label || label.length < 3) {
      setAvailable(null)
      setError(null)
      return
    }

    const validation = validateUsername(label)
    if (!validation.isValid) {
      setAvailable(false)
      setError(validation.error || 'Invalid username')
      return
    }

    const checkAvailability = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const contract = getRegistrarContract()
        const isAvailable = await contract.available(label.toLowerCase())
        setAvailable(isAvailable)
        if (!isAvailable) {
          setError('Username is already taken')
        }
      } catch (err) {
        console.error('Error checking availability:', err)
        setAvailable(null)
        setError('Failed to check availability')
      } finally {
        setIsLoading(false)
      }
    }

    const timeout = setTimeout(checkAvailability, 300)
    return () => clearTimeout(timeout)
  }, [label])

  return { available, isLoading, error }
}

/**
 * Hook to register subdomain via SERVER API
 */
export function useRegisterSubdomain() {
  const [isRegistering, setIsRegistering] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<Hex | null>(null)

  const { user } = usePrivy()

  const isMountedRef = useRef(true)
  useEffect(() => {
    isMountedRef.current = true
    return () => { isMountedRef.current = false }
  }, [])

  const register = useCallback(async (label: string): Promise<boolean> => {
    if (!user?.id || !user?.wallet?.address) {
      setError('Please login first')
      return false
    }

    const validation = validateUsername(label)
    if (!validation.isValid) {
      setError(validation.error || 'Invalid username')
      return false
    }

    const normalizedLabel = label.toLowerCase()

    setIsRegistering(true)
    setError(null)
    setTxHash(null)

    try {
      // 1. Check availability
      const contract = getRegistrarContract()
      const isAvailable = await contract.available(normalizedLabel)

      if (!isAvailable) {
        setError('Username is already taken')
        setIsRegistering(false)
        return false
      }

      // 2. Call Server API
      const response = await fetch('/api/ens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'register',
          userId: user.id,
          userWalletAddress: user.wallet.address,
          label: normalizedLabel,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Registration failed')
      }

      if (!isMountedRef.current) return false

      if (data.hash) {
        setTxHash(data.hash as Hex)
      }

      if (isMountedRef.current) {
        setIsRegistering(false)
      }
      return true
    } catch (err: unknown) {
      console.error('Error registering subdomain:', err)
      if (isMountedRef.current) {
        const errorMessage = err instanceof Error ? err.message : 'Registration failed'
        setError(errorMessage)
        setIsRegistering(false)
      }
      return false
    }
  }, [user])

  return { register, isRegistering, error, txHash }
}

/**
 * Hook to get leverage text record (Readers via Ethers)
 */
export function useGetLeverage(label: string | null) {
  const [leverage, setLeverage] = useState<LeverageOption | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!label) {
      setLeverage(null)
      return
    }

    setIsLoading(true)
    try {
      const registry = getRegistryContract()
      const baseNode = await registry.baseNode()
      const node = await registry.makeNode(baseNode, label.toLowerCase())
      const text = await registry.text(node, LEVERAGE_KEY)

      if (text && text.length > 0) {
        setLeverage(text as LeverageOption)
      } else {
        setLeverage(null)
      }
    } catch (err) {
      console.error('Error getting leverage:', err)
      setLeverage(null)
    } finally {
      setIsLoading(false)
    }
  }, [label])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { leverage, isLoading, refresh }
}

/**
 * Hook to set leverage via CLIENT-SIDE transaction
 * Uses Privy useSendTransaction for Gas Sponsorship
 */
export function useSetLeverage() {
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<Hex | null>(null)

  const { user } = usePrivy()
  const { wallets } = useWallets()

  // Local state since useSendTransaction might not expose 'state' in all versions
  const [isProcessing, setIsProcessing] = useState(false)

  // Use Privy's hook for sending transactions
  const { sendTransaction } = useSendTransaction({
    onError: (err) => {
      console.error('Privy transaction error:', err)
      setIsProcessing(false)
      // err might be string or object
      setError(String(err))
    },
    onSuccess: (res) => {
      console.log('Transaction success:', res)
      setIsProcessing(false)
    }
  })

  // Derived isSetting state
  const isSetting = isProcessing

  const isMountedRef = useRef(true)
  useEffect(() => {
    isMountedRef.current = true
    return () => { isMountedRef.current = false }
  }, [])

  const setLeverage = useCallback(async (label: string, leverage: LeverageOption): Promise<boolean> => {
    if (!user?.wallet?.address) {
      setError('Please login first')
      return false
    }

    const wallet = wallets.find(w => w.address === user.wallet?.address) || wallets[0]
    if (!wallet) {
      setError('No wallet found')
      return false
    }

    setIsProcessing(true)
    setError(null)
    setTxHash(null)

    try {
      // 1. Calculate Node
      // Use ethers for read safety
      const registry = getRegistryContract()
      const baseNode = await registry.baseNode()
      const node = await registry.makeNode(baseNode, label.toLowerCase())

      // 2. Send transaction via Privy hook (Sponsored)
      
      // Encode data
      const data = encodeFunctionData({
        abi: registryAbi,
        functionName: 'setText',
        args: [node, LEVERAGE_KEY, leverage],
      })

      // Switch chain logic not strictly needed if sendTransaction handles checks,
      // but Privy sendTransaction docs say: "If the user is on the wrong chain, they will be prompted to switch."
      // BUT for gasless/embedded wallet, it might better to switch explicitly just in case.
      const chainId = Number(wallet.chainId.split(':')[1])
      if (chainId !== baseSepolia.id) {
        await wallet.switchChain(baseSepolia.id)
      }

      // Send
      // Note: sendTransaction follows { to, data, value, chainId? }, { address, sponsor }
      const receipt = await sendTransaction(
        {
          to: L2_REGISTRY as Address,
          data,
          chainId: baseSepolia.id
        },
        {
          uiOptions: {
            description: 'Set Leverage',
            buttonText: 'Confirm',
          },
          address: wallet.address as Address,
          sponsor: true,
        } as any
      )
      
      // If receipt has hash
      const hash = (receipt as any).hash as Hex
      
      if (isMountedRef.current) {
        setTxHash(hash)
      }
      return true
    } catch (err: unknown) {
      console.error('Error setting leverage:', err)
      setIsProcessing(false)
      if (isMountedRef.current) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to set leverage'
        setError(errorMessage)
      }
      return false
    }
  }, [user, wallets, sendTransaction])

  return { setLeverage, isSetting, error, txHash }
}

// Legacy export
export { useUserName as useCheckUsername }
