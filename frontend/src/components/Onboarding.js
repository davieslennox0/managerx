import React from 'react';
import { usePrivy } from '@privy-io/react-auth';

export default function Onboarding() {
  const { login, ready } = usePrivy();

  return (
    <div style={{
      height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#0A0A0A', fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      <div style={{ textAlign: 'center', maxWidth: 420, padding: '48px 40px', background: '#111', borderRadius: 24, border: '1px solid #2A2A2A' }}>
        <div style={{ fontSize: 48, marginBottom: 20 }}>📈</div>
        <h1 style={{ fontSize: 32, fontWeight: 700, margin: '0 0 10px', color: '#D4AF37', letterSpacing: '-1px' }}>ManagerX</h1>
        <p style={{ color: '#666', fontSize: 14, margin: '0 0 32px', lineHeight: 1.7 }}>
          AI-powered portfolio agent for tokenized stocks.<br/>
          Trade Robinhood stocks on Arbitrum or xStocks on Solana.
        </p>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginBottom: 36 }}>
          {['ARB · Robinhood', 'SOL · xStocks', 'SUI · CCTP'].map(c => (
            <div key={c} style={{
              padding: '6px 12px', borderRadius: 20,
              background: '#1A1A1A', border: '1px solid #2A2A2A',
              fontSize: 11, fontWeight: 600, color: '#D4AF37', letterSpacing: '0.5px',
            }}>{c}</div>
          ))}
        </div>

        <button onClick={login} disabled={!ready} style={{
          width: '100%', padding: '15px', borderRadius: 12, border: 'none',
          background: ready ? '#D4AF37' : '#2A2A2A',
          color: ready ? '#0A0A0A' : '#555',
          fontSize: 15, fontWeight: 700, cursor: ready ? 'pointer' : 'not-allowed',
          letterSpacing: '-0.2px', transition: 'all 0.15s',
        }}>
          Get Started
        </button>
        <p style={{ color: '#333', fontSize: 11, marginTop: 16 }}>Powered by Privy · No seed phrases needed</p>
      </div>
    </div>
  );
}
