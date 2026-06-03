import React, { useState } from 'react';
import Chat from './Chat';
import Portfolio from './Portfolio';

const CHAINS = [
  { id: 'arbitrum', label: 'ARB', desc: 'Robinhood Stocks', color: '#D4AF37' },
  { id: 'sui',      label: 'SUI', desc: 'xStocks',          color: '#D4AF37' },
];

export default function Dashboard({ user, chain, onChainChange, onLogout }) {
  const [view, setView] = useState('chat');
  const activeChain = CHAINS.find(c => c.id === chain) || CHAINS[0];

  return (
    <div style={{
      display: 'flex', height: '100vh',
      fontFamily: "'Inter', system-ui, sans-serif",
      background: '#0A0A0A', color: '#F5F5F5',
    }}>
      {/* Sidebar */}
      <div style={{
        width: 220, background: '#111', borderRight: '1px solid #2A2A2A',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Logo */}
        <div style={{ padding: '24px 20px', borderBottom: '1px solid #2A2A2A' }}>
          <div style={{ fontWeight: 700, fontSize: 20, color: '#D4AF37', letterSpacing: '-0.5px' }}>ManagerX</div>
          <div style={{ fontSize: 11, color: '#666', marginTop: 3, letterSpacing: '0.5px' }}>AI PORTFOLIO AGENT</div>
        </div>

        {/* Chain Toggle */}
        <div style={{ padding: '16px 12px', borderBottom: '1px solid #2A2A2A' }}>
          <div style={{ fontSize: 10, color: '#555', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '1.5px', paddingLeft: 8 }}>Network</div>
          {CHAINS.map(c => (
            <button key={c.id} onClick={() => onChainChange(c.id)} style={{
              width: '100%', padding: '10px 12px', marginBottom: 4, borderRadius: 10,
              border: chain === c.id ? '1px solid #D4AF37' : '1px solid transparent',
              background: chain === c.id ? '#D4AF3715' : 'transparent',
              cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: chain === c.id ? '#D4AF37' : '#888' }}>{c.label}</div>
              <div style={{ fontSize: 10, color: '#555', marginTop: 1 }}>{c.desc}</div>
            </button>
          ))}
        </div>

        {/* Nav */}
        <div style={{ padding: '12px', flex: 1 }}>
          {[
            { id: 'chat', label: '💬  Chat' },
            { id: 'portfolio', label: '📊  Portfolio' },
          ].map(v => (
            <button key={v.id} onClick={() => setView(v.id)} style={{
              width: '100%', padding: '10px 12px', marginBottom: 4, borderRadius: 10,
              border: 'none', background: view === v.id ? '#1A1A1A' : 'transparent',
              cursor: 'pointer', textAlign: 'left', fontSize: 13,
              fontWeight: view === v.id ? 600 : 400,
              color: view === v.id ? '#F5F5F5' : '#666',
            }}>
              {v.label}
            </button>
          ))}
        </div>

        {/* User */}
        <div style={{ padding: '16px 20px', borderTop: '1px solid #2A2A2A' }}>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</div>
          <div style={{ fontSize: 10, color: '#444', marginBottom: 10, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {(chain === 'solana' ? user.solAddress : user.evmAddress)?.slice(0, 18)}…
          </div>
          <button onClick={onLogout} style={{
            fontSize: 11, color: '#555', border: '1px solid #2A2A2A',
            background: 'none', cursor: 'pointer', padding: '5px 10px',
            borderRadius: 6, width: '100%',
          }}>Sign out</button>
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header bar */}
        <div style={{
          padding: '16px 28px', background: '#111',
          borderBottom: '1px solid #2A2A2A',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#D4AF37', boxShadow: '0 0 8px #D4AF37' }} />
          <span style={{ fontWeight: 600, color: '#D4AF37', fontSize: 14 }}>{activeChain.label}</span>
          <span style={{ color: '#555', fontSize: 13 }}>·</span>
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
