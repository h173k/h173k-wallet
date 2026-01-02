/**
 * H173K Wallet - PWA Cryptocurrency Wallet
 * Single-token wallet dedicated to H173K on Solana
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Connection, PublicKey, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js'
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

// Constants & Utils
import { TOKEN_MINT, TOKEN_DECIMALS, getRpcEndpoint, saveRpcEndpoint, isRpcConfigured, validateRpcEndpoint, DEFAULT_RPC_ENDPOINT, OfferStatus } from './constants'
import { useTokenPrice } from './usePrice'
import { 
  formatNumber, 
  formatSmartNumber,
  formatUSD, 
  shortenAddress, 
  copyToClipboard,
  fromTokenAmount,
  generateCode,
  getStatusInfo,
  parseOfferStatus,
  canCancelOffer,
  canReleaseOffer,
  canBurnOffer
} from './utils'

import './App.css'

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
  
  const { price, toUSD } = useTokenPrice()
  
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
  
  const fetchBalances = useCallback(async () => {
    if (!connection || !publicKey) return
    try {
      const tokenAccount = await getAssociatedTokenAddress(TOKEN_MINT, publicKey)
      try {
        const account = await getAccount(connection, tokenAccount)
        const newBalance = Number(account.amount) / Math.pow(10, TOKEN_DECIMALS)
        setBalance(newBalance)
        localStorage.setItem('h173k_cached_balance', newBalance.toString())
      } catch (tokenErr) {
        // Only set to 0 if account doesn't exist, not on network errors
        if (tokenErr.name === 'TokenAccountNotFoundError' || tokenErr.name === 'TokenInvalidAccountOwnerError') {
          setBalance(0)
          localStorage.setItem('h173k_cached_balance', '0')
        }
        // On network errors - keep previous balance
      }
      const lamports = await connection.getBalance(publicKey)
      const newSolBalance = lamports / LAMPORTS_PER_SOL
      setSolBalance(newSolBalance)
      localStorage.setItem('h173k_cached_sol_balance', newSolBalance.toString())
    } catch (err) {
      // Network error - keep previous balances, just log
      console.error('Balance fetch error:', err)
    }
  }, [connection, publicKey])
  
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
    sessionWallet.lock()
    setIsUnlocked(false)
  }, [])
  
  if (loading || !initialized) return <LoadingScreen message="Loading wallet..." />
  if (!hasWallet) return <OnboardingFlow onComplete={handleWalletCreated} showToast={showToast} />
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
        <HistoryView connection={connection} publicKey={publicKey} onBack={() => setCurrentView('main')} />
      )}
      
      {currentView === 'escrow' && (
        <EscrowView 
          connection={connection} publicKey={publicKey} balance={balance}
          solBalance={solBalance} price={price} toUSD={toUSD}
          onBack={() => setCurrentView('main')} showToast={showToast} onRefresh={fetchBalances}
        />
      )}
      
      {currentView === 'settings' && (
        <SettingsView
          publicKey={publicKey} onBack={() => setCurrentView('main')} showToast={showToast}
          onDeleteWallet={() => { 
            deleteWallet(); 
            localStorage.removeItem('h173k_cached_balance');
            localStorage.removeItem('h173k_cached_sol_balance');
            setHasWallet(false); 
            setIsUnlocked(false); 
            setPublicKey(null);
            setBalance(0);
            setSolBalance(0);
          }}
          onRpcChange={onRpcChange}
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
function OnboardingFlow({ onComplete, showToast }) {
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
      setStep('welcome')
    } catch (err) {
      setError('Failed to validate RPC: ' + err.message)
    } finally {
      setValidatingRpc(false)
    }
  }, [rpcUrl])
  
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
      onComplete(sessionWallet.getPublicKey())
    } catch (err) { setError(err.message) } 
    finally { setLoading(false) }
  }, [mnemonic, pin, confirmPin, onComplete])
  
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
function MainView({ connection, publicKey, balance, solBalance, price, toUSD, onSend, onReceive, onHistory, onEscrow, onSettings, onRefresh, onLock, showToast }) {
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
  const needsDeposit = solBalance < MIN_SOL_FOR_SWAP
  const lowSOL = solBalance < MIN_SOL_BALANCE && solBalance >= MIN_SOL_FOR_SWAP
  
  // Show SOL prompt if SOL is very low (can't even do a swap) and not dismissed
  useEffect(() => {
    if (solBalance >= MIN_SOL_FOR_SWAP) {
      // Have enough SOL for swaps - close prompt
      setShowSolPrompt(false)
    } else if (solBalance < MIN_SOL_FOR_SWAP && !solPromptDismissed) {
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
  
  // SOL to h173k conversion
  const maxConvertableSOL = Math.max(0, solBalance - 0.02) // Keep minimum 0.02 SOL
  
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
      showToast(`Converted ${numAmount} SOL to ${result.h173kReceived.toFixed(2)} h173k`, 'success')
      setShowConvertModal(false)
      setConvertAmount('')
      setConvertQuote(null)
      onRefresh()
    } catch (err) {
      showToast('Conversion failed: ' + err.message, 'error')
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
    return (
      <div className="main-view">
        <div className="sol-prompt-overlay">
          <div className="sol-prompt-card">
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
            
            <div className="sol-prompt-actions">
              <button className="btn btn-primary btn-action" onClick={handleCheckDeposit} disabled={refreshing}>
                {refreshing ? 'Checking...' : 'I\'ve Deposited SOL'}
              </button>
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
              <label className="form-label">Amount (SOL)</label>
              <input 
                type="number" 
                className="form-input" 
                placeholder="0.00" 
                value={convertAmount} 
                onChange={(e) => handleConvertAmountChange(e.target.value)}
                step="0.01"
                max={maxConvertableSOL}
              />
              <div className="input-hint">
                Available: {formatNumber(maxConvertableSOL, 4)} SOL (keeping 0.02 SOL for fees)
              </div>
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
                disabled={swapLoading || !convertQuote || parseFloat(convertAmount) <= 0}
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
        <div className="balance-amount">{formatNumber(balance)} <span className="balance-symbol">h173k</span></div>
        {usdValue !== null && <div className="balance-usd">{formatUSD(usdValue)}</div>}
        <div className="balance-sol-row">
          <span className="balance-sol">{formatNumber(solBalance, 4)} SOL</span>
          {solBalance > 0.02 && (
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
            <span>MAD</span>
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
  
  const { withAutoSOL, loading: swapLoading } = useSwap(connection, sessionWallet)
  const usdValue = toUSD && amount ? toUSD(parseFloat(amount) || 0) : null
  
  const handleScan = (data) => {
    if (data.address) { setRecipient(data.address); if (data.amount) setAmount(data.amount.toString()) }
    setShowScanner(false)
  }
  
  const validateAndProceed = async () => {
    if (!recipient.trim()) { showToast('Enter recipient address', 'error'); return }
    try { new PublicKey(recipient) } catch { showToast('Invalid Solana address', 'error'); return }
    const sendAmount = parseFloat(amount)
    if (!sendAmount || sendAmount <= 0) { showToast('Enter valid amount', 'error'); return }
    if (sendAmount > balance) { showToast('Insufficient balance', 'error'); return }
    
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
          try { await getAccount(connection, recipientTokenAccount) } 
          catch { transaction.add(createAssociatedTokenAccountInstruction(publicKey, recipientTokenAccount, recipientPubkey, TOKEN_MINT)) }
          
          transaction.add(createTransferInstruction(senderTokenAccount, recipientTokenAccount, publicKey, amountLamports))
          
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
            showToast(`Swapped ${swapInfo.h173kUsed.toFixed(2)} h173k for ${swapInfo.solReceived.toFixed(4)} SOL`, 'info')
            if (onRefresh) onRefresh()
          }
        }
      )
      
      setTxSignature(signature)
      showToast('Transaction sent!', 'success')
      onRefresh()
    } catch (err) { console.error('Send error:', err); showToast('Transaction failed: ' + err.message, 'error') }
    finally { setLoading(false) }
  }
  
  if (txSignature) {
    return (
      <div className="send-view">
        <div className="success-card">
          <div className="success-icon">✓</div>
          <h2>Sent!</h2>
          <p className="success-amount">{formatNumber(parseFloat(amount))} h173k</p>
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
          <div className="confirm-row"><span className="confirm-label">Amount</span><span className="confirm-value">{formatNumber(parseFloat(amount))} h173k{usdValue && <span className="confirm-usd">({formatUSD(usdValue)})</span>}</span></div>
          <div className="confirm-row"><span className="confirm-label">To</span><span className="confirm-value address">{shortenAddress(recipient)}</span></div>
          <div className="confirm-row"><span className="confirm-label">Network Fee</span><span className="confirm-value">~0.000005 SOL</span></div>
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
          <span className="form-hint">Available: {formatNumber(balance)} h173k</span>
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
function HistoryView({ connection, publicKey, onBack }) {
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
      
      // 1. Fetch H173K token transactions
      const tokenAccount = await getAssociatedTokenAddress(TOKEN_MINT, publicKey)
      const tokenSignatures = await connection.getSignaturesForAddress(tokenAccount, { limit: 30 })
      
      const tokenTxs = await Promise.all(tokenSignatures.map(async (sig) => {
        try {
          const tx = await connection.getParsedTransaction(sig.signature, { maxSupportedTransactionVersion: 0 })
          if (!tx?.meta) return null
          
          const preBalances = tx.meta.preTokenBalances || []
          const postBalances = tx.meta.postTokenBalances || []
          
          const preB = preBalances.find(b => b.mint === TOKEN_MINT.toString() && b.owner === ownerStr)
          const postB = postBalances.find(b => b.mint === TOKEN_MINT.toString() && b.owner === ownerStr)
          
          const pre = preB?.uiTokenAmount?.uiAmount || 0
          const post = postB?.uiTokenAmount?.uiAmount || 0
          const diff = post - pre
          
          if (diff === 0) return null
          
          return { 
            signature: sig.signature, 
            blockTime: sig.blockTime, 
            type: diff > 0 ? 'receive' : 'send', 
            amount: Math.abs(diff),
            token: 'h173k',
            error: sig.err !== null 
          }
        } catch (err) { 
          console.error('Error parsing token tx:', sig.signature, err)
          return null
        }
      }))
      
      allTxs.push(...tokenTxs.filter(tx => tx && tx.amount > 0 && !tx.error))
      
      // 2. Fetch SOL transactions
      const solSignatures = await connection.getSignaturesForAddress(publicKey, { limit: 30 })
      
      const solTxs = await Promise.all(solSignatures.map(async (sig) => {
        try {
          // Skip if already processed as token tx
          if (allTxs.some(t => t.signature === sig.signature)) return null
          
          const tx = await connection.getParsedTransaction(sig.signature, { maxSupportedTransactionVersion: 0 })
          if (!tx?.meta) return null
          
          // Find account index for our publicKey
          const accountKeys = tx.transaction.message.accountKeys.map(k => k.pubkey?.toString() || k.toString())
          const accountIndex = accountKeys.findIndex(k => k === ownerStr)
          
          if (accountIndex === -1) return null
          
          const preSol = tx.meta.preBalances[accountIndex] || 0
          const postSol = tx.meta.postBalances[accountIndex] || 0
          const diff = (postSol - preSol) / LAMPORTS_PER_SOL
          
          // Skip tiny changes (likely just fees) - threshold 0.0001 SOL
          if (Math.abs(diff) < 0.0001) return null
          
          // If we're just paying fees (small negative amount), skip
          const fee = (tx.meta.fee || 0) / LAMPORTS_PER_SOL
          if (diff < 0 && Math.abs(diff) <= fee * 1.1) return null
          
          return { 
            signature: sig.signature, 
            blockTime: sig.blockTime, 
            type: diff > 0 ? 'receive' : 'send', 
            amount: Math.abs(diff),
            token: 'SOL',
            error: sig.err !== null 
          }
        } catch (err) { 
          console.error('Error parsing SOL tx:', sig.signature, err)
          return null
        }
      }))
      
      allTxs.push(...solTxs.filter(tx => tx && tx.amount > 0 && !tx.error))
      
      // Sort by time (newest first)
      allTxs.sort((a, b) => (b.blockTime || 0) - (a.blockTime || 0))
      
      setTransactions(allTxs)
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
              <div className={`tx-amount ${tx.type}`}>{tx.type === 'receive' ? '+' : '-'}{formatNumber(tx.amount, tx.token === 'SOL' ? 4 : 2)} {tx.token}</div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

// ========== ESCROW VIEW ==========
function EscrowView({ connection, publicKey, balance, solBalance, price, toUSD, onBack, showToast, onRefresh }) {
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
    
    // Always reload metadata from localStorage to get latest hidden flags
    let currentMeta = contractsMetadataRef.current
    try {
      const stored = localStorage.getItem('h173k_contracts_metadata')
      currentMeta = stored ? JSON.parse(stored) : {}
      setContractsMetadata(currentMeta)
      contractsMetadataRef.current = currentMeta
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
    const newMeta = { ...contractsMetadata, [key]: { ...contractsMetadata[key], ...data } }
    setContractsMetadata(newMeta)
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
        connection={connection} escrow={escrow} balance={balance} solBalance={solBalance} toUSD={toUSD}
        onBack={() => setSubView('list')} 
        showToast={showToast}
        onSuccess={(code, name) => {
          reloadMetadata()
          showToast('Contract created!', 'success')
          fetchContracts()
          setSubView('list')
        }}
        onRefresh={onRefresh}
      />
    )
  }
  
  if (subView === 'accept') {
    return (
      <AcceptContractView
        connection={connection} escrow={escrow} balance={balance} solBalance={solBalance}
        onBack={() => setSubView('list')}
        showToast={showToast}
        onSuccess={() => {
          showToast('Contract accepted!', 'success')
          fetchContracts()
          setSubView('list')
        }}
        onRefresh={onRefresh}
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
        toUSD={toUSD}
        onBack={() => { setSubView('list'); setSelectedContract(null) }}
        showToast={showToast}
        onRefresh={fetchContracts}
        onSaveMetadata={(data) => saveMetadata(selectedContract.publicKey.toString(), data)}
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
                  {formatNumber(amount)} h173k
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
function NewContractView({ connection, escrow, balance, solBalance, toUSD, onBack, showToast, onSuccess, onRefresh }) {
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
      
      // Use withAutoSOL wrapper - automatically handles SOL replenishment
      const result = await withAutoSOL(
        () => escrow.createOffer(numAmount, code),
        (swapInfo) => {
          if (swapInfo.status === 'swapping') {
            showToast('Swapping h173k for SOL...', 'info')
          } else if (swapInfo.status === 'swapped') {
            showToast(`Swapped ${swapInfo.h173kUsed.toFixed(2)} h173k for ${swapInfo.solReceived.toFixed(4)} SOL`, 'info')
            if (onRefresh) onRefresh()
          }
        }
      )
      
      // Save metadata
      const meta = JSON.parse(localStorage.getItem('h173k_contracts_metadata') || '{}')
      meta[result.offerPDA.toString()] = { name: name || 'New Contract', code, createdAt: Date.now() }
      localStorage.setItem('h173k_contracts_metadata', JSON.stringify(meta))
      
      setCreatedCode(code)
    } catch (err) {
      showToast('Failed to create: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }
  
  if (createdCode) {
    const handleCopyCode = async () => {
      const success = await copyToClipboard(createdCode)
      showToast(success ? 'Code copied!' : 'Copy failed', success ? 'success' : 'error')
    }
    
    return (
      <div className="new-contract-view">
        <div className="success-card">
          <div className="success-icon">✓</div>
          <h2>Contract Created!</h2>
          <p>Share this code with the seller:</p>
          <div className="code-display" onClick={handleCopyCode}>
            <span className="code-text">{createdCode}</span>
            <span className="copy-hint">Tap to copy</span>
          </div>
          <p className="code-warning">⚠️ Keep this code safe! You'll need it to manage this contract.</p>
          <button className="btn btn-primary" onClick={() => onSuccess(createdCode, name)}>Done</button>
        </div>
      </div>
    )
  }
  
  const usdValue = toUSD && amount ? toUSD(parseFloat(amount) || 0) : null
  
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
          <span className="form-hint">Available: {formatNumber(balance)} h173k (max: {formatNumber(balance / 2)})</span>
          {usdValue && <span className="amount-usd-preview">{formatUSD(usdValue)}</span>}
        </div>
      </div>
      
      <div className="deposit-preview">
        <div className="deposit-row">
          <span>Your deposit (2x amount)</span>
          <span>{formatNumber(parseFloat(amount || 0) * 2)} h173k</span>
        </div>
        <div className="deposit-row total">
          <span>Required balance</span>
          <span>{formatNumber(parseFloat(amount || 0) * 2)} h173k</span>
        </div>
      </div>
      
      <button className="btn btn-primary btn-action" onClick={handleCreate} disabled={loading || swapLoading || !amount}>
        {loading ? (swapLoading ? 'Swapping SOL...' : 'Creating...') : 'Create Contract'}
      </button>
    </div>
  )
}

// ========== ACCEPT CONTRACT VIEW ==========
function AcceptContractView({ connection, escrow, balance, solBalance, onBack, showToast, onSuccess, onRefresh }) {
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
      // Use withAutoSOL wrapper - automatically handles SOL replenishment
      await withAutoSOL(
        () => escrow.acceptOffer(foundContract.publicKey, code.trim()),
        (swapInfo) => {
          if (swapInfo.status === 'swapping') {
            showToast('Swapping h173k for SOL...', 'info')
          } else if (swapInfo.status === 'swapped') {
            showToast(`Swapped ${swapInfo.h173kUsed.toFixed(2)} h173k for ${swapInfo.solReceived.toFixed(4)} SOL`, 'info')
            if (onRefresh) onRefresh()
          }
        }
      )
      
      // Save metadata
      const meta = JSON.parse(localStorage.getItem('h173k_contracts_metadata') || '{}')
      meta[foundContract.publicKey.toString()] = { name: name || 'Accepted Contract', code: code.trim(), acceptedAt: Date.now() }
      localStorage.setItem('h173k_contracts_metadata', JSON.stringify(meta))
      
      onSuccess()
    } catch (err) {
      showToast('Failed to accept: ' + err.message, 'error')
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
              <span>{formatNumber(fromTokenAmount(foundContract.amount))} h173k</span>
            </div>
            <div className="found-row">
              <span>Your deposit (1x amount)</span>
              <span>{formatNumber(fromTokenAmount(foundContract.amount))} h173k</span>
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
function ImportContractView({ escrow, onBack, showToast, onSuccess }) {
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
              <span>{formatNumber(amount)} h173k</span>
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
function ContractDetailView({ connection, contract, metadata, escrow, publicKey, toUSD, onBack, showToast, onRefresh, onSaveMetadata }) {
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
        () => escrow.releaseOffer(contract.publicKey),
        (swapInfo) => {
          if (swapInfo.status === 'swapped') {
            showToast(`Swapped ${swapInfo.h173kUsed.toFixed(2)} h173k for SOL`, 'info')
          }
        }
      )
      showToast('Release confirmed!', 'success')
      onRefresh()
      onBack()
    } catch (err) {
      showToast('Release failed: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }
  
  const handleCancel = async () => {
    setLoading(true)
    try {
      await withAutoSOL(
        () => escrow.cancelOffer(contract.publicKey),
        (swapInfo) => {
          if (swapInfo.status === 'swapped') {
            showToast(`Swapped ${swapInfo.h173kUsed.toFixed(2)} h173k for SOL`, 'info')
          }
        }
      )
      showToast('Contract cancelled', 'success')
      onRefresh()
      onBack()
    } catch (err) {
      showToast('Cancel failed: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }
  
  const handleBurn = async () => {
    setLoading(true)
    try {
      await withAutoSOL(
        () => escrow.burnOffer(contract.publicKey),
        (swapInfo) => {
          if (swapInfo.status === 'swapped') {
            showToast(`Swapped ${swapInfo.h173kUsed.toFixed(2)} h173k for SOL`, 'info')
          }
        }
      )
      showToast('Deposits burned', 'success')
      onRefresh()
      onBack()
    } catch (err) {
      showToast('Burn failed: ' + err.message, 'error')
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
          {formatNumber(amount)} h173k
          {toUSD && <span className="detail-usd">{formatUSD(toUSD(amount))}</span>}
        </div>
        
        <div className="detail-row">
          <span>Your role</span>
          <span>{isBuyer ? 'Buyer' : isSeller ? 'Seller' : 'Unknown'}</span>
        </div>
        
        <div className="detail-row">
          <span>Buyer deposit</span>
          <span>{formatNumber(buyerDeposit)} h173k</span>
        </div>
        
        {sellerDeposit > 0 && (
          <div className="detail-row">
            <span>Seller deposit</span>
            <span>{formatNumber(sellerDeposit)} h173k</span>
          </div>
        )}
        
        {metadata?.code && (
          <div className="detail-row code-row" onClick={async () => {
            const success = await copyToClipboard(metadata.code)
            showToast(success ? 'Code copied!' : 'Copy failed', success ? 'success' : 'error')
          }}>
            <span>Code</span>
            <span className="code-value">{metadata.code} <CopyIcon size={14} /></span>
          </div>
        )}
      </div>
      
      {/* Actions based on status */}
      <div className="detail-actions">
        {canCancelOffer(contract, publicKey) && (
          <button className="btn btn-secondary" onClick={handleCancel} disabled={loading || swapLoading}>
            {loading ? (swapLoading ? 'Swapping SOL...' : 'Cancelling...') : 'Cancel Contract'}
          </button>
        )}
        
        {canReleaseOffer(contract, publicKey) && (
          <>
            <button className="btn btn-primary btn-action" onClick={handleRelease} disabled={loading || swapLoading}>
              {loading ? (swapLoading ? 'Swapping SOL...' : 'Processing...') : 'Confirm Release'}
            </button>
            
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

// ========== SETTINGS VIEW ==========
function SettingsView({ publicKey, onBack, showToast, onDeleteWallet, onRpcChange }) {
  const [showBackup, setShowBackup] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [showBiometricSetup, setShowBiometricSetup] = useState(false)
  const [showChangePIN, setShowChangePIN] = useState(false)
  const [showRpcSettings, setShowRpcSettings] = useState(false)
  const [pin, setPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmNewPin, setConfirmNewPin] = useState('')
  const [mnemonic, setMnemonic] = useState('')
  const [biometricAvailable, setBiometricAvailable] = useState(false)
  const [biometricEnabled, setBiometricEnabled] = useState(false)
  const [loading, setLoading] = useState(false)
  const [rpcUrl, setRpcUrl] = useState(getRpcEndpoint())
  const [validatingRpc, setValidatingRpc] = useState(false)
  
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
              <button className="btn btn-primary" onClick={handleShowBackup}>Reveal Phrase</button>
              <button className="btn" onClick={() => setShowBackup(false)}>Cancel</button>
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
      
      <div className="settings-section"><h3>About</h3><div className="settings-item"><span>Version</span><span>1.0.0</span></div></div>
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
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
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
