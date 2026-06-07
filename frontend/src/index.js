import React from 'react';
import ReactDOM from 'react-dom/client';
import {
  DynamicContextProvider,
} from '@dynamic-labs/sdk-react-core';
import { SolanaWalletConnectors } from '@dynamic-labs/solana';
import { SuiWalletConnectors } from '@dynamic-labs/sui';
import App from './App';
import './index.css';

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
    }}
  >
    <App />
  </DynamicContextProvider>
);
