import React from 'react';
import { DynamicWidget } from '@dynamic-labs/sdk-react-core';

export default function Onboarding() {
  return (
    <div style={{
      minHeight: '100vh', background: '#0C0C10',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Georgia, serif',
    }}>
      <div style={{ textAlign: 'center', maxWidth: 400, padding: '0 20px' }}>
        <div style={{ fontSize: 28, fontWeight: 700, color: '#C9A84C', letterSpacing: '0.15em', marginBottom: 8 }}>
          MANAGERX
        </div>
        <div style={{ fontSize: 10, color: '#333', letterSpacing: '0.3em', marginBottom: 48 }}>
          AI PORTFOLIO AGENT
        </div>
        <div style={{ fontSize: 13, color: '#555', marginBottom: 32, lineHeight: 1.8 }}>
          Trade tokenized stocks on Arbitrum and Sui.<br />
          Powered by AI. Non-custodial.
        </div>
        <DynamicWidget />
        <div style={{ fontSize: 9, color: '#222', marginTop: 24, letterSpacing: '0.1em' }}>
          EVM · SOLANA · SUI · ALL IN ONE
        </div>
      </div>
    </div>
  );
}
