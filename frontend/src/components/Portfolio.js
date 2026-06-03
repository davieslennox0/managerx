import React, { useState, useEffect } from 'react';
import axios from 'axios';

export default function Portfolio({ user, chain }) {
  const [portfolio, setPortfolio] = useState(null);
  const [loading, setLoading] = useState(true);
  const token = localStorage.getItem('managerx_token');

  useEffect(() => {
    setLoading(true);
    axios.get(`/api/portfolio/${chain}`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then(({ data }) => setPortfolio(data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [chain]);

  const address = chain === 'solana' ? user.solAddress : user.evmAddress;

  if (loading) return (
    <div style={{ padding: 40, textAlign: 'center', color: '#555', background: '#0A0A0A', flex: 1 }}>
      Loading portfolio…
    </div>
  );

  return (
    <div style={{ padding: '28px 32px', overflowY: 'auto', background: '#0A0A0A', flex: 1 }}>
      <h2 style={{ margin: '0 0 24px', fontWeight: 700, fontSize: 18, color: '#D4AF37' }}>
        Portfolio — {chain.toUpperCase()}
      </h2>

      {/* Cards */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
        <div style={{ flex: 1, background: '#111', borderRadius: 14, padding: 22, border: '1px solid #2A2A2A' }}>
          <div style={{ fontSize: 11, color: '#555', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>USDC Balance</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#D4AF37' }}>${portfolio?.usdcBalance?.toFixed(2) || '0.00'}</div>
        </div>
        <div style={{ flex: 2, background: '#111', borderRadius: 14, padding: 22, border: '1px solid #2A2A2A' }}>
          <div style={{ fontSize: 11, color: '#555', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Wallet</div>
          <div style={{ fontSize: 12, fontFamily: 'monospace', color: '#AAA', wordBreak: 'break-all' }}>
            {address || 'Not connected'}
          </div>
        </div>
      </div>

      {/* Positions */}
      <div style={{ background: '#111', borderRadius: 14, border: '1px solid #2A2A2A', overflow: 'hidden' }}>
        <div style={{ padding: '16px 22px', borderBottom: '1px solid #2A2A2A', fontWeight: 600, fontSize: 14, color: '#AAA' }}>
          Positions
        </div>
        {!portfolio?.trackedPositions?.length ? (
          <div style={{ padding: '48px 22px', textAlign: 'center', color: '#444', fontSize: 14 }}>
            No positions yet. Start trading in the chat.
          </div>
        ) : (
          portfolio.trackedPositions.map(p => (
            <div key={p.id} style={{
              padding: '16px 22px', borderBottom: '1px solid #1A1A1A',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div>
                <div style={{ fontWeight: 600, color: '#F5F5F5' }}>{p.symbol}</div>
                <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>{p.shares} shares @ ${p.avg_price?.toFixed(2)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 600, color: '#D4AF37' }}>${(p.shares * p.avg_price).toFixed(2)}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
