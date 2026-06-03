import React, { useState } from 'react';
import Chat from './Chat';
import Portfolio from './Portfolio';

const CHAINS = [
  { id: 'arbitrum', label: 'ARB', desc: 'Robinhood Stocks', color: '#28a0f0' },
  { id: 'solana',   label: 'SOL', desc: 'xStocks',          color: '#9945ff' },
  { id: 'sui',      label: 'SUI', desc: 'xStocks via CCTP', color: '#4da2ff' },
];

export default function Dashboard({ user, chain, onChainChange, onLogout }) {
  const [view, setView] = useState('chat');
  const activeChain = CHAINS.find(c => c.id === chain) || CHAINS[0];

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'system-ui, sans-serif', background: '#f8f9fa' }}>

      {/* Sidebar */}
      <div style={{ width: 200, background: '#fff', borderRight: '1px solid #eee', display: 'flex', flexDirection: 'column', padding: '20px 0' }}>
        <div style={{ padding: '0 16px 20px', borderBottom: '1px solid #eee' }}>
          <div style={{ fontWeight: 700, fontSize: 18, color: '#111' }}>ManagerX</div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>AI Portfolio Agent</div>
        </div>

        {/* Chain Toggle */}
        <div style={{ padding: '16px 12px', borderBottom: '1px solid #eee' }}>
          <div style={{ fontSize: 10, color: '#aaa', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Network</div>
          {CHAINS.map(c => (
            <button key={c.id} onClick={() => onChainChange(c.id)} style={{
              width: '100%', padding: '8px 10px', marginBottom: 4, borderRadius: 8,
              border: chain === c.id ? `2px solid ${c.color}` : '2px solid transparent',
              background: chain === c.id ? `${c.color}15` : 'transparent',
              cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: chain === c.id ? c.color : '#444' }}>{c.label}</div>
              <div style={{ fontSize: 10, color: '#888' }}>{c.desc}</div>
            </button>
          ))}
        </div>

        {/* Nav */}
        <div style={{ padding: '12px 12px', flex: 1 }}>
          {['chat', 'portfolio'].map(v => (
            <button key={v} onClick={() => setView(v)} style={{
              width: '100%', padding: '10px 12px', marginBottom: 4, borderRadius: 8,
              border: 'none', background: view === v ? '#f0f0f0' : 'transparent',
              cursor: 'pointer', textAlign: 'left', fontSize: 13,
              fontWeight: view === v ? 600 : 400, color: '#333', textTransform: 'capitalize',
            }}>
              {v === 'chat' ? '💬 Chat' : '📊 Portfolio'}
            </button>
          ))}
        </div>

        {/* User */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid #eee' }}>
          <div style={{ fontSize: 12, color: '#555', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</div>
          <div style={{ fontSize: 10, color: '#aaa', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {chain === 'solana' ? user.solAddress : user.evmAddress}
          </div>
          <button onClick={onLogout} style={{ fontSize: 12, color: '#888', border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}>Sign out</button>
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '16px 24px', background: '#fff', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: activeChain.color }} />
          <span style={{ fontWeight: 600, color: '#111' }}>{activeChain.label}</span>
          <span style={{ color: '#888', fontSize: 13 }}>{activeChain.desc}</span>
        </div>

        {view === 'chat'
          ? <Chat user={user} chain={chain} />
          : <Portfolio user={user} chain={chain} />
        }
      </div>
    </div>
  );
}
