const axios = require('axios');

const PRIVY_APP_ID = process.env.PRIVY_APP_ID;
const PRIVY_SECRET = process.env.PRIVY_SECRET;

const privyClient = axios.create({
  baseURL: 'https://auth.privy.io/api/v1',
  auth: {
    username: PRIVY_APP_ID,
    password: PRIVY_SECRET,
  },
  headers: {
    'privy-app-id': PRIVY_APP_ID,
    'Content-Type': 'application/json',
  },
});

/**
 * Get or create a Privy user by email.
 * Returns their embedded EVM wallet address.
 */
async function getOrCreatePrivyUser(email) {
  try {
    // Search for existing user
    const search = await privyClient.get(`/users?email=${encodeURIComponent(email)}`);
    const existing = search.data?.data?.[0];

    if (existing) {
      const evmWallet = existing.linked_accounts?.find(
        a => a.type === 'wallet' && a.chain_type === 'ethereum'
      );
      return {
        privyUserId: existing.id,
        evmAddress: evmWallet?.address || null,
        isNew: false,
      };
    }
  } catch (e) {
    // User not found — create
  }

  try {
    // Create new user with embedded wallet
    const create = await privyClient.post('/users', {
      create_ethereum_wallet: true,
      linked_accounts: [{ type: 'email', address: email }],
    });

    const user = create.data;
    const evmWallet = user.linked_accounts?.find(
      a => a.type === 'wallet' && a.chain_type === 'ethereum'
    );

    return {
      privyUserId: user.id,
      evmAddress: evmWallet?.address || null,
      isNew: true,
    };
  } catch (e) {
    console.error('Privy create user error:', e.response?.data || e.message);
    // Fallback: generate a deterministic mock address for demo
    return {
      privyUserId: `mock_${email}`,
      evmAddress: generateMockEvmAddress(email),
      isNew: true,
    };
  }
}

/**
 * Sign a transaction using Privy's server-side wallet API
 */
async function signAndSendTransaction(privyUserId, walletAddress, txData) {
  try {
    const response = await privyClient.post(`/wallets/${walletAddress}/rpc`, {
      method: 'eth_sendTransaction',
      params: [txData],
      chain_id: 42161, // Arbitrum One
    });
    return response.data;
  } catch (e) {
    console.error('Privy tx error:', e.response?.data || e.message);
    throw e;
  }
}

/**
 * Verify a Privy access token
 */
async function verifyPrivyToken(token) {
  try {
    const response = await privyClient.post('/verify_token', { token });
    return response.data;
  } catch (e) {
    return null;
  }
}

// Fallback for demo mode
function generateMockEvmAddress(email) {
  const hash = email.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return '0x' + hash.toString(16).padStart(40, '0').slice(0, 40);
}

module.exports = { getOrCreatePrivyUser, signAndSendTransaction, verifyPrivyToken };
