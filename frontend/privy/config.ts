import { PrivyClientConfig } from '@privy-io/react-auth'

export const privyConfig: PrivyClientConfig = {
  // Configure appearance
  appearance: {
    theme: 'dark',
    accentColor: '#6366f1',
  },
  // Configure embedded wallet
  embeddedWallets: {
    ethereum: {
      createOnLogin: 'users-without-wallets',
    },
    // Hide wallet UIs for seamless transactions
    showWalletUIs: false,
  },
  // Supported login methods
  loginMethods: ['email', 'google'],
}
