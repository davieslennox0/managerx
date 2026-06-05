import React, { useState, useEffect } from 'react';
import { useDynamicContext } from '@dynamic-labs/sdk-react-core';
import { isEthereumWallet } from '@dynamic-labs/ethereum';
import { isSolanaWallet } from '@dynamic-labs/solana';
import axios from 'axios';
import Dashboard from './components/Dashboard';
import Onboarding from './components/Onboarding';

export default function App() {
  const { user: dynamicUser, userWallets, handleLogOut } = useDynamicContext();

  const [user, setUser] = useState(null);
  const [chain, setChain] = useState(() => localStorage.getItem('managerx_chain') || 'arbitrum');
  const [showTour, setShowTour] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Sync wallets to backend whenever Dynamic user or wallets change
  useEffect(() => {
    if (!dynamicUser) {
      setUser(null);
      return;
    }

    const evmWallet = userWallets?.find(w => isEthereumWallet(w));
    const solWallet = userWallets?.find(w => isSolanaWallet(w));
    const suiWallet = userWallets?.find(w =>
      !isEthereumWallet(w) && !isSolanaWallet(w)
    );

    console.log('Wallets:', { 
      evm: evmWallet?.address, 
      sol: solWallet?.address, 
      sui: suiWallet?.address 
    });

    const email = dynamicUser.email
      || dynamicUser.verifiedCredentials?.find(c => c.oauthProvider === 'google')?.oauthAccountId
      || dynamicUser.verifiedCredentials?.[0]?.address;

    if (!email) return;

    setSyncing(true);
    axios.post('/api/auth/sync', {
      email,
      name: dynamicUser.firstName || dynamicUser.alias || email.split('@')[0],
      privyUserId: dynamicUser.userId,
      evmAddress: evmWallet?.address || '',
      solAddress: solWallet?.address || '',
      suiAddress: suiWallet?.address || '',
    }).then(({ data }) => {
      const isNew = !localStorage.getItem('managerx_token');
      localStorage.setItem('managerx_token', data.token);
      localStorage.setItem('managerx_user', JSON.stringify(data.user));
      setUser(data.user);
      if (isNew) setShowTour(true);
    }).catch(e => {
      console.error('Sync failed:', e.message);
    }).finally(() => setSyncing(false));

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

  // Not logged in
  if (!dynamicUser) return <Onboarding />;

  // Logged in but syncing
  if (!user) return (
    <div style={{
      minHeight: '100vh', background: '#0C0C10',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Georgia, serif', gap: 16,
    }}>
      <div style={{ fontSize: 20, color: '#C9A84C', letterSpacing: '0.15em' }}>MANAGERX</div>
      <div style={{ fontSize: 10, color: '#444', letterSpacing: '0.2em' }}>
        {syncing ? 'SYNCING WALLETS...' : 'LOADING...'}
      </div>
    </div>
  );

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
