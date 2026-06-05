import React, { useState, useEffect } from 'react';
import {
  useDynamicContext,
  DynamicWidget,
} from '@dynamic-labs/sdk-react-core';
import { isEthereumWallet } from '@dynamic-labs/ethereum';
import { isSolanaWallet } from '@dynamic-labs/solana';
import axios from 'axios';
import Dashboard from './components/Dashboard';
import Onboarding from './components/Onboarding';

export default function App() {
  const {
    user: dynamicUser,
    primaryWallet,
    userWallets,
    handleLogOut,
    setShowAuthFlow,
  } = useDynamicContext();

  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('managerx_user');
    return stored ? JSON.parse(stored) : null;
  });
  const [chain, setChain] = useState(
    () => localStorage.getItem('managerx_chain') || 'arbitrum'
  );
  const [showTour, setShowTour] = useState(false);

  useEffect(() => {
    if (!dynamicUser || !userWallets?.length) return;

    const evmWallet = userWallets.find(w => isEthereumWallet(w));
    const solWallet = userWallets.find(w => isSolanaWallet(w));
    const suiWallet = userWallets.find(w => w.chain === 'SUI' || w.chain === 'sui');

    const email = dynamicUser.email || dynamicUser.verifiedCredentials?.find(c => c.oauthProvider === 'google')?.oauthAccountId;
    const name = dynamicUser.firstName || dynamicUser.alias || email?.split('@')[0];

    axios.post('/api/auth/sync', {
      email,
      name,
      privyUserId: dynamicUser.userId,
      evmAddress: evmWallet?.address || '',
      solAddress: solWallet?.address || '',
      suiAddress: suiWallet?.address || '',
    }).then(({ data }) => {
      const isNew = !localStorage.getItem('managerx_token');
      localStorage.setItem('managerx_user', JSON.stringify(data.user));
      localStorage.setItem('managerx_token', data.token);
      setUser(data.user);
      if (isNew) setShowTour(true);
    }).catch(console.error);
  }, [dynamicUser, userWallets]);

  const handleLogout = async () => {
    await handleLogOut();
    localStorage.removeItem('managerx_user');
    localStorage.removeItem('managerx_token');
    localStorage.removeItem('managerx_chain');
    setUser(null);
  };

  const handleChainChange = (c) => {
    setChain(c);
    localStorage.setItem('managerx_chain', c);
  };

  // Show dashboard if Dynamic user exists, even before backend sync
  if (!dynamicUser) {
    return <Onboarding />;
  }

  // Show loading while syncing
  if (!user) {
    return (
      <div style={{ minHeight: '100vh', background: '#0C0C10', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#C9A84C', fontFamily: 'Georgia, serif', fontSize: 12, letterSpacing: '0.2em' }}>
          LOADING PORTFOLIO...
        </div>
      </div>
    );
  }

  return (
    <Dashboard
      user={user}
      chain={chain}
      onChainChange={handleChainChange}
      onLogout={handleLogout}
      showTour={showTour}
      onTourDone={() => setShowTour(false)}
      userWallets={userWallets}
    />
  );
}
