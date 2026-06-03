import React, { useState, useEffect } from 'react';
import { usePrivy, useSolanaWallets, useWallets } from '@privy-io/react-auth';
import axios from 'axios';
import Onboarding from './components/Onboarding';
import Dashboard from './components/Dashboard';

export default function App() {
  const { ready, authenticated, user: privyUser, logout } = usePrivy();
  const { wallets: evmWallets } = useWallets();
  const { wallets: solWallets } = useSolanaWallets();
  const [user, setUser] = useState(null);
  const [chain, setChain] = useState('arbitrum');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem('managerx_user');
    const savedChain = localStorage.getItem('managerx_chain');
    if (saved) setUser(JSON.parse(saved));
    if (savedChain) setChain(savedChain);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!ready || !authenticated || !privyUser) return;

    const email = privyUser.email?.address || privyUser.google?.email;
    if (!email) return;

    const evmWallet = evmWallets.find(w => w.walletClientType === 'privy');
    const solWallet = solWallets.find(w => w.walletClientType === 'privy');

    const evmAddress = evmWallet?.address || '';
    const solAddress = solWallet?.address || '';

    axios.post('/api/auth/sync', {
      email,
      name: privyUser.google?.name || email,
      privyUserId: privyUser.id,
      evmAddress,
      solAddress,
      suiAddress: '',
    }).then(({ data }) => {
      localStorage.setItem('managerx_user', JSON.stringify(data.user));
      localStorage.setItem('managerx_token', data.token);
      setUser(data.user);
    }).catch(console.error);

  }, [ready, authenticated, privyUser, evmWallets, solWallets]);

  const handleChainChange = (newChain) => {
    setChain(newChain);
    localStorage.setItem('managerx_chain', newChain);
  };

  const handleLogout = () => {
    localStorage.removeItem('managerx_user');
    localStorage.removeItem('managerx_chain');
    setUser(null);
    if (authenticated) logout();
  };

  if (loading || !ready) return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontFamily: 'monospace', color: '#888' }}>Loading…</div>
    </div>
  );

  return user
    ? <Dashboard user={user} chain={chain} onChainChange={handleChainChange} onLogout={handleLogout} />
    : <Onboarding onLogin={(u) => { localStorage.setItem('managerx_user', JSON.stringify(u)); setUser(u); }} />;
}
