import React, { useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';

export default function Onboarding() {
  const { login, ready } = usePrivy();
  const [hovered, setHovered] = useState(false);

  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0C0C10', fontFamily: 'Georgia, serif' }}>
      <div style={{ textAlign: 'center', maxWidth: 400, padding: '48px 40px', background: '#0E0E14', borderRadius: 16, border: '1px solid #1C1C22' }}>
        <div style={{ fontSize: 9, color: '#2A2A30', letterSpacing: '0.35em', marginBottom: 24 }}>PRIVATE PORTFOLIO AGENT</div>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 12px', color: '#C9A84C', letterSpacing: '0.08em' }}>MANAGERX</h1>
        <p style={{ color: '#3A3A40', fontSize: 12, margin: '0 0 32px', lineHeight: 1.8, fontStyle: 'italic' }}>
          An AI agent for tokenized stocks.<br/>Trade Robinhood equities on Arbitrum<br/>or xStocks on Sui.
        </p>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 36 }}>
          {[{ label: 'ARB', sub: 'Robinhood' }, { label: 'SUI', sub: 'xStocks' }].map(c => (
            <div key={c.label} style={{ padding: '8px 16px', borderRadius: 4, background: '#12121A', border: '1px solid #C9A84C20', textAlign: 'center' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#C9A84C', letterSpacing: '0.15em' }}>{c.label}</div>
              <div style={{ fontSize: 8, color: '#3A3A40', marginTop: 2, letterSpacing: '0.1em' }}>{c.sub}</div>
            </div>
          ))}
        </div>

        <button
          onClick={login}
          disabled={!ready}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            width: '100%', padding: '14px', borderRadius: 6, border: 'none',
            background: ready ? (hovered ? '#D4B84C' : '#C9A84C') : '#1A1A1A',
            color: ready ? '#0C0C10' : '#2A2A2A',
            fontSize: 11, fontWeight: 700, cursor: ready ? 'pointer' : 'not-allowed',
            letterSpacing: '0.2em', transition: 'all 0.2s', fontFamily: 'Georgia, serif',
          }}>
          ENTER
        </button>
        <p style={{ color: '#1C1C22', fontSize: 9, marginTop: 14, letterSpacing: '0.1em' }}>POWERED BY PRIVY · NO SEED PHRASES</p>
      </div>
    </div>
  );
}
