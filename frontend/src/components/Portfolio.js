import React, { useState, useEffect } from 'react';
import axios from 'axios';

function DepositModal({ user, onClose }) {
  const address = user.suiAddress;
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#00000090', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#12121A', border: '1px solid #C9A84C30', borderRadius: 14, padding: '32px', maxWidth: 380, width: '90%' }}>
        <div style={{ fontSize: 10, color: '#C9A84C', letterSpacing: '0.2em', marginBottom: 20 }}>DEPOSIT FUNDS</div>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 12, lineHeight: 1.6 }}>
          Send USDC to your Sui wallet address below. Your balance will update automatically.
        </div>
        <div style={{ background: '#0C0C10', border: '1px solid #1C1C22', borderRadius: 8, padding: '14px', marginBottom: 16 }}>
          <div style={{ fontSize: 10, color: '#3A3A40', letterSpacing: '0.15em', marginBottom: 6 }}>WALLET ADDRESS</div>
          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#E8DCC8', wordBreak: 'break-all', lineHeight: 1.6 }}>{address || 'No wallet connected'}</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={copy} style={{ flex: 1, padding: '10px', background: copied ? '#1A2A1A' : '#C9A84C', border: 'none', color: copied ? '#4A8' : '#0C0C10', borderRadius: 6, cursor: 'pointer', fontSize: 10, fontWeight: 700, fontFamily: 'Georgia, serif', letterSpacing: '0.1em' }}>
            {copied ? 'COPIED ✓' : 'COPY ADDRESS'}
          </button>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', background: 'none', border: '1px solid #1C1C22', color: '#555', borderRadius: 6, cursor: 'pointer', fontSize: 10, fontFamily: 'Georgia, serif', letterSpacing: '0.1em' }}>CLOSE</button>
        </div>
      </div>
    </div>
  );
}

export default function Portfolio({ user, chain }) {
  const [portfolio, setPortfolio] = useState(null);
  const [prices, setPrices] = useState({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('positions');
  const [showDeposit, setShowDeposit] = useState(false);
  const [txHistory, setTxHistory] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const token = localStorage.getItem('managerx_token');

  useEffect(() => {
    setLoading(true);
    Promise.all([
      axios.get(`/api/portfolio/${chain}`, { headers: { Authorization: `Bearer ${token}` } }),
      axios.get(`/api/prices/${chain}`),
    ]).then(([port, px]) => {
      setPortfolio(port.data);
      setPrices(px.data);
    }).catch(console.error).finally(() => setLoading(false));
  }, [chain]);

  useEffect(() => {
    if (tab !== 'activity') return;
    setActivityLoading(true);
    axios.get('/api/trade/history', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setTxHistory(r.data.transactions || []))
      .catch(console.error)
      .finally(() => setActivityLoading(false));
  }, [tab]);

  const address = user.suiAddress;

  const getPnL = (position) => {
    const sym = position.symbol.replace('X', '').replace('x', '');
    const current = prices[sym]?.price;
    if (!current || current === '—') return null;
    const currentVal = parseFloat(current) * position.shares;
    const costVal = position.avg_price * position.shares;
    const pnl = currentVal - costVal;
    const pct = ((pnl / costVal) * 100).toFixed(2);
    return { pnl: pnl.toFixed(2), pct, positive: pnl >= 0 };
  };

  const totalValue = portfolio?.trackedPositions?.reduce((acc, p) => {
    const sym = p.symbol.replace('X', '').replace('x', '');
    const px = prices[sym]?.price;
    return acc + (px && px !== '—' ? parseFloat(px) * p.shares : p.avg_price * p.shares);
  }, 0) || 0;

  if (loading) return (
    <div style={{ padding: 40, textAlign: 'center', color: '#3A3A40', background: '#0C0C10', flex: 1, fontFamily: 'Georgia, serif', fontSize: 12, letterSpacing: '0.1em' }}>
      LOADING PORTFOLIO…
    </div>
  );

  return (
    <div style={{ overflowY: 'auto', background: '#0C0C10', flex: 1, fontFamily: 'Georgia, serif' }}>
      {showDeposit && <DepositModal user={user} onClose={() => setShowDeposit(false)} />}

      <div style={{ padding: '24px 28px' }}>
        {/* Top cards */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
          <div style={{ flex: 1, background: '#0E0E14', borderRadius: 12, padding: '18px 20px', border: '1px solid #1C1C22' }}>
            <div style={{ fontSize: 9, color: '#3A3A40', letterSpacing: '0.2em', marginBottom: 8 }}>PORTFOLIO VALUE</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#E8DCC8' }}>${totalValue.toFixed(2)}</div>
          </div>
          <div style={{ flex: 1, background: '#0E0E14', borderRadius: 12, padding: '18px 20px', border: '1px solid #1C1C22', cursor: 'pointer' }} onClick={() => setShowDeposit(true)}>
            <div style={{ fontSize: 9, color: '#3A3A40', letterSpacing: '0.2em', marginBottom: 8 }}>WALLET</div>
            <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#888' }}>{address?.slice(0, 14) || 'Not connected'}…</div>
            <div style={{ fontSize: 9, color: '#C9A84C', marginTop: 6, letterSpacing: '0.1em' }}>+ DEPOSIT →</div>
          </div>
        </div>

        {/* Chain balances */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
          <div style={{ flex: 1, background: '#0E0E14', borderRadius: 12, padding: '18px 20px', border: '1px solid #1C1C22' }}>
            <div style={{ fontSize: 9, color: '#3A3A40', letterSpacing: '0.2em', marginBottom: 12 }}>SUI</div>
            <div style={{ fontSize: 9, color: '#555', letterSpacing: '0.15em', marginBottom: 4 }}>USDC</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#C9A84C' }}>${(portfolio?.suiUsdcBalance ?? portfolio?.usdcBalance ?? 0).toFixed(2)}</div>
          </div>
          <div style={{ flex: 1, background: '#0E0E14', borderRadius: 12, padding: '18px 20px', border: '1px solid #1C1C22' }}>
            <div style={{ fontSize: 9, color: '#3A3A40', letterSpacing: '0.2em', marginBottom: 12 }}>SOLANA</div>
            <div style={{ display: 'flex', gap: 20 }}>
              <div>
                <div style={{ fontSize: 9, color: '#555', letterSpacing: '0.15em', marginBottom: 4 }}>SOL</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#9945FF' }}>{(portfolio?.solNativeBalance ?? 0).toFixed(4)}</div>
              </div>
              <div>
                <div style={{ fontSize: 9, color: '#555', letterSpacing: '0.15em', marginBottom: 4 }}>USDC</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#C9A84C' }}>${(portfolio?.solUsdcBalance ?? 0).toFixed(2)}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid #1C1C22' }}>
          {['positions', 'activity'].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '8px 20px', background: 'none', border: 'none',
              borderBottom: tab === t ? '1px solid #C9A84C' : '1px solid transparent',
              color: tab === t ? '#C9A84C' : '#3A3A40', cursor: 'pointer',
              fontSize: 9, letterSpacing: '0.2em', fontFamily: 'Georgia, serif',
              marginBottom: -1,
            }}>{t.toUpperCase()}</button>
          ))}
        </div>

        {tab === 'positions' && (
          <div style={{ background: '#0E0E14', borderRadius: 12, border: '1px solid #1C1C22', overflow: 'hidden' }}>
            {!portfolio?.trackedPositions?.length ? (
              <div style={{ padding: '48px 22px', textAlign: 'center', color: '#3A3A40', fontSize: 12, fontStyle: 'italic' }}>
                No positions yet.<br />Start trading in the chat.
              </div>
            ) : (
              portfolio.trackedPositions.map(p => {
                const pnl = getPnL(p);
                return (
                  <div key={p.id} style={{ padding: '16px 20px', borderBottom: '1px solid #12121A', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 600, color: '#E8DCC8', fontSize: 13 }}>{p.symbol}</div>
                      <div style={{ fontSize: 10, color: '#3A3A40', marginTop: 2 }}>{p.shares} shares · avg ${p.avg_price?.toFixed(2)}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 600, color: '#C9A84C', fontSize: 13 }}>${(p.shares * p.avg_price).toFixed(2)}</div>
                      {pnl && <div style={{ fontSize: 10, color: pnl.positive ? '#4A8A5A' : '#8A4A4A', marginTop: 2 }}>{pnl.positive ? '+' : ''}{pnl.pnl} ({pnl.pct}%)</div>}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {tab === 'activity' && (
          <div style={{ background: '#0E0E14', borderRadius: 12, border: '1px solid #1C1C22', overflow: 'hidden' }}>
            {activityLoading ? (
              <div style={{ padding: '48px 22px', textAlign: 'center', color: '#3A3A40', fontSize: 11, letterSpacing: '0.15em' }}>
                LOADING ACTIVITY…
              </div>
            ) : !txHistory.length ? (
              <div style={{ padding: '48px 22px', textAlign: 'center', color: '#3A3A40', fontSize: 12, fontStyle: 'italic' }}>
                No transactions yet.<br />Start trading in the chat.
              </div>
            ) : txHistory.map((tx, i) => {
              const success = tx.status !== 'failed';
              const isBuy = tx.type === 'buy';
              const accentColor = success ? (isBuy ? '#3DBA6F' : '#E8DCC8') : '#D05050';
              const bgColor = success ? (isBuy ? '#0D1A12' : '#141414') : '#1A0D0D';
              const borderColor = success ? (isBuy ? '#1A3A2A' : '#1C1C22') : '#3A1515';
              const date = tx.created_at ? new Date(tx.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
              return (
                <div key={tx.id || i} style={{
                  padding: '16px 20px',
                  borderBottom: '1px solid #12121A',
                  background: bgColor,
                  borderLeft: `3px solid ${borderColor}`,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  transition: 'background 0.15s',
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: '0.15em',
                        padding: '3px 8px', borderRadius: 4,
                        background: success ? (isBuy ? '#1A3A2A' : '#1C1C28') : '#2A1010',
                        color: accentColor,
                      }}>
                        {tx.type?.toUpperCase()}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#E8DCC8' }}>{tx.symbol}</span>
                      <span style={{
                        fontSize: 9, letterSpacing: '0.1em',
                        padding: '2px 7px', borderRadius: 3,
                        background: success ? '#0D200D' : '#200D0D',
                        color: success ? '#3DBA6F' : '#D05050',
                        border: `1px solid ${success ? '#1A3A1A' : '#3A1A1A'}`,
                      }}>
                        {success ? '✓ SUCCESS' : '✗ FAILED'}
                      </span>
                    </div>
                    {success ? (
                      <div style={{ fontSize: 10, color: '#555', marginBottom: 4 }}>
                        {tx.shares?.toFixed(6)} shares · ${tx.price?.toFixed(2)} per share
                      </div>
                    ) : (
                      <div style={{ fontSize: 10, color: '#6A2A2A', marginBottom: 4, fontStyle: 'italic' }}>
                        {tx.error || 'Trade execution failed'}
                      </div>
                    )}
                    {tx.tx_hash && (
                      <div style={{ fontSize: 9, color: '#2C2C34', fontFamily: 'monospace', letterSpacing: '0.05em' }}>
                        {tx.tx_hash.slice(0, 18)}…{tx.tx_hash.slice(-6)}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', minWidth: 90 }}>
                    {success && (
                      <div style={{ fontSize: 14, fontWeight: 700, color: accentColor, marginBottom: 4 }}>
                        ${tx.total?.toFixed(2)}
                      </div>
                    )}
                    <div style={{ fontSize: 9, color: '#2C2C34', letterSpacing: '0.05em' }}>{date}</div>
                    <div style={{ fontSize: 9, color: '#2C2C34', marginTop: 2, letterSpacing: '0.1em' }}>
                      {tx.chain?.toUpperCase()}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
