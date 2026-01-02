# H173K Wallet PWA

A dedicated Progressive Web App wallet for H173K tokens on Solana blockchain.

## Features

### 🔐 Security
- **BIP39 Seed Phrase**: Compatible with Phantom wallet (12/24 words)
- **Encrypted Storage**: AES-256 encryption for seed phrase
- **PIN Protection**: 4-8 digit PIN code for quick access
- **Biometric Auth**: Face ID / Touch ID support (where available)
- **Auto-lock**: Automatic wallet lock after inactivity

### 💰 Wallet Functions
- **Send H173K**: Transfer tokens with QR code scanning
- **Receive H173K**: Generate QR codes for receiving payments
- **Balance Display**: Real-time balance with USD conversion
- **Transaction History**: View past transactions with Solscan links

### ⛽ SOL Management
- **Auto-replenish**: Automatically swap H173K to SOL when needed for transaction fees
- **Low balance warning**: Alerts when SOL balance is too low
- **Jupiter Integration**: Best swap rates via Jupiter aggregator

### 📱 PWA Features
- **Installable**: Add to home screen on iOS/Android
- **Offline Support**: Basic functionality without internet
- **Native-like**: Full-screen, no browser UI
- **Push Notifications**: Transaction alerts (coming soon)

## Technical Stack

- **Frontend**: React 18 + Vite
- **Blockchain**: Solana Web3.js, SPL Token
- **Crypto**: BIP39, Ed25519-HD-Key, CryptoJS
- **PWA**: Vite PWA Plugin, Service Worker
- **Swap**: Jupiter API

## Installation

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Project Structure

```
h173k-wallet/
├── public/
│   ├── icons/           # PWA icons
│   ├── manifest.json    # PWA manifest
│   └── sw.js            # Service worker
├── src/
│   ├── components/      # React components
│   │   └── QRCode.jsx   # QR scanner/generator
│   ├── crypto/          # Cryptographic functions
│   │   ├── wallet.js    # Seed/keypair management
│   │   └── auth.js      # PIN/biometric auth
│   ├── hooks/           # React hooks
│   │   ├── useWallet.js # Wallet state management
│   │   └── useSwap.js   # Jupiter swap integration
│   ├── App.jsx          # Main app component
│   ├── App.css          # Styles
│   ├── constants.js     # Token/program addresses
│   ├── utils.js         # Utility functions
│   ├── usePrice.js      # Price fetching hook
│   └── main.jsx         # Entry point
├── index.html
├── package.json
└── vite.config.js
```

## Security Considerations

### Storage
- Seed phrase is encrypted with AES-256 before storage
- PIN hash is stored separately (SHA-256)
- Session wallet keeps keypair in memory only
- Auto-lock clears sensitive data after timeout

### Best Practices
1. **Never share your recovery phrase**
2. **Use a strong PIN** (avoid 1234, 0000, etc.)
3. **Enable biometric authentication** when available
4. **Back up your recovery phrase** immediately after creation
5. **Test with small amounts** first

## Phantom Compatibility

This wallet uses the same derivation path as Phantom:
```
m/44'/501'/0'/0'
```

You can import your H173K Wallet seed phrase into Phantom (or vice versa) and access the same wallet.

## Configuration

### RPC Endpoint
Default: Helius mainnet RPC

To change, modify `src/constants.js`:
```javascript
export const DEFAULT_RPC_ENDPOINT = 'your-rpc-url'
```

### Token Configuration
The wallet is configured for H173K token:
```javascript
export const TOKEN_MINT = new PublicKey('173AvoJNQoWsaR1wdYTMNLUqZc1b7d4SzB2ZZRZVyz3')
export const TOKEN_DECIMALS = 9
```

## API Integrations

- **GeckoTerminal**: Token price from Raydium pool
- **Jupiter**: Swap quotes and execution
- **Solana RPC**: Blockchain interactions

## Future Roadmap

- [ ] Push notifications for transactions
- [ ] Multiple account support
- [ ] NFT display
- [ ] DApp browser
- [ ] Hardware wallet support
- [ ] Multi-language support

## License

MIT License

## Disclaimer

This wallet is provided as-is. Always verify transactions before signing. The developers are not responsible for any loss of funds due to user error or software bugs.
