import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import { useUserWallets, useDynamicContext } from '@dynamic-labs/sdk-react-core';
import { isSuiWallet } from '@dynamic-labs/sui';
import { isSolanaWallet } from '@dynamic-labs/solana';
import { Transaction } from '@mysten/sui/transactions';
import { Transaction as SolTransaction } from '@solana/web3.js';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';

const CCTP = {
  TOKEN_MESSENGER_MINTER: '0x2aa6c5d56376c371f88a6cc42e852824994993cb9bab8d3e6450cbe3cb32b94e',
  TOKEN_MESSENGER_STATE:  '0x45993eecc0382f37419864992c12faee2238f5cfe22b98ad3bf455baf65c8a2f',
  MESSAGE_TRANSMITTER_STATE: '0xf68268c3d9b1df3215f2439400c1c4ea08ac4ef4bb7d6f3ca6a2a239e17510af',
  USDC_TREASURY: '0x57d6725e7a8b49a7b2a612f6bd66ab5f39fc95332ca48be421c3229d514a6de7',
  DENY_LIST: '0x0000000000000000000000000000000000000000000000000000000000000403',
  USDC_TYPE: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
  SOLANA_DOMAIN: 5,
  AGENT_ATA: '6fnbQ8eaU5WhJEqD9LgzWigZ7nLcJdVMmAvvLSL3FvgP',
};

function base58ToHex(str) {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let result = BigInt(0);
  for (const c of str) result = result * 58n + BigInt(ALPHABET.indexOf(c));
  let hex = result.toString(16);
  while (hex.length < 64) hex = '0' + hex;
  return '0x' + hex;
}

function ConfirmModal({ action, onConfirm, onCancel }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#00000080', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#12121A', border: '1px solid #C9A84C30', borderRadius: 12, padding: 28, maxWidth: 340, width: '90%', fontFamily: 'Georgia, serif' }}>
        <div style={{ fontSize: 10, color: '#C9A84C', letterSpacing: '0.2em', marginBottom: 16 }}>CONFIRM TRADE</div>
        <div style={{ fontSize: 13, color: '#E8DCC8', marginBottom: 8 }}>
          <strong>{action.action?.toUpperCase()}</strong> {action.symbol}
        </div>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 20 }}>
          Amount: ${action.amount} USD
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onCancel} style={{ flex: 1, padding: 10, background: 'none', border: '1px solid #1C1C22', color: '#555', borderRadius: 6, cursor: 'pointer', fontSize: 10, fontFamily: 'Georgia, serif' }}>CANCEL</button>
          <button onClick={onConfirm} style={{ flex: 2, padding: 10, background: '#C9A84C', border: 'none', color: '#0C0C10', borderRadius: 6, cursor: 'pointer', fontSize: 10, fontWeight: 700, fontFamily: 'Georgia, serif' }}>CONFIRM</button>
        </div>
      </div>
    </div>
  );
}

const parseAction = (text) => {
  const fenced = text.match(/```json\s*([\s\S]*?)```/);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch {} }
  const raw = text.match(/\{[\s\S]*?"action"[\s\S]*?"symbol"[\s\S]*?\}/);
  if (raw) { try { return JSON.parse(raw[0]); } catch {} }
  return null;
};

export default function Chat({ user, chain }) {
  const userWallets = useUserWallets();
  const { primaryWallet } = useDynamicContext();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const token = localStorage.getItem('managerx_token');

  useEffect(() => {
    axios.get(`/api/chat/history/${chain}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(({ data }) => { if (data.messages?.length) setMessages(data.messages); })
      .catch(() => {});
  }, [chain]);

  const send = useCallback(async (text) => {
    const msg = text || input.trim();
    if (!msg || loading) return;
    setInput('');
    const newMessages = [...messages, { role: 'user', content: msg }];
    setMessages(newMessages);
    setLoading(true);
    try {
      const { data } = await axios.post('/api/chat', { messages: newMessages, chain }, { headers: { Authorization: `Bearer ${token}` } });
      const reply = data.reply;
      setMessages([...newMessages, { role: 'assistant', content: reply }]);
      const action = parseAction(reply);
      if (action?.action) setPendingAction(action);
    } catch {
      setMessages([...newMessages, { role: 'assistant', content: 'Something went wrong. Please try again.' }]);
    } finally { setLoading(false); }
  }, [messages, input, loading, chain, token]);

  const handleConfirm = async () => {
    const action = pendingAction;
    setPendingAction(null);

    try {
      let suiTxHash = null;
      let solTxHash = null;
      let execUserSuiAddress = null;

      if (chain === 'sui') {
        if (action.action === 'sell') {
          // ── SELL: transfer xStock Solana→agent, backend swaps+bridges USDC→Sui ──
          const solWallet = userWallets?.find(w => isSolanaWallet(w));
          if (!solWallet) throw new Error('Solana wallet not connected. Please connect your Solana wallet.');

          const suiAddress = user.suiAddress;
          if (!suiAddress) throw new Error('Sui address not found on your account.');

          // Step 1: Backend builds the unsigned Solana SPL transfer tx
          const { data: buildData } = await axios.post('/api/trade/build-sell-transfer', {
            symbol: action.symbol,
            amount: action.amount,
            currency: action.currency || 'usd',
          }, { headers: { Authorization: `Bearer ${token}` } });

          // Step 2: User signs + submits via their Solana wallet
          const connection = await solWallet.getConnection();
          // atob → Uint8Array avoids needing a Buffer polyfill in the browser
          const txBytes = Uint8Array.from(atob(buildData.transaction), c => c.charCodeAt(0));
          const solTx = SolTransaction.from(txBytes);
          // Dynamic's WaaS SVM wallet routes signAndSendTransaction through a UI popup
          // that incorrectly labels the network as "Ethereum". Use internalSignAndSendTransaction
          // to bypass the popup. The WaaS connector requires activeAccountAddress to be set
          // before signing (same pattern as the Sui WaaS connector).
          // For injected wallets (Phantom etc.) fall back to the signer directly.
          const solConnector = solWallet._connector;
          if (solConnector && typeof solConnector.internalSignAndSendTransaction === 'function') {
            if (typeof solConnector.setActiveAccountAddress === 'function') {
              solConnector.setActiveAccountAddress(solWallet.address);
            }
            solTxHash = await solConnector.internalSignAndSendTransaction(solTx);
          } else {
            const signer = await solWallet.getSigner();
            const { signature } = await signer.signAndSendTransaction(solTx);
            solTxHash = signature;
          }
          await connection.confirmTransaction(solTxHash, 'confirmed');
          console.log('xStock transfer to agent confirmed:', solTxHash);

          execUserSuiAddress = suiAddress;

        } else {
          // ── BUY: user burns USDC on Sui, agent sponsors gas ──────────────────
          let suiWallet = userWallets?.find(w => isSuiWallet(w));
          if (!suiWallet && primaryWallet && isSuiWallet(primaryWallet)) suiWallet = primaryWallet;
          if (!suiWallet) throw new Error('Sui wallet not connected. Please reconnect.');

          const suiAddress = suiWallet.address || user.suiAddress;
          console.log('Using Sui wallet:', suiWallet, 'address:', suiAddress);

          const amountMist = BigInt(Math.round(action.amount * 1e6));
          const mintRecipientHex = base58ToHex(CCTP.AGENT_ATA);

          const suiClient = new SuiClient({ url: getFullnodeUrl('mainnet') });
          const coins = await suiClient.getCoins({ owner: suiAddress, coinType: CCTP.USDC_TYPE });
          if (!coins.data.length) throw new Error('No USDC in your Sui wallet');

          const totalBalance = coins.data.reduce((a, c) => a + BigInt(c.balance), 0n);
          if (totalBalance < amountMist) throw new Error(`Insufficient USDC balance ($${(Number(totalBalance)/1e6).toFixed(2)} available)`);

          // Step 1: Build the tx kind only (no gas — agent will sponsor)
          const tx = new Transaction();
          // Merge all coin objects so fragmented balances combine into one
          const primaryCoin = tx.object(coins.data[0].coinObjectId);
          if (coins.data.length > 1) {
            tx.mergeCoins(primaryCoin, coins.data.slice(1).map(c => tx.object(c.coinObjectId)));
          }
          let coinArg;
          if (totalBalance === amountMist) {
            coinArg = primaryCoin;
          } else {
            [coinArg] = tx.splitCoins(primaryCoin, [amountMist]);
          }
          tx.moveCall({
            target: `${CCTP.TOKEN_MESSENGER_MINTER}::deposit_for_burn::deposit_for_burn`,
            typeArguments: [CCTP.USDC_TYPE],
            arguments: [
              coinArg,
              tx.pure.u32(CCTP.SOLANA_DOMAIN),
              tx.pure.address(mintRecipientHex),
              tx.object(CCTP.TOKEN_MESSENGER_STATE),
              tx.object(CCTP.MESSAGE_TRANSMITTER_STATE),
              tx.object(CCTP.DENY_LIST),
              tx.object(CCTP.USDC_TREASURY),
            ],
          });
          const txKindBytes = Buffer.from(
            await tx.build({ client: suiClient, onlyTransactionKind: true })
          ).toString('base64');

          // Step 2: Backend wraps with agent gas + signs
          const { data: sponsored } = await axios.post('/api/trade/sponsor-sui-tx', {
            txKindBytes,
            senderAddress: suiAddress,
          }, { headers: { Authorization: `Bearer ${token}` } });

          // Step 3: User signs the sponsored tx bytes
          const sponsoredTxBytes = Uint8Array.from(atob(sponsored.txBytes), c => c.charCodeAt(0));
          const connector = suiWallet._connector;
          if (!connector) throw new Error('Sui wallet connector not found');
          await connector.connect();
          // WaaS connector requires the active address to be set before signing
          if (connector.setActiveAccountAddress) connector.setActiveAccountAddress(suiAddress);
          const sponsoredTx = Transaction.from(sponsoredTxBytes);
          const signedTx = await connector.signTransaction(sponsoredTx);

          // Step 4: Submit with both signatures (user + agent)
          const result = await suiClient.executeTransactionBlock({
            transactionBlock: signedTx.bytes,
            signature: [signedTx.signature, sponsored.agentSignature],
          });
          suiTxHash = result.digest;
          console.log('CCTP burn confirmed (sponsored):', suiTxHash);
        }
      }

      const { data } = await axios.post('/api/trade/execute', {
        chain,
        suiTxHash,
        solTxHash,
        userSuiAddress: execUserSuiAddress,
        action: {
          type: action.action,
          symbol: action.symbol,
          amount: action.amount,
          currency: action.currency || 'usd',
        },
      }, { headers: { Authorization: `Bearer ${token}` }, timeout: 120000 });

      const successMsg = {
        role: 'assistant',
        content: data.txHash
          ? `✅ Trade executed!\n\n**${action.action?.toUpperCase()}** ${action.symbol}\n**Amount:** $${action.amount}\n**Tx:** ${data.txHash.slice(0, 10)}...${data.txHash.slice(-6)}`
          : `✅ ${data.message}`,
      };
      setMessages(prev => [...prev, successMsg]);

    } catch (e) {
      const rootMsg = e.cause?.cause?.message || e.cause?.message || e.response?.data?.error || e.message;
      console.error('Trade error:', e, 'cause:', e.cause);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ Trade failed: ${rootMsg}`,
      }]);
    }
  };

  const handleNewChat = async () => {
    await axios.delete(`/api/chat/history/${chain}`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    setMessages([]);
  };

  const handleRecoverUsdc = async () => {
    const suiAddress = user.suiAddress;
    if (!suiAddress) {
      setMessages(prev => [...prev, { role: 'assistant', content: '❌ No Sui address found on your account.' }]);
      return;
    }
    setMessages(prev => [...prev, { role: 'assistant', content: '🔄 Checking for stuck USDC on Solana...' }]);
    try {
      const { data } = await axios.post('/api/trade/recover-solana-usdc',
        { userSuiAddress: suiAddress },
        { headers: { Authorization: `Bearer ${token}` }, timeout: 120000 }
      );
      setMessages(prev => [...prev, { role: 'assistant', content: `✅ ${data.message}` }]);
    } catch (e) {
      const msg = e.response?.data?.error || e.message;
      setMessages(prev => [...prev, { role: 'assistant', content: `❌ Recovery failed: ${msg}` }]);
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#0C0C10' }}>
      {pendingAction && (
        <ConfirmModal
          action={pendingAction}
          onConfirm={handleConfirm}
          onCancel={() => setPendingAction(null)}
        />
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: '#2A2A30', fontSize: 11, marginTop: 60, fontFamily: 'Georgia, serif', letterSpacing: '0.1em' }}>
            ASK YOUR PORTFOLIO AGENT
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{
            maxWidth: '80%', padding: '10px 14px', borderRadius: 10, fontSize: 12, lineHeight: 1.7,
            alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
            background: m.role === 'user' ? '#C9A84C' : '#12121A',
            color: m.role === 'user' ? '#0C0C10' : '#E8DCC8',
            fontFamily: 'Georgia, serif',
            border: m.role === 'assistant' ? '1px solid #1C1C22' : 'none',
          }}>
            {m.role === 'assistant'
              ? <ReactMarkdown>{m.content}</ReactMarkdown>
              : m.content}
          </div>
        ))}
        {loading && (
          <div style={{ alignSelf: 'flex-start', color: '#C9A84C', fontSize: 10, letterSpacing: '0.2em', fontFamily: 'Georgia, serif' }}>
            THINKING...
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid #1C1C22', display: 'flex', gap: 8, background: '#0E0E14' }}>
        <button onClick={handleNewChat} style={{ background: 'none', border: 'none', color: '#2A2A30', cursor: 'pointer', fontSize: 14, padding: '0 4px' }} title="New chat">✦</button>
        {chain === 'sui' && (
          <button onClick={handleRecoverUsdc} style={{ background: 'none', border: 'none', color: '#2A2A30', cursor: 'pointer', fontSize: 9, letterSpacing: '0.1em', padding: '0 4px', fontFamily: 'Georgia, serif' }} title="Bridge any stuck USDC on Solana back to your Sui wallet">RECOVER</button>
        )}
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
          placeholder={`Ask about your ${chain} portfolio...`}
          style={{ flex: 1, background: 'none', border: 'none', color: '#E8DCC8', fontSize: 12, outline: 'none', fontFamily: 'Georgia, serif' }}
        />
        <button onClick={() => send()} style={{ background: 'none', border: 'none', color: '#C9A84C', cursor: 'pointer', fontSize: 10, letterSpacing: '0.1em', fontFamily: 'Georgia, serif' }}>SEND</button>
      </div>
    </div>
  );
}
