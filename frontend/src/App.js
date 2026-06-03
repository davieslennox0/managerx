import React, { useState, useEffect } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import axios from 'axios';
import Onboarding from './components/Onboarding';
import Dashboard from './components/Dashboard';

export default function App() {
  const { ready, authenticated, user: privyUser, logout } = usePrivy();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Load saved session
  useEffect(() => {
    const saved = localStorage.getItem('manager_user');
    if (saved) setUser(JSON.parse(saved));
    setLoading(false);
  }, []);

  // Sync Privy login to backend
  useEffect(() => {
    if (!ready || !authenticated || !privyUser) return;
    const email = privyUser.email?.address || privyUser.google?.email;
    const name = privyUser.google?.name || email;
    if (!email) return;

    const evmWallet = privyUser.linkedAccounts?.find(
      a => a.type === 'wallet' && a.chainType === 'ethereum'
    );
    const evmAddress = evmWallet?.address || null;

    axios.post('/api/auth/google', { email, name, privyToken: null, evmAddress })
      .then(({ data }) => {
        localStorage.setItem('manager_user', JSON.stringify(data.user));
        setUser(data.user);
      })
      .catch(console.error);
  }, [ready, authenticated, privyUser]);

  const handleLogin = (userData) => {
    localStorage.setItem('manager_user', JSON.stringify(userData));
    setUser(userData);
  };

  const handleLogout = () => {
    localStorage.removeItem('manager_user');
    setUser(null);
    if (authenticated) logout();
  };

  if (loading || !ready) return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff' }}>
      <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text3)', fontSize: 13 }}>Loading…</div>
    </div>
  );

  return user
    ? <Dashboard user={user} onLogout={handleLogout} />
    : <Onboarding onLogin={handleLogin} />;
}
