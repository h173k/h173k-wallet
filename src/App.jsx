/**
 * H173K Wallet - PWA Cryptocurrency Wallet
 * Single-token wallet dedicated to H173K on Solana
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Connection, PublicKey, Transaction, LAMPORTS_PER_SOL, SystemProgram } from '@solana/web3.js'
import { 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount
} from '@solana/spl-token'

// Crypto & Auth
import { 
  sessionWallet, 
  walletExists, 
  generateMnemonic, 
  validateMnemonic,
  importWallet, 
  storeEncryptedWallet,
  exportMnemonic,
  deleteWallet,
  deriveKeypairFromMnemonic
} from './crypto/wallet'
import { 
  setupPIN, 
  verifyPIN, 
  isPINSetup,
  checkBiometricSupport,
  setupBiometric,
  authenticateBiometric,
  isBiometricSetup,
  removeBiometric,
  isLockedOut
} from './crypto/auth'

// Components
import { QRCodeGenerator, QRCodeScanner } from './components/QRCode'

// Hooks
import { useSwap } from './hooks/useSwap'
import { useEscrowProgram } from './hooks/useEscrow'

// P2P Marketplace
import P2PMarketplace from './p2p/P2PMarketplace'
import { getP2PProfile, saveP2PProfile, isP2POnboarded } from './p2p/useP2P'

// Constants & Utils
import { TOKEN_MINT, TOKEN_DECIMALS, getRpcEndpoint, saveRpcEndpoint, isRpcConfigured, validateRpcEndpoint, DEFAULT_RPC_ENDPOINT, OfferStatus, getReplenishSettings, saveReplenishSettings, DEFAULT_REPLENISH_SETTINGS, getSponsorAccounts, saveSponsorAccounts, WSOL_ATA_RENT as WSOL_ATA_RENT_CONST, MIN_SWAP_PRIORITY_FEE, MIN_TRIGGER_THRESHOLD, MIN_REPLENISH_TO, getH173KDecimals, saveH173KDecimals } from './constants'
import { useTokenPrice } from './usePrice'
import { 
  formatNumber, 
  formatSmartNumber,
  formatH173K,
  formatUSD, 
  shortenAddress, 
  copyToClipboard,
  fromTokenAmount,
  generateCode,
  getStatusInfo,
  parseOfferStatus,
  canCancelOffer,
  canReleaseOffer,
  canBurnOffer,
  hasAlreadyConfirmed,
  getSellerIndexPDA,
  getBuyerIndexPDA
} from './utils'

import './App.css'

// Referral System
import { 
  getReferralFromURL, 
  storeReferrer, 
  getReferrer, 
  hasReferrer,
  clearReferrer,
  storeLastKnownPrice,
  calculateReferralBonusLamports,
  generateReferralLink,
  getReferralBonusInfo
} from './referral'

const MIN_SOL_BALANCE = 0.015

// ========== PWA HELPERS ==========
function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    (window.innerWidth <= 768 && 'ontouchstart' in window)
}

function isStandaloneMode() {
  // iOS Safari
  if (window.navigator.standalone === true) return true
  // Android Chrome, other browsers
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  if (window.matchMedia('(display-mode: fullscreen)').matches) return true
  return false
}

// ========== INSTALL PROMPT SCREEN ==========
function InstallPromptScreen() {
  const [isIOS, setIsIOS] = useState(false)
  
  useEffect(() => {
    setIsIOS(/iPhone|iPad|iPod/i.test(navigator.userAgent))
  }, [])
  
  return (
    <div className="install-prompt-screen">
      <div className="install-content">
        <div className="install-logo">
          <img src="/logo.png" alt="H173K" className="logo-img large" />
        </div>
        <h1 className="install-title">Install H173K Wallet</h1>
        <p className="install-subtitle">
          For security and best experience, please add this app to your home screen.
        </p>
        
        <div className="install-instructions">
          {isIOS ? (
            <>
              <div className="install-step">
                <span className="step-number">1</span>
                <span>Tap the <strong>Share</strong> button <ShareIcon /></span>
              </div>
              <div className="install-step">
                <span className="step-number">2</span>
                <span>Scroll and tap <strong>"Add to Home Screen"</strong></span>
              </div>
              <div className="install-step">
                <span className="step-number">3</span>
                <span>Tap <strong>"Add"</strong> to confirm</span>
              </div>
            </>
          ) : (
            <>
              <div className="install-step">
                <span className="step-number">1</span>
                <span>Tap the <strong>menu</strong> button <MenuIcon /></span>
              </div>
              <div className="install-step">
                <span className="step-number">2</span>
                <span>Select <strong>"Add to Home screen"</strong> or <strong>"Install app"</strong></span>
              </div>
              <div className="install-step">
                <span className="step-number">3</span>
                <span>Tap <strong>"Install"</strong> to confirm</span>
              </div>
            </>
          )}
        </div>
        
        <div className="install-note">
          <span className="note-icon">🔒</span>
          <p>Installing as an app ensures your wallet runs in a secure, fullscreen environment without browser controls.</p>
        </div>
      </div>
    </div>
  )
}

function ShareIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', marginLeft: '4px' }}>
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  )
}

function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', marginLeft: '4px' }}>
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="5" r="1" />
      <circle cx="12" cy="19" r="1" />
    </svg>
  )
}

// ========== MAIN APP ==========
function App() {
  const [connection, setConnection] = useState(null)
  const [rpcVersion, setRpcVersion] = useState(0)
  const [requiresInstall, setRequiresInstall] = useState(false)
  const [checkComplete, setCheckComplete] = useState(false)
  
  useEffect(() => {
    // Check if running on mobile and not in standalone mode
    const mobile = isMobileDevice()
    const standalone = isStandaloneMode()
    setRequiresInstall(mobile && !standalone)
    setCheckComplete(true)
    
    // Lock orientation to portrait (works on Android PWA)
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('portrait').catch(() => {
        // Silently fail - not supported on all devices/browsers
      })
    }
  }, [])
  
  useEffect(() => {
    if (checkComplete && !requiresInstall) {
      const conn = new Connection(getRpcEndpoint(), 'confirmed')
      setConnection(conn)
    }
  }, [rpcVersion, checkComplete, requiresInstall])
  
  const handleRpcChange = useCallback(() => {
    setConnection(null)
    setRpcVersion(v => v + 1)
  }, [])
  
  // Show loading until check is complete
  if (!checkComplete) {
    return (
      <>
        <div className="landscape-overlay">
          <div className="rotate-icon">📱</div>
          <h2>Please Rotate Your Device</h2>
          <p>This app works best in portrait mode</p>
        </div>
        <div className="app-background"><div className="light-streak" /></div>
        <div className="app-container">
          <LoadingScreen message="Loading..." />
        </div>
      </>
    )
  }
  
  // Show install prompt if on mobile and not standalone
  if (requiresInstall) {
    return (
      <>
        <div className="landscape-overlay">
          <div className="rotate-icon">📱</div>
          <h2>Please Rotate Your Device</h2>
          <p>This app works best in portrait mode</p>
        </div>
        <div className="app-background"><div className="light-streak" /></div>
        <div className="app-container">
          <InstallPromptScreen />
        </div>
      </>
    )
  }
  
  return (
    <>
      <div className="landscape-overlay">
        <div className="rotate-icon">📱</div>
        <h2>Please Rotate Your Device</h2>
        <p>This app works best in portrait mode</p>
      </div>
      <div className="app-background"><div className="light-streak" /></div>
      <div className="app-container">
        {!connection ? <LoadingScreen message="Connecting..." /> : <WalletApp connection={connection} onRpcChange={handleRpcChange} />}
      </div>
    </>
  )
}

// ========== WALLET APP ==========
function WalletApp({ connection, onRpcChange }) {
  const [initialized, setInitialized] = useState(false)
  const [hasWallet, setHasWallet] = useState(false)
  const [isUnlocked, setIsUnlocked] = useState(false)
  const [publicKey, setPublicKey] = useState(null)
  const [loading, setLoading] = useState(true)
  const [balance, setBalance] = useState(() => {
    try {
      const cached = localStorage.getItem('h173k_cached_balance')
      return cached ? parseFloat(cached) : 0
    } catch { return 0 }
  })
  const [solBalance, setSolBalance] = useState(() => {
    try {
      const cached = localStorage.getItem('h173k_cached_sol_balance')
      return cached ? parseFloat(cached) : 0
    } catch { return 0 }
  })
  const [currentView, setCurrentView] = useState('main')
  const [toast, setToast] = useState(null)
  const [h173kDecimals, setH173kDecimals] = useState(() => getH173KDecimals())
  
  // Check for referral code in URL on mount
  const [pendingReferral, setPendingReferral] = useState(() => getReferralFromURL())
  
  const { price, toUSD } = useTokenPrice(connection)
  
  // Store last known price for referral calculations
  useEffect(() => {
    if (price && price > 0) {
      storeLastKnownPrice(price)
    }
  }, [price])
  
  useEffect(() => {
    const exists = walletExists()
    setHasWallet(exists)
    if (exists && sessionWallet.isUnlocked()) {
      setIsUnlocked(true)
      setPublicKey(sessionWallet.getPublicKey())
    }
    setLoading(false)
    setInitialized(true)
  }, [])
  
  // Listen for session lock events (auto-lock after inactivity)
  useEffect(() => {
    const unsubscribe = sessionWallet.onLock(({ reason }) => {
      console.log(`🔒 Wallet locked (reason: ${reason})`)
      setIsUnlocked(false)
      setCurrentView('main') // Reset to main view when locked
    })
    return unsubscribe
  }, [])
  
  // RPC error state
  const [rpcError, setRpcError] = useState(null)
  
  const fetchBalances = useCallback(async () => {
    if (!connection || !publicKey) return
    try {
      // Fetch token balance
      try {
        const tokenAccount = await getAssociatedTokenAddress(TOKEN_MINT, publicKey)
        try {
          const account = await getAccount(connection, tokenAccount)
          const newBalance = Number(account.amount) / Math.pow(10, TOKEN_DECIMALS)
          setBalance(newBalance)
          localStorage.setItem('h173k_cached_balance', newBalance.toString())
          setRpcError(null)
        } catch (tokenErr) {
          if (tokenErr.message && (tokenErr.message.includes('401') || tokenErr.message.includes('Unauthorized'))) {
            setRpcError('rpc_limit')
            // Don't return — still attempt SOL balance fetch below
          } else if (tokenErr.name === 'TokenAccountNotFoundError' || tokenErr.name === 'TokenInvalidAccountOwnerError') {
            setBalance(0)
            localStorage.setItem('h173k_cached_balance', '0')
            setRpcError(null)
          }
          // On network errors - keep previous balance
        }
      } catch {
        // getAssociatedTokenAddress failure - keep previous token balance
      }

      // Always fetch SOL balance independently
      const lamports = await connection.getBalance(publicKey)
      const newSolBalance = lamports / LAMPORTS_PER_SOL
      setSolBalance(newSolBalance)
      localStorage.setItem('h173k_cached_sol_balance', newSolBalance.toString())
      if (!rpcError) setRpcError(null)
    } catch (err) {
      if (err.message && (err.message.includes('401') || err.message.includes('Unauthorized'))) {
        setRpcError('rpc_limit')
      }
      console.error('Balance fetch error:', err)
    }
  }, [connection, publicKey, rpcError])
  
  useEffect(() => {
    if (isUnlocked && publicKey) {
      fetchBalances()
      const interval = setInterval(fetchBalances, 30000)
      return () => clearInterval(interval)
    }
  }, [isUnlocked, publicKey, fetchBalances])
  
  const showToast = useCallback((message, type = 'info') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }, [])
  
  const handleWalletCreated = useCallback((pubKey) => {
    setHasWallet(true)
    setIsUnlocked(true)
    setPublicKey(pubKey)
  }, [])
  
  const handleUnlock = useCallback((pubKey) => {
    setIsUnlocked(true)
    setPublicKey(pubKey)
  }, [])
  
  const handleLock = useCallback(() => {
    sessionWallet.lock('manual')
    setIsUnlocked(false)
  }, [])
  
  if (loading || !initialized) return <LoadingScreen message="Loading wallet..." />
  if (!hasWallet) return <OnboardingFlow onComplete={handleWalletCreated} showToast={showToast} pendingReferral={pendingReferral} onRpcChange={onRpcChange} />
  if (!isUnlocked) return <LockScreen onUnlock={handleUnlock} showToast={showToast} />
  
  return (
    <div className="wallet-app">
      {currentView === 'main' && (
        <MainView
          connection={connection} publicKey={publicKey} balance={balance} solBalance={solBalance}
          price={price} toUSD={toUSD}
          onSend={() => setCurrentView('send')}
          onReceive={() => setCurrentView('receive')}
          onHistory={() => setCurrentView('history')}
          onEscrow={() => setCurrentView('escrow')}
          onSettings={() => setCurrentView('settings')}
          onRefresh={fetchBalances} onLock={handleLock}
          showToast={showToast}
          rpcError={rpcError}
          h173kDecimals={h173kDecimals}
        />
      )}
      
      {currentView === 'send' && (
        <SendView
          connection={connection} publicKey={publicKey} balance={balance}
          solBalance={solBalance} price={price} toUSD={toUSD}
          onBack={() => setCurrentView('main')} showToast={showToast} onRefresh={fetchBalances}
        />
      )}
      
      {currentView === 'receive' && (
        <ReceiveView publicKey={publicKey} onBack={() => setCurrentView('main')} showToast={showToast} />
      )}
      
      {currentView === 'history' && (
        <HistoryView connection={connection} publicKey={publicKey} onBack={() => setCurrentView('main')} h173kDecimals={h173kDecimals} />
      )}
      
      {currentView === 'escrow' && (
        <EscrowView 
          connection={connection} publicKey={publicKey} balance={balance}
          solBalance={solBalance} price={price} toUSD={toUSD}
          onBack={() => setCurrentView('main')} showToast={showToast} onRefresh={fetchBalances}
          h173kDecimals={h173kDecimals}
          onOpenP2P={() => setCurrentView('p2p')}
        />
      )}

      {currentView === 'p2p' && (
        <P2PMarketplace
          connection={connection} publicKey={publicKey} balance={balance}
          solBalance={solBalance} price={price} toUSD={toUSD}
          onBack={() => setCurrentView('escrow')} showToast={showToast}
        />
      )}
      
      {currentView === 'settings' && (
        <SettingsView
          connection={connection} publicKey={publicKey} solBalance={solBalance}
          onBack={() => setCurrentView('main')} showToast={showToast}
          onDeleteWallet={() => { 
            deleteWallet(); 
            clearReferrer(); // Clear referral data when wallet is deleted
            localStorage.removeItem('h173k_cached_balance');
            localStorage.removeItem('h173k_cached_sol_balance');
            setHasWallet(false); 
            setIsUnlocked(false); 
            setPublicKey(null);
            setBalance(0);
            setSolBalance(0);
          }}
          onRpcChange={onRpcChange}
          onDecimalsChange={setH173kDecimals}
        />
      )}
      
      {toast && <div className={`toast toast-${toast.type}`}>{toast.message}</div>}
    </div>
  )
}

// ========== LOADING SCREEN ==========
function LoadingScreen({ message }) {
  return (
    <div className="loading-screen">
      <div className="loading-content">
        <div className="loading-logo"><img src="/logo.png" alt="H173K" className="logo-img large" /></div>
        <div className="loading-spinner" />
        <p className="loading-text">{message}</p>
      </div>
    </div>
  )
}

// ========== ONBOARDING FLOW ==========
function OnboardingFlow({ onComplete, showToast, pendingReferral, onRpcChange }) {
  const [step, setStep] = useState(() => isRpcConfigured() ? 'welcome' : 'rpc')
  const [mnemonic, setMnemonic] = useState('')
  const [importMnemonic, setImportMnemonic] = useState('')
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [showMnemonic, setShowMnemonic] = useState(false)
  const [backupConfirmed, setBackupConfirmed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [rpcUrl, setRpcUrl] = useState(DEFAULT_RPC_ENDPOINT)
  const [validatingRpc, setValidatingRpc] = useState(false)
  
  const handleSaveRpc = useCallback(async () => {
    if (!rpcUrl.trim()) {
      setError('RPC URL is required')
      return
    }
    
    setValidatingRpc(true)
    setError('')
    
    try {
      const isValid = await validateRpcEndpoint(rpcUrl.trim())
      if (!isValid) {
        setError('Invalid RPC endpoint. Please check the URL.')
        setValidatingRpc(false)
        return
      }
      
      saveRpcEndpoint(rpcUrl.trim())
      
      // Trigger connection refresh with new RPC
      if (onRpcChange) {
        onRpcChange()
      }
      
      setStep('welcome')
    } catch (err) {
      setError('Failed to validate RPC: ' + err.message)
    } finally {
      setValidatingRpc(false)
    }
  }, [rpcUrl, onRpcChange])
  
  const handleCreateWallet = useCallback(() => {
    const newMnemonic = generateMnemonic()
    setMnemonic(newMnemonic)
    setStep('backup')
  }, [])
  
  const [previewAddress, setPreviewAddress] = useState('')
  
  const handleImport = useCallback(async () => {
    if (!validateMnemonic(importMnemonic)) {
      setError('Invalid recovery phrase')
      return
    }
    const cleanMnemonic = importMnemonic.trim().toLowerCase()
    setMnemonic(cleanMnemonic)
    
    // Show preview of the wallet address - dynamic import to get deriveKeypairFromMnemonic
    try {
      const walletModule = await import('./crypto/wallet')
      const keypair = walletModule.deriveKeypairFromMnemonic(cleanMnemonic)
      setPreviewAddress(keypair.publicKey.toString())
      setStep('confirmImport')
    } catch (err) {
      setError('Failed to derive wallet: ' + err.message)
    }
  }, [importMnemonic])
  
  const handleSetupPin = useCallback(async () => {
    if (pin.length < 4) { setError('PIN must be at least 4 digits'); return }
    if (pin !== confirmPin) { setError('PINs do not match'); return }
    if (!/^\d+$/.test(pin)) { setError('PIN must contain only digits'); return }
    
    setLoading(true)
    setError('')
    
    try {
      const walletPassword = `${pin}_h173k_wallet_v1`
      storeEncryptedWallet(mnemonic, walletPassword)
      setupPIN(pin)
      sessionWallet.unlock(walletPassword)
      
      // Store referrer for both new and imported wallets
      if (pendingReferral) {
        const newWalletAddress = sessionWallet.getPublicKey().toString()
        // Don't store if referrer is the same as the new wallet
        if (pendingReferral !== newWalletAddress) {
          storeReferrer(pendingReferral)
          console.log('Referrer stored for wallet:', pendingReferral)
        }
      }
      
      onComplete(sessionWallet.getPublicKey())
    } catch (err) { setError(err.message) } 
    finally { setLoading(false) }
  }, [mnemonic, pin, confirmPin, onComplete, pendingReferral])
  
  return (
    <div className="onboarding">
      <div className="onboarding-container">
        
        {step === 'rpc' && (
          <div className="onboarding-step">
            <div className="onboarding-logo"><img src="/logo.png" alt="H173K" className="logo-img large" /></div>
            <h1 className="onboarding-title">RPC Configuration</h1>
            <p className="onboarding-subtitle">Enter your Solana RPC endpoint</p>
            {error && <div className="error-message">{error}</div>}
            <div className="form-group">
              <label className="form-label">RPC URL</label>
              <input 
                type="text" 
                className="form-input" 
                placeholder="https://your-rpc-endpoint.com" 
                value={rpcUrl} 
                onChange={(e) => { setRpcUrl(e.target.value); setError('') }}
              />
              <span className="form-hint">Use a reliable Solana RPC provider (Helius, QuickNode, Alchemy, etc.)</span>
            </div>
            <button 
              className="btn btn-primary btn-action" 
              onClick={handleSaveRpc} 
              disabled={validatingRpc || !rpcUrl.trim()}
            >
              {validatingRpc ? 'Validating...' : 'Continue'}
            </button>
          </div>
        )}
        
        {step === 'welcome' && (
          <div className="onboarding-step">
            <div className="onboarding-logo"><img src="/logo.png" alt="H173K" className="logo-img large" /></div>
            <h1 className="onboarding-title">H173K Wallet</h1>
            <p className="onboarding-subtitle">Your dedicated wallet for H173K tokens</p>
            <div className="onboarding-actions">
              <button className="btn btn-primary btn-action" onClick={handleCreateWallet}>Create New Wallet</button>
              <button className="btn" onClick={() => setStep('import')}>Import Existing Wallet</button>
            </div>
          </div>
        )}
        
        {step === 'import' && (
          <div className="onboarding-step">
            <button className="back-btn" onClick={() => setStep('welcome')}><BackIcon size={16} /> Back</button>
            <h2 className="onboarding-title">Import Wallet</h2>
            <p className="onboarding-subtitle">Enter your 12 or 24 word recovery phrase</p>
            <div className="form-group">
              <textarea className="form-input mnemonic-input" placeholder="word1 word2 word3..." value={importMnemonic}
                onChange={(e) => { setImportMnemonic(e.target.value); setError('') }} rows={4} />
            </div>
            {error && <div className="error-message">{error}</div>}
            <button className="btn btn-primary btn-action" onClick={handleImport} disabled={!importMnemonic.trim()}>Continue</button>
          </div>
        )}
        
        {step === 'confirmImport' && (
          <div className="onboarding-step">
            <button className="back-btn" onClick={() => { setStep('import'); setPreviewAddress('') }}><BackIcon size={16} /> Back</button>
            <h2 className="onboarding-title">Verify Wallet</h2>
            <p className="onboarding-subtitle">Is this your wallet address?</p>
            <div className="address-preview-card">
              <div className="address-preview-label">Wallet Address</div>
              <div className="address-preview-value">{previewAddress}</div>
            </div>
            <p className="onboarding-hint">If this doesn't look right, go back and check your recovery phrase.</p>
            <button className="btn btn-primary btn-action" onClick={() => setStep('pin')}>Yes, Continue</button>
          </div>
        )}
        
        {step === 'backup' && (
          <div className="onboarding-step">
            <h2 className="onboarding-title">Backup Your Wallet</h2>
            <p className="onboarding-subtitle">Write down these 12 words in order. This is the only way to recover your wallet!</p>
            <div className="mnemonic-display">
              {showMnemonic ? (
                <div className="mnemonic-words">
                  {mnemonic.split(' ').map((word, i) => (
                    <div key={i} className="mnemonic-word">
                      <span className="word-number">{i + 1}</span>
                      <span className="word-text">{word}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <button className="btn btn-reveal" onClick={() => setShowMnemonic(true)}>Tap to reveal recovery phrase</button>
              )}
            </div>
            {showMnemonic && (
              <>
                <div className="backup-warning">
                  <span className="warning-icon">⚠️</span>
                  <p>Never share these words with anyone. Anyone with this phrase can access your funds.</p>
                </div>
                <label className="checkbox-label">
                  <input type="checkbox" checked={backupConfirmed} onChange={(e) => setBackupConfirmed(e.target.checked)} />
                  <span>I have written down my recovery phrase</span>
                </label>
                <button className="btn btn-primary btn-action" onClick={() => setStep('pin')} disabled={!backupConfirmed}>Continue</button>
              </>
            )}
          </div>
        )}
        
        {step === 'pin' && (
          <div className="onboarding-step">
            <h2 className="onboarding-title">Create PIN</h2>
            <p className="onboarding-subtitle">Create a 6-digit PIN to protect your wallet</p>
            <div className="form-group">
              <label className="form-label">PIN Code (6 digits)</label>
              <input type="password" className="form-input pin-input" placeholder="••••••" value={pin}
                onChange={(e) => { setPin(e.target.value.replace(/\D/g, '').slice(0, 6)); setError('') }} inputMode="numeric" maxLength={6} />
            </div>
            <div className="form-group">
              <label className="form-label">Confirm PIN</label>
              <input type="password" className="form-input pin-input" placeholder="••••••" value={confirmPin}
                onChange={(e) => { setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6)); setError('') }} inputMode="numeric" maxLength={6} />
            </div>
            {error && <div className="error-message">{error}</div>}
            <button className="btn btn-primary btn-action" onClick={handleSetupPin} disabled={loading || pin.length !== 6 || confirmPin.length !== 6}>
              {loading ? 'Creating...' : 'Create Wallet'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ========== LOCK SCREEN ==========
function LockScreen({ onUnlock, showToast }) {
  const [pin, setPin] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [biometricAvailable, setBiometricAvailable] = useState(false)
  
  useEffect(() => {
    const check = async () => {
      const supported = await checkBiometricSupport()
      setBiometricAvailable(supported && isBiometricSetup())
    }
    check()
  }, [])
  
  const handlePinUnlock = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const lockout = isLockedOut()
      if (lockout && lockout.locked) {
        setError(`Too many attempts. Try again in ${Math.ceil(lockout.remainingMs / 1000)}s`)
        return
      }
      verifyPIN(pin)
      const walletPassword = `${pin}_h173k_wallet_v1`
      sessionWallet.unlock(walletPassword)
      onUnlock(sessionWallet.getPublicKey())
    } catch (err) { setError(err.message); setPin('') }
    finally { setLoading(false) }
  }, [pin, onUnlock])
  
  const handleBiometricUnlock = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const password = await authenticateBiometric()
      sessionWallet.unlock(password)
      onUnlock(sessionWallet.getPublicKey())
    } catch { setError('Biometric authentication failed') }
    finally { setLoading(false) }
  }, [onUnlock])
  
  // Try to unlock when PIN reaches 6 digits
  useEffect(() => {
    if (pin.length === 6 && !loading) {
      handlePinUnlock()
    }
  }, [pin, loading, handlePinUnlock])
  
  return (
    <div className="lock-screen">
      <div className="lock-content">
        <div className="lock-logo"><img src="/logo.png" alt="H173K" className="logo-img" /></div>
        <h2 className="lock-title">Unlock Wallet</h2>
        <div className="pin-display">
          {[...Array(6)].map((_, i) => <div key={i} className={`pin-dot ${pin.length > i ? 'filled' : ''}`} />)}
        </div>
        {error && <div className="error-message">{error}</div>}
        <div className="pin-pad">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, null, 0, 'del'].map((key, i) => (
            <button key={i} className={`pin-key ${key === null ? 'empty' : ''} ${key === 'del' ? 'delete' : ''}`}
              onClick={() => {
                if (key === null) return
                if (key === 'del') setPin(p => p.slice(0, -1))
                else setPin(p => (p + key).slice(0, 6))
                setError('')
              }} disabled={loading || key === null}>
              {key === 'del' ? '⌫' : key}
            </button>
          ))}
        </div>
        {biometricAvailable && <button className="btn biometric-btn" onClick={handleBiometricUnlock} disabled={loading}><LockIcon /> Use Biometric</button>}
      </div>
    </div>
  )
}

// ========== MAIN VIEW ==========
function MainView({ connection, publicKey, balance, solBalance, price, toUSD, onSend, onReceive, onHistory, onEscrow, onSettings, onRefresh, onLock, showToast, rpcError, h173kDecimals }) {
  const [refreshing, setRefreshing] = useState(false)
  const [showSolPrompt, setShowSolPrompt] = useState(false)
  const [solPromptDismissed, setSolPromptDismissed] = useState(false)
  const [showMADInfo, setShowMADInfo] = useState(false)
  const [showConvertModal, setShowConvertModal] = useState(false)
  const [convertAmount, setConvertAmount] = useState('')
  const [convertQuote, setConvertQuote] = useState(null)

  const usdValue = toUSD ? toUSD(balance) : null
  
  const { 
    convertSOLtoH173K, 
    getSwapQuoteSOLtoH173K,
    calculateSwapForSOL,
    executeSwap,
    loading: swapLoading, 
    MIN_SOL_FOR_SWAP 
  } = useSwap(connection, sessionWallet)
  
  // Pull to refresh state
  const mainViewRef = useRef(null)
  const touchStartY = useRef(0)
  const isPulling = useRef(false)
  const [pullProgress, setPullProgress] = useState(0)
  
  // Determine if SOL warning should be shown
  // Only show if not enough SOL for swap even with h173k
  const { swapFeeSol: _swapFeeSol, threshold: solThreshold, replenishTo: solReplenishTo } = getReplenishSettings()
  const swapTxFloor = _swapFeeSol + 0.000005  // absolute minimum to initiate any swap
  const needsDeposit = solBalance < swapTxFloor
  const lowSOL = solBalance < MIN_SOL_BALANCE && solBalance >= swapTxFloor
  
  // Show SOL prompt if SOL is very low (can't even do a swap) and not dismissed
  useEffect(() => {
    if (solBalance >= swapTxFloor) {
      // Have enough SOL for swaps - close prompt
      setShowSolPrompt(false)
    } else if (solBalance < swapTxFloor && !solPromptDismissed) {
      setShowSolPrompt(true)
    }
  }, [solBalance, solPromptDismissed])
  
  const handleRefresh = async () => {
    setRefreshing(true)
    await onRefresh()
    setTimeout(() => setRefreshing(false), 500)
  }
  
  const handleCheckDeposit = async () => {
    setRefreshing(true)
    await onRefresh()
    setTimeout(() => setRefreshing(false), 500)
  }
  
  const handleDismissSolPrompt = () => {
    setSolPromptDismissed(true)
    setShowSolPrompt(false)
  }
  
  // Emergency swap h173k -> 0.003 SOL
  const [emergencySwapping, setEmergencySwapping] = useState(false)
  
  const handleEmergencySwap = async () => {
    if (balance <= 0) {
      showToast('No h173k balance to swap', 'error')
      return
    }
    
    setEmergencySwapping(true)
    try {
      const targetSOL = solReplenishTo  // use user-configured replenish target
      const { h173kNeeded, quote } = await calculateSwapForSOL(targetSOL)
      
      if (h173kNeeded > balance) {
        showToast(`Need ${h173kNeeded.toFixed(2)} h173k, have ${balance.toFixed(2)}`, 'error')
        return
      }
      
      const result = await executeSwap(quote, 'H173KtoSOL')
      showToast(`Swapped ${result.inputAmount.toFixed(2)} h173k for ${result.outputAmount.toFixed(4)} SOL`, 'success')
      onRefresh()
    } catch (err) {
      showToast('Swap failed: ' + err.message, 'error')
    } finally {
      setEmergencySwapping(false)
    }
  }
  
  // SOL to h173k conversion
  const { convertThreshold, replenishTo, swapFeeSol, threshold } = getReplenishSettings()
  const WSOL_ATA_RENT = 0.00204 // 2039280 lamports — rent-exempt deposit for a token account
  // Solana system accounts must stay above rent-exempt minimum (890880 lamports ≈ 0.00089 SOL).
  const SOL_ACCOUNT_RENT_EXEMPT = 0.00089088
  const effectiveThreshold = Math.max(threshold, SOL_ACCOUNT_RENT_EXEMPT)
  // Cost of this conversion (WSOL ATA is always closed after swap, so rent is always needed).
  const CONVERT_ATA_OVERHEAD = WSOL_ATA_RENT + swapFeeSol + 0.000005
  // Reserve enough SOL for the *next* swap (replenish: h173k→SOL) so it's always executable.
  // That swap creates a fresh WSOL ATA for output: full rent + fees required.
  const NEXT_SWAP_RESERVE = WSOL_ATA_RENT + swapFeeSol + 0.000005
  const maxConvertableSOL = Math.floor(Math.max(0, solBalance - effectiveThreshold - CONVERT_ATA_OVERHEAD - NEXT_SWAP_RESERVE) * 10000) / 10000
  
  const handleConvertAmountChange = async (value) => {
    setConvertAmount(value)
    setConvertQuote(null)
    
    const numAmount = parseFloat(value)
    if (numAmount > 0 && numAmount <= maxConvertableSOL) {
      try {
        const quote = await getSwapQuoteSOLtoH173K(numAmount)
        setConvertQuote(quote)
      } catch (err) {
        console.error('Quote error:', err)
      }
    }
  }

  const convertAmountNum = parseFloat(convertAmount)
  const convertAmountOverLimit = convertAmountNum > 0 && convertAmountNum > maxConvertableSOL
  
  const handleConvert = async () => {
    const numAmount = parseFloat(convertAmount)
    if (!numAmount || numAmount <= 0) {
      showToast('Enter valid amount', 'error')
      return
    }
    if (numAmount > maxConvertableSOL) {
      showToast('Amount exceeds available SOL', 'error')
      return
    }
    
    try {
      const result = await convertSOLtoH173K(numAmount)
      showToast(`Converted ${numAmount} SOL to ${formatSmartNumber(result.h173kReceived)} h173k`, 'success')
      setShowConvertModal(false)
      setConvertAmount('')
      setConvertQuote(null)
      onRefresh()
    } catch (err) {
      // Check if wallet session expired
      if (err.message.includes('Wallet is locked') || !sessionWallet.isUnlocked()) {
        showToast('Session expired. Please unlock your wallet again.', 'error')
      } else {
        showToast('Conversion failed: ' + err.message, 'error')
      }
    }
  }
  
  // Touch handlers for pull to refresh
  const handleTouchStart = useCallback((e) => {
    if (mainViewRef.current?.scrollTop === 0 || window.scrollY === 0) {
      touchStartY.current = e.touches[0].clientY
      isPulling.current = true
    }
  }, [])
  
  const handleTouchMove = useCallback((e) => {
    if (!isPulling.current || refreshing) return
    const diff = e.touches[0].clientY - touchStartY.current
    if (diff > 0 && diff < 150) {
      setPullProgress(Math.min(diff / 100, 1))
    }
    if (diff > 100 && !refreshing) {
      handleRefresh()
      isPulling.current = false
      setPullProgress(0)
    }
  }, [refreshing])
  
  const handleTouchEnd = useCallback(() => {
    isPulling.current = false
    setPullProgress(0)
  }, [])
  
  // SOL Deposit Prompt Modal - only show when can't even do swaps
  if (showSolPrompt) {
    const { swapFeeSol: _swapFeeFloor } = getReplenishSettings()
    // If we have enough SOL for the priority fee but no h173k to auto-replenish → h173k problem, not SOL
    const isH173KProblem = solBalance >= _swapFeeFloor && balance === 0

    return (
      <div className="main-view">
        <div className="sol-prompt-overlay">
          <div className="sol-prompt-card">
            {isH173KProblem ? (
              <>
                <div className="sol-prompt-icon">🪙</div>
                <h2>Add h173k Tokens</h2>
                <p>Your wallet has SOL for fees, but needs h173k tokens to enable automatic SOL replenishment.</p>

                <div className="sol-prompt-info">
                  <div className="sol-prompt-row">
                    <span>Current SOL</span>
                    <span className="sol-amount">{formatNumber(solBalance, 4)} SOL</span>
                  </div>
                  <div className="sol-prompt-row">
                    <span>h173k balance</span>
                    <span className="sol-amount">0 h173k</span>
                  </div>
                </div>

                <div className="sol-prompt-address">
                  <div className="sol-prompt-label">Receive h173k at this address:</div>
                  <QRCodeGenerator data={publicKey.toString()} size={180} />
                  <div className="address-display" onClick={() => copyToClipboard(publicKey.toString())}>
                    <span className="address-text">{publicKey.toString()}</span>
                    <span className="copy-icon"><CopyIcon /></span>
                  </div>
                </div>

                <p className="sol-prompt-note">
                  💡 Once you have h173k, the wallet will automatically swap small amounts to SOL whenever fees are needed.
                </p>
              </>
            ) : (
              <>
                <div className="sol-prompt-icon">⚡</div>
                <h2>Deposit SOL to Get Started</h2>
                <p>Your wallet needs a small amount of SOL to pay for transaction fees on Solana network.</p>
                
                <div className="sol-prompt-info">
                  <div className="sol-prompt-row">
                    <span>Recommended</span>
                    <span className="sol-amount">0.01 - 0.05 SOL</span>
                  </div>
                  <div className="sol-prompt-row">
                    <span>Approximate cost</span>
                    <span className="sol-amount">~$2 - $10</span>
                  </div>
                </div>
                
                <div className="sol-prompt-address">
                  <div className="sol-prompt-label">Send SOL to this address:</div>
                  <QRCodeGenerator data={publicKey.toString()} size={180} />
                  <div className="address-display" onClick={() => copyToClipboard(publicKey.toString())}>
                    <span className="address-text">{publicKey.toString()}</span>
                    <span className="copy-icon"><CopyIcon /></span>
                  </div>
                </div>
                
                <p className="sol-prompt-note">
                  💡 Once you have h173k tokens, the wallet can automatically swap small amounts to SOL when needed for fees.
                </p>
              </>
            )}
            
            <div className="sol-prompt-actions">
              <button className="btn btn-primary btn-action" onClick={handleCheckDeposit} disabled={refreshing}>
                {refreshing ? 'Checking...' : isH173KProblem ? 'I\'ve Added h173k' : 'I\'ve Deposited SOL'}
              </button>
              {!isH173KProblem && balance > 0 && (
                <button 
                  className="btn btn-action" 
                  onClick={handleEmergencySwap} 
                  disabled={emergencySwapping || swapLoading}
                  style={{ backgroundColor: '#f59e0b', borderColor: '#f59e0b' }}
                >
                  {emergencySwapping ? 'Swapping...' : `Swap h173k for ${solReplenishTo} SOL`}
                </button>
              )}
              <button className="btn" onClick={handleDismissSolPrompt}>
                Skip for Now
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }
  
  // SOL to h173k Convert Modal
  if (showConvertModal) {
    return (
      <div className="main-view">
        <div className="sol-prompt-overlay">
          <div className="sol-prompt-card convert-modal">
            <h2>Convert SOL to h173k</h2>
            <p>Convert your excess SOL to h173k tokens.</p>
            
            <div className="form-group">
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                <label className="form-label" style={{margin:0}}>Amount (SOL)</label>
                <button
                  className="btn"
                  style={{fontSize:'0.7rem', padding:'2px 8px', height:'auto', marginBottom:'6px'}}
                  onClick={() => handleConvertAmountChange(String(maxConvertableSOL))}
                >MAX</button>
              </div>
              <input 
                type="number" 
                className={`form-input${convertAmountOverLimit ? ' input-error' : ''}`}
                placeholder="0.00" 
                value={convertAmount} 
                onChange={(e) => handleConvertAmountChange(e.target.value)}
                step="0.01"
                max={maxConvertableSOL}
              />
              {convertAmountOverLimit
                ? <div className="input-hint" style={{color:'var(--error, #e05)'}}>
                    Exceeds max — enter {formatNumber(maxConvertableSOL, 4)} SOL or less
                  </div>
                : <div className="input-hint">
                    Max: {formatNumber(maxConvertableSOL, 4)} SOL · Reserved: {formatNumber(effectiveThreshold + CONVERT_ATA_OVERHEAD + NEXT_SWAP_RESERVE, 4)} SOL

                  </div>
              }
            </div>
            
            {convertQuote && (
              <div className="convert-quote">
                <div className="convert-quote-row">
                  <span>You'll receive</span>
                  <span className="convert-quote-amount">~{formatSmartNumber(convertQuote.outputAmount)} h173k</span>
                </div>
                {convertQuote.priceImpact > 1 && (
                  <div className="convert-quote-warning">
                    ⚠️ Price impact: {convertQuote.priceImpact.toFixed(2)}%
                  </div>
                )}
              </div>
            )}
            
            <div className="sol-prompt-actions">
              <button 
                className="btn btn-primary btn-action" 
                onClick={handleConvert} 
                disabled={swapLoading || !convertQuote || parseFloat(convertAmount) <= 0 || convertAmountOverLimit}
              >
                {swapLoading ? 'Converting...' : 'Convert'}
              </button>
              <button className="btn" onClick={() => { setShowConvertModal(false); setConvertAmount(''); setConvertQuote(null) }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }
  
  return (
    <div 
      className="main-view"
      ref={mainViewRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull to refresh indicator */}
      {(pullProgress > 0 || refreshing) && (
        <div className="pull-refresh-indicator" style={{ opacity: refreshing ? 1 : pullProgress }}>
          {!refreshing && <RefreshIcon size={24} />}
          <span>{refreshing ? 'Refreshing...' : (pullProgress >= 1 ? 'Release to refresh' : 'Pull to refresh')}</span>
        </div>
      )}
      
      {/* RPC Error Banner */}
      {rpcError === 'rpc_limit' && (
        <div className="rpc-error-banner" onClick={onSettings}>
          <div className="rpc-error-icon">⚠️</div>
          <div className="rpc-error-content">
            <div className="rpc-error-title">RPC Limit Exceeded</div>
            <div className="rpc-error-message">Default RPC limit reached. Tap here to set your own RPC endpoint in Settings.</div>
          </div>
          <div className="rpc-error-arrow"><ChevronRightIcon /></div>
        </div>
      )}
      
      <div className="main-header">
        <button className="icon-btn" onClick={onSettings}><SettingsIcon /></button>
        <div className="header-address" onClick={() => copyToClipboard(publicKey.toString())}>{shortenAddress(publicKey.toString())}</div>
        <button className="icon-btn" onClick={onLock}><LockIcon /></button>
      </div>
      
      {/* Logo */}
      <div className="main-logo">
        <img src="/logo.png" alt="H173K" className="logo-img" />
      </div>
      
      <div className="balance-card">
        <div className="balance-label">Balance</div>
        <div className="balance-amount">{formatH173K(balance, h173kDecimals)} <span className="balance-symbol">h173k</span></div>
        {usdValue !== null && <div className="balance-usd">{formatUSD(usdValue)}</div>}
        <div className="balance-sol-row">
          <span className="balance-sol">{formatNumber(solBalance, 4)} SOL</span>
          {solBalance > convertThreshold  && (
            <button className="convert-sol-btn" onClick={() => setShowConvertModal(true)}>
              Convert
            </button>
          )}
        </div>
        <button className={`refresh-btn ${refreshing ? 'refreshing' : ''}`} onClick={handleRefresh} disabled={refreshing}><RefreshIcon size={18} /></button>
        {needsDeposit && (
          <div className="sol-warning critical" onClick={() => setShowSolPrompt(true)}>
            Low SOL - Deposit required for transactions
          </div>
        )}
      </div>
      
      <div className="action-row">
        <button className="action-btn" onClick={onSend} disabled={needsDeposit}>
          <div className="action-icon"><SendIcon size={24} /></div><span>Send</span>
        </button>
        <button className="action-btn" onClick={onReceive}>
          <div className="action-icon"><ReceiveIcon size={24} /></div><span>Receive</span>
        </button>
        <div className="action-btn-wrapper">
          <button className="action-btn" onClick={onEscrow} disabled={needsDeposit}>
            <div className="action-icon"><EscrowIcon size={24} /></div>
            <span className="mad-label">MAD</span>
          </button>
          <button className="mad-info-btn" onClick={() => setShowMADInfo(true)}>?</button>
        </div>
      </div>
      
      {showMADInfo && (
        <div className="mad-info-overlay" onClick={() => setShowMADInfo(false)}>
          <div className="mad-info-card" onClick={(e) => e.stopPropagation()}>
            <h3>What is MAD?</h3>
            <p><strong>Mutual Assured Destruction</strong> is an escrow system where both parties deposit collateral.</p>
            <p>If the transaction goes wrong, either party can "burn" the contract - destroying <em>all</em> deposits permanently.</p>
            <p>This creates strong incentive for both parties to cooperate and complete the transaction honestly.</p>
            <button className="btn" onClick={() => setShowMADInfo(false)}>Got it</button>
          </div>
        </div>
      )}
      
      <button className="action-btn-secondary" onClick={onHistory}>
        <HistoryIcon size={18} /><span>Transaction History</span>
      </button>
    </div>
  )
}

// ========== SEND VIEW ==========
function SendView({ connection, publicKey, balance, solBalance, price, toUSD, onBack, showToast, onRefresh }) {
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [showScanner, setShowScanner] = useState(false)
  const [confirmStep, setConfirmStep] = useState(false)
  const [txSignature, setTxSignature] = useState(null)
  const [sponsorAmtState, setSponsorAmtState] = useState(0) // pre-calculated in validateAndProceed
  const [extraSOLNeeded, setExtraSOLNeeded] = useState(0)   // sponsor + recipient ATA rent
  
  const { withAutoSOL, loading: swapLoading } = useSwap(connection, sessionWallet)
  const usdValue = toUSD && amount ? toUSD(parseFloat(amount) || 0) : null
  
  // Get referrer and referral bonus info
  const referrer = getReferrer()
  const referralBonusLamports = referrer ? calculateReferralBonusLamports(price, TOKEN_DECIMALS) : null
  const referralBonusInfo = referrer ? getReferralBonusInfo(price) : null
  
  const handleScan = (data) => {
    if (data.address) { setRecipient(data.address); if (data.amount) setAmount(data.amount.toString()) }
    setShowScanner(false)
  }
  
  const validateAndProceed = async () => {
    if (!recipient.trim()) { showToast('Enter recipient address', 'error'); return }
    try { new PublicKey(recipient) } catch { showToast('Invalid Solana address', 'error'); return }
    const sendAmount = parseFloat(amount)
    if (!sendAmount || sendAmount <= 0) { showToast('Enter valid amount', 'error'); return }
    
    // Calculate total needed including referral bonus
    let totalNeeded = sendAmount
    if (referralBonusInfo && referralBonusInfo.tokenAmount) {
      totalNeeded += referralBonusInfo.tokenAmount
    }
    
    if (totalNeeded > balance) { 
      showToast('Insufficient balance' + (referralBonusInfo ? ' (including referral bonus)' : ''), 'error')
      return 
    }

    // Pre-calculate sponsor amount + recipient ATA cost.
    // No sender cap here — withAutoSOL handles reserves via TARGET = replenishTo + swapTxCost + extraSOLNeeded.
    // After replenish sender has TARGET SOL, spends extraSOLNeeded, keeps replenishTo + swapTxCost as reserve.
    const WSOL_ATA_RENT_SP   = 0.00204
    const SOL_RENT_EXEMPT_SP = 0.00089088
    const TX_BASE_FEE_SP     = 0.000005
    const { swapFeeSol: recipientSwapFee } = getReplenishSettings()
    const SWAP_FEE_SP = recipientSwapFee || 0.0001

    // Check if recipient token ATA needs creating — costs rent paid by sender
    let recipientAtaRent = 0
    try {
      const recipientPubkeyCheck = new PublicKey(recipient)
      const recipientTokenAccountCheck = await getAssociatedTokenAddress(TOKEN_MINT, recipientPubkeyCheck)
      await getAccount(connection, recipientTokenAccountCheck)
    } catch {
      recipientAtaRent = WSOL_ATA_RENT_SP
    }

    let sponsorAmt = 0
    if (getSponsorAccounts()) {
      try {
        const REQUIRED_SOL = SOL_RENT_EXEMPT_SP
          + (WSOL_ATA_RENT_SP + SWAP_FEE_SP + TX_BASE_FEE_SP)
          + (WSOL_ATA_RENT_SP + SWAP_FEE_SP + TX_BASE_FEE_SP)
        const recipientPubkey = new PublicKey(recipient)
        const recipientLamports = await connection.getBalance(recipientPubkey)
        const recipientSOL = recipientLamports / LAMPORTS_PER_SOL
        sponsorAmt = Math.max(0, REQUIRED_SOL - recipientSOL)
      } catch { /* leave at 0 */ }
    }
    setSponsorAmtState(sponsorAmt)
    // extraSOLNeeded = everything this send will spend on SOL:
    // sponsor transfer to recipient + recipient token ATA creation rent
    setExtraSOLNeeded(sponsorAmt + recipientAtaRent)
    
    setConfirmStep(true)
  }
  
  const handleSend = async () => {
    setLoading(true)
    try {
      const recipientPubkey = new PublicKey(recipient)
      const sendAmount = parseFloat(amount)
      const amountLamports = Math.floor(sendAmount * Math.pow(10, TOKEN_DECIMALS))
      
      // Use withAutoSOL wrapper for the entire send operation
      const signature = await withAutoSOL(
        async () => {
          const senderTokenAccount = await getAssociatedTokenAddress(TOKEN_MINT, publicKey)
          const recipientTokenAccount = await getAssociatedTokenAddress(TOKEN_MINT, recipientPubkey)
          
          const transaction = new Transaction()
          
          // Create recipient token account if needed
          try { await getAccount(connection, recipientTokenAccount) } 
          catch { transaction.add(createAssociatedTokenAccountInstruction(publicKey, recipientTokenAccount, recipientPubkey, TOKEN_MINT)) }
          
          // Main transfer
          transaction.add(createTransferInstruction(senderTokenAccount, recipientTokenAccount, publicKey, amountLamports))
          
          // Sponsor transfer — amount pre-calculated and capped in validateAndProceed.
          // withAutoSOL already replenished enough SOL to cover this.
          if (getSponsorAccounts() && sponsorAmtState > 0) {
            transaction.add(
              SystemProgram.transfer({
                fromPubkey: publicKey,
                toPubkey: recipientPubkey,
                lamports: Math.round(sponsorAmtState * LAMPORTS_PER_SOL)
              })
            )
          }

          // Add referral bonus transfer if referrer exists and bonus is calculable
          if (referrer && referralBonusLamports && referralBonusLamports > 0) {
            try {
              const referrerPubkey = new PublicKey(referrer)
              // Don't send referral to self or to the recipient
              if (referrer !== publicKey.toString() && referrer !== recipient) {
                const referrerTokenAccount = await getAssociatedTokenAddress(TOKEN_MINT, referrerPubkey)
                
                // Only send bonus if referrer already has a token account — never create it on their behalf
                try {
                  await getAccount(connection, referrerTokenAccount)
                  // Add referral bonus transfer
                  transaction.add(createTransferInstruction(senderTokenAccount, referrerTokenAccount, publicKey, referralBonusLamports))
                  console.log(`Adding referral bonus: ${referralBonusLamports} lamports to ${referrer}`)
                } catch {
                  console.warn(`Skipping referral bonus: referrer has no token account`)
                }
              }
            } catch (err) {
              console.error('Error adding referral transfer:', err)
              // Continue without referral if there's an error
            }
          }
          
          const { blockhash } = await connection.getLatestBlockhash()
          transaction.recentBlockhash = blockhash
          transaction.feePayer = publicKey
          
          const signed = sessionWallet.signTransaction(transaction)
          const sig = await connection.sendRawTransaction(signed.serialize())
          await connection.confirmTransaction(sig, 'confirmed')
          return sig
        },
        (swapInfo) => {
          if (swapInfo.status === 'swapping') {
            showToast('Swapping h173k for SOL...', 'info')
          } else if (swapInfo.status === 'swapped') {
            showToast(`Swapped ${formatSmartNumber(swapInfo.h173kUsed)} h173k for ${swapInfo.solReceived.toFixed(4)} SOL`, 'info')
            if (onRefresh) onRefresh()
          }
        },
        extraSOLNeeded  // sponsor transfer + recipient ATA rent — withAutoSOL factors this into replenish target
      )
      
      setTxSignature(signature)
      showToast('Transaction sent!', 'success')
      onRefresh()
    } catch (err) { 
      console.error('Send error:', err)
      // Check if wallet session expired
      if (err.message.includes('Wallet is locked') || !sessionWallet.isUnlocked()) {
        showToast('Session expired. Please unlock your wallet again.', 'error')
      } else {
        showToast('Transaction failed: ' + err.message, 'error')
      }
    }
    finally { setLoading(false) }
  }
  
  if (txSignature) {
    return (
      <div className="send-view">
        <div className="success-card">
          <div className="success-icon">✓</div>
          <h2>Sent!</h2>
          <p className="success-amount">{formatH173K(parseFloat(amount))} h173k</p>
          <p className="success-to">to {shortenAddress(recipient)}</p>
          <a href={`https://solscan.io/tx/${txSignature}`} target="_blank" rel="noopener noreferrer" className="tx-link">View on Solscan →</a>
          <button className="btn btn-primary" onClick={onBack}>Done</button>
        </div>
      </div>
    )
  }
  
  if (showScanner) {
    return (
      <div className="send-view">
        <div className="view-header"><button className="back-btn" onClick={() => setShowScanner(false)}><BackIcon size={16} /> Back</button><h2>Scan QR Code</h2></div>
        <QRCodeScanner onScan={handleScan} onError={() => showToast('Scanner error', 'error')} />
      </div>
    )
  }
  
  if (confirmStep) {
    return (
      <div className="send-view">
        <div className="view-header"><button className="back-btn" onClick={() => setConfirmStep(false)}><BackIcon size={16} /> Back</button><h2>Confirm Send</h2></div>
        <div className="confirm-card">
          <div className="confirm-row"><span className="confirm-label">Amount</span><span className="confirm-value">{formatH173K(parseFloat(amount))} h173k{usdValue && <span className="confirm-usd">({formatUSD(usdValue)})</span>}</span></div>
          <div className="confirm-row"><span className="confirm-label">To</span><span className="confirm-value address">{shortenAddress(recipient)}</span></div>
          {referrer && referralBonusInfo && referralBonusInfo.tokenAmount && (
            <div className="confirm-row referral-row">
              <span className="confirm-label">Referral Bonus</span>
              <span className="confirm-value referral-value">+{formatH173K(referralBonusInfo.tokenAmount)} h173k <span className="confirm-usd">(${referralBonusInfo.usdAmount})</span></span>
            </div>
          )}
          <div className="confirm-row"><span className="confirm-label">Network Fee</span><span className="confirm-value">~0.000005 SOL</span></div>
          {sponsorAmtState > 0 && (
            <div className="confirm-row"><span className="confirm-label">Recipient top-up</span><span className="confirm-value">{formatNumber(sponsorAmtState, 6)} SOL</span></div>
          )}
          {referrer && referralBonusInfo && referralBonusInfo.tokenAmount && (
            <div className="confirm-row total-row">
              <span className="confirm-label">Total</span>
              <span className="confirm-value">{formatH173K(parseFloat(amount) + referralBonusInfo.tokenAmount)} h173k</span>
            </div>
          )}
          <button className="btn btn-primary btn-action" onClick={handleSend} disabled={loading || swapLoading}>{loading ? (swapLoading ? 'Swapping SOL...' : 'Sending...') : 'Confirm & Send'}</button>
        </div>
      </div>
    )
  }
  
  return (
    <div className="send-view">
      <div className="view-header"><button className="back-btn" onClick={onBack}><BackIcon size={16} /> Back</button><h2>Send h173k</h2></div>
      <div className="form-group">
        <label className="form-label">Recipient Address</label>
        <div className="input-with-action">
          <input type="text" className="form-input" placeholder="Solana address..." value={recipient} onChange={(e) => setRecipient(e.target.value)} />
          <button className="input-action-btn" onClick={() => setShowScanner(true)}><ScanIcon size={18} /></button>
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Amount</label>
        <div className="amount-input-wrapper">
          <input type="number" className="form-input" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} step="0.01" />
          <button className="max-btn" onClick={() => setAmount(balance.toString())}>MAX</button>
        </div>
        <div className="form-hint-row">
          <span className="form-hint">Available: {formatH173K(balance)} h173k</span>
          {usdValue !== null && <span className="amount-usd-preview">{formatUSD(usdValue)}</span>}
        </div>
      </div>
      <button className="btn btn-primary btn-action" onClick={validateAndProceed} disabled={!recipient || !amount}>Continue</button>
    </div>
  )
}

// ========== RECEIVE VIEW ==========
function ReceiveView({ publicKey, onBack, showToast }) {
  const address = publicKey.toString()
  // Use plain address for QR - universal, works for both SOL and any SPL tokens
  // Solana Pay format (solana:address) forces SOL in most wallets
  
  const handleCopy = async () => {
    const success = await copyToClipboard(address)
    showToast(success ? 'Address copied!' : 'Copy failed', success ? 'success' : 'error')
  }
  
  return (
    <div className="receive-view">
      <div className="view-header"><button className="back-btn" onClick={onBack}><BackIcon size={16} /> Back</button><h2>Receive</h2></div>
      <div className="receive-card">
        <QRCodeGenerator data={address} size={220} />
        <div className="address-display" onClick={handleCopy}><span className="address-text">{address}</span><span className="copy-icon"><CopyIcon /></span></div>
        <button className="btn btn-secondary" onClick={handleCopy}>Copy Address</button>
      </div>
      <div className="receive-info"><p>This address accepts both <strong>h173k</strong> tokens and <strong>SOL</strong>.</p><p>Share this QR code or address to receive funds.</p></div>
    </div>
  )
}

// ========== HISTORY VIEW ==========
function HistoryView({ connection, publicKey, onBack, h173kDecimals }) {
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  
  // Pull to refresh state
  const historyListRef = useRef(null)
  const touchStartY = useRef(0)
  const isPulling = useRef(false)
  const [pullProgress, setPullProgress] = useState(0)
  
  const fetchHistory = useCallback(async () => {
    try {
      const ownerStr = publicKey.toString()
      const allTxs = []
      
      // Helper: delay function
      const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))
      
      // Helper: fetch transaction with retry and rate limiting
      const fetchTxWithRetry = async (signature, maxRetries = 3) => {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try {
            const tx = await connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0 })
            return tx
          } catch (err) {
            if (err?.message?.includes('429') || err?.status === 429) {
              const backoffDelay = Math.min(1000 * Math.pow(2, attempt), 5000)
              console.log(`Rate limited, waiting ${backoffDelay}ms before retry...`)
              await delay(backoffDelay)
            } else {
              throw err
            }
          }
        }
        return null
      }
      
      // Helper: process transactions in batches with rate limiting
      const processBatch = async (signatures, batchSize = 3, delayMs = 200) => {
        const results = []
        for (let i = 0; i < signatures.length; i += batchSize) {
          const batch = signatures.slice(i, i + batchSize)
          const batchResults = await Promise.all(batch.map(sig => fetchTxWithRetry(sig.signature)))
          results.push(...batchResults.map((tx, idx) => ({ tx, sig: batch[idx] })))
          
          // Add delay between batches to avoid rate limiting
          if (i + batchSize < signatures.length) {
            await delay(delayMs)
          }
        }
        return results
      }
      
      // 1. Fetch H173K token transactions
      const tokenAccount = await getAssociatedTokenAddress(TOKEN_MINT, publicKey)
      const tokenSignatures = await connection.getSignaturesForAddress(tokenAccount, { limit: 20 })
      
      await delay(100) // Small delay after getting signatures
      
      const tokenResults = await processBatch(tokenSignatures, 3, 250)
      
      for (const { tx, sig } of tokenResults) {
        try {
          if (!tx?.meta) continue
          
          const preBalances = tx.meta.preTokenBalances || []
          const postBalances = tx.meta.postTokenBalances || []
          
          const preB = preBalances.find(b => b.mint === TOKEN_MINT.toString() && b.owner === ownerStr)
          const postB = postBalances.find(b => b.mint === TOKEN_MINT.toString() && b.owner === ownerStr)
          
          const pre = preB?.uiTokenAmount?.uiAmount || 0
          const post = postB?.uiTokenAmount?.uiAmount || 0
          const diff = post - pre
          
          if (diff === 0) continue
          
          allTxs.push({ 
            signature: sig.signature, 
            blockTime: sig.blockTime, 
            type: diff > 0 ? 'receive' : 'send', 
            amount: Math.abs(diff),
            token: 'h173k',
            error: sig.err !== null 
          })
        } catch (err) { 
          console.error('Error parsing token tx:', sig.signature, err)
        }
      }
      
      // Filter valid token txs
      const validTokenTxs = allTxs.filter(tx => tx && tx.amount > 0 && !tx.error)
      
      await delay(300) // Delay before SOL transactions
      
      // 2. Fetch SOL transactions
      const solSignatures = await connection.getSignaturesForAddress(publicKey, { limit: 20 })
      
      // Filter out already processed signatures
      const newSolSignatures = solSignatures.filter(sig => 
        !validTokenTxs.some(t => t.signature === sig.signature)
      )
      
      await delay(100)
      
      const solResults = await processBatch(newSolSignatures, 3, 250)
      
      for (const { tx, sig } of solResults) {
        try {
          if (!tx?.meta) continue
          
          // Find account index for our publicKey
          const accountKeys = tx.transaction.message.accountKeys.map(k => k.pubkey?.toString() || k.toString())
          const accountIndex = accountKeys.findIndex(k => k === ownerStr)
          
          if (accountIndex === -1) continue
          
          const preSol = tx.meta.preBalances[accountIndex] || 0
          const postSol = tx.meta.postBalances[accountIndex] || 0
          const diff = (postSol - preSol) / LAMPORTS_PER_SOL
          
          // Skip tiny changes (likely just fees) - threshold 0.0001 SOL
          if (Math.abs(diff) < 0.0001) continue
          
          // If we're just paying fees (small negative amount), skip
          const fee = (tx.meta.fee || 0) / LAMPORTS_PER_SOL
          if (diff < 0 && Math.abs(diff) <= fee * 1.1) continue
          
          allTxs.push({ 
            signature: sig.signature, 
            blockTime: sig.blockTime, 
            type: diff > 0 ? 'receive' : 'send', 
            amount: Math.abs(diff),
            token: 'SOL',
            error: sig.err !== null 
          })
        } catch (err) { 
          console.error('Error parsing SOL tx:', sig.signature, err)
        }
      }
      
      // Filter and sort
      const finalTxs = allTxs.filter(tx => tx && tx.amount > 0 && !tx.error)
      finalTxs.sort((a, b) => (b.blockTime || 0) - (a.blockTime || 0))
      
      setTransactions(finalTxs)
    } catch (err) { console.error('History fetch error:', err) }
    finally { setLoading(false) }
  }, [connection, publicKey])
  
  useEffect(() => {
    fetchHistory()
  }, [fetchHistory])
  
  // Handle manual refresh
  const handleRefresh = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    await fetchHistory()
    setTimeout(() => setRefreshing(false), 500)
  }, [fetchHistory, refreshing])
  
  // Touch handlers for pull to refresh
  const handleTouchStart = useCallback((e) => {
    const listEl = historyListRef.current
    if (listEl && listEl.scrollTop === 0) {
      touchStartY.current = e.touches[0].clientY
      isPulling.current = true
    }
  }, [])
  
  const handleTouchMove = useCallback((e) => {
    if (!isPulling.current || refreshing) return
    const diff = e.touches[0].clientY - touchStartY.current
    if (diff > 0 && diff < 150) {
      setPullProgress(Math.min(diff / 100, 1))
    }
    if (diff > 100 && !refreshing) {
      handleRefresh()
      isPulling.current = false
      setPullProgress(0)
    }
  }, [refreshing, handleRefresh])
  
  const handleTouchEnd = useCallback(() => {
    isPulling.current = false
    setPullProgress(0)
  }, [])
  
  return (
    <div className="history-view">
      <div className="view-header">
        <button className="back-btn" onClick={onBack}><BackIcon size={16} /> Back</button>
        <h2>Transaction History</h2>
      </div>
      
      {/* Refresh button above transactions */}
      <div className="history-top-actions">
        <button className="history-refresh-btn" onClick={handleRefresh} disabled={refreshing}>
          <RefreshIcon size={18} />
          <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
        </button>
      </div>
      
      {/* Pull to refresh indicator */}
      {(pullProgress > 0 || refreshing) && (
        <div className="pull-refresh-indicator history-pull" style={{ opacity: refreshing ? 1 : pullProgress }}>
          {!refreshing && <RefreshIcon size={20} />}
          <span>{refreshing ? 'Refreshing...' : (pullProgress >= 1 ? 'Release to refresh' : 'Pull to refresh')}</span>
        </div>
      )}
      
      {loading ? <div className="loading-spinner-small" /> : transactions.length === 0 ? (
        <div 
          className="empty-state"
          ref={historyListRef}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <p>No transactions yet</p>
        </div>
      ) : (
        <div 
          className="tx-list"
          ref={historyListRef}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {transactions.map((tx) => (
            <a key={tx.signature} href={`https://solscan.io/tx/${tx.signature}`} target="_blank" rel="noopener noreferrer" className="tx-item">
              <div className={`tx-icon ${tx.type} ${tx.token === 'SOL' ? 'sol' : ''}`}>{tx.type === 'receive' ? <ReceiveIcon size={20} /> : <SendIcon size={20} />}</div>
              <div className="tx-details">
                <div className="tx-type">{tx.type === 'receive' ? 'Received' : 'Sent'} {tx.token}</div>
                <div className="tx-date">{tx.blockTime ? new Date(tx.blockTime * 1000).toLocaleDateString() : 'Unknown'}</div>
              </div>
              <div className={`tx-amount ${tx.type}`}>{tx.type === 'receive' ? '+' : '-'}{tx.token === 'SOL' ? formatNumber(tx.amount, 4) : formatH173K(tx.amount, h173kDecimals)} {tx.token}</div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

// ========== ESCROW VIEW ==========
function EscrowView({ connection, publicKey, balance, solBalance, price, toUSD, onBack, showToast, onRefresh, h173kDecimals, onOpenP2P }) {
  const [subView, setSubView] = useState('list') // list, new, accept, detail, import
  const [contracts, setContracts] = useState([])
  const [selectedContract, setSelectedContract] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [contractsMetadata, setContractsMetadata] = useState(() => {
    try {
      const stored = localStorage.getItem('h173k_contracts_metadata')
      return stored ? JSON.parse(stored) : {}
    } catch { return {} }
  })
  
  // Pull to refresh state
  const contractsListRef = useRef(null)
  const touchStartY = useRef(0)
  const isPulling = useRef(false)
  const [pullProgress, setPullProgress] = useState(0)
  
  // Create a wallet-like object for useEscrow
  const walletAdapter = useMemo(() => ({
    publicKey,
    signTransaction: (tx) => sessionWallet.signTransaction(tx),
    signAllTransactions: (txs) => sessionWallet.signAllTransactions(txs)
  }), [publicKey])
  
  const escrow = useEscrowProgram(connection, walletAdapter)
  
  // Use refs to avoid dependencies causing re-renders
  const escrowRef = useRef(escrow)
  escrowRef.current = escrow
  
  const contractsMetadataRef = useRef(contractsMetadata)
  contractsMetadataRef.current = contractsMetadata
  
  // Fetch contracts - stable function, no dependencies that cause loops
  const fetchContracts = useCallback(async () => {
    if (!publicKey) return
    
    // Read latest metadata from localStorage but do NOT overwrite React state yet
    // (overwriting here causes a race condition that drops freshly-saved names)
    let currentMeta = contractsMetadataRef.current
    try {
      const stored = localStorage.getItem('h173k_contracts_metadata')
      if (stored) {
        currentMeta = JSON.parse(stored)
        contractsMetadataRef.current = currentMeta
      }
    } catch { /* ignore */ }
    
    setLoading(true)
    try {
      const offers = await escrowRef.current.fetchAllUserOffers()
      // Filter out hidden contracts
      const visible = offers.filter(o => {
        const key = o.publicKey.toString()
        return !currentMeta[key]?.hidden
      })
      setContracts(visible)
      // Update state only after async work is done, with the consistent snapshot
      setContractsMetadata(currentMeta)
    } catch (err) {
      console.error('Fetch contracts error:', err)
    } finally {
      setLoading(false)
    }
  }, [publicKey])
  
  // Fetch only once on mount
  const hasFetchedRef = useRef(false)
  useEffect(() => {
    if (!hasFetchedRef.current) {
      hasFetchedRef.current = true
      fetchContracts()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  
  const saveMetadata = (key, data) => {
    const current = JSON.parse(localStorage.getItem('h173k_contracts_metadata') || '{}')
    const newMeta = { ...current, [key]: { ...current[key], ...data } }
    setContractsMetadata(newMeta)
    contractsMetadataRef.current = newMeta
    localStorage.setItem('h173k_contracts_metadata', JSON.stringify(newMeta))
  }
  
  const reloadMetadata = () => {
    try {
      const stored = localStorage.getItem('h173k_contracts_metadata')
      const newMeta = stored ? JSON.parse(stored) : {}
      setContractsMetadata(newMeta)
      contractsMetadataRef.current = newMeta // Update ref immediately for fetchContracts
    } catch { /* ignore */ }
  }
  
  // Handle manual refresh
  const handleRefresh = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    await fetchContracts()
    setTimeout(() => setRefreshing(false), 500)
  }, [fetchContracts, refreshing])
  
  // Touch handlers for pull to refresh
  const handleTouchStart = useCallback((e) => {
    // Check if we're at the top of the page
    if (window.scrollY === 0) {
      touchStartY.current = e.touches[0].clientY
      isPulling.current = true
    }
  }, [])
  
  const handleTouchMove = useCallback((e) => {
    if (!isPulling.current || refreshing) return
    const diff = e.touches[0].clientY - touchStartY.current
    if (diff > 0 && diff < 150) {
      setPullProgress(Math.min(diff / 100, 1))
    }
    if (diff > 100 && !refreshing) {
      handleRefresh()
      isPulling.current = false
      setPullProgress(0)
    }
  }, [refreshing, handleRefresh])
  
  const handleTouchEnd = useCallback(() => {
    isPulling.current = false
    setPullProgress(0)
  }, [])
  
  // Sub-views
  if (subView === 'new') {
    return (
      <NewContractView
        connection={connection} escrow={escrow} balance={balance} solBalance={solBalance} price={price} toUSD={toUSD}
        onBack={() => setSubView('list')} 
        showToast={showToast}
        onSuccess={(contractData) => {
          // Directly update state with new metadata to avoid race conditions
          const newMeta = { ...contractsMetadataRef.current, [contractData.offerPDA]: contractData.meta }
          setContractsMetadata(newMeta)
          contractsMetadataRef.current = newMeta
          localStorage.setItem('h173k_contracts_metadata', JSON.stringify(newMeta))
          showToast('Contract created!', 'success')
          fetchContracts()
          setSubView('list')
        }}
        onRefresh={onRefresh}
        h173kDecimals={h173kDecimals}
      />
    )
  }
  
  if (subView === 'accept') {
    return (
      <AcceptContractView
        connection={connection} escrow={escrow} balance={balance} solBalance={solBalance} price={price} toUSD={toUSD}
        onBack={() => setSubView('list')}
        showToast={showToast}
        onSuccess={(contractData) => {
          // Directly update state with new metadata to avoid race conditions
          const newMeta = { ...contractsMetadata, [contractData.offerPDA]: contractData.meta }
          setContractsMetadata(newMeta)
          contractsMetadataRef.current = newMeta
          showToast('Contract accepted!', 'success')
          fetchContracts()
          setSubView('list')
        }}
        onRefresh={onRefresh}
        h173kDecimals={h173kDecimals}
      />
    )
  }
  
  if (subView === 'import') {
    return (
      <ImportContractView
        escrow={escrow}
        onBack={() => setSubView('list')}
        showToast={showToast}
        onSuccess={(result) => {
          // Save metadata for imported contract
          const newMeta = { ...contractsMetadata }
          newMeta[result.publicKey.toString()] = {
            name: result.name,
            code: result.code,
            amount: result.amount,
            timestamp: Date.now(),
            importedAt: new Date().toISOString(),
            hidden: false // Restore if previously hidden
          }
          setContractsMetadata(newMeta)
          localStorage.setItem('h173k_contracts_metadata', JSON.stringify(newMeta))
          showToast('Contract imported!', 'success')
          fetchContracts()
          setSubView('list')
        }}
        h173kDecimals={h173kDecimals}
      />
    )
  }
  
  if (subView === 'detail' && selectedContract) {
    return (
      <ContractDetailView
        connection={connection}
        contract={selectedContract}
        metadata={contractsMetadata[selectedContract.publicKey.toString()]}
        escrow={escrow}
        publicKey={publicKey}
        price={price}
        toUSD={toUSD}
        onBack={() => { setSubView('list'); setSelectedContract(null) }}
        showToast={showToast}
        onRefresh={fetchContracts}
        onSaveMetadata={(data) => saveMetadata(selectedContract.publicKey.toString(), data)}
        h173kDecimals={h173kDecimals}
      />
    )
  }
  
  // Contract list
  return (
    <div 
      className="escrow-view"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div className="view-header">
        <button className="back-btn" onClick={onBack}><BackIcon size={16} /> Back</button>
        <h2>MAD Contracts</h2>
      </div>
      
      <div className="escrow-actions">
        <button className="btn btn-action" onClick={() => setSubView('new')}>
          + New Contract
        </button>
        <button className="btn" onClick={() => setSubView('accept')}>
          Accept Contract
        </button>
      </div>

      <button className="btn btn-p2p" onClick={onOpenP2P}>
        P2P Marketplace
      </button>

      {/* Action buttons above contracts */}
      <div className="escrow-top-actions">
        <button className="escrow-action-btn refresh-action-btn" onClick={handleRefresh} disabled={refreshing}>
          <RefreshIcon size={18} />
          <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
        </button>
        <button className="escrow-action-btn" onClick={() => setSubView('import')}>
          <ImportIcon size={18} />
          <span>Import Contract</span>
        </button>
      </div>
      
      {/* Pull to refresh indicator */}
      {(pullProgress > 0 || refreshing) && (
        <div className="pull-refresh-indicator escrow-pull" style={{ opacity: refreshing ? 1 : pullProgress }}>
          {!refreshing && <RefreshIcon size={20} />}
          <span>{refreshing ? 'Refreshing...' : (pullProgress >= 1 ? 'Release to refresh' : 'Pull to refresh')}</span>
        </div>
      )}
      
      {loading ? (
        <div className="loading-spinner-small" />
      ) : contracts.length === 0 ? (
        <div className="empty-state">
          <p>No MAD contracts yet</p>
          <p className="empty-hint">Create a new contract or accept one with a code</p>
        </div>
      ) : (
        <div className="contracts-list" ref={contractsListRef}>
          {contracts.map((contract) => {
            const meta = contractsMetadata[contract.publicKey.toString()] || {}
            const status = getStatusInfo(contract.status, contract, publicKey)
            const amount = fromTokenAmount(contract.amount)
            
            return (
              <div 
                key={contract.publicKey.toString()} 
                className="contract-item"
                onClick={() => { setSelectedContract(contract); setSubView('detail') }}
              >
                <div className="contract-item-header">
                  <span className="contract-name">{meta.name || 'Unnamed Contract'}</span>
                  <span className={`contract-status ${status.class}`}>{status.label}</span>
                </div>
                <div className="contract-item-amount">
                  {formatH173K(amount, h173kDecimals)} h173k
                  {toUSD && <span className="contract-item-usd">{formatUSD(toUSD(amount))}</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ========== NEW CONTRACT VIEW ==========
function NewContractView({ connection, escrow, balance, solBalance, price, toUSD, onBack, showToast, onSuccess, onRefresh, h173kDecimals }) {
  const [amount, setAmount] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [createdCode, setCreatedCode] = useState(null)
  
  const { withAutoSOL, loading: swapLoading } = useSwap(connection, sessionWallet)
  
const handleCreate = async () => {
  const numAmount = parseFloat(amount)
  if (!numAmount || numAmount <= 0) {
    showToast('Enter valid amount', 'error')
    return
  }
  const requiredDeposit = numAmount * 2

  if (requiredDeposit > balance) {
    showToast(`Insufficient balance. Need ${formatNumber(requiredDeposit)} h173k (2x amount) as deposit.`, 'error')
    return
  }

  setLoading(true)
  try {
    const code = generateCode()

    const BUYER_INDEX_RENT  = 12166080 / 1e9  // 0.01216608 SOL — rent nowego buyerIndex PDA
    const ESCROW_VAULT_RENT = 0.00204          // ATA rent — escrowVault zawsze nowy (unikalny offerPDA)

    // 1. buyerIndex — koszt tylko przy pierwszym kontrakcie tego portfela
    let buyerIndexRent = 0
    try {
      const [buyerIndexPDA] = getBuyerIndexPDA(sessionWallet.publicKey)
      const buyerIndexInfo = await connection.getAccountInfo(buyerIndexPDA)
      if (!buyerIndexInfo) buyerIndexRent = BUYER_INDEX_RENT
    } catch {
      buyerIndexRent = BUYER_INDEX_RENT
    }

    // 2. escrowVault ATA — zawsze ponoszony (każdy kontrakt = nowy unikalny vault)
    const escrowVaultRent = ESCROW_VAULT_RENT

    // NOTE: sponsorAmt removed — referrer never receives SOL sponsorship.
    // Suma wszystkich kosztów SOL które createOffer poniesie z portfela twórcy
    const extraSOLNeeded = buyerIndexRent + escrowVaultRent

    const result = await withAutoSOL(
      () => escrow.createOffer(numAmount, code, name, price),
      (swapInfo) => {
        if (swapInfo.status === 'swapping') {
          showToast('Swapping h173k for SOL...', 'info')
        } else if (swapInfo.status === 'swapped') {
          showToast(`Swapped ${formatSmartNumber(swapInfo.h173kUsed)} h173k for ${swapInfo.solReceived.toFixed(4)} SOL`, 'info')
          if (onRefresh) onRefresh()
        }
      },
      extraSOLNeeded
    )

    // Save metadata
    const meta = JSON.parse(localStorage.getItem('h173k_contracts_metadata') || '{}')
    const contractMeta = { name: name || 'New Contract', code, createdAt: Date.now() }
    meta[result.offerPDA.toString()] = contractMeta
    localStorage.setItem('h173k_contracts_metadata', JSON.stringify(meta))

    setCreatedCode({ code, offerPDA: result.offerPDA.toString(), meta: contractMeta })
  } catch (err) {
    if (err.message.includes('Wallet is locked') || !sessionWallet.isUnlocked()) {
      showToast('Session expired. Please unlock your wallet again.', 'error')
    } else {
      showToast('Failed to create: ' + err.message, 'error')
    }
  } finally {
    setLoading(false)
  }
}
  
  if (createdCode) {
    const handleCopyCode = async () => {
      const success = await copyToClipboard(createdCode.code)
      showToast(success ? 'Code copied!' : 'Copy failed', success ? 'success' : 'error')
    }
    
    return (
      <div className="new-contract-view">
        <div className="success-card">
          <div className="success-icon">✓</div>
          <h2>Contract Created!</h2>
          <p>Share this code with the seller:</p>
          <div className="code-display" onClick={handleCopyCode}>
            <span className="code-text">{createdCode.code}</span>
            <span className="copy-hint">Tap to copy</span>
          </div>
          <p className="code-warning">⚠️ Keep this code safe! You'll need it to manage this contract.</p>
          <button className="btn btn-primary" onClick={() => onSuccess(createdCode)}>Done</button>
        </div>
      </div>
    )
  }
  
  const numAmount = parseFloat(amount) || 0
  const requiredDeposit = numAmount * 2
  const insufficientBalance = !!amount && numAmount > 0 && requiredDeposit > balance
  const usdValue = toUSD && amount ? toUSD(numAmount) : null
  
  return (
    <div className="new-contract-view">
      <div className="view-header">
        <button className="back-btn" onClick={onBack}><BackIcon size={16} /> Back</button>
        <h2>New Contract</h2>
      </div>
      
      <div className="escrow-info-card">
        <p>Create a MAD contract as a <strong>buyer</strong>. You'll deposit <strong>2x the contract amount</strong> as collateral that will be held until the transaction is complete.</p>
      </div>
      
      <div className="form-group">
        <label className="form-label">Contract Name (optional)</label>
        <input 
          type="text" className="form-input" placeholder="e.g. Purchase from Alice"
          value={name} onChange={(e) => setName(e.target.value)} maxLength={50}
        />
      </div>
      
      <div className="form-group">
        <label className="form-label">Amount (h173k)</label>
        <div className="amount-input-wrapper">
          <input 
            type="number" className="form-input" placeholder="0.00"
            value={amount} onChange={(e) => setAmount(e.target.value)} step="0.01"
          />
          <button className="max-btn" onClick={() => setAmount((balance / 2).toFixed(2))}>MAX</button>
        </div>
        <div className="form-hint-row">
          <span className="form-hint">Available: {formatH173K(balance, h173kDecimals)} h173k (max: {formatH173K(balance / 2, h173kDecimals)})</span>
          {usdValue && <span className="amount-usd-preview">{formatUSD(usdValue)}</span>}
        </div>
      </div>
      
      <div className={`deposit-preview${insufficientBalance ? ' deposit-preview--error' : ''}`}>
        <div className="deposit-row">
          <span>Your deposit (2x amount)</span>
          <span>{formatH173K(requiredDeposit, h173kDecimals)} h173k</span>
        </div>
        <div className={`deposit-row total${insufficientBalance ? ' deposit-row--error' : ''}`}>
          <span>Required balance</span>
          <span>{formatH173K(requiredDeposit, h173kDecimals)} h173k</span>
        </div>
        {insufficientBalance && (
          <div className="deposit-row deposit-row--insufficient">
            <span>⚠️ Insufficient balance</span>
            <span className="deposit-shortfall">−{formatH173K(requiredDeposit - balance, h173kDecimals)} h173k</span>
          </div>
        )}
      </div>
      
      <button className="btn btn-primary btn-action" onClick={handleCreate} disabled={loading || swapLoading || !amount || insufficientBalance}>
        {loading ? (swapLoading ? 'Swapping SOL...' : 'Creating...') : 'Create Contract'}
      </button>
    </div>
  )
}

// ========== ACCEPT CONTRACT VIEW ==========
function AcceptContractView({ connection, escrow, balance, solBalance, price, toUSD, onBack, showToast, onSuccess, onRefresh, h173kDecimals }) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [foundContract, setFoundContract] = useState(null)
  
  const { withAutoSOL, loading: swapLoading } = useSwap(connection, sessionWallet)
  
  const handleSearch = async () => {
    if (!code.trim()) {
      showToast('Enter contract code', 'error')
      return
    }
    
    setLoading(true)
    try {
      const result = await escrow.findOfferByCode(code.trim())
      if (result) {
        setFoundContract(result)
      } else {
        showToast('Contract not found', 'error')
      }
    } catch (err) {
      showToast('Search failed: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }
  
  const handleAccept = async () => {
    if (!foundContract) return
    
    const amount = fromTokenAmount(foundContract.amount)
    
    if (amount > balance) {
      showToast(`Insufficient balance. Need ${formatNumber(amount)} h173k as deposit.`, 'error')
      return
    }
    
    setLoading(true)
    try {
      // Check if sellerIndex account needs to be created — it costs rent on first accept.
      // Exact size confirmed from on-chain error: "need 12110400 lamports" → 0.0121104 SOL.
      const SELLER_INDEX_RENT = 12110400 / 1e9 // ~0.01211 SOL, derived from actual program error
      let sellerIndexRent = 0
      try {
        const [sellerIndexPDA] = getSellerIndexPDA(sessionWallet.publicKey)
        const sellerIndexInfo = await connection.getAccountInfo(sellerIndexPDA)
        if (!sellerIndexInfo) {
          sellerIndexRent = SELLER_INDEX_RENT
        }
      } catch {
        // Can't check — be conservative and assume account needs creation
        sellerIndexRent = SELLER_INDEX_RENT
      }

      // Use withAutoSOL wrapper - automatically handles SOL replenishment.
      // Pass sellerIndexRent as extraSOLNeeded so replenish target covers account creation cost.
      await withAutoSOL(
        () => escrow.acceptOffer(foundContract.publicKey, code.trim(), price),
        (swapInfo) => {
          if (swapInfo.status === 'swapping') {
            showToast('Swapping h173k for SOL...', 'info')
          } else if (swapInfo.status === 'swapped') {
            showToast(`Swapped ${formatSmartNumber(swapInfo.h173kUsed)} h173k for ${swapInfo.solReceived.toFixed(4)} SOL`, 'info')
            if (onRefresh) onRefresh()
          }
        },
        sellerIndexRent
      )
      
      // Save metadata
      const meta = JSON.parse(localStorage.getItem('h173k_contracts_metadata') || '{}')
      const contractMeta = { name: name || 'Accepted Contract', code: code.trim(), acceptedAt: Date.now() }
      meta[foundContract.publicKey.toString()] = contractMeta
      localStorage.setItem('h173k_contracts_metadata', JSON.stringify(meta))
      
      onSuccess({ offerPDA: foundContract.publicKey.toString(), meta: contractMeta })
    } catch (err) {
      // Check if wallet session expired
      if (err.message.includes('Wallet is locked') || !sessionWallet.isUnlocked()) {
        showToast('Session expired. Please unlock your wallet again.', 'error')
      } else {
        showToast('Failed to accept: ' + err.message, 'error')
      }
    } finally {
      setLoading(false)
    }
  }
  
  return (
    <div className="accept-contract-view">
      <div className="view-header">
        <button className="back-btn" onClick={onBack}><BackIcon size={16} /> Back</button>
        <h2>Accept Contract</h2>
      </div>
      
      <div className="escrow-info-card">
        <p>Enter the contract code to accept as a <strong>seller</strong>. You'll need to deposit <strong>1x the contract amount</strong> as collateral.</p>
      </div>
      
      <div className="form-group">
        <label className="form-label">Contract Code</label>
        <input 
          type="text" className="form-input" placeholder="Enter code..."
          value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={20}
        />
      </div>
      
      {!foundContract ? (
        <button className="btn btn-primary btn-action" onClick={handleSearch} disabled={loading || !code.trim()}>
          {loading ? 'Searching...' : 'Find Contract'}
        </button>
      ) : (
        <>
          <div className="found-contract-card">
            <div className="found-row">
              <span>Amount</span>
              <span>{formatH173K(fromTokenAmount(foundContract.amount), h173kDecimals)} h173k</span>
            </div>
            {toUSD && (
              <div className="found-row">
                <span>Value</span>
                <span>{formatUSD(toUSD(fromTokenAmount(foundContract.amount)))}</span>
              </div>
            )}
            <div className="found-row">
              <span>Your deposit (1x amount)</span>
              <span>{formatH173K(fromTokenAmount(foundContract.amount), h173kDecimals)} h173k</span>
            </div>
          </div>
          
          <div className="form-group">
            <label className="form-label">Contract Name (optional)</label>
            <input 
              type="text" className="form-input" placeholder="e.g. Sale to Bob"
              value={name} onChange={(e) => setName(e.target.value)} maxLength={50}
            />
          </div>
          
          <button className="btn btn-primary btn-action" onClick={handleAccept} disabled={loading || swapLoading}>
            {loading ? (swapLoading ? 'Swapping SOL...' : 'Accepting...') : 'Accept & Deposit'}
          </button>
        </>
      )}
    </div>
  )
}

// ========== IMPORT CONTRACT VIEW ==========
function ImportContractView({ escrow, onBack, showToast, onSuccess, h173kDecimals }) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [foundContract, setFoundContract] = useState(null)
  
  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      setCode(text.trim().toUpperCase())
      setError('')
    } catch (err) {
      showToast('Could not read clipboard', 'error')
    }
  }
  
  const handleSearch = async () => {
    if (!code.trim()) {
      setError('Please enter a contract code')
      return
    }
    
    setLoading(true)
    setError('')
    setFoundContract(null)
    
    try {
      // Use readOfferByCode if available, otherwise findOfferByCode
      const offer = await escrow.readOfferByCode ? 
        await escrow.readOfferByCode(code.trim()) : 
        await escrow.findOfferByCode(code.trim())
      
      if (!offer) {
        setError('No contract found with this code')
        return
      }
      
      // Determine status
      const status = parseOfferStatus(offer.status)
      let statusLabel = 'unknown'
      if (status === OfferStatus.Completed) statusLabel = 'completed'
      else if (status === OfferStatus.Burned) statusLabel = 'burned'
      else if (status === OfferStatus.Cancelled) statusLabel = 'cancelled'
      else if (status === OfferStatus.Locked) statusLabel = 'ongoing'
      else if (status === OfferStatus.BuyerConfirmed || status === OfferStatus.SellerConfirmed) statusLabel = 'pending-release'
      else if (status === OfferStatus.PendingSeller) statusLabel = 'pending'
      
      setFoundContract({
        ...offer,
        statusLabel,
        isClosed: offer.isClosed || status === OfferStatus.Completed || status === OfferStatus.Burned || status === OfferStatus.Cancelled
      })
      
      // Auto-generate a name suggestion
      if (!name) {
        setName(`Imported #${offer.nonce?.toString() || '?'}`)
      }
    } catch (err) {
      console.error('Error searching for contract:', err)
      setError(err.message || 'Failed to find contract')
    } finally {
      setLoading(false)
    }
  }
  
  const handleImport = () => {
    if (!foundContract) return
    if (!name.trim()) {
      setError('Please enter a name for this contract')
      return
    }
    
    onSuccess({
      publicKey: foundContract.publicKey,
      name: name.trim(),
      code: code.trim(),
      amount: fromTokenAmount(foundContract.amount),
      isClosed: foundContract.isClosed,
      statusLabel: foundContract.statusLabel
    })
  }
  
  const amount = foundContract ? fromTokenAmount(foundContract.amount) : 0
  const statusInfo = foundContract ? getStatusInfo(foundContract.status) : null
  
  return (
    <div className="import-contract-view">
      <div className="view-header">
        <button className="back-btn" onClick={onBack}><BackIcon size={16} /> Back</button>
        <h2>Import Contract</h2>
      </div>
      
      <div className="escrow-info-card">
        <p>Lost a contract from your list? Enter the code to recover it. This works even for completed, cancelled or burned contracts.</p>
      </div>
      
      <div className="form-group">
        <label className="form-label">Contract Code</label>
        <div className="input-with-paste">
          <input 
            type="text" 
            className="form-input" 
            placeholder="Enter code..."
            value={code} 
            onChange={(e) => {
              setCode(e.target.value.toUpperCase())
              setError('')
              setFoundContract(null)
            }} 
            maxLength={20}
          />
          <button type="button" className="paste-btn" onClick={handlePaste}>
            Paste
          </button>
        </div>
      </div>
      
      {error && <div className="error-message">{error}</div>}
      
      {!foundContract ? (
        <button className="btn btn-primary btn-action" onClick={handleSearch} disabled={loading || !code.trim()}>
          {loading ? 'Searching...' : 'Find Contract'}
        </button>
      ) : (
        <>
          <div className="found-contract-card">
            <div className="found-row">
              <span>Status</span>
              <span className={`contract-status ${statusInfo?.class}`}>{statusInfo?.label}</span>
            </div>
            <div className="found-row">
              <span>Amount</span>
              <span>{formatH173K(amount, h173kDecimals)} h173k</span>
            </div>
            {foundContract.isClosed && (
              <div className="found-row closed-note">
                <span>This contract is closed but will be added to your history.</span>
              </div>
            )}
          </div>
          
          <div className="form-group">
            <label className="form-label">Contract Name</label>
            <input 
              type="text" 
              className="form-input" 
              placeholder="e.g. Payment from Alice"
              value={name} 
              onChange={(e) => {
                setName(e.target.value)
                setError('')
              }} 
              maxLength={50}
            />
          </div>
          
          <button className="btn btn-primary btn-action" onClick={handleImport} disabled={!name.trim()}>
            Import Contract
          </button>
        </>
      )}
    </div>
  )
}

// ========== CONTRACT DETAIL VIEW ==========
function ContractDetailView({ connection, contract, metadata, escrow, publicKey, price, toUSD, onBack, showToast, onRefresh, onSaveMetadata, h173kDecimals }) {
  const [loading, setLoading] = useState(false)
  const [showBurnConfirm, setShowBurnConfirm] = useState(false)
  const [burnCodeInput, setBurnCodeInput] = useState('')
  
  const { withAutoSOL, loading: swapLoading } = useSwap(connection, sessionWallet)
  
  const status = getStatusInfo(contract.status, contract, publicKey)
  const amount = fromTokenAmount(contract.amount)
  const buyerDeposit = fromTokenAmount(contract.buyerDeposit)
  const sellerDeposit = fromTokenAmount(contract.sellerDeposit)
  const isBuyer = contract.buyer.toString() === publicKey.toString()
  const isSeller = contract.seller && contract.seller.toString() !== '11111111111111111111111111111111' && contract.seller.toString() === publicKey.toString()
  
  // Check if contract is in terminal state (completed, burned, or cancelled)
  const statusValue = parseOfferStatus(contract.status)
  const isTerminal = statusValue === OfferStatus.Completed || 
                     statusValue === OfferStatus.Burned || 
                     statusValue === OfferStatus.Cancelled
  
  const handleRelease = async () => {
    setLoading(true)
    try {
      await withAutoSOL(
        () => escrow.releaseOffer(contract.publicKey, price),
        (swapInfo) => {
          if (swapInfo.status === 'swapped') {
            showToast(`Swapped ${formatSmartNumber(swapInfo.h173kUsed)} h173k for SOL`, 'info')
          }
        }
      )
      showToast('Release confirmed!', 'success')
      onRefresh()
      onBack()
    } catch (err) {
      // Check if wallet session expired
      if (err.message.includes('Wallet is locked') || !sessionWallet.isUnlocked()) {
        showToast('Session expired. Please unlock your wallet again.', 'error')
      } else {
        showToast('Release failed: ' + err.message, 'error')
      }
    } finally {
      setLoading(false)
    }
  }
  
  const handleCancel = async () => {
    setLoading(true)
    try {
      await withAutoSOL(
        () => escrow.cancelOffer(contract.publicKey, price),
        (swapInfo) => {
          if (swapInfo.status === 'swapped') {
            showToast(`Swapped ${formatSmartNumber(swapInfo.h173kUsed)} h173k for SOL`, 'info')
          }
        }
      )
      showToast('Contract cancelled', 'success')
      onRefresh()
      onBack()
    } catch (err) {
      // Check if wallet session expired
      if (err.message.includes('Wallet is locked') || !sessionWallet.isUnlocked()) {
        showToast('Session expired. Please unlock your wallet again.', 'error')
      } else {
        showToast('Cancel failed: ' + err.message, 'error')
      }
    } finally {
      setLoading(false)
    }
  }
  
  const handleBurn = async () => {
    setLoading(true)
    try {
      await withAutoSOL(
        () => escrow.burnOffer(contract.publicKey, price),
        (swapInfo) => {
          if (swapInfo.status === 'swapped') {
            showToast(`Swapped ${formatSmartNumber(swapInfo.h173kUsed)} h173k for SOL`, 'info')
          }
        }
      )
      showToast('Deposits burned', 'success')
      onRefresh()
      onBack()
    } catch (err) {
      // Check if wallet session expired
      if (err.message.includes('Wallet is locked') || !sessionWallet.isUnlocked()) {
        showToast('Session expired. Please unlock your wallet again.', 'error')
      } else {
        showToast('Burn failed: ' + err.message, 'error')
      }
    } finally {
      setLoading(false)
      setShowBurnConfirm(false)
      setBurnCodeInput('')
    }
  }
  
  const handleHideContract = () => {
    onSaveMetadata({ hidden: true })
    showToast('Contract removed from list', 'success')
    onRefresh() // Refresh the list to apply hidden filter
    onBack()
  }
  
  return (
    <div className="contract-detail-view">
      <div className="view-header">
        <button className="back-btn" onClick={onBack}><BackIcon size={16} /> Back</button>
        <h2>{metadata?.name || 'Contract Details'}</h2>
      </div>
      
      <div className="detail-card">
        <div className="detail-status">
          <span className={`status-badge ${status.class}`}>{status.label}</span>
        </div>
        
        <div className="detail-amount">
          {formatH173K(amount, h173kDecimals)} h173k
          {toUSD && <span className="detail-usd">{formatUSD(toUSD(amount))}</span>}
        </div>
        
        <div className="detail-row">
          <span>Your role</span>
          <span>{isBuyer ? 'Buyer' : isSeller ? 'Seller' : 'Unknown'}</span>
        </div>
        
        <div className="detail-row">
          <span>Buyer deposit</span>
          <span>{formatH173K(buyerDeposit, h173kDecimals)} h173k</span>
        </div>
        
        {sellerDeposit > 0 && (
          <div className="detail-row">
            <span>Seller deposit</span>
            <span>{formatH173K(sellerDeposit, h173kDecimals)} h173k</span>
          </div>
        )}
        
        <div className="detail-row code-row" onClick={async () => {
          if (metadata?.code) {
            const success = await copyToClipboard(metadata.code)
            showToast(success ? 'Code copied!' : 'Copy failed', success ? 'success' : 'error')
          } else {
            showToast('Code not available', 'error')
          }
        }}>
          <span>Code</span>
          <span className="code-value">{metadata?.code || 'Unavailable'} {metadata?.code && <CopyIcon size={14} />}</span>
        </div>
      </div>
      
      {/* Actions based on status */}
      <div className="detail-actions">
        {canCancelOffer(contract, publicKey) && (
          <button className="btn btn-secondary" onClick={handleCancel} disabled={loading || swapLoading}>
            {loading ? (swapLoading ? 'Swapping SOL...' : 'Cancelling...') : 'Cancel Contract'}
          </button>
        )}
        
        {canReleaseOffer(contract, publicKey) && (
          <button className="btn btn-primary btn-action" onClick={handleRelease} disabled={loading || swapLoading}>
            {loading ? (swapLoading ? 'Swapping SOL...' : 'Processing...') : 'Confirm Release'}
          </button>
        )}
        
        {/* Show confirmation status when user already confirmed */}
        {hasAlreadyConfirmed(contract, publicKey) && (
          <div className="release-confirmed-notice">
            <div className="confirmed-icon">✓</div>
            <div className="confirmed-text">
              <strong>Release Confirmed</strong>
              <p>You have confirmed the release. Waiting for the other party to confirm.</p>
            </div>
          </div>
        )}
        
        {canBurnOffer(contract, publicKey) && (
          <>
            {!showBurnConfirm ? (
              <button className="btn btn-danger" onClick={() => setShowBurnConfirm(true)} disabled={loading || swapLoading}>
                Burn Deposits
              </button>
            ) : (
              <div className="burn-confirm">
                <p className="warning-text">⚠️ This will permanently destroy ALL deposits. This action cannot be undone!</p>
                <p className="burn-code-instruction">Type the contract code to confirm:</p>
                <input
                  type="text"
                  className="form-input burn-code-input"
                  placeholder="Enter contract code"
                  value={burnCodeInput}
                  onChange={(e) => setBurnCodeInput(e.target.value.toUpperCase())}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck="false"
                />
                <div className="burn-actions">
                  <button className="btn" onClick={() => { setShowBurnConfirm(false); setBurnCodeInput('') }}>Cancel</button>
                  <button 
                    className="btn btn-danger" 
                    onClick={handleBurn} 
                    disabled={loading || swapLoading || !metadata?.code || burnCodeInput !== metadata.code}
                  >
                    {loading ? (swapLoading ? 'Swapping SOL...' : 'Burning...') : 'Burn All'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        
        {isTerminal && (
          <button className="btn btn-secondary" onClick={handleHideContract}>
            Remove from List
          </button>
        )}
      </div>
    </div>
  )
}

// ========== REFERRAL SECTION ==========
function ReferralSection({ publicKey, showToast }) {
  const [copied, setCopied] = useState(false)
  const [showReferralInfo, setShowReferralInfo] = useState(false)
  
  const referrer = getReferrer()
  const referralLink = generateReferralLink(publicKey.toString())
  
  const handleCopyLink = async () => {
    const success = await copyToClipboard(referralLink)
    if (success) {
      setCopied(true)
      showToast('Referral link copied!', 'success')
      setTimeout(() => setCopied(false), 2000)
    } else {
      showToast('Failed to copy', 'error')
    }
  }
  
  return (
    <div className="settings-section">
      <h3>Referral Program</h3>
      
      <div className="referral-link-section">
        <p className="referral-description">Share your referral link to earn $0.01 in h173k on every transaction made by referred users.</p>
        
        <div className="referral-link-box" onClick={handleCopyLink}>
          <span className="referral-link-text">{referralLink}</span>
          <span className="copy-icon">{copied ? '✓' : <CopyIcon size={16} />}</span>
        </div>
        
        <button className="btn btn-secondary referral-copy-btn" onClick={handleCopyLink}>
          {copied ? 'Copied!' : 'Copy Referral Link'}
        </button>
      </div>
      
      {referrer && (
        <div className="referral-info">
          <div className="settings-item">
            <span>Referred by</span>
            <span className="address-small">{shortenAddress(referrer)}</span>
          </div>
          <p className="referral-note">A small bonus ($0.01 in h173k) is sent to your referrer with each transaction you make.</p>
        </div>
      )}
      
      <button className="referral-info-btn" onClick={() => setShowReferralInfo(!showReferralInfo)}>
        {showReferralInfo ? 'Hide' : 'Learn more about referrals'}
      </button>
      
      {showReferralInfo && (
        <div className="referral-details">
          <p><strong>How it works:</strong></p>
          <ul>
            <li>Share your referral link with friends</li>
            <li>When they create or import a wallet using your link, you become their referrer</li>
            <li>Every time they make a transaction, a small bonus of $0.01 worth of h173k is automatically sent to you</li>
            <li>The bonus is included in the same transaction for efficiency</li>
          </ul>
        </div>
      )}
    </div>
  )
}

// ========== SPONSOR ACCOUNTS TOGGLE ==========
function SponsorAccountsToggle({ showToast }) {
  const [enabled, setEnabled] = useState(() => getSponsorAccounts())

  const handleToggle = () => {
    const next = !enabled
    saveSponsorAccounts(next)
    setEnabled(next)
    showToast(next ? 'Account sponsoring enabled' : 'Account sponsoring disabled', 'info')
  }

  return (
    <div className="settings-item" onClick={handleToggle} style={{ cursor: 'pointer' }}>
      <div>
        <div>Sponsor recipient accounts</div>
        <div style={{ fontSize: '12px', opacity: 0.6, marginTop: '2px' }}>
          Include Swap Priority Fee SOL with every h173k send so recipients can auto-replenish
        </div>
      </div>
      <span className={`badge ${enabled ? 'enabled' : ''}`}>{enabled ? 'On' : 'Off'}</span>
    </div>
  )
}

// ========== REPLENISH NOW BUTTON ==========
// Separate component so it can call useSwap as a hook
function ReplenishNowButton({ connection, solBalance, showToast }) {
  const [busy, setBusy] = useState(false)
  const { swapForSOL, loading } = useSwap(connection, sessionWallet)

  const handleReplenish = async () => {
    const settings = getReplenishSettings()
    const neededSOL = Math.max(0, settings.replenishTo - solBalance)
    if (neededSOL <= 0) {
      showToast('SOL balance is already sufficient', 'info')
      return
    }
    setBusy(true)
    try {
      const result = await swapForSOL(neededSOL)
      showToast(`Replenish OK: +${result.solReceived.toFixed(4)} SOL`, 'success')
    } catch (err) {
      const msg = err.message.replace(/^NO_H173K:|^NO_SOL:/, '')
      showToast('Error: ' + msg, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      className="btn btn-primary btn-action"
      onClick={handleReplenish}
      disabled={busy || loading}
      style={{ width: '100%' }}
    >
      {busy || loading ? 'Swapping h173k→SOL...' : 'Replenish SOL Now'}
    </button>
  )
}

// ========== P2P SETTINGS SECTION (only visible once onboarded) ==========
function P2PSettingsSection({ showToast }) {
  const initial = getP2PProfile()
  const [nickname, setNickname] = useState(initial?.nickname || '')
  if (!initial) return null // hidden until the user has used P2P at least once

  const save = () => {
    const n = nickname.trim()
    if (!n) { showToast('Nickname cannot be empty', 'error'); return }
    if (n.length > 32) { showToast('Nickname too long (max 32)', 'error'); return }
    const current = getP2PProfile() || initial
    saveP2PProfile({ ...current, nickname: n })
    showToast('P2P nickname saved', 'success')
  }

  return (
    <div className="settings-section">
      <h3>P2P Marketplace</h3>
      <div className="form-group" style={{ marginBottom: 12 }}>
        <label className="form-label">Nickname</label>
        <input className="form-input" maxLength={32} value={nickname} onChange={(e) => setNickname(e.target.value)} />
      </div>
      <button className="btn btn-secondary" onClick={save}>Save nickname</button>
    </div>
  )
}

// ========== SETTINGS VIEW ==========
function SettingsView({ connection, publicKey, solBalance, onBack, showToast, onDeleteWallet, onRpcChange, onDecimalsChange }) {
  const [showBackup, setShowBackup] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [showBiometricSetup, setShowBiometricSetup] = useState(false)
  const [showChangePIN, setShowChangePIN] = useState(false)
  const [showRpcSettings, setShowRpcSettings] = useState(false)
  const [showReplenishSettings, setShowReplenishSettings] = useState(false)
  const [replenishForm, setReplenishForm] = useState(() => getReplenishSettings())

  const [pin, setPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmNewPin, setConfirmNewPin] = useState('')
  const [mnemonic, setMnemonic] = useState('')
  const [biometricAvailable, setBiometricAvailable] = useState(false)
  const [biometricEnabled, setBiometricEnabled] = useState(false)
  const [loading, setLoading] = useState(false)
  const [rpcUrl, setRpcUrl] = useState(getRpcEndpoint())
  const [validatingRpc, setValidatingRpc] = useState(false)
  const [h173kDecimals, setH173kDecimals] = useState(() => getH173KDecimals())
  
  useEffect(() => {
    const check = async () => { 
      const s = await checkBiometricSupport()
      setBiometricAvailable(s)
      setBiometricEnabled(isBiometricSetup()) 
    }
    check()
  }, [])
  
  const handleSaveRpc = async () => {
    if (!rpcUrl.trim()) {
      showToast('RPC URL is required', 'error')
      return
    }
    
    setValidatingRpc(true)
    
    try {
      const isValid = await validateRpcEndpoint(rpcUrl.trim())
      if (!isValid) {
        showToast('Invalid RPC endpoint', 'error')
        setValidatingRpc(false)
        return
      }
      
      saveRpcEndpoint(rpcUrl.trim())
      showToast('RPC updated! Reconnecting...', 'success')
      setShowRpcSettings(false)
      
      // Trigger reconnect
      if (onRpcChange) {
        onRpcChange()
      }
    } catch (err) {
      showToast('Failed to validate RPC', 'error')
    } finally {
      setValidatingRpc(false)
    }
  }
  
  const handleShowBackup = () => {
    try { verifyPIN(pin); const p = `${pin}_h173k_wallet_v1`; const phrase = exportMnemonic(p); setMnemonic(phrase); setShowBackup(true) }
    catch (err) { showToast(err.message, 'error') }
    setPin('')
  }
  
  const handleChangePIN = () => {
    if (newPin.length !== 6) {
      showToast('New PIN must be 6 digits', 'error')
      return
    }
    if (newPin !== confirmNewPin) {
      showToast('PINs do not match', 'error')
      return
    }
    try {
      verifyPIN(pin)
      const oldPassword = `${pin}_h173k_wallet_v1`
      const newPassword = `${newPin}_h173k_wallet_v1`
      // Re-encrypt wallet with new PIN
      const phrase = exportMnemonic(oldPassword)
      setupPIN(newPin)
      // Re-store wallet with new password
      storeEncryptedWallet(phrase, newPassword)
      sessionWallet.lock()
      sessionWallet.unlock(newPassword)
      // If biometric is enabled, update it too
      if (biometricEnabled) {
        setupBiometric(newPassword)
      }
      showToast('PIN changed successfully!', 'success')
      setShowChangePIN(false)
      setPin('')
      setNewPin('')
      setConfirmNewPin('')
    } catch (err) {
      showToast(err.message, 'error')
    }
  }
  
  const handleToggleBiometric = async () => {
    if (biometricEnabled) {
      // Disable biometric
      removeBiometric()
      setBiometricEnabled(false)
      showToast('Biometric disabled', 'success')
    } else {
      // Need PIN to enable biometric
      setShowBiometricSetup(true)
    }
  }
  
  const handleEnableBiometric = async () => {
    if (pin.length < 4) {
      showToast('Enter your PIN', 'error')
      return
    }
    
    setLoading(true)
    try {
      verifyPIN(pin)
      const walletPassword = `${pin}_h173k_wallet_v1`
      await setupBiometric(walletPassword)
      setBiometricEnabled(true)
      setShowBiometricSetup(false)
      setPin('')
      showToast('Biometric enabled!', 'success')
    } catch (err) {
      showToast(err.message, 'error')
    } finally {
      setLoading(false)
    }
  }
  
  const handleDeleteWallet = () => { try { verifyPIN(pin); onDeleteWallet() } catch (err) { showToast(err.message, 'error') } }
  
  // Replenish SOL settings sub-view
  if (showReplenishSettings) {
    const handleSaveReplenish = () => {
      const threshold = parseFloat(replenishForm.threshold)
      const replenishTo = parseFloat(replenishForm.replenishTo)
      const swapFeeSol = parseFloat(replenishForm.swapFeeSol)
      const convertThreshold = parseFloat(replenishForm.convertThreshold)

      if (isNaN(swapFeeSol) || swapFeeSol < MIN_SWAP_PRIORITY_FEE) { showToast(`Minimum swap priority fee is ${MIN_SWAP_PRIORITY_FEE} SOL`, 'error'); return }
      if (isNaN(threshold) || threshold < MIN_TRIGGER_THRESHOLD) { showToast(`Trigger replenish below must be at least ${MIN_TRIGGER_THRESHOLD} SOL (2× WSOL ATA rent)`, 'error'); return }
      if (isNaN(replenishTo) || replenishTo < MIN_REPLENISH_TO) { showToast(`Replenish up to must be at least ${MIN_REPLENISH_TO} SOL (3× WSOL ATA rent)`, 'error'); return }
      if (replenishTo <= threshold) { showToast('Replenish amount must be greater than threshold', 'error'); return }
      const minConvert = WSOL_ATA_RENT_CONST + swapFeeSol
      if (isNaN(convertThreshold) || convertThreshold < minConvert) { showToast(`"Show Convert button above" must be at least ${minConvert.toFixed(5)} SOL (WSOL ATA rent + swap fee)`, 'error'); return }
      if (convertThreshold < threshold) { showToast(`"Show Convert button above" cannot be lower than Trigger Replenish Below (${threshold} SOL)`, 'error'); return }

      saveReplenishSettings({ threshold, replenishTo, swapFeeSol, convertThreshold })
      showToast('Settings saved!', 'success')
    }

    return (
      <div className="settings-view">
        <div className="view-header">
          <button className="back-btn" onClick={() => { setShowReplenishSettings(false); setReplenishForm(getReplenishSettings()) }}><BackIcon size={16} /> Back</button>
          <h2>Replenish SOL</h2>
        </div>

        <div className="settings-section">
          <h3>Settings</h3>
          <div className="form-group">
            <label className="form-label">Trigger replenish below (SOL)</label>
            <input
              type="number"
              className="form-input"
              placeholder={DEFAULT_REPLENISH_SETTINGS.threshold}
              value={replenishForm.threshold}
              onChange={(e) => setReplenishForm(f => ({ ...f, threshold: e.target.value }))}
              step="0.001" min={MIN_TRIGGER_THRESHOLD}
            />
            <span className="form-hint">Auto-swap h173k→SOL when balance drops below this level. Minimum: {MIN_TRIGGER_THRESHOLD} SOL (2× WSOL ATA rent)</span>
          </div>
          <div className="form-group">
            <label className="form-label">Replenish up to (SOL)</label>
            <input
              type="number"
              className="form-input"
              placeholder={DEFAULT_REPLENISH_SETTINGS.replenishTo}
              value={replenishForm.replenishTo}
              onChange={(e) => setReplenishForm(f => ({ ...f, replenishTo: e.target.value }))}
              step="0.001" min={MIN_REPLENISH_TO}
            />
            <span className="form-hint">Target SOL balance after replenishment. Minimum: {MIN_REPLENISH_TO} SOL (3× WSOL ATA rent)</span>
          </div>
          <div className="form-group">
            <label className="form-label">Swap priority fee (SOL)</label>
            <input
              type="number"
              className="form-input"
              placeholder={DEFAULT_REPLENISH_SETTINGS.swapFeeSol}
              value={replenishForm.swapFeeSol}
              onChange={(e) => setReplenishForm(f => ({ ...f, swapFeeSol: e.target.value }))}
              step="0.0001" min={MIN_SWAP_PRIORITY_FEE} max="0.1"
            />
            <span className="form-hint">Extra SOL fee for faster swap confirmation. Minimum: {MIN_SWAP_PRIORITY_FEE} SOL.</span>
          </div>

          <div className="form-group">
            <label className="form-label">Show "Convert" button above (SOL)</label>
            <input
              type="number"
              className="form-input"
              placeholder={DEFAULT_REPLENISH_SETTINGS.convertThreshold}
              value={replenishForm.convertThreshold}
              onChange={(e) => setReplenishForm(f => ({ ...f, convertThreshold: e.target.value }))}
              step="0.001" min={WSOL_ATA_RENT_CONST + parseFloat(replenishForm.swapFeeSol || 0)}
            />
            <span className="form-hint">The convert button will appear when SOL balance exceeds this value. Minimum: WSOL ATA rent + swap fee</span>
          </div>
          <button
            className="btn btn-primary"
            onClick={handleSaveReplenish}
            style={{ marginTop: '16px' }}
          >
            Save Settings
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => setReplenishForm({ ...DEFAULT_REPLENISH_SETTINGS })}
            style={{ marginTop: '12px', width: '100%' }}
          >
            Reset to Defaults
          </button>
        </div>

        <div className="settings-section">
          <h3>Manual Replenish</h3>
          <div className="settings-item">
            <span>Current SOL balance</span>
            <span>{formatNumber(solBalance, 4)} SOL</span>
          </div>
          <p style={{ fontSize: '13px', opacity: 0.7, margin: '8px 0 16px' }}>
            If automatic replenish failed, use the button below to try manually.
          </p>
          <ReplenishNowButton
            connection={connection}
            solBalance={solBalance}
            showToast={showToast}
          />
        </div>
      </div>
    )
  }

  // RPC settings view
  if (showRpcSettings) {
    return (
      <div className="settings-view">
        <div className="view-header">
          <button className="back-btn" onClick={() => { setShowRpcSettings(false); setRpcUrl(getRpcEndpoint()) }}><BackIcon size={16} /> Back</button>
          <h2>RPC Settings</h2>
        </div>
        <div className="settings-section">
          <div className="form-group">
            <label className="form-label">RPC Endpoint URL</label>
            <input 
              type="text" 
              className="form-input" 
              placeholder="https://your-rpc-endpoint.com" 
              value={rpcUrl} 
              onChange={(e) => setRpcUrl(e.target.value)}
            />
            <span className="form-hint">Use a reliable Solana RPC provider (Helius, QuickNode, Alchemy, etc.)</span>
          </div>
          <button 
            className="btn btn-primary" 
            onClick={handleSaveRpc} 
            disabled={validatingRpc || !rpcUrl.trim()}
            style={{ marginTop: '16px' }}
          >
            {validatingRpc ? 'Validating...' : 'Save RPC'}
          </button>
          <button 
            className="btn btn-secondary" 
            onClick={() => setRpcUrl(DEFAULT_RPC_ENDPOINT)}
            style={{ marginTop: '12px', width: '100%' }}
          >
            Reset to Default
          </button>
        </div>
      </div>
    )
  }
  
  // Change PIN view
  if (showChangePIN) {
    return (
      <div className="settings-view">
        <div className="view-header">
          <button className="back-btn" onClick={() => { setShowChangePIN(false); setPin(''); setNewPin(''); setConfirmNewPin('') }}><BackIcon size={16} /> Back</button>
          <h2>Change PIN</h2>
        </div>
        <div className="settings-section">
          <div className="form-group">
            <label className="form-label">Current PIN</label>
            <input 
              type="password" 
              className="form-input pin-input" 
              placeholder="••••••" 
              value={pin} 
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} 
              inputMode="numeric" 
            />
          </div>
          <div className="form-group">
            <label className="form-label">New PIN (6 digits)</label>
            <input 
              type="password" 
              className="form-input pin-input" 
              placeholder="••••••" 
              value={newPin} 
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))} 
              inputMode="numeric" 
            />
          </div>
          <div className="form-group">
            <label className="form-label">Confirm New PIN</label>
            <input 
              type="password" 
              className="form-input pin-input" 
              placeholder="••••••" 
              value={confirmNewPin} 
              onChange={(e) => setConfirmNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))} 
              inputMode="numeric" 
            />
          </div>
          <button 
            className="btn btn-primary" 
            onClick={handleChangePIN} 
            disabled={pin.length !== 6 || newPin.length !== 6 || confirmNewPin.length !== 6}
            style={{ marginTop: '16px' }}
          >
            Change PIN
          </button>
        </div>
      </div>
    )
  }
  
  // Biometric setup view
  if (showBiometricSetup) {
    return (
      <div className="settings-view">
        <div className="view-header">
          <button className="back-btn" onClick={() => { setShowBiometricSetup(false); setPin('') }}><BackIcon size={16} /> Back</button>
          <h2>Enable Biometric</h2>
        </div>
        <div className="settings-section">
          <p style={{ marginBottom: '16px', opacity: 0.8 }}>Enter your PIN to enable biometric authentication</p>
          <input 
            type="password" 
            className="form-input pin-input" 
            placeholder="6-digit PIN" 
            value={pin} 
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} 
            inputMode="numeric" 
          />
          <button 
            className="btn btn-primary" 
            onClick={handleEnableBiometric} 
            disabled={loading || pin.length !== 6}
            style={{ marginTop: '16px' }}
          >
            {loading ? 'Setting up...' : 'Enable Biometric'}
          </button>
        </div>
      </div>
    )
  }
  
  return (
    <div className="settings-view">
      <div className="view-header"><button className="back-btn" onClick={onBack}><BackIcon size={16} /> Back</button><h2>Settings</h2></div>
      
      {!showBackup ? (
        <div className="settings-section">
          <h3>Security</h3>
          <div className="settings-item" onClick={() => setShowBackup(true)}><span>Backup Recovery Phrase</span><span className="arrow"><ChevronRightIcon /></span></div>
          <div className="settings-item" onClick={() => setShowChangePIN(true)}><span>Change PIN</span><span className="arrow"><ChevronRightIcon /></span></div>
          {biometricAvailable && (
            <div className="settings-item" onClick={handleToggleBiometric}>
              <span>Biometric Authentication</span>
              <span className={`badge ${biometricEnabled ? 'enabled' : ''}`}>{biometricEnabled ? 'Enabled' : 'Disabled'}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="backup-section">
          {!mnemonic ? (
            <>
              <p>Enter your PIN to view recovery phrase</p>
              <input type="password" className="form-input pin-input" placeholder="6-digit PIN" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" />
              <div className="backup-actions">
                <button className="btn btn-primary" onClick={handleShowBackup}>Reveal Phrase</button>
                <button className="btn" onClick={() => setShowBackup(false)}>Cancel</button>
              </div>
            </>
          ) : (
            <><div className="mnemonic-words">{mnemonic.split(' ').map((word, i) => <div key={i} className="mnemonic-word"><span className="word-number">{i + 1}</span><span className="word-text">{word}</span></div>)}</div><button className="btn" onClick={() => { setMnemonic(''); setShowBackup(false) }}>Done</button></>
          )}
        </div>
      )}
      
      <div className="settings-section">
        <h3>Wallet</h3>
        <div className="settings-item">
          <span>Address</span>
          <span className="address-small">{shortenAddress(publicKey.toString())}</span>
        </div>
      </div>
      
      <ReferralSection publicKey={publicKey} showToast={showToast} />

      <P2PSettingsSection showToast={showToast} />
      
      <div className="settings-section">
        <h3>Network</h3>
        <div className="settings-item">
          <span>Network</span>
          <span>Solana Mainnet</span>
        </div>
        <div className="settings-item" onClick={() => setShowRpcSettings(true)}>
          <span>RPC Endpoint</span>
          <span className="arrow"><ChevronRightIcon /></span>
        </div>
        <div className="settings-item" onClick={() => setShowReplenishSettings(true)}>
          <span>Replenish SOL</span>
          <span className="arrow"><ChevronRightIcon /></span>
        </div>
      </div>

      <div className="settings-section">
        <h3>Display</h3>
        <div className="settings-item">
          <span>h173k decimal places</span>
          <div className="decimal-picker">
            {[0, 2, 4, 6, 8, 9].map(d => (
              <button
                key={d}
                className={`decimal-btn${h173kDecimals === d ? ' active' : ''}`}
                onClick={() => { setH173kDecimals(d); saveH173KDecimals(d); if (onDecimalsChange) onDecimalsChange(d); showToast(`Decimal places set to ${d}`, 'success') }}
              >{d}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3>Sending</h3>
        <SponsorAccountsToggle showToast={showToast} />
      </div>
      
      <div className="settings-section danger">
        <h3>Danger Zone</h3>
        {!showDelete ? <button className="btn btn-danger" onClick={() => setShowDelete(true)}>Delete Wallet</button> : (
          <div className="delete-confirm">
            <p className="warning-text">⚠️ This will permanently delete your wallet. Make sure you have backed up your recovery phrase!</p>
            <input type="password" className="form-input pin-input" placeholder="6-digit PIN" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" />
            <div className="delete-actions"><button className="btn" onClick={() => { setShowDelete(false); setPin('') }}>Cancel</button><button className="btn btn-danger" onClick={handleDeleteWallet} disabled={pin.length !== 6}>Delete Forever</button></div>
          </div>
        )}
      </div>
      
      <div className="settings-section"><h3>About</h3><div className="settings-item"><span>Version</span><span>1.2.2.2</span></div></div>
    </div>
  )
}

// ========== ICONS ==========
function SettingsIcon() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
}

function LockIcon() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
}

function SendIcon({ size = 24 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></svg>
}

function ReceiveIcon({ size = 24 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" /></svg>
}

function EscrowIcon({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <defs>
        <linearGradient id="madGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#EA6A4E" />
          <stop offset="100%" stopColor="#F5A623" />
        </linearGradient>
      </defs>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="url(#madGrad)" />
    </svg>
  )
}

function HistoryIcon({ size = 24 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
}

function RefreshIcon({ size = 20 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
}

function CopyIcon({ size = 16 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
}

function ScanIcon({ size = 20 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2h-4" /><path d="M23 5a2 2 0 0 0-2-2h-4" /><path d="M1 19a2 2 0 0 0 2 2h4" /><path d="M1 5a2 2 0 0 1 2-2h4" /><line x1="1" y1="12" x2="23" y2="12" /></svg>
}

function BackIcon({ size = 20 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
}

function ChevronRightIcon({ size = 16 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
}

function ImportIcon({ size = 20 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
}

export default App
