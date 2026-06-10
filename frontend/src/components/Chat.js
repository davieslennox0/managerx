import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import { useUserWallets, useDynamicContext } from '@dynamic-labs/sdk-react-core';
import { isSuiWallet } from '@dynamic-labs/sui';
import { isSolanaWallet } from '@dynamic-labs/solana';
import { Transaction } from '@mysten/sui/transactions';
import { Transaction as SolTransaction, PublicKey as SolPublicKey, VersionedTransaction } from '@solana/web3.js';
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

// Returns the deterministic SPL Token USDC ATA for a Solana address.
// USDC uses the legacy SPL Token program, not Token-2022.
function getUserUsdcAta(userSolAddress) {
  const ASSOC_PROG = new SolPublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bM3');
  const TOKEN_PROG = new SolPublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  const USDC_MINT  = new SolPublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  const [ata] = SolPublicKey.findProgramAddressSync(
    [new SolPublicKey(userSolAddress).toBytes(), TOKEN_PROG.toBytes(), USDC_MINT.toBytes()],
    ASSOC_PROG
  );
  return ata.toBase58();
}

function ConfirmModal({ action, onConfirm, onCancel }) {
  const isBridge = action.action === 'bridge';
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#00000080', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#12121A', border: '1px solid #C9A84C30', borderRadius: 12, padding: 28, maxWidth: 340, width: '90%', fontFamily: 'Georgia, serif' }}>
        <div style={{ fontSize: 10, color: '#C9A84C', letterSpacing: '0.2em', marginBottom: 16 }}>{isBridge ? 'CONFIRM BRIDGE' : 'CONFIRM TRADE'}</div>
        <div style={{ fontSize: 13, color: '#E8DCC8', marginBottom: 8 }}>
          {isBridge
            ? <><strong>BRIDGE</strong> ${action.amount} USDC {action.direction === 'solana_to_sui' ? 'Solana → Sui' : 'Sui → Solana'}</>
            : <><strong>{action.action?.toUpperCase()}</strong> {action.symbol}</>}
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


export default function Chat({ user, chain }) {
  const userWallets = useUserWallets();
  const { primaryWallet } = useDynamicContext();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [gasApprovalNeeded, setGasApprovalNeeded] = useState(false);
  const [pendingRetry, setPendingRetry] = useState(null);
  const [gasSolUsdcBalance, setGasSolUsdcBalance] = useState(0);
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
      const action = data.action;
      if (reply) setMessages([...newMessages, { role: 'assistant', content: reply }]);
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

      if (chain === 'sui' && action.action === 'bridge' && action.direction === 'solana_to_sui') {
        // ── BRIDGE Solana→Sui: user signs Solana USDC transfer to agent, agent CCTP-bridges to Sui ──
        const solWallet = userWallets?.find(w => isSolanaWallet(w));
        if (!solWallet) throw new Error('Solana wallet not connected. Please connect your Solana wallet.');
        const suiAddress = user.suiAddress;
        if (!suiAddress) throw new Error('Sui address not found on your account.');

        const rawAmount = Math.round(action.amount * 1e6);

        const { data: buildData } = await axios.post('/api/trade/build-sol-to-sui-bridge', {
          rawAmount,
        }, { headers: { Authorization: `Bearer ${token}` } });

        const txBytes = Uint8Array.from(atob(buildData.txBase64), c => c.charCodeAt(0));
        const solTxForBridge = SolTransaction.from(txBytes);

        let userSignedTxBase64;
        const solConnector = solWallet._connector;
        if (solConnector && typeof solConnector.internalSignTransaction === 'function') {
          if (typeof solConnector.setActiveAccountAddress === 'function') {
            solConnector.setActiveAccountAddress(solWallet.address);
          }
          const signed = await solConnector.internalSignTransaction(solTxForBridge);
          userSignedTxBase64 = btoa(String.fromCharCode(...signed.serialize({ requireAllSignatures: false })));
        } else {
          const signer = await solWallet.getSigner();
          const signed = await signer.signTransaction(solTxForBridge);
          userSignedTxBase64 = btoa(String.fromCharCode(...signed.serialize({ requireAllSignatures: false })));
        }

        setMessages(prev => [...prev, { role: 'assistant', content: `🔄 Signed. Transferring $${action.amount} USDC Solana → Sui (30–60s)...` }]);

        const { data: bridgeResult } = await axios.post('/api/trade/submit-sol-to-sui-bridge', {
          signedTx: userSignedTxBase64,
          blockhash: buildData.blockhash,
          lastValidBlockHeight: buildData.lastValidBlockHeight,
          rawAmount,
          userSuiAddress: suiAddress,
        }, { headers: { Authorization: `Bearer ${token}` }, timeout: 120000 });

        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `✅ $${action.amount} USDC bridged to your Sui wallet!\n\n**Tx:** ${bridgeResult.suiMintTxHash?.slice(0, 10)}...`,
        }]);
        return;
      }

      if (chain === 'sui') {
        if (action.action === 'sell') {
          // ── SELL (non-custodial): user signs Jupiter swap directly ──
          // xStock goes: user wallet → Jupiter pool → USDC → agent ATA → CCTP bridge → Sui
          // Agent is fee payer only. xStock never enters agent wallet.
          const solWallet = userWallets?.find(w => isSolanaWallet(w));
          if (!solWallet) throw new Error('Solana wallet not connected. Please connect your Solana wallet.');
          const suiAddress = user.suiAddress;
          if (!suiAddress) throw new Error('Sui address not found on your account.');

          // Step 1: Build sell tx. Response also tells us if user needs gas.
          const { data: buildData } = await axios.post('/api/trade/build-sell-swap', {
            symbol: action.symbol,
            amount: action.amount,
            currency: action.currency || 'usd',
          }, { headers: { Authorization: `Bearer ${token}` } });

          const { VersionedTransaction: VT } = await import('@solana/web3.js');

          const signVT = async (base64) => {
            const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
            const vtx = VT.deserialize(bytes);
            try {
              const signer = await solWallet.getSigner();
              const signed = await signer.signTransaction(vtx);
              return btoa(String.fromCharCode(...signed.serialize()));
            } catch {
              const c = solWallet._connector;
              if (c?.setActiveAccountAddress) c.setActiveAccountAddress(solWallet.address);
              const signed = await c.internalSignTransaction(vtx);
              return btoa(String.fromCharCode(...signed.serialize()));
            }
          };

          // Step 2: If user has no SOL, convert $0.50 of their USDC → SOL first.
          // Agent pays fee for this one bootstrap (user has zero SOL — unavoidable).
          // After this, user pays all future gas from their own SOL.
          if (buildData.needsGas) {
            setMessages(prev => [...prev, { role: 'assistant', content: `⛽ No SOL for gas. Sign to convert $0.50 of your USDC → SOL (one-time setup)...` }]);
            const { data: gasData } = await axios.post('/api/trade/build-user-gas', {}, { headers: { Authorization: `Bearer ${token}` } });
            const signedGasTx = await signVT(gasData.txBase64);
            await axios.post('/api/trade/submit-user-gas', {
              signedTx: signedGasTx,
              blockhash: gasData.blockhash,
              lastValidBlockHeight: gasData.lastValidBlockHeight,
            }, { headers: { Authorization: `Bearer ${token}` }, timeout: 120000 });
          }

          setMessages(prev => [...prev, { role: 'assistant', content: `🔄 Sign to swap ${action.symbol} → USDC and bridge to Sui...` }]);

          // Step 3: User signs the sell tx — user is fee payer (uses their own SOL)
          const signedTxBase64 = await signVT(buildData.txBase64);

          // Step 3: Backend confirms swap + bridges USDC to Sui (one call, ~60s)
          const { data: sellResult } = await axios.post('/api/trade/submit-sell-swap', {
            signedTx: signedTxBase64,
            blockhash: buildData.blockhash,
            lastValidBlockHeight: buildData.lastValidBlockHeight,
            rawUsdcOutput: buildData.rawUsdcOutput,
            userSuiAddress: suiAddress,
            symbol: buildData.symbol,
            shares: buildData.shares,
            price: buildData.price,
          }, { headers: { Authorization: `Bearer ${token}` }, timeout: 180000 });

          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `✅ Sold ${action.symbol}! $${sellResult.usdcBridged} USDC bridged to your Sui wallet.\n\n**Swap:** ${sellResult.swapTxHash?.slice(0,10)}...\n**Sui:** ${sellResult.suiMintTxHash?.slice(0,10)}...`,
          }]);
          return;

        } else {
          // ── BUY: user burns USDC on Sui → USDC minted to user's Solana ATA ──
          let suiWallet = userWallets?.find(w => isSuiWallet(w));
          if (!suiWallet && primaryWallet && isSuiWallet(primaryWallet)) suiWallet = primaryWallet;
          if (!suiWallet) throw new Error('Sui wallet not connected. Please reconnect.');

          // Solana wallet needed for the Jupiter swap signature
          const solWallet = userWallets?.find(w => isSolanaWallet(w));
          if (!solWallet) throw new Error('Solana wallet not connected. Please connect your Solana wallet.');

          const suiAddress = suiWallet.address || user.suiAddress;
          const userSolAddress = solWallet.address;
          console.log('Using Sui wallet:', suiAddress, '| Solana wallet:', userSolAddress);

          // CCTP mint recipient = user's own USDC ATA (agent only collects fee)
          const amountMist = BigInt(Math.round(action.amount * 1e6));
          const mintRecipientHex = base58ToHex(getUserUsdcAta(userSolAddress));

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

          // Bridge: receive USDC on Solana and transfer to user's wallet (no trade)
          if (action.action === 'bridge') {
            setMessages(prev => [...prev, { role: 'assistant', content: `🔄 $${action.amount} USDC burned on Sui. Bridging to Solana (30–60s)...` }]);
            const { data: bridgeData } = await axios.post('/api/trade/bridge-to-solana', {
              suiTxHash,
              rawAmount: Math.round(action.amount * 1e6),
            }, { headers: { Authorization: `Bearer ${token}` }, timeout: 120000 });
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: `✅ $${action.amount} USDC bridged to your Solana wallet!\n\n**Tx:** ${bridgeData.mintTxHash?.slice(0, 10)}...`,
            }]);
            return;
          }
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

      // Buy flow: backend minted USDC to user's Solana ATA and built the Jupiter
      // swap tx. User must sign it with their Solana wallet to complete the trade.
      if (data.needsSwapSignature) {
        const { swapTx, blockhash, lastValidBlockHeight, tradeInfo } = data;
        const solWalletForSwap = userWallets?.find(w => isSolanaWallet(w));
        if (!solWalletForSwap) throw new Error('Solana wallet not available for swap signing');

        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `🔄 USDC bridged. Sign the Solana swap to receive your ${action.symbol}...`,
        }]);

        // Deserialize the VersionedTransaction (agent already pre-signed as fee payer)
        const txBytes = Uint8Array.from(atob(swapTx), c => c.charCodeAt(0));
        const vtx = VersionedTransaction.deserialize(txBytes);

        // Sign with user's Solana wallet
        let signedVtx;
        const solConnector = solWalletForSwap._connector;
        if (solConnector && typeof solConnector.internalSignTransaction === 'function') {
          if (typeof solConnector.setActiveAccountAddress === 'function') {
            solConnector.setActiveAccountAddress(solWalletForSwap.address);
          }
          signedVtx = await solConnector.internalSignTransaction(vtx);
        } else {
          const signer = await solWalletForSwap.getSigner();
          signedVtx = await signer.signTransaction(vtx);
        }
        const signedTxBase64 = btoa(String.fromCharCode(...signedVtx.serialize()));

        // Submit — backend just confirms on-chain and records the position
        const { data: submitData } = await axios.post('/api/trade/submit-buy-swap', {
          signedTx: signedTxBase64,
          blockhash,
          lastValidBlockHeight,
          tradeInfo,
        }, { headers: { Authorization: `Bearer ${token}` }, timeout: 120000 });

        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `✅ Trade executed!\n\n**BUY** ${action.symbol}\n**Amount:** $${action.amount}\n**Tx:** ${submitData.txHash.slice(0, 10)}...${submitData.txHash.slice(-6)}`,
        }]);
        return;
      }

      const successMsg = {
        role: 'assistant',
        content: data.txHash
          ? `✅ Trade executed!\n\n**${action.action?.toUpperCase()}** ${action.symbol}\n**Amount:** $${action.amount}\n**Tx:** ${data.txHash.slice(0, 10)}...${data.txHash.slice(-6)}`
          : `✅ ${data.message}`,
      };
      setMessages(prev => [...prev, successMsg]);

    } catch (e) {
      const errCode = e.response?.data?.error;
      if (errCode === 'GAS_INSUFFICIENT') {
        const solUsdc = e.response?.data?.userSolUsdcBalance || 0;
        setGasSolUsdcBalance(solUsdc);
        setPendingRetry(action);
        setGasApprovalNeeded(true);
        const msg = solUsdc >= 1
          ? `⚠️ Agent needs gas. You have $${solUsdc.toFixed(2)} USDC on Solana — approve a $1 transfer from your Solana wallet to fund it? (no bridge needed)`
          : `⚠️ Agent needs gas. You have $${solUsdc.toFixed(2)} USDC on Solana — approve transferring $1 USDC from your Sui wallet to Solana to fund it?`;
        setMessages(prev => [...prev, { role: 'assistant', content: msg }]);
        return;
      }
      const rootMsg = e.cause?.cause?.message || e.cause?.message || e.response?.data?.error || e.message;
      console.error('Trade error:', e, 'cause:', e.cause);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ Trade failed: ${rootMsg}`,
      }]);
    }
  };

  const handleGasTopup = async () => {
    setGasApprovalNeeded(false);
    setLoading(true);
    try {
      const solWallet = userWallets?.find(w => isSolanaWallet(w));

      // ── Path A: user has Solana USDC — Solana-native transfer, no bridge ──
      if (gasSolUsdcBalance >= 1 && solWallet) {
        const { data: buildData } = await axios.post('/api/trade/build-sol-gas-topup', {}, {
          headers: { Authorization: `Bearer ${token}` },
        });

        const txBytes = Uint8Array.from(atob(buildData.txBase64), c => c.charCodeAt(0));
        const solTx = SolTransaction.from(txBytes);

        let userSignedTxBase64;
        const solConnector = solWallet._connector;
        if (solConnector && typeof solConnector.internalSignTransaction === 'function') {
          if (typeof solConnector.setActiveAccountAddress === 'function') {
            solConnector.setActiveAccountAddress(solWallet.address);
          }
          const signed = await solConnector.internalSignTransaction(solTx);
          userSignedTxBase64 = btoa(String.fromCharCode(...signed.serialize({ requireAllSignatures: false })));
        } else {
          const signer = await solWallet.getSigner();
          const signed = await signer.signTransaction(solTx);
          userSignedTxBase64 = btoa(String.fromCharCode(...signed.serialize({ requireAllSignatures: false })));
        }

        setMessages(prev => [...prev, { role: 'assistant', content: '🔄 Solana USDC transfer signed. Funding gas...' }]);

        await axios.post('/api/trade/submit-sol-gas-topup', {
          signedTx: userSignedTxBase64,
          blockhash: buildData.blockhash,
          lastValidBlockHeight: buildData.lastValidBlockHeight,
        }, { headers: { Authorization: `Bearer ${token}` }, timeout: 60000 });

        const retry = pendingRetry;
        setPendingRetry(null);
        setGasSolUsdcBalance(0);
        setMessages(prev => [...prev, { role: 'assistant', content: '✅ Gas funded from Solana! Retrying your trade...' }]);
        if (retry) setPendingAction(retry);
        return;
      }

      // ── Path B: not enough Solana USDC — bridge $1 from Sui ──
      let suiWallet = userWallets?.find(w => isSuiWallet(w));
      if (!suiWallet && primaryWallet && isSuiWallet(primaryWallet)) suiWallet = primaryWallet;
      if (!suiWallet) throw new Error('Sui wallet not connected. Please reconnect.');

      const suiAddress = suiWallet.address || user.suiAddress;
      const amountMist = BigInt(1_000_000); // $1 USDC
      const mintRecipientHex = base58ToHex(CCTP.AGENT_ATA);

      const suiClient = new SuiClient({ url: getFullnodeUrl('mainnet') });
      const coins = await suiClient.getCoins({ owner: suiAddress, coinType: CCTP.USDC_TYPE });
      if (!coins.data.length) throw new Error('No USDC in your Sui wallet');
      const totalBalance = coins.data.reduce((a, c) => a + BigInt(c.balance), 0n);
      if (totalBalance < amountMist) throw new Error(`Need $1 USDC in Sui wallet (have $${(Number(totalBalance)/1e6).toFixed(2)})`);

      const tx = new Transaction();
      const primaryCoin = tx.object(coins.data[0].coinObjectId);
      if (coins.data.length > 1) tx.mergeCoins(primaryCoin, coins.data.slice(1).map(c => tx.object(c.coinObjectId)));
      let coinArg;
      if (totalBalance === amountMist) { coinArg = primaryCoin; }
      else { [coinArg] = tx.splitCoins(primaryCoin, [amountMist]); }

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

      const txKindBytes = Buffer.from(await tx.build({ client: suiClient, onlyTransactionKind: true })).toString('base64');

      const { data: sponsored } = await axios.post('/api/trade/sponsor-sui-tx', {
        txKindBytes, senderAddress: suiAddress,
      }, { headers: { Authorization: `Bearer ${token}` } });

      const sponsoredTxBytes = Uint8Array.from(atob(sponsored.txBytes), c => c.charCodeAt(0));
      const connector = suiWallet._connector;
      if (!connector) throw new Error('Sui wallet connector not found');
      await connector.connect();
      if (connector.setActiveAccountAddress) connector.setActiveAccountAddress(suiAddress);
      const signedTx = await connector.signTransaction(Transaction.from(sponsoredTxBytes));

      const result = await suiClient.executeTransactionBlock({
        transactionBlock: signedTx.bytes,
        signature: [signedTx.signature, sponsored.agentSignature],
      });
      const suiTxHash = result.digest;
      console.log('Gas bridge burn confirmed:', suiTxHash);

      setMessages(prev => [...prev, { role: 'assistant', content: '🔄 $1 transfer submitted. Bridging to Solana (30–60s)...' }]);

      await axios.post('/api/trade/bridge-for-gas', { suiTxHash }, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 120000,
      });

      const retry = pendingRetry;
      setPendingRetry(null);
      setMessages(prev => [...prev, { role: 'assistant', content: '✅ Gas funded! Retrying your trade...' }]);
      if (retry) {
        setPendingAction(retry);
      }
    } catch (e) {
      const msg = e.response?.data?.error || e.message;
      setMessages(prev => [...prev, { role: 'assistant', content: `❌ Gas transfer failed: ${msg}` }]);
      setPendingRetry(null);
    } finally {
      setLoading(false);
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
      const { data: balData } = await axios.get('/api/trade/agent-usdc-balance',
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!balData.rawAmount) {
        setMessages(prev => [...prev, { role: 'assistant', content: '✅ No stuck USDC found on Solana.' }]);
        return;
      }
      const { data } = await axios.post('/api/trade/recover-solana-usdc',
        { userSuiAddress: suiAddress, rawAmount: balData.rawAmount },
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
        {gasApprovalNeeded && !loading && (
          <div style={{ alignSelf: 'flex-start', display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              onClick={handleGasTopup}
              style={{ padding: '8px 16px', background: '#C9A84C', border: 'none', color: '#0C0C10', borderRadius: 6, cursor: 'pointer', fontSize: 10, fontWeight: 700, fontFamily: 'Georgia, serif', letterSpacing: '0.1em' }}
            >
              APPROVE $1 TRANSFER
            </button>
            <button
              onClick={() => { setGasApprovalNeeded(false); setPendingRetry(null); }}
              style={{ padding: '8px 16px', background: 'none', border: '1px solid #1C1C22', color: '#555', borderRadius: 6, cursor: 'pointer', fontSize: 10, fontFamily: 'Georgia, serif' }}
            >
              CANCEL
            </button>
          </div>
        )}
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
