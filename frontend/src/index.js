import React from 'react';
import ReactDOM from 'react-dom/client';
import { PrivyProvider } from '@privy-io/react-auth';
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana';
import { SuiClientProvider, WalletProvider, createNetworkConfig } from '@mysten/dapp-kit';
import { getFullnodeUrl } from '@mysten/sui/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './index.css';

const solanaConnectors = toSolanaWalletConnectors({ shouldAutoConnect: false });
const queryClient = new QueryClient();

const { networkConfig } = createNetworkConfig({
  mainnet: { url: getFullnodeUrl('mainnet') },
});

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <QueryClientProvider client={queryClient}>
    <SuiClientProvider networks={networkConfig} defaultNetwork="mainnet">
      <WalletProvider
        autoConnect={false}
        slushWallet={{ name: 'ManagerX' }}
      >
        <PrivyProvider
          appId="cmpeku47e000l0ci6ejcg63m5"
          config={{
            loginMethods: ['google', 'email'],
            appearance: { theme: 'dark', accentColor: '#C9A84C' },
            embeddedWallets: {
              ethereum: { createOnLogin: 'all-users' },
              solana: { createOnLogin: 'all-users' },
            },
            solanaClusters: [{ name: 'mainnet-beta', rpcUrl: 'https://api.mainnet-beta.solana.com' }],
            externalWallets: { solana: { connectors: solanaConnectors } },
          }}
        >
          <App />
        </PrivyProvider>
      </WalletProvider>
    </SuiClientProvider>
  </QueryClientProvider>
);
