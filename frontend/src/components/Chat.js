import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';

const SUGGESTIONS = {
  arbitrum: ['What stocks can I buy?', 'Buy $100 of NVDAX', 'Show my portfolio', "What's AAPLX trading at?"],
  solana:   ['What xStocks are available?', 'Buy $50 of TSLAx', 'Show my portfolio', "What's NVDAx price?"],
  sui:      ['How does Sui trading work?', 'Bridge USDC to Solana', 'Show my portfolio', 'Buy TSLAx via CCTP'],
};

export default function Chat({ user, chain }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  const token = localStorage.getItem('managerx_token');

  useEffect(() => { setMessages([]); }, [chain]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = async (text) => {
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
      setMessages([...newMessages, { role: 'assistant', content: data.reply }]);
    } catch {
      setMessages([...newMessages, { role: 'assistant', content: 'Something went wrong. Please try again.' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#0C0C10' }}>
      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', paddingTop: 80 }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>📈</div>
            <div style={{ fontWeight: 700, fontSize: 18, color: '#C9A84C', marginBottom: 6, letterSpacing: '0.12em' }}>
              {chain === 'arbitrum' ? 'ARBITRUM · ROBINHOOD' : 'SUI · XSTOCKS'}
            </div>
            <div style={{ color: '#3A3A40', fontSize: 12, marginBottom: 32, lineHeight: 1.8, fontStyle: 'italic' }}>
              Your positions, your strategy. Ask anything.
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
              {(SUGGESTIONS[chain] || SUGGESTIONS.arbitrum).map(s => (
                <button key={s} onClick={() => send(s)} style={{
                  padding: '9px 16px', borderRadius: 20,
                  border: '1px solid #C9A84C30', background: 'none',
                  cursor: 'pointer', fontSize: 10, color: '#666',
                  letterSpacing: '0.08em', fontFamily: "'Georgia', serif",
                }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} style={{
            marginBottom: 20, display: 'flex',
            justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
          }}>
            {m.role === 'assistant' && (
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                background: '#D4AF3720', border: '1px solid #D4AF3740',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, marginRight: 10, flexShrink: 0, marginTop: 2,
              }}>M</div>
            )}
            <div style={{
              maxWidth: '72%', padding: '12px 18px', borderRadius: 16,
              background: m.role === 'user' ? '#C9A84C' : '#12121A',
              color: m.role === 'user' ? '#0C0C10' : '#C8C0B0',
              border: m.role === 'assistant' ? '1px solid #1C1C22' : 'none',
              fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap',
              fontWeight: m.role === 'user' ? 500 : 400,
            }}>
              {m.content}
            </div>
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%',
              background: '#D4AF3720', border: '1px solid #D4AF3740',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12,
            }}>M</div>
            <div style={{ padding: '12px 18px', borderRadius: 16, background: '#1A1A1A', border: '1px solid #2A2A2A', color: '#555', fontSize: 14 }}>
              Thinking…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '14px 28px', background: '#0E0E14', borderTop: '1px solid #1C1C22' }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && send()}
            placeholder={`Ask about your ${chain} portfolio…`}
            style={{
              flex: 1, padding: '13px 18px', borderRadius: 12,
              border: '1px solid #1C1C22', background: '#12121A',
              color: '#E8DCC8', fontSize: 12, outline: 'none',
              fontFamily: "'Georgia', serif", letterSpacing: '0.03em',
            }}
          />
          <button onClick={() => send()} disabled={!input.trim() || loading} style={{
            padding: '13px 22px', borderRadius: 12, border: 'none',
            background: input.trim() && !loading ? '#C9A84C' : '#16161E',
            color: input.trim() && !loading ? '#0C0C10' : '#3A3A40',
            cursor: input.trim() && !loading ? 'pointer' : 'not-allowed',
            fontSize: 14, fontWeight: 600, transition: 'all 0.15s',
          }}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
