import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';

const SUGGESTIONS = {
  arbitrum: ['What stocks can I buy?', 'Buy $100 of NVDAX', 'Show my portfolio', 'What\'s AAPLX trading at?'],
  solana:   ['What xStocks are available?', 'Buy $100 of TSLAx', 'Show my portfolio', 'What\'s NVDAx trading at?'],
  sui:      ['How does Sui trading work?', 'Bridge USDC from Sui', 'Show my portfolio', 'Buy TSLAx via CCTP'],
};

export default function Chat({ user, chain }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  const token = localStorage.getItem('managerx_token');

  useEffect(() => {
    setMessages([]);
  }, [chain]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async (text) => {
    const msg = text || input.trim();
    if (!msg || loading) return;
    setInput('');

    const newMessages = [...messages, { role: 'user', content: msg }];
    setMessages(newMessages);
    setLoading(true);

    try {
      const { data } = await axios.post('/api/chat', {
        messages: newMessages,
        chain,
      }, { headers: { Authorization: `Bearer ${token}` } });

      setMessages([...newMessages, { role: 'assistant', content: data.reply }]);
    } catch (e) {
      setMessages([...newMessages, { role: 'assistant', content: 'Something went wrong. Please try again.' }]);
    } finally {
      setLoading(false);
    }
  };

  const suggestions = SUGGESTIONS[chain] || SUGGESTIONS.arbitrum;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', paddingTop: 60 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📈</div>
            <div style={{ fontWeight: 600, color: '#111', marginBottom: 6 }}>ManagerX on {chain.charAt(0).toUpperCase() + chain.slice(1)}</div>
            <div style={{ color: '#888', fontSize: 14, marginBottom: 32 }}>Your AI portfolio agent. Ask anything.</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
              {suggestions.map(s => (
                <button key={s} onClick={() => send(s)} style={{
                  padding: '8px 14px', borderRadius: 20, border: '1px solid #e0e0e0',
                  background: '#fff', cursor: 'pointer', fontSize: 13, color: '#444',
                }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 16, display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '75%', padding: '12px 16px', borderRadius: 16,
              background: m.role === 'user' ? '#111' : '#fff',
              color: m.role === 'user' ? '#fff' : '#111',
              border: m.role === 'assistant' ? '1px solid #eee' : 'none',
              fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap',
            }}>
              {m.content}
            </div>
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 16 }}>
            <div style={{ padding: '12px 16px', borderRadius: 16, background: '#fff', border: '1px solid #eee', color: '#888', fontSize: 14 }}>
              Thinking…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '16px 24px', background: '#fff', borderTop: '1px solid #eee' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && send()}
            placeholder={`Ask about your ${chain} portfolio…`}
            style={{
              flex: 1, padding: '12px 16px', borderRadius: 12,
              border: '1px solid #e0e0e0', fontSize: 14, outline: 'none',
            }}
          />
          <button onClick={() => send()} disabled={!input.trim() || loading} style={{
            padding: '12px 20px', borderRadius: 12, border: 'none',
            background: '#111', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600,
          }}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
