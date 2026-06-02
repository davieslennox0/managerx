import React from 'react';
import ReactDOM from 'react-dom/client';
import { PrivyProvider } from '@privy-io/react-auth';
import App from './App';
import './index.css';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <PrivyProvider
    appId="cmpeku47e000l0ci6ejcg63m5"
    config={{
      loginMethods: ['google', 'email'],
      appearance: {
        theme: 'light',
        accentColor: '#00d4aa',
        logo: '',
      },
      embeddedWallets: {
        createOnLogin: 'users-without-wallets',
      },
    }}
  >
    <App />
  </PrivyProvider>
);
