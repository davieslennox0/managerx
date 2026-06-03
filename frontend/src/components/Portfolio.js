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
    }).then(({ data }) => {
      setPortfolio(data);
    }).catch(console.error)
      .finally(() => setLoading(false));
  }, [chain]);

  if (loading) return (
    <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Loading portfolio…</div>
  );

  return (
    <div style={{ padding: 24, overflowY: 'auto' }}>
      <h2 style={{ margin: '0 0 20px', fontWeight: 700, fontSize: 20 }}>Portfolio — {chain.toUpperCase()}</h2>

      {/* Balances */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
        <div style={{ flex: 1, background: '#fff', borderRadius: 12, padding: 20, border: '1px solid #eee' }}>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>USDC Balance</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>${portfolio?.usdcBalance?.toFixed(2) || '0.00'}</div>
        </div>
        <div style={{ flex: 1, background: '#fff', borderRadius: 12, padding: 20, border: '1px solid #eee' }}>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>Wallet</div>
          <div style={{ fontSize: 12, fontFamily: 'monospace', wordBreak: 'break-all' }}>
            {chain === 'solana' ? user.solAddress : user.evmAddress || 'Not connected'}
          </div>
        </div>
      </div>

      {/* Positions */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #eee', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #eee', fontWeight: 600 }}>Positions</div>
        {portfolio?.trackedPositions?.length === 0 || !portfolio?.trackedPositions ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#888', fontSize: 14 }}>
            No positions yet. Start trading in the chat.
          </div>
        ) : (
          portfolio.trackedPositions.map(p => (
            <div key={p.id} style={{ padding: '16px 20px', borderBottom: '1px solid #f5f5f5', display: 'flex', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 600 }}>{p.symbol}</div>
                <div style={{ fontSize: 12, color: '#888' }}>{p.shares} shares @ ${p.avg_price?.toFixed(2)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 600 }}>${(p.shares * p.avg_price).toFixed(2)}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
