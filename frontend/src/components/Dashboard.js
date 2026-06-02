import React, { useState, useEffect } from 'react';
import Chat from './Chat';
import Portfolio from './Portfolio';
import axios from 'axios';

const S = {
  wrap: { display:'flex', height:'100vh', background:'var(--bg)', overflow:'hidden' },
  sidebar: { width:200, minWidth:200, background:'var(--bg2)', borderRight:'1px solid var(--border)', display:'flex', flexDirection:'column', padding:'20px 0' },
  logo: { padding:'0 20px 16px', borderBottom:'1px solid var(--border)', marginBottom:12 },
  logoText: { fontSize:18, fontWeight:800 },
  logoSub: { fontFamily:'var(--font-mono)', fontSize:9, color:'var(--accent)', letterSpacing:'0.15em', textTransform:'uppercase', marginTop:2 },
  chainToggle: { display:'flex', margin:'0 12px 12px', borderRadius:8, overflow:'hidden', border:'1px solid var(--border)' },
  chainBtn: (active, chain) => ({ flex:1, padding:'6px 0', fontSize:11, fontWeight:700, fontFamily:'var(--font-mono)', border:'none', cursor:'pointer', background: active ? (chain==='sui'?'var(--sui)':'var(--arb)') : 'transparent', color: active ? '#fff' : 'var(--text3)', transition:'all 0.2s' }),
  navItem: (active) => ({ display:'flex', alignItems:'center', gap:8, padding:'9px 20px', cursor:'pointer', fontSize:13, fontWeight:active?600:400, color:active?'var(--text)':'var(--text2)', background:active?'var(--bg3)':'transparent', borderLeft:active?'2px solid var(--accent)':'2px solid transparent', transition:'all 0.15s' }),
  navIcon: { fontSize:13, width:16, textAlign:'center' },
  sideBottom: { marginTop:'auto', padding:'14px 20px', borderTop:'1px solid var(--border)' },
  userRow: { display:'flex', alignItems:'center', gap:8 },
  avatar: { width:30, height:30, borderRadius:7, background:'var(--accent)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700, color:'#fff', flexShrink:0 },
  userName: { fontSize:12, fontWeight:600 },
  userEmail: { fontFamily:'var(--font-mono)', fontSize:9, color:'var(--text3)' },
  walletRow: { marginTop:6, fontFamily:'var(--font-mono)', fontSize:9, color:'var(--text3)', lineHeight:1.8 },
  walletAddr: { color:'var(--text2)' },
  logoutBtn: { marginTop:8, width:'100%', padding:'6px', background:'transparent', border:'1px solid var(--border)', borderRadius:6, color:'var(--text3)', fontSize:11, fontFamily:'var(--font-mono)' },
  main: { flex:1, display:'flex', flexDirection:'column', overflow:'hidden' },
  ticker: { height:34, background:'var(--bg2)', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', padding:'0 16px', gap:20, overflow:'hidden', flexShrink:0 },
  tickerItem: { display:'flex', alignItems:'center', gap:5, fontFamily:'var(--font-mono)', fontSize:10, whiteSpace:'nowrap', color:'var(--text2)' },
  tickerSym: { color:'var(--text)', fontWeight:500 },
  tickerUp: { color:'var(--green)' },
  tickerDown: { color:'var(--red)' },
  bridgeBanner: { margin:'6px 12px', padding:'7px 12px', background:'rgba(77,162,255,0.08)', border:'1px solid rgba(77,162,255,0.3)', borderRadius:8, fontFamily:'var(--font-mono)', fontSize:11, color:'var(--sui)', display:'flex', alignItems:'center', gap:6 },
  content: { flex:1, overflow:'hidden', display:'flex', flexDirection:'column' },
};

const TICKERS = [
  {sym:'AAPLX',price:'189.42',chg:'+1.2%',up:true},{sym:'TSLAX',price:'248.71',chg:'-0.8%',up:false},
  {sym:'NVDAX',price:'512.30',chg:'+3.1%',up:true},{sym:'GOOGLX',price:'174.55',chg:'+0.4%',up:true},
  {sym:'MSFTX',price:'415.22',chg:'-0.2%',up:false},{sym:'METAX',price:'521.44',chg:'+2.2%',up:true},
];

const NAV = [
  {id:'chat',icon:'◎',label:'Chat'},
  {id:'portfolio',icon:'◈',label:'Portfolio'},
  {id:'activity',icon:'◐',label:'Activity'},
];

export default function Dashboard({ user, onLogout }) {
  const [activeNav, setActiveNav] = useState('chat');
  const [chain, setChain] = useState('arbitrum');
  const [portfolio, setPortfolio] = useState(null);
  const [bridgePending, setBridgePending] = useState(false);

  const fetchPortfolio = async () => {
    try {
      const { data } = await axios.get('/api/portfolio', { headers: { 'x-user-id': user.id } });
      setPortfolio(data);
    } catch {}
  };

  useEffect(() => { fetchPortfolio(); }, []);

  const initials = (user.name || user.email || 'U').slice(0,2).toUpperCase();
  const shortAddr = (addr) => addr ? addr.slice(0,6)+'…'+addr.slice(-4) : 'Not set';

  return (
    <div style={S.wrap}>
      <div style={S.sidebar}>
        <div style={S.logo}>
          <div style={S.logoText}>Manager</div>
          <div style={S.logoSub}>Multi-Chain · RWA</div>
        </div>
        <div style={S.chainToggle}>
          <button style={S.chainBtn(chain==='arbitrum','arb')} onClick={()=>setChain('arbitrum')}>ARB</button>
          <button style={S.chainBtn(chain==='sui','sui')} onClick={()=>setChain('sui')}>SUI</button>
        </div>
        {bridgePending && <div style={S.bridgeBanner}>🌉 Bridge in progress…</div>}
        {NAV.map(n=>(
          <div key={n.id} style={S.navItem(activeNav===n.id)} onClick={()=>setActiveNav(n.id)}>
            <span style={S.navIcon}>{n.icon}</span>{n.label}
          </div>
        ))}
        <div style={S.sideBottom}>
          <div style={S.userRow}>
            <div style={S.avatar}>{initials}</div>
            <div>
              <div style={S.userName}>{user.name||'User'}</div>
              <div style={S.userEmail}>{user.email}</div>
            </div>
          </div>
          <div style={S.walletRow}>
            <div>EVM: <span style={S.walletAddr}>{shortAddr(user.evmAddress)}</span></div>
            {user.suiAddress && <div>SUI: <span style={S.walletAddr}>{shortAddr(user.suiAddress)}</span></div>}
          </div>
          <button style={S.logoutBtn} onClick={onLogout}>Sign out</button>
        </div>
      </div>

      <div style={S.main}>
        <div style={S.ticker}>
          {TICKERS.map(t=>(
            <div key={t.sym} style={S.tickerItem}>
              <span style={S.tickerSym}>{t.sym}</span>
              <span>{t.price}</span>
              <span style={t.up?S.tickerUp:S.tickerDown}>{t.chg}</span>
            </div>
          ))}
        </div>
        <div style={S.content}>
          {activeNav==='chat' && <Chat user={user} chain={chain} portfolio={portfolio} onPortfolioUpdate={fetchPortfolio} onBridgeStart={()=>setBridgePending(true)} onBridgeEnd={()=>setBridgePending(false)} />}
          {activeNav==='portfolio' && <Portfolio user={user} portfolio={portfolio} chain={chain} onRefresh={fetchPortfolio} fullPage />}
          {activeNav==='activity' && <Activity user={user} />}
        </div>
      </div>
    </div>
  );
}

function Activity({ user }) {
  const [txs, setTxs] = useState([]);
  const [bridges, setBridges] = useState([]);
  useEffect(() => {
    axios.get('/api/portfolio/history',{headers:{'x-user-id':user.id}}).then(r=>setTxs(r.data.history||[])).catch(()=>{});
    axios.get('/api/bridge/history',{headers:{'x-user-id':user.id}}).then(r=>setBridges(r.data.history||[])).catch(()=>{});
  }, []);
  const S2 = {
    wrap:{padding:'24px',overflowY:'auto',height:'100%'},
    title:{fontSize:18,fontWeight:700,marginBottom:20},
    section:{marginBottom:24},
    sTitle:{fontFamily:'var(--font-mono)',fontSize:10,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:10},
    row:{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'11px 13px',background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:8,marginBottom:6},
    sym:{fontWeight:700,fontSize:13},
    detail:{fontFamily:'var(--font-mono)',fontSize:10,color:'var(--text3)',marginTop:2},
    amount:{fontFamily:'var(--font-mono)',fontSize:12,fontWeight:500},
    date:{fontFamily:'var(--font-mono)',fontSize:10,color:'var(--text3)',marginTop:2,textAlign:'right'},
    badge:(type)=>({display:'inline-block',padding:'2px 7px',borderRadius:4,fontSize:9,fontFamily:'var(--font-mono)',fontWeight:600,background:type==='buy'?'rgba(0,200,83,0.1)':'rgba(229,57,53,0.1)',color:type==='buy'?'var(--green)':'var(--red)',marginLeft:6}),
    chainTag:(c)=>({display:'inline-block',padding:'1px 6px',borderRadius:4,fontSize:9,fontFamily:'var(--font-mono)',background:c==='sui'?'rgba(77,162,255,0.1)':'rgba(40,160,240,0.1)',color:c==='sui'?'var(--sui)':'var(--arb)',marginLeft:4}),
    bridgeRow:{display:'flex',justifyContent:'space-between',padding:'10px 13px',background:'rgba(77,162,255,0.05)',border:'1px solid rgba(77,162,255,0.2)',borderRadius:8,marginBottom:6},
    empty:{color:'var(--text3)',fontFamily:'var(--font-mono)',fontSize:12},
  };
  return (
    <div style={S2.wrap}>
      <div style={S2.title}>Activity</div>
      <div style={S2.section}>
        <div style={S2.sTitle}>Bridges</div>
        {bridges.length===0 ? <div style={S2.empty}>No bridges yet.</div> : bridges.map((b,i)=>(
          <div key={i} style={S2.bridgeRow}>
            <div>
              <div style={{fontFamily:'var(--font-mono)',fontSize:12,fontWeight:600}}>🌉 {b.from_chain.toUpperCase()} → {b.to_chain.toUpperCase()}</div>
              <div style={S2.detail}>${b.amount_usdc} USDC via CCTP</div>
            </div>
            <div style={{textAlign:'right'}}>
              <div style={{fontFamily:'var(--font-mono)',fontSize:11,color:b.status==='completed'?'var(--green)':b.status==='failed'?'var(--red)':'var(--yellow)'}}>{b.status}</div>
              <div style={S2.date}>{new Date(b.created_at).toLocaleDateString()}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={S2.section}>
        <div style={S2.sTitle}>Trades</div>
        {txs.length===0 ? <div style={S2.empty}>No trades yet.</div> : txs.map((tx,i)=>(
          <div key={i} style={S2.row}>
            <div>
              <div style={S2.sym}>{tx.symbol}<span style={S2.badge(tx.type)}>{tx.type.toUpperCase()}</span><span style={S2.chainTag(tx.chain)}>{tx.chain}</span></div>
              <div style={S2.detail}>{tx.shares} shares @ ${tx.price}</div>
            </div>
            <div>
              <div style={S2.amount}>${(tx.shares*tx.price).toFixed(2)}</div>
              <div style={S2.date}>{new Date(tx.timestamp).toLocaleDateString()}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
