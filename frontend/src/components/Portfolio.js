import React from 'react';

const S = {
  wrap:{flex:1,overflowY:'auto',padding:'16px'},
  chainLabel:(c)=>({fontFamily:'var(--font-mono)',fontSize:10,fontWeight:700,color:c==='sui'?'var(--sui)':'var(--arb)',textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:10,display:'block'}),
  totalWrap:{marginBottom:14},
  totalLabel:{fontFamily:'var(--font-mono)',fontSize:9,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.1em'},
  totalValue:{fontSize:22,fontWeight:800,lineHeight:1.1,marginTop:2},
  totalChange:(up)=>({fontFamily:'var(--font-mono)',fontSize:10,color:up?'var(--green)':'var(--red)',marginTop:2}),
  cashCard:(c)=>({padding:'8px 10px',borderRadius:7,background:c==='sui'?'rgba(77,162,255,0.06)':'rgba(40,160,240,0.06)',border:`1px solid ${c==='sui'?'rgba(77,162,255,0.2)':'rgba(40,160,240,0.2)'}`,display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}),
  cashLabel:{fontFamily:'var(--font-mono)',fontSize:10,color:'var(--text3)'},
  cashValue:(c)=>({fontFamily:'var(--font-mono)',fontSize:13,fontWeight:600,color:c==='sui'?'var(--sui)':'var(--arb)'}),
  sectionTitle:{fontFamily:'var(--font-mono)',fontSize:9,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8},
  holding:{padding:'9px 10px',background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:7,marginBottom:5},
  holdingTop:{display:'flex',justifyContent:'space-between',alignItems:'center'},
  holdingSymbol:{fontSize:12,fontWeight:700},
  holdingValue:{fontFamily:'var(--font-mono)',fontSize:12},
  holdingBottom:{display:'flex',justifyContent:'space-between',marginTop:3},
  holdingShares:{fontFamily:'var(--font-mono)',fontSize:9,color:'var(--text3)'},
  holdingChg:(up)=>({fontFamily:'var(--font-mono)',fontSize:9,color:up?'var(--green)':'var(--red)'}),
  bar:{height:2,borderRadius:1,background:'var(--border)',marginTop:5,overflow:'hidden'},
  barFill:(pct,up)=>({height:'100%',borderRadius:1,width:pct+'%',background:up?'var(--green)':'var(--red)'}),
  empty:{color:'var(--text3)',fontFamily:'var(--font-mono)',fontSize:11,padding:'8px 0',lineHeight:1.8},
  bridgeBtn:{width:'100%',padding:'8px',background:'transparent',border:'1px solid rgba(77,162,255,0.4)',borderRadius:7,color:'var(--sui)',fontSize:11,fontFamily:'var(--font-mono)',fontWeight:600,marginTop:8,cursor:'pointer'},
};

export default function Portfolio({ user, portfolio, chain, onRefresh }) {
  const isArb = chain === 'arbitrum';
  const holdings = isArb ? (portfolio?.arbHoldings||[]) : (portfolio?.suiHoldings||[]);
  const cash = isArb ? (portfolio?.arbCashBalance??10000) : (portfolio?.suiCashBalance??0);
  const stockValue = isArb ? (portfolio?.arbStockValue??0) : (portfolio?.suiStockValue??0);
  const total = cash + stockValue;
  const totalCost = holdings.reduce((s,h)=>s+(h.avgPrice*h.shares),0);
  const pnl = stockValue - totalCost;
  const up = pnl >= 0;
  const maxVal = Math.max(...holdings.map(h=>h.currentValue||0), 1);

  return (
    <div style={S.wrap}>
      <span style={S.chainLabel(chain)}>{isArb?'Arbitrum':'Sui'} Portfolio</span>

      <div style={S.totalWrap}>
        <div style={S.totalLabel}>Total Value</div>
        <div style={S.totalValue}>${total.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
        {stockValue > 0 && <div style={S.totalChange(up)}>{up?'▲':'▼'} {up?'+':''}{pnl.toFixed(2)} all time</div>}
      </div>

      <div style={S.cashCard(chain)}>
        <span style={S.cashLabel}>USDC Balance</span>
        <span style={S.cashValue(chain)}>${cash.toLocaleString('en-US',{minimumFractionDigits:2})}</span>
      </div>

      <div style={S.sectionTitle}>Holdings</div>

      {holdings.length === 0 ? (
        <div style={S.empty}>
          No {isArb?'Arbitrum':'Sui'} positions yet.<br/>
          {isArb ? 'Try: "Buy 1 share of AAPLX"' : 'Try: "Buy 1 AAPL on Sui"'}
        </div>
      ) : holdings.map((h,i) => {
        const hUp = h.currentPrice >= h.avgPrice;
        const pnlPct = ((h.currentPrice-h.avgPrice)/h.avgPrice*100).toFixed(2);
        const pct = Math.min(100,((h.currentValue||0)/maxVal)*100);
        return (
          <div key={i} style={S.holding}>
            <div style={S.holdingTop}>
              <span style={S.holdingSymbol}>{h.symbol}</span>
              <span style={S.holdingValue}>${(h.currentValue||0).toFixed(2)}</span>
            </div>
            <div style={S.holdingBottom}>
              <span style={S.holdingShares}>{h.shares} sh @ ${h.avgPrice?.toFixed(2)}</span>
              <span style={S.holdingChg(hUp)}>{hUp?'+':''}{pnlPct}%</span>
            </div>
            <div style={S.bar}><div style={S.barFill(pct,hUp)}/></div>
          </div>
        );
      })}

      {!isArb && cash > 0 && (
        <button style={S.bridgeBtn}>🌉 Bridge to Arbitrum via CCTP</button>
      )}
    </div>
  );
}
