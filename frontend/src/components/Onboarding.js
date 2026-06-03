import React from 'react';
import { usePrivy } from '@privy-io/react-auth';

export default function Onboarding({ onLogin }) {
  const { login, ready } = usePrivy();

  return (
    <div style={{
      height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#f8f9fa', fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{ textAlign: 'center', maxWidth: 400, padding: 40 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>📈</div>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 8px', color: '#111' }}>ManagerX</h1>
        <p style={{ color: '#888', fontSize: 15, margin: '0 0 32px', lineHeight: 1.6 }}>
          AI-powered portfolio agent for tokenized stocks.<br />
          Trade Robinhood stocks on Arbitrum or xStocks on Solana.
        </p>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginBottom: 32 }}>
          {['ARB', 'SOL', 'SUI'].map(c => (
            <div key={c} style={{ padding: '6px 14px', borderRadius: 20, background: '#fff', border: '1px solid #e0e0e0', fontSize: 13, fontWeight: 600, color: '#555' }}>{c}</div>
          ))}
        </div>

        <button
          onClick={login}
          disabled={!ready}
          style={{
            width: '100%', padding: '14px', borderRadius: 12, border: 'none',
            background: '#111', color: '#fff', fontSize: 16, fontWeight: 600,
            cursor: ready ? 'pointer' : 'not-allowed', opacity: ready ? 1 : 0.6,
          }}
        >
          Get Started
        </button>
        <p style={{ color: '#aaa', fontSize: 12, marginTop: 16 }}>Powered by Privy · No seed phrases needed</p>
      </div>
    </div>
  );
}
