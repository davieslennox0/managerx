import React, { useState, useEffect } from 'react';
import { useConnectWallet, useWallets, useCurrentAccount, useDisconnectWallet } from '@mysten/dapp-kit';
import axios from 'axios';
import Chat from './Chat';
import Portfolio from './Portfolio';



function SuiConnectBtn() {
  const wallets = useWallets();
  const account = useCurrentAccount();
  const { mutate: connect } = useConnectWallet();
  const { mutate: disconnect } = useDisconnectWallet();

  if (account) {
    return (
      <button onClick={() => disconnect()} style={{
        background: 'none', border: '1px solid #C9A84C50',
        color: '#C9A84C', padding: '5px 12px', cursor: 'pointer',
        fontSize: 9, letterSpacing: '0.1em', fontFamily: 'Georgia, serif', borderRadius: 4,
      }}>
        {account.address.slice(0,6)}...{account.address.slice(-4)} ✓
      </button>
    );
  }

  console.log('ALL wallets:', wallets.map(w => w.name));
  if (wallets.length === 0) {
    return (
      <a href="https://slush.app" target="_blank" rel="noreferrer" style={{
        background: 'none', border: '1px solid #C9A84C50',
        color: '#C9A84C', padding: '5px 12px', cursor: 'pointer',
        fontSize: 9, letterSpacing: '0.1em', fontFamily: 'Georgia, serif',
        borderRadius: 4, textDecoration: 'none', display: 'inline-block',
      }}>GET SLUSH ↗</a>
    );
  }

  return (
    <button onClick={() => {
      console.log('Connecting to:', wallets[0]?.name);
      connect({ wallet: wallets[0] });
    }} style={{
      background: 'none', border: '1px solid #C9A84C50',
      color: '#C9A84C', padding: '5px 12px', cursor: 'pointer',
      fontSize: 9, letterSpacing: '0.1em', fontFamily: 'Georgia, serif', borderRadius: 4,
    }}>
      {wallets[0]?.name || 'CONNECT SUI'}
    </button>
  );
}

const CHAINS = [
  { id: 'arbitrum', label: 'Arbitrum', short: 'ARB', desc: 'Robinhood Stocks' },
  { id: 'sui', label: 'Sui', short: 'SUI', desc: 'xStocks' },
];

const TOUR_STEPS = [
  { title: 'Welcome to ManagerX', body: 'Your AI-powered portfolio agent for tokenized stocks. Trade Robinhood stocks on Arbitrum or xStocks on Sui.' },
  { title: 'Switch Networks', body: 'Use the dropdown in the top right to switch between Arbitrum (Robinhood stocks) and Sui (xStocks via CCTP).' },
  { title: 'Fund Your Wallet', body: 'Go to Portfolio → click your wallet address → copy it and send USDC to start trading.' },
  { title: 'Start Trading', body: 'Just chat naturally. Say "Buy $100 of NVDAX" or "What\'s TSLA trading at?" — your AI agent handles the rest.' },
];

function Tour({ onDone }) {
  const [step, setStep] = useState(0);
  const current = TOUR_STEPS[step];
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#00000090', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
      <div style={{ background: '#12121A', border: '1px solid #C9A84C40', borderRadius: 14, padding: '36px', maxWidth: 380, width: '90%', fontFamily: 'Georgia, serif' }}>
        <div style={{ fontSize: 9, color: '#C9A84C', letterSpacing: '0.25em', marginBottom: 16 }}>GETTING STARTED · {step + 1}/{TOUR_STEPS.length}</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#E8DCC8', marginBottom: 12 }}>{current.title}</div>
        <div style={{ fontSize: 12, color: '#888', lineHeight: 1.8, marginBottom: 28 }}>{current.body}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {step > 0 && <button onClick={() => setStep(s => s - 1)} style={{ flex: 1, padding: '10px', background: 'none', border: '1px solid #1C1C22', color: '#555', borderRadius: 6, cursor: 'pointer', fontSize: 10, fontFamily: 'Georgia, serif', letterSpacing: '0.1em' }}>BACK</button>}
          <button onClick={() => step < TOUR_STEPS.length - 1 ? setStep(s => s + 1) : onDone()} style={{ flex: 2, padding: '10px', background: '#C9A84C', border: 'none', color: '#0C0C10', borderRadius: 6, cursor: 'pointer', fontSize: 10, fontWeight: 700, fontFamily: 'Georgia, serif', letterSpacing: '0.1em' }}>
            {step < TOUR_STEPS.length - 1 ? 'NEXT →' : 'GET STARTED'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PriceTicker({ chain }) {
  const [prices, setPrices] = useState({});
  useEffect(() => {
    axios.get(`/api/prices/${chain}`).then(({ data }) => setPrices(data)).catch(() => {});
    const t = setInterval(() => axios.get(`/api/prices/${chain}`).then(({ data }) => setPrices(data)).catch(() => {}), 60000);
    return () => clearInterval(t);
  }, [chain]);

  const items = Object.entries(prices);
  if (!items.length) return null;

  return (
    <div style={{ display: 'flex', gap: 16, overflow: 'hidden' }}>
      {items.map(([sym, data]) => (
        <div key={sym} style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
          <span style={{ fontSize: 9, color: '#555', letterSpacing: '0.1em' }}>{sym}</span>
          <span style={{ fontSize: 10, color: '#E8DCC8' }}>${data.price}</span>
          <span style={{ fontSize: 9, color: parseFloat(data.change) >= 0 ? '#4A8A5A' : '#8A4A4A' }}>
            {parseFloat(data.change) >= 0 ? '+' : ''}{data.change}%
          </span>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard({ user, chain, onChainChange, onLogout, showTour, onTourDone, suiAccount }) {
  const [view, setView] = useState('chat');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [balance, setBalance] = useState(null);
  const activeChain = CHAINS.find(c => c.id === chain) || CHAINS[0];
  const token = localStorage.getItem('managerx_token');

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  useEffect(() => {
    axios.get(`/api/portfolio/${chain}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(({ data }) => setBalance(data.usdcBalance))
      .catch(() => {});
  }, [chain]);

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'Georgia, serif', background: '#0C0C10', color: '#E8DCC8' }}
      onClick={() => setDropdownOpen(false)}>

      {showTour && <Tour onDone={onTourDone} />}

      {/* Sidebar */}
      <div style={{ width: 180, background: '#0E0E14', borderRight: '1px solid #1C1C22', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: '22px 18px 18px', borderBottom: '1px solid #1C1C22' }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: '#C9A84C', letterSpacing: '0.12em' }}>MANAGERX</div>
          <div style={{ fontSize: 8, color: '#2A2A30', marginTop: 3, letterSpacing: '0.3em' }}>PRIVATE PORTFOLIO</div>
        </div>

        <div style={{ padding: '16px 10px', flex: 1 }}>
          <div style={{ fontSize: 7, color: '#2A2A30', letterSpacing: '0.25em', marginBottom: 8, paddingLeft: 8 }}>NAVIGATION</div>
          {[{ id: 'chat', label: 'Chat', icon: '◈' }, { id: 'portfolio', label: 'Portfolio', icon: '◇' }].map(v => (
            <button key={v.id} onClick={() => setView(v.id)} style={{
              width: '100%', padding: '8px 10px', marginBottom: 2, borderRadius: 6,
              border: 'none', background: view === v.id ? '#16161E' : 'transparent',
              cursor: 'pointer', textAlign: 'left', fontSize: 10,
              fontWeight: view === v.id ? 600 : 400,
              color: view === v.id ? '#C9A84C' : '#444',
              fontFamily: 'Georgia, serif',
              display: 'flex', alignItems: 'center', gap: 7,
              borderLeft: view === v.id ? '1px solid #C9A84C40' : '1px solid transparent',
              letterSpacing: '0.1em',
            }}>
              <span style={{ fontSize: 9 }}>{v.icon}</span>{v.label.toUpperCase()}
            </button>
          ))}
        </div>

        <div style={{ padding: '14px 18px', borderTop: '1px solid #1C1C22' }}>
          <div style={{ fontSize: 7, color: '#2A2A30', letterSpacing: '0.25em', marginBottom: 6 }}>CLIENT</div>
          <div style={{ fontSize: 11, color: '#777', marginBottom: 2 }}>{user.name || user.email?.split('@')[0]}</div>
          <div style={{ fontSize: 8, color: '#2A2A30', marginBottom: 10, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {(chain === 'sui' ? user.suiAddress : user.evmAddress)?.slice(0, 14)}…
          </div>
          <button onClick={onLogout} style={{ fontSize: 8, color: '#333', border: '1px solid #1C1C22', background: 'none', cursor: 'pointer', padding: '5px 8px', borderRadius: 4, width: '100%', letterSpacing: '0.1em', fontFamily: 'Georgia, serif' }}>SIGN OUT</button>
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        {/* Header */}
        <div style={{ padding: '10px 20px', background: '#0E0E14', borderBottom: '1px solid #1C1C22', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, overflow: 'hidden' }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#C9A84C', flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: '#555', letterSpacing: '0.1em', whiteSpace: 'nowrap' }}>
              {greeting()}, <span style={{ color: '#C9A84C' }}>{user.name || user.email?.split('@')[0]}</span>
            </span>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <PriceTicker chain={chain} />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            {balance !== null && (
              <div style={{ fontSize: 10, color: '#C9A84C', letterSpacing: '0.05em' }}>${parseFloat(balance || 0).toFixed(2)} USDC</div>
            )}
            {chain === 'sui' && <SuiConnectBtn />}
            <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
              <button onClick={() => setDropdownOpen(!dropdownOpen)} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: 'none', border: '1px solid #C9A84C30',
                color: '#C9A84C', padding: '5px 12px', cursor: 'pointer',
                fontSize: 9, letterSpacing: '0.15em', fontFamily: 'Georgia, serif', borderRadius: 4,
              }}>
                {activeChain.label.toUpperCase()} <span style={{ fontSize: 6 }}>▼</span>
              </button>
              {dropdownOpen && (
                <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, background: '#12121A', border: '1px solid #C9A84C20', borderRadius: 6, zIndex: 100, minWidth: 150, boxShadow: '0 8px 32px #00000080' }}>
                  {CHAINS.map(c => (
                    <div key={c.id} onClick={() => { onChainChange(c.id); setDropdownOpen(false); }} style={{ padding: '10px 14px', cursor: 'pointer', background: c.id === chain ? '#1A1A24' : 'transparent', borderBottom: '1px solid #1C1C22' }}>
                      <div style={{ fontSize: 9, color: c.id === chain ? '#C9A84C' : '#777', letterSpacing: '0.12em' }}>{c.label.toUpperCase()}</div>
                      <div style={{ fontSize: 8, color: '#2A2A30', marginTop: 2 }}>{c.desc}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {view === 'chat' ? <Chat user={user} chain={chain} /> : <Portfolio user={user} chain={chain} />}
      </div>
    </div>
  );
}
