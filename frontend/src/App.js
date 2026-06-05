import React, { useState, useEffect } from 'react';
import { usePrivy, useSolanaWallets, useWallets, useExportWallet } from '@privy-io/react-auth';
import { useCurrentAccount } from '@mysten/dapp-kit';
import axios from 'axios';
import Onboarding from './components/Onboarding';
import Dashboard from './components/Dashboard';

export default function App() {
  const { ready, authenticated, user: privyUser, logout } = usePrivy();
  const { wallets: evmWallets } = useWallets();
  const { wallets: solWallets } = useSolanaWallets();
  const suiAccount = useCurrentAccount();
  const { exportWallet } = useExportWallet();
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

  // Sync whenever Privy or Sui wallet changes
  useEffect(() => {
    if (!ready || !authenticated || !privyUser) return;
    const email = privyUser.email?.address || privyUser.google?.email;
    if (!email) return;

    const evmWallet = evmWallets.find(w => w.walletClientType === 'privy');
    const solWallet = solWallets.find(w => w.walletClientType === 'privy');
    const evmAddress = evmWallet?.address || '';
    const solAddress = solWallet?.address || '';
    const suiAddress = suiAccount?.address || '';

    axios.post('/api/auth/sync', {
      email, name: privyUser.google?.name || email,
      privyUserId: privyUser.id,
      evmAddress, solAddress, suiAddress,
    }).then(({ data }) => {
      const isNew = !localStorage.getItem('managerx_token');
      localStorage.setItem('managerx_user', JSON.stringify(data.user));
      localStorage.setItem('managerx_token', data.token);
      setUser(data.user);
    }).catch(console.error);
  }, [ready, authenticated, privyUser, evmWallets, solWallets, suiAccount]);

  const handleChainChange = (c) => { setChain(c); localStorage.setItem('managerx_chain', c); };
  const handleLogout = () => {
    localStorage.removeItem('managerx_user');
    localStorage.removeItem('managerx_chain');
    localStorage.removeItem('managerx_token');
    setUser(null);
    if (authenticated) logout();
  };

  if (loading || !ready) return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0C0C10' }}>
      <div style={{ fontFamily: 'Georgia, serif', color: '#C9A84C', fontSize: 13, letterSpacing: '0.2em' }}>LOADING…</div>
    </div>
  );

  return user
    ? <Dashboard user={user} chain={chain} onChainChange={handleChainChange} onLogout={handleLogout} suiAccount={suiAccount} onExportWallet={exportWallet} />
    : <Onboarding />;
}
