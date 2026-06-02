import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';

const S = {
  wrap:{display:'flex',flexDirection:'column',flex:1,overflow:'hidden',height:'100%'},
  header:{padding:'14px 24px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',gap:10,flexShrink:0},
  dot:{width:8,height:8,borderRadius:'50%',background:'var(--accent)',animation:'pulse 2s infinite'},
  headerText:{fontSize:13,fontWeight:600},
  chainBadge:(c)=>({fontFamily:'var(--font-mono)',fontSize:10,padding:'2px 8px',borderRadius:12,background:c==='sui'?'rgba(77,162,255,0.1)':'rgba(40,160,240,0.1)',color:c==='sui'?'var(--sui)':'var(--arb)',marginLeft:6}),
  headerSub:{fontFamily:'var(--font-mono)',fontSize:10,color:'var(--text3)',marginLeft:'auto'},
  messages:{flex:1,overflowY:'auto',padding:'16px 20px',display:'flex',flexDirection:'column',gap:14},
  welcome:{maxWidth:500,animation:'fadeUp 0.5s ease both'},
  welcomeTitle:{fontSize:18,fontWeight:800,marginBottom:8},
  welcomeSub:{color:'var(--text2)',fontSize:13,lineHeight:1.6,marginBottom:20},
  suggestions:{display:'flex',flexWrap:'wrap',gap:7},
  suggestion:{padding:'7px 13px',background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:20,fontSize:12,color:'var(--text2)',cursor:'pointer',fontFamily:'var(--font-mono)'},
  msgWrap:(role)=>({display:'flex',justifyContent:role==='user'?'flex-end':'flex-start',animation:'fadeUp 0.2s ease both'}),
  bubble:(role)=>({maxWidth:'90%',padding:'11px 15px',borderRadius:role==='user'?'16px 16px 4px 16px':'16px 16px 16px 4px',background:role==='user'?'var(--accent)':'var(--bg2)',color:role==='user'?'#fff':'var(--text)',border:role==='user'?'none':'1px solid var(--border)',fontSize:13,lineHeight:1.6}),
  actionCard:{marginTop:8,padding:'12px 14px',background:'var(--bg3)',border:'1px solid var(--border2)',borderRadius:8,fontFamily:'var(--font-mono)',fontSize:12},
  actionRow:{display:'flex',justifyContent:'space-between',marginBottom:5,color:'var(--text2)'},
  actionLabel:{color:'var(--text3)'},
  actionVal:{color:'var(--text)',fontWeight:500},
  bridgeCard:{marginTop:8,padding:'12px 14px',background:'rgba(77,162,255,0.06)',border:'1px solid rgba(77,162,255,0.25)',borderRadius:8,fontFamily:'var(--font-mono)',fontSize:12},
  confirmBtns:{display:'flex',gap:8,marginTop:10},
  confirmBtn:(t)=>({flex:1,padding:'8px',background:t==='confirm'?'var(--accent)':'transparent',color:t==='confirm'?'#fff':'var(--text3)',border:t==='confirm'?'none':'1px solid var(--border)',borderRadius:6,fontSize:12,fontWeight:600}),
  thinking:{display:'flex',alignItems:'center',gap:5,color:'var(--text3)',fontFamily:'var(--font-mono)',fontSize:12},
  thinkingDot:(i)=>({width:5,height:5,borderRadius:'50%',background:'var(--accent)',animation:`pulse 1.2s infinite ${i*0.2}s`,display:'inline-block'}),
  inputArea:{padding:'12px 16px',borderTop:'1px solid var(--border)',flexShrink:0},
  chips:{display:'flex',gap:6,marginBottom:8,flexWrap:'wrap'},
  chip:{padding:'4px 10px',background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:12,fontSize:11,color:'var(--text3)',cursor:'pointer',fontFamily:'var(--font-mono)'},
  inputRow:{display:'flex',alignItems:'flex-end',gap:8,background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:12,padding:'9px 12px'},
  textarea:{flex:1,background:'transparent',border:'none',outline:'none',color:'var(--text)',fontSize:13,resize:'none',lineHeight:1.5,maxHeight:100,minHeight:20},
  sendBtn:(a)=>({width:30,height:30,borderRadius:7,background:a?'var(--accent)':'var(--bg3)',border:'none',color:a?'#fff':'var(--text3)',fontSize:15,display:'flex',alignItems:'center',justifyContent:'center',transition:'all 0.2s',flexShrink:0}),
  receipt:{marginTop:6,padding:'8px 12px',background:'rgba(0,200,83,0.06)',border:'1px solid rgba(0,200,83,0.2)',borderRadius:8,fontFamily:'var(--font-mono)',fontSize:11},
};

const SUGGESTIONS = ['What\'s my portfolio worth?','Buy 2 shares of NVDAX','Best AI stocks to buy now','Bridge $500 from Sui to Arbitrum','Sell all my TSLAX','Rebalance my portfolio'];
const CHIPS = ['Buy','Sell','Bridge','Portfolio','Prices'];

export default function Chat({ user, chain, portfolio, onPortfolioUpdate, onBridgeStart, onBridgeEnd }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const bottomRef = useRef(null);
  const taRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({behavior:'smooth'}); }, [messages, loading]);

  const autoResize = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height='20px';
    ta.style.height=Math.min(ta.scrollHeight,100)+'px';
  };

  const send = async (text) => {
    const msg = text || input.trim();
    if (!msg || loading) return;
    setInput('');
    if (taRef.current) taRef.current.style.height='20px';

    const userMsg = {role:'user',content:msg};
    setMessages(prev=>[...prev,userMsg]);
    setLoading(true);

    try {
      const history = [...messages, userMsg].map(m=>({role:m.role,content:m.content}));
      const {data} = await axios.post('/api/chat',{messages:history,userId:user.id,chain});
      const aiMsg = {role:'assistant',content:data.reply};
      if (data.action) {
        aiMsg.action = data.action;
        if (data.action.requiresConfirm) setPendingAction(data.action);
        if (data.action.type==='bridge'||data.action.type==='bridge_and_buy') onBridgeStart?.();
      }
      setMessages(prev=>[...prev,aiMsg]);
      if (!data.action?.requiresConfirm) onPortfolioUpdate();
    } catch {
      setMessages(prev=>[...prev,{role:'assistant',content:'Something went wrong. Please try again.'}]);
    } finally { setLoading(false); }
  };

  const confirmAction = async (action, confirmed) => {
    setPendingAction(null);
    if (!confirmed) {
      setMessages(prev=>[...prev,{role:'assistant',content:'Action cancelled.'}]);
      return;
    }
    setLoading(true);
    try {
      const {data} = await axios.post('/api/trade/execute',{action,userId:user.id});
      setMessages(prev=>[...prev,{role:'assistant',content:data.message,receipt:data.receipt}]);
      onPortfolioUpdate();
      if (action.type==='bridge_and_buy') setTimeout(()=>{ onBridgeEnd?.(); onPortfolioUpdate(); },35000);
    } catch (e) {
      setMessages(prev=>[...prev,{role:'assistant',content:e.response?.data?.error||'Trade failed.'}]);
    } finally { setLoading(false); }
  };

  const isBridgeAction = (a) => a?.type==='bridge'||a?.type==='bridge_and_buy';

  return (
    <div style={S.wrap}>
      <div style={S.header}>
        <div style={S.dot}/>
        <span style={S.headerText}>Manager Agent</span>
        <span style={S.chainBadge(chain)}>{chain==='sui'?'Sui':'Arbitrum'}</span>
        <span style={S.headerSub}>Claude · CCTP · Privy</span>
      </div>

      <div style={S.messages}>
        {messages.length===0 && (
          <div style={S.welcome}>
            <h2 style={S.welcomeTitle}>Good {getTime()}, {user.name?.split(' ')[0]||'there'}.</h2>
            <p style={S.welcomeSub}>I manage your RWA stock portfolio across Arbitrum and Sui. I bridge automatically via CCTP when needed — just tell me what to do.</p>
            <div style={S.suggestions}>{SUGGESTIONS.map(s=><div key={s} style={S.suggestion} onClick={()=>send(s)}>{s}</div>)}</div>
          </div>
        )}

        {messages.map((m,i)=>(
          <div key={i} style={S.msgWrap(m.role)}>
            <div>
              <div style={S.bubble(m.role)}>
                {m.role==='assistant' ? <ReactMarkdown>{m.content}</ReactMarkdown> : m.content}
              </div>

              {/* Trade confirmation card */}
              {m.action?.requiresConfirm && pendingAction && !isBridgeAction(m.action) && (
                <div style={S.actionCard}>
                  <div style={S.actionRow}><span style={S.actionLabel}>Action</span><span style={S.actionVal}>{m.action.type?.toUpperCase()}</span></div>
                  <div style={S.actionRow}><span style={S.actionLabel}>Chain</span><span style={S.actionVal}>{(m.action.chain||chain).toUpperCase()}</span></div>
                  <div style={S.actionRow}><span style={S.actionLabel}>Stock</span><span style={S.actionVal}>{m.action.symbol}</span></div>
                  <div style={S.actionRow}><span style={S.actionLabel}>Shares</span><span style={S.actionVal}>{m.action.shares}</span></div>
                  <div style={S.actionRow}><span style={S.actionLabel}>Est. Cost</span><span style={S.actionVal}>${m.action.estimatedCost?.toFixed(2)}</span></div>
                  <div style={S.confirmBtns}>
                    <button style={S.confirmBtn('cancel')} onClick={()=>confirmAction(m.action,false)}>Cancel</button>
                    <button style={S.confirmBtn('confirm')} onClick={()=>confirmAction(m.action,true)}>Confirm</button>
                  </div>
                </div>
              )}

              {/* Bridge + buy card */}
              {m.action?.requiresConfirm && pendingAction && isBridgeAction(m.action) && (
                <div style={S.bridgeCard}>
                  <div style={{color:'var(--sui)',fontWeight:700,marginBottom:6}}>🌉 Bridge + Buy</div>
                  <div style={S.actionRow}><span style={S.actionLabel}>Bridge</span><span style={S.actionVal}>${m.action.bridgeAmount?.toFixed(2)} Sui → Arb</span></div>
                  <div style={S.actionRow}><span style={S.actionLabel}>Then Buy</span><span style={S.actionVal}>{m.action.shares} {m.action.symbol}</span></div>
                  <div style={S.actionRow}><span style={S.actionLabel}>Via</span><span style={S.actionVal}>CCTP (Circle) · ~30s</span></div>
                  <div style={S.confirmBtns}>
                    <button style={S.confirmBtn('cancel')} onClick={()=>confirmAction(m.action,false)}>Cancel</button>
                    <button style={S.confirmBtn('confirm')} onClick={()=>confirmAction(m.action,true)}>Bridge & Buy</button>
                  </div>
                </div>
              )}

              {/* Receipt */}
              {m.receipt && (
                <div style={S.receipt}>
                  <div style={{color:'var(--green)',marginBottom:3}}>✓ {m.receipt.type==='bridge_initiated'?'BRIDGE INITIATED':'TRADE EXECUTED'}</div>
                  <div style={{color:'var(--text3)'}}>Tx: {m.receipt.txHash?.slice(0,22)}…</div>
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div style={S.msgWrap('assistant')}>
            <div style={S.bubble('assistant')}>
              <div style={S.thinking}>
                <span style={S.thinkingDot(0)}/><span style={S.thinkingDot(1)}/><span style={S.thinkingDot(2)}/>
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef}/>
      </div>

      <div style={S.inputArea}>
        <div style={S.chips}>
          {CHIPS.map(c=><div key={c} style={S.chip} onClick={()=>setInput(c+' ')}>{c}</div>)}
        </div>
        <div style={S.inputRow}>
          <textarea ref={taRef} style={S.textarea} rows={1} placeholder={`Ask about your ${chain} portfolio…`} value={input}
            onChange={e=>{setInput(e.target.value);autoResize();}}
            onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}}}
          />
          <button style={S.sendBtn(input.trim().length>0)} onClick={()=>send()}>↑</button>
        </div>
      </div>
    </div>
  );
}

function getTime() {
  const h = new Date().getHours();
  return h<12?'morning':h<17?'afternoon':'evening';
}
