import React, { useState, useEffect } from 'react';
import { useDynamicContext, useUserWallets } from '@dynamic-labs/sdk-react-core';
import { isEthereumWallet } from '@dynamic-labs/ethereum';
import { isSolanaWallet } from '@dynamic-labs/solana';
import axios from 'axios';
import Dashboard from './components/Dashboard';
import Onboarding from './components/Onboarding';

export default function App() {
  const { user: dynamicUser, handleLogOut } = useDynamicContext();
  const userWallets = useUserWallets();

  const [user, setUser] = useState(null);
  const [chain, setChain] = useState(() => localStorage.getItem('managerx_chain') || 'arbitrum');
  const [showTour, setShowTour] = useState(false);

  useEffect(() => {
    if (!dynamicUser) { setUser(null); return; }

    console.log('userWallets:', userWallets?.map(w => ({ address: w.address, chain: w.chain })));

    const evmWallet = userWallets?.find(w => isEthereumWallet(w));
    const solWallet = userWallets?.find(w => isSolanaWallet(w));
    const suiWallet = userWallets?.find(w => !isEthereumWallet(w) && !isSolanaWallet(w));

    const email = dynamicUser.email
      || dynamicUser.verifiedCredentials?.find(c => c.oauthProvider === 'google')?.oauthAccountId;

    if (!email) return;

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
    }).catch(e => console.error('Sync failed:', e.message));

  }, [dynamicUser, userWallets]);

  const handleLogout = async () => {
    await handleLogOut();
    localStorage.removeItem('managerx_user');
    localStorage.removeItem('managerx_token');
    localStorage.removeItem('managerx_chain');
    setUser(null);
  };

  if (!dynamicUser) return <Onboarding />;

  if (!user) return (
    <div style={{
      minHeight: '100vh', background: '#0C0C10',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Georgia, serif', gap: 16,
    }}>
      <div style={{ fontSize: 20, color: '#C9A84C', letterSpacing: '0.15em' }}>MANAGERX</div>
      <div style={{ fontSize: 10, color: '#444', letterSpacing: '0.2em' }}>SYNCING WALLETS...</div>
    </div>
  );

  return (
    <Dashboard
      user={user}
      chain={chain}
      onChainChange={(c) => { setChain(c); localStorage.setItem('managerx_chain', c); }}
      onLogout={handleLogout}
      showTour={showTour}
      onTourDone={() => setShowTour(false)}
      userWallets={userWallets}
    />
  );
}
