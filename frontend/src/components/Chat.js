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
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#0A0A0A' }}>
      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', paddingTop: 80 }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>📈</div>
            <div style={{ fontWeight: 700, fontSize: 20, color: '#D4AF37', marginBottom: 8 }}>
              ManagerX · {chain.charAt(0).toUpperCase() + chain.slice(1)}
            </div>
            <div style={{ color: '#555', fontSize: 14, marginBottom: 36, lineHeight: 1.6 }}>
              Your AI portfolio agent for tokenized stocks.<br/>Ask anything or pick a suggestion.
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
              {(SUGGESTIONS[chain] || SUGGESTIONS.arbitrum).map(s => (
                <button key={s} onClick={() => send(s)} style={{
                  padding: '9px 16px', borderRadius: 20,
                  border: '1px solid #2A2A2A', background: '#111',
                  cursor: 'pointer', fontSize: 13, color: '#AAA',
                  transition: 'all 0.15s',
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
              background: m.role === 'user' ? '#D4AF37' : '#1A1A1A',
              color: m.role === 'user' ? '#0A0A0A' : '#E0E0E0',
              border: m.role === 'assistant' ? '1px solid #2A2A2A' : 'none',
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
      <div style={{ padding: '20px 32px', background: '#111', borderTop: '1px solid #2A2A2A' }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && send()}
            placeholder={`Ask about your ${chain} portfolio…`}
            style={{
              flex: 1, padding: '13px 18px', borderRadius: 12,
              border: '1px solid #2A2A2A', background: '#1A1A1A',
              color: '#F5F5F5', fontSize: 14, outline: 'none',
              fontFamily: "'Inter', system-ui, sans-serif",
            }}
          />
          <button onClick={() => send()} disabled={!input.trim() || loading} style={{
            padding: '13px 22px', borderRadius: 12, border: 'none',
            background: input.trim() && !loading ? '#D4AF37' : '#2A2A2A',
            color: input.trim() && !loading ? '#0A0A0A' : '#555',
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
