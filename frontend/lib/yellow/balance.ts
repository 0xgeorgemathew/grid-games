/**
 * Yellow Offchain Balance Checker
 * ===============================
 *
 * Checks balance on Yellow Network's offchain ledger (not on-chain USDC).
 * Follows the pattern from scripts/check-yellow-balance.ts
 */

import { createGetLedgerBalancesMessage, RPCMethod, RPCResponse } from '@erc7824/nitrolite'
import { ENTRY_STAKE } from './config'

export async function checkUSDCBalance(
  yellowClient: any,  // Yellow Client instance
  messageSigner: any, // Message signer function
  walletAddress: string
): Promise<{ hasEnough: boolean; balance: string; formatted: string }> {
  try {
    // Create the balance query message
    const balanceMessage = await createGetLedgerBalancesMessage(messageSigner, walletAddress)

    // Set up a Promise to wait for the balance response
    const balancePromise = new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Balance query timeout'))
      }, 10000)

      // Listen for the response
      yellowClient.listen((message: RPCResponse) => {
        if (message.method === RPCMethod.GetLedgerBalances) {
          clearTimeout(timeout)
          // Transform snake_case response to camelCase
          const params = message.params as any
          resolve({
            ledgerBalances: params.ledger_balances || params.ledgerBalances || []
          })
        }
      })

      // Send the request
      yellowClient.sendMessage(balanceMessage).catch((error: any) => {
        clearTimeout(timeout)
        reject(error)
      })
    })

    const response = await balancePromise
    const balances = response.ledgerBalances

    // Find ytest.usd balance
    const ytestBalance = balances.find((b: any) => b.asset === 'ytest.usd')
    const balance = ytestBalance?.amount || '0'

    const required = parseFloat(ENTRY_STAKE) / 100 // Convert from cents
    const hasEnough = parseFloat(balance) >= required
    const formatted = parseFloat(balance).toFixed(2)

    return { hasEnough, balance, formatted }
  } catch (error) {
    console.error('[Balance] Error checking Yellow balance:', error)
    return { hasEnough: false, balance: '0', formatted: '0.00' }
  }
}
