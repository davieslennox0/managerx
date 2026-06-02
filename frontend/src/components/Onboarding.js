import React, { useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import axios from 'axios';

const S = {
  wrap: { height:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--bg)', position:'relative', overflow:'hidden' },
  grid: { position:'absolute', inset:0, backgroundImage:`linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)`, backgroundSize:'48px 48px', opacity:0.5 },
  glow: { position:'absolute', width:500, height:500, borderRadius:'50%', background:'radial-gradient(circle, rgba(0,212,170,0.06) 0%, transparent 70%)', top:'50%', left:'50%', transform:'translate(-50%,-50%)', pointerEvents:'none' },
  card: { position:'relative', width:420, padding:'48px', background:'var(--bg)', border:'1px solid var(--border)', borderRadius:16, animation:'fadeUp 0.5s ease both', boxShadow:'0 4px 40px rgba(0,0,0,0.06)' },
  eyebrow: { fontFamily:'var(--font-mono)', fontSize:11, letterSpacing:'0.2em', color:'var(--accent)', textTransform:'uppercase', marginBottom:16 },
  title: { fontSize:36, fontWeight:800, lineHeight:1.1, marginBottom:8 },
  sub: { fontSize:14, color:'var(--text2)', lineHeight:1.6, marginBottom:36 },
  googleBtn: { width:'100%', padding:'14px', background:'var(--text)', color:'#fff', border:'none', borderRadius:8, fontSize:14, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', gap:10, marginBottom:12, transition:'opacity 0.2s' },
  googleIcon: { width:18, height:18 },
  divider: { display:'flex', alignItems:'center', gap:12, margin:'20px 0', color:'var(--text3)', fontSize:12, fontFamily:'var(--font-mono)' },
  line: { flex:1, height:1, background:'var(--border)' },
  label: { display:'block', fontFamily:'var(--font-mono)', fontSize:11, letterSpacing:'0.1em', color:'var(--text3)', textTransform:'uppercase', marginBottom:6 },
  input: { width:'100%', padding:'12px 14px', background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:8, color:'var(--text)', fontSize:14, outline:'none', marginBottom:12 },
  btn: { width:'100%', padding:'13px', background:'var(--accent)', color:'var(--bg)', border:'none', borderRadius:8, fontSize:14, fontWeight:700, marginTop:4 },
  toggle: { textAlign:'center', marginTop:20, fontSize:13, color:'var(--text3)', fontFamily:'var(--font-mono)' },
  link: { color:'var(--accent)', cursor:'pointer' },
  err: { fontFamily:'var(--font-mono)', fontSize:12, color:'var(--red)', marginBottom:10 },
  chains: { display:'flex', gap:8, marginBottom:24 },
  chainBadge: (c) => ({ padding:'4px 10px', borderRadius:20, fontSize:11, fontFamily:'var(--font-mono)', background: c==='sui'?'rgba(77,162,255,0.1)':'rgba(40,160,240,0.1)', color: c==='sui'?'var(--sui)':'var(--arb)', border:`1px solid ${c==='sui'?'var(--sui)':'var(--arb)'}` }),
};

export default function Onboarding({ onLogin }) {
  const { login } = usePrivy();
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!email || !password) return setError('Email and password required.');
    setLoading(true); setError('');
    try {
      const ep = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const payload = mode === 'login' ? { email, password } : { email, password, name };
      const { data } = await axios.post(ep, payload);
      onLogin(data.user);
    } catch (e) { setError(e.response?.data?.error || 'Something went wrong.'); }
    finally { setLoading(false); }
  };

  const demoLogin = async () => {
    setLoading(true);
    try {
      const { data } = await axios.post('/api/auth/login', { email:'demo@manager.ai', password:'demo1234' });
      onLogin(data.user);
    } catch {
      try {
        const { data } = await axios.post('/api/auth/register', { email:'demo@manager.ai', password:'demo1234', name:'Demo User' });
        onLogin(data.user);
      } catch { setError('Demo failed.'); }
    } finally { setLoading(false); }
  };

  return (
    <div style={S.wrap}>
      <div style={S.grid} />
      <div style={S.glow} />
      <div style={S.card}>
        <div style={S.eyebrow}>Multi-Chain · RWA Stocks</div>
        <h1 style={S.title}>Manager</h1>
        <p style={S.sub}>AI-powered portfolio agent. Trade tokenized stocks on Arbitrum and Sui — just by having a conversation.</p>

        <div style={S.chains}>
          <span style={S.chainBadge('sui')}>Sui · zkLogin</span>
          <span style={S.chainBadge('arb')}>Arbitrum · CCTP</span>
          <span style={{ ...S.chainBadge('sui'), background:'rgba(0,212,170,0.1)', color:'var(--accent)', border:'1px solid var(--accent)' }}>Privy Wallets</span>
        </div>

        {/* Google Login */}
        <button style={S.googleBtn} onClick={() => login()} disabled={loading}>
          <svg style={S.googleIcon} viewBox="0 0 24 24">
            <path fill="#fff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#fff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#fff" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#fff" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Continue with Google
        </button>

        <div style={S.divider}><span style={S.line}/><span>or</span><span style={S.line}/></div>

        {mode === 'register' && (
          <><label style={S.label}>Name</label><input style={S.input} placeholder="Your name" value={name} onChange={e=>setName(e.target.value)} /></>
        )}
        <label style={S.label}>Email</label>
        <input style={S.input} type="email" placeholder="you@example.com" value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submit()} />
        <label style={S.label}>Password</label>
        <input style={S.input} type="password" placeholder="••••••••" value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submit()} />

        {error && <p style={S.err}>{error}</p>}
        <button style={S.btn} onClick={submit} disabled={loading}>{loading?'Working…':mode==='login'?'Sign In':'Create Account'}</button>

        <div style={S.toggle}>
          <span style={S.link} onClick={demoLogin}>Demo Account</span>
          {' · '}
          {mode==='login'
            ? <span>No account? <span style={S.link} onClick={()=>setMode('register')}>Register</span></span>
            : <span>Have one? <span style={S.link} onClick={()=>setMode('login')}>Sign in</span></span>
          }
        </div>
      </div>
    </div>
  );
}
