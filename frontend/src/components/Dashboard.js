import React, { useState } from 'react';
import Chat from './Chat';
import Portfolio from './Portfolio';

const CHAINS = [
  { id: 'arbitrum', label: 'Arbitrum', short: 'ARB', desc: 'Robinhood Stocks' },
  { id: 'sui',      label: 'Sui',      short: 'SUI', desc: 'xStocks' },
];

export default function Dashboard({ user, chain, onChainChange, onLogout }) {
  const [view, setView] = useState('chat');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const activeChain = CHAINS.find(c => c.id === chain) || CHAINS[0];
  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  return (
    <div style={{
      display: 'flex', height: '100vh',
      fontFamily: "'Georgia', 'Times New Roman', serif",
      background: '#0C0C10', color: '#E8DCC8',
    }} onClick={() => setDropdownOpen(false)}>

      {/* Sidebar */}
      <div style={{
        width: 200, background: '#0E0E14',
        borderRight: '1px solid #1C1C22',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Logo */}
        <div style={{ padding: '28px 20px 20px', borderBottom: '1px solid #1C1C22' }}>
          <div style={{ fontWeight: 700, fontSize: 18, color: '#C9A84C', letterSpacing: '0.12em' }}>MANAGERX</div>
          <div style={{ fontSize: 9, color: '#3A3A40', marginTop: 4, letterSpacing: '0.3em' }}>PRIVATE PORTFOLIO</div>
        </div>

        {/* Nav */}
        <div style={{ padding: '20px 12px', flex: 1 }}>
          <div style={{ fontSize: 8, color: '#3A3A40', letterSpacing: '0.25em', marginBottom: 10, paddingLeft: 8 }}>NAVIGATION</div>
          {[
            { id: 'chat', label: 'Chat', icon: '◈' },
            { id: 'portfolio', label: 'Portfolio', icon: '◇' },
          ].map(v => (
            <button key={v.id} onClick={() => setView(v.id)} style={{
              width: '100%', padding: '9px 12px', marginBottom: 2, borderRadius: 6,
              border: 'none', background: view === v.id ? '#16161E' : 'transparent',
              cursor: 'pointer', textAlign: 'left', fontSize: 11,
              fontWeight: view === v.id ? 600 : 400,
              color: view === v.id ? '#C9A84C' : '#555',
              fontFamily: "'Georgia', serif",
              display: 'flex', alignItems: 'center', gap: 8,
              borderLeft: view === v.id ? '1px solid #C9A84C40' : '1px solid transparent',
              letterSpacing: '0.08em',
            }}>
              <span style={{ fontSize: 10 }}>{v.icon}</span>{v.label.toUpperCase()}
            </button>
          ))}
        </div>

        {/* User */}
        <div style={{ padding: '16px 20px', borderTop: '1px solid #1C1C22' }}>
          <div style={{ fontSize: 8, color: '#3A3A40', letterSpacing: '0.25em', marginBottom: 8 }}>CLIENT</div>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>{user.name || user.email?.split('@')[0]}</div>
          <div style={{ fontSize: 9, color: '#333', marginBottom: 12, fontFamily: 'monospace' }}>
            {(chain === 'sui' ? user.suiAddress : user.evmAddress)?.slice(0, 16)}…
          </div>
          <button onClick={onLogout} style={{
            fontSize: 9, color: '#444', border: '1px solid #1C1C22',
            background: 'none', cursor: 'pointer', padding: '5px 10px',
            borderRadius: 4, width: '100%', letterSpacing: '0.1em',
            fontFamily: "'Georgia', serif",
          }}>SIGN OUT</button>
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{
          padding: '14px 28px', background: '#0E0E14',
          borderBottom: '1px solid #1C1C22',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#C9A84C' }} />
            <span style={{ fontSize: 11, color: '#888', letterSpacing: '0.15em' }}>
              {greeting()}, <span style={{ color: '#C9A84C' }}>{user.name || user.email?.split('@')[0]}</span>
            </span>
          </div>

          {/* Chain Dropdown */}
          <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
            <button onClick={() => setDropdownOpen(!dropdownOpen)} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: 'none', border: '1px solid #C9A84C40',
              color: '#C9A84C', padding: '6px 14px', cursor: 'pointer',
              fontSize: 10, letterSpacing: '0.15em',
              fontFamily: "'Georgia', serif", borderRadius: 4,
            }}>
              {activeChain.label.toUpperCase()}
              <span style={{ fontSize: 7, color: '#C9A84C80' }}>▼</span>
            </button>
            {dropdownOpen && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 6px)', right: 0,
                background: '#12121A', border: '1px solid #C9A84C20',
                borderRadius: 6, zIndex: 100, minWidth: 160,
                boxShadow: '0 8px 32px #00000080',
              }}>
                {CHAINS.map(c => (
                  <div key={c.id} onClick={() => { onChainChange(c.id); setDropdownOpen(false); }} style={{
                    padding: '10px 16px', cursor: 'pointer',
                    background: c.id === chain ? '#1A1A24' : 'transparent',
                    borderBottom: '1px solid #1C1C22',
                  }}>
                    <div style={{ fontSize: 10, color: c.id === chain ? '#C9A84C' : '#888', letterSpacing: '0.12em' }}>{c.label.toUpperCase()}</div>
                    <div style={{ fontSize: 9, color: '#3A3A40', marginTop: 2 }}>{c.desc}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {view === 'chat'
          ? <Chat user={user} chain={chain} />
          : <Portfolio user={user} chain={chain} />
        }
      </div>
    </div>
  );
}