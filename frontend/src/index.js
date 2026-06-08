import React from 'react';
import ReactDOM from 'react-dom/client';
import {
  DynamicContextProvider,
} from '@dynamic-labs/sdk-react-core';
import { SolanaWalletConnectors } from '@dynamic-labs/solana';
import { SuiWalletConnectors } from '@dynamic-labs/sui';
import App from './App';
import './index.css';

// Stable reference required by Dynamic's dependency array.
// Replaces whatever RPC Dynamic has configured (often a rate-limited private URL)
// with the public Solana mainnet endpoint so embedded wallet signing works.
const solNetworksOverride = (networks) =>
  networks.map(n => ({ ...n, rpcUrls: ['https://mainnet.helius-rpc.com/?api-key=4de1718f-f24d-4112-9324-32f3deb3d717'] }));

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <DynamicContextProvider
    settings={{
      environmentId: 'a2aa0b6a-4786-47f1-8758-ed3d968d05c7',
      walletConnectors: [
        SolanaWalletConnectors,
        SuiWalletConnectors,
      ],
      embeddedWallets: {
        createOnLogin: 'all-users',
        generateWalletOnLogin: true,
      },
      initialAuthenticationMode: 'connect-and-sign',
      overrides: {
        solNetworks: solNetworksOverride,
      },
    }}
  >
    <App />
  </DynamicContextProvider>
);
