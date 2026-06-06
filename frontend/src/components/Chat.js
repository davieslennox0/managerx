import React, { useState, useRef, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useUserWallets } from '@dynamic-labs/sdk-react-core';
import { isSuiWallet } from '@dynamic-labs/sui-core';

// ── Markdown renderer ──────────────────────────────────────────────────────
function Markdown({ text }) {
  const lines = text.split('\n');
  return (
    <div>
      {lines.map((line, i) => {
        if (line.startsWith('### ')) return <div key={i} style={{ fontWeight: 700, color: '#C9A84C', fontSize: 12, letterSpacing: '0.1em', marginTop: 10, marginBottom: 4 }}>{line.slice(4)}</div>;
        if (line.startsWith('## ')) return <div key={i} style={{ fontWeight: 700, color: '#C9A84C', fontSize: 13, marginTop: 10, marginBottom: 4 }}>{line.slice(3)}</div>;
        if (line.startsWith('# ')) return <div key={i} style={{ fontWeight: 700, color: '#C9A84C', fontSize: 14, marginTop: 10, marginBottom: 4 }}>{line.slice(2)}</div>;
        if (line === '---' || line === '—') return <hr key={i} style={{ border: 'none', borderTop: '1px solid #1C1C22', margin: '8px 0' }} />;
        if (line.startsWith('- ') || line.startsWith('* ')) return <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 2 }}><span style={{ color: '#C9A84C', flexShrink: 0 }}>·</span><span>{renderInline(line.slice(2))}</span></div>;
        if (/^\d+\./.test(line)) return <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 2 }}><span style={{ color: '#C9A84C', flexShrink: 0, minWidth: 16 }}>{line.match(/^\d+/)[0]}.</span><span>{renderInline(line.replace(/^\d+\.\s*/, ''))}</span></div>;
        if (line.startsWith('```')) return null;
        if (line === '') return <div key={i} style={{ height: 6 }} />;
        return <div key={i} style={{ marginBottom: 2 }}>{renderInline(line)}</div>;
      })}
    </div>
  );
}

function renderInline(text) {
  const parts = [];
  let remaining = text;
  let key = 0;
  while (remaining.length > 0) {
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    const codeMatch = remaining.match(/`(.+?)`/);
    const first = [boldMatch, codeMatch].filter(Boolean).sort((a, b) => a.index - b.index)[0];
    if (!first) { parts.push(<span key={key++}>{remaining}</span>); break; }
    if (first.index > 0) parts.push(<span key={key++}>{remaining.slice(0, first.index)}</span>);
    if (first === boldMatch) parts.push(<strong key={key++} style={{ color: '#E8DCC8', fontWeight: 600 }}>{first[1]}</strong>);
    else parts.push(<code key={key++} style={{ background: '#1C1C22', padding: '1px 5px', borderRadius: 3, fontSize: 11, fontFamily: 'monospace', color: '#C9A84C' }}>{first[1]}</code>);
    remaining = remaining.slice(first.index + first[0].length);
  }
  return parts;
}

// ── Suggestions ────────────────────────────────────────────────────────────
const SUGGESTIONS = {
  arbitrum: ['What stocks can I buy?', 'Buy $100 of NVDAX', 'Show my portfolio', "What's AAPLX price?"],
  sui: ['What xStocks are available?', 'Buy $50 of TSLAx', 'Show my portfolio', 'How do I deposit?'],
};

// ── Confirm modal ──────────────────────────────────────────────────────────
function ConfirmModal({ action, onConfirm, onCancel }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#00000080', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#12121A', border: '1px solid #C9A84C30', borderRadius: 12, padding: '28px 32px', maxWidth: 340, width: '90%' }}>
        <div style={{ fontSize: 10, color: '#C9A84C', letterSpacing: '0.2em', marginBottom: 16 }}>CONFIRM TRADE</div>
        <div style={{ fontSize: 13, color: '#E8DCC8', marginBottom: 8 }}>
          <strong>{action.action?.toUpperCase()}</strong> {action.symbol}
        </div>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 24 }}>
          Amount: <span style={{ color: '#C9A84C' }}>${action.amount} {action.currency === 'usd' ? 'USD' : 'shares'}</span>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onCancel} style={{ flex: 1, padding: '10px', background: 'none', border: '1px solid #1C1C22', color: '#555', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontFamily: 'Georgia, serif', letterSpacing: '0.1em' }}>CANCEL</button>
          <button onClick={onConfirm} style={{ flex: 1, padding: '10px', background: '#C9A84C', border: 'none', color: '#0C0C10', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 700, fontFamily: 'Georgia, serif', letterSpacing: '0.1em' }}>CONFIRM</button>
        </div>
      </div>
    </div>
  );
}

// ── Main Chat ──────────────────────────────────────────────────────────────
export default function Chat({ user, chain, onNewChat }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const bottomRef = useRef(null);
  const token = localStorage.getItem('managerx_token');

  // Load history on mount/chain change
  useEffect(() => {
    setMessages([]);
    setHistoryLoaded(false);
    axios.get(`/api/chat/history/${chain}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(({ data }) => { if (data.messages?.length) setMessages(data.messages); })
      .catch(() => {})
      .finally(() => setHistoryLoaded(true));
  }, [chain]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const parseAction = (text) => {
    // Try fenced code block first
    const fenced = text.match(/```json\s*([\s\S]*?)```/);
    if (fenced) {
      try { return JSON.parse(fenced[1]); } catch {}
    }
    // Try raw JSON object
    const raw = text.match(/\{[\s\S]*?"action"[\s\S]*?"symbol"[\s\S]*?\}/);
    if (raw) {
      try { return JSON.parse(raw[0]); } catch {}
    }
    return null;
  };

  const send = useCallback(async (text) => {
    const msg = text || input.trim();
    if (!msg || loading) return;
    setInput('');
    const newMessages = [...messages, { role: 'user', content: msg }];
    setMessages(newMessages);
    setLoading(true);
    try {
      const { data } = await axios.post('/api/chat', { messages: newMessages, chain }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const reply = data.reply;
      setMessages([...newMessages, { role: 'assistant', content: reply }]);
      const action = parseAction(reply);
      if (action?.action) setPendingAction(action);
    } catch {
      setMessages([...newMessages, { role: 'assistant', content: 'Something went wrong. Please try again.' }]);
    } finally { setLoading(false); }
  }, [messages, input, loading, chain, token]);

  const handleNewChat = async () => {
    await axios.delete(`/api/chat/history/${chain}`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    setMessages([]);
    if (onNewChat) onNewChat();
  };

  const greeting = () => {
    const h = new Date().getHours();
    const name = user.name || user.email?.split('@')[0];
    if (h < 12) return `Good morning, ${name}.`;
    if (h < 17) return `Good afternoon, ${name}.`;
    return `Good evening, ${name}.`;
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#0C0C10' }}>
      {pendingAction && (
        <ConfirmModal
          action={pendingAction}
          onConfirm={async () => {
            const action = pendingAction;
            setPendingAction(null);
            // Call trade execute endpoint directly
            try {
              const { data } = await axios.post('/api/trade/execute', {
                chain,
                action: {
                  type: action.action,
                  symbol: action.symbol,
                  amount: action.amount,
                  currency: action.currency || 'usd',
                },
              }, { headers: { Authorization: `Bearer ${token}` } });

              const successMsg = {
                role: 'assistant',
                content: data.txHash
                  ? `✅ Trade executed.\n\n**${action.action.toUpperCase()}** ${action.symbol}\n**Amount:** ${action.amount}\n**Tx:** ${data.txHash.slice(0, 10)}...${data.txHash.slice(-6)}\n\n[View on Arbiscan](https://arbiscan.io/tx/${data.txHash})`
                  : `✅ ${data.message}`,
              };
              setMessages(prev => [...prev, successMsg]);
            } catch (e) {
              const errMsg = {
                role: 'assistant',
                content: `❌ Trade failed: ${e.response?.data?.error || e.message}`,
              };
              setMessages(prev => [...prev, errMsg]);
            }
          }}
          onCancel={() => setPendingAction(null)}
        />
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
        {!historyLoaded && (
          <div style={{ textAlign: 'center', color: '#3A3A40', fontSize: 11, paddingTop: 40 }}>Loading history…</div>
        )}

        {historyLoaded && messages.length === 0 && (
          <div style={{ textAlign: 'center', paddingTop: 60 }}>
            <div style={{ fontSize: 36, marginBottom: 16 }}>📈</div>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#C9A84C', marginBottom: 6, letterSpacing: '0.12em' }}>
              {chain === 'arbitrum' ? 'ARBITRUM · ROBINHOOD' : 'SUI · XSTOCKS'}
            </div>
            <div style={{ color: '#3A3A40', fontSize: 12, marginBottom: 8, fontStyle: 'italic' }}>{greeting()}</div>
            <div style={{ color: '#3A3A40', fontSize: 11, marginBottom: 28 }}>Your positions, your strategy. Ask anything.</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
              {(SUGGESTIONS[chain] || SUGGESTIONS.arbitrum).map(s => (
                <button key={s} onClick={() => send(s)} style={{
                  padding: '8px 14px', borderRadius: 20,
                  border: '1px solid #C9A84C30', background: 'none',
                  cursor: 'pointer', fontSize: 10, color: '#666',
                  letterSpacing: '0.08em', fontFamily: 'Georgia, serif',
                }}>{s}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 18, display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            {m.role === 'assistant' && (
              <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#C9A84C20', border: '1px solid #C9A84C30', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, marginRight: 8, flexShrink: 0, marginTop: 2, color: '#C9A84C' }}>M</div>
            )}
            <div style={{
              maxWidth: '74%', padding: '11px 16px', borderRadius: 14,
              background: m.role === 'user' ? '#C9A84C' : '#12121A',
              color: m.role === 'user' ? '#0C0C10' : '#C8C0B0',
              border: m.role === 'assistant' ? '1px solid #1C1C22' : 'none',
              fontSize: 12, lineHeight: 1.7,
              fontWeight: m.role === 'user' ? 500 : 400,
            }}>
              {m.role === 'assistant' ? <Markdown text={m.content} /> : m.content}
            </div>
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
            <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#C9A84C20', border: '1px solid #C9A84C30', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#C9A84C' }}>M</div>
            <div style={{ padding: '11px 16px', borderRadius: 14, background: '#12121A', border: '1px solid #1C1C22', color: '#3A3A40', fontSize: 12, fontStyle: 'italic' }}>
              Thinking…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '12px 24px 16px', background: '#0E0E14', borderTop: '1px solid #1C1C22' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={handleNewChat} title="New chat" style={{
            width: 38, height: 38, borderRadius: 8, border: '1px solid #1C1C22',
            background: 'none', color: '#3A3A40', cursor: 'pointer', fontSize: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>✦</button>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
            placeholder={`Ask about your ${chain} portfolio…`}
            style={{
              flex: 1, padding: '11px 16px', borderRadius: 10,
              border: '1px solid #1C1C22', background: '#12121A',
              color: '#E8DCC8', fontSize: 12, outline: 'none',
              fontFamily: 'Georgia, serif', letterSpacing: '0.03em',
            }}
          />
          <button onClick={() => send()} disabled={!input.trim() || loading} style={{
            padding: '11px 20px', borderRadius: 10, border: 'none',
            background: input.trim() && !loading ? '#C9A84C' : '#16161E',
            color: input.trim() && !loading ? '#0C0C10' : '#3A3A40',
            cursor: input.trim() && !loading ? 'pointer' : 'not-allowed',
            fontSize: 11, fontWeight: 700, transition: 'all 0.15s',
            fontFamily: 'Georgia, serif', letterSpacing: '0.1em',
          }}>SEND</button>
        </div>
      </div>
    </div>
  );
}
