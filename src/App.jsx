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

// Lottery (Win h173k)
import LotteryView from './lottery/LotteryView'
import './lottery/lottery.css'

// P2P Marketplace
import P2PMarketplace from './p2p/P2PMarketplace'
import { getP2PProfile, saveP2PProfile, isP2POnboarded } from './p2p/useP2P'

// Messenger (E2E encrypted)
import MessengerView from './messenger/MessengerView'
import {
  store as messengerStore,
  scanIncomingMessages,
  getNotificationsEnabled,
  setNotificationsEnabled,
  getMessengerScanLimit,
  setMessengerScanLimit,
  MESSENGER_SCAN_OPTIONS,
  getTxNotificationsEnabled,
  setTxNotificationsEnabled,
  showAppNotification,
  scanLockedNotifications,
} from './messenger/messenger'

// Constants & Utils
import { TOKEN_MINT, TOKEN_DECIMALS, getRpcEndpoint, saveRpcEndpoint, isRpcConfigured, validateRpcEndpoint, DEFAULT_RPC_ENDPOINT, OfferStatus, getReplenishSettings, saveReplenishSettings, DEFAULT_REPLENISH_SETTINGS, getSponsorAccounts, saveSponsorAccounts, WSOL_ATA_RENT as WSOL_ATA_RENT_CONST, MIN_SWAP_PRIORITY_FEE, MIN_TRIGGER_THRESHOLD, MIN_REPLENISH_TO, getH173KDecimals, saveH173KDecimals, getAutoLockSeconds, saveAutoLockSeconds, DEFAULT_AUTO_LOCK_SECONDS } from './constants'
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

// Internationalization (i18n)
import { useTranslation } from './i18n'

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

// P2P offer deep links
import { getOfferLinkFromURL, clearOfferLinkFromURL, isIOS as detectIOS } from './p2p/deeplink'

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
function InstallPromptScreen({ offerLink }) {
  const { t } = useTranslation()
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
        <h1 className="install-title">{t('install.title')}</h1>
        <p className="install-subtitle">
          {t('install.subtitle')}
        </p>

        {offerLink && (
          <div className="install-note">
            <span className="note-icon">🔗</span>
            <p>{offerLink.currency
              ? t('install.offerLinkNotice', { code: offerLink.currency })
              : t('install.offerLinkNoticeGeneric')}</p>
          </div>
        )}
        
        <div className="install-instructions">
          {isIOS ? (
            <>
              <div className="install-step">
                <span className="step-number">1</span>
                <span>{t('install.tapThe')} <strong>{t('install.share')}</strong> <ShareIcon /></span>
              </div>
              <div className="install-step">
                <span className="step-number">2</span>
                <span>{t('install.scrollAndTap')} <strong>{t('install.addToHomeScreen')}</strong></span>
              </div>
              <div className="install-step">
                <span className="step-number">3</span>
                <span>{t('install.tap')} <strong>{t('install.add')}</strong> {t('install.toConfirm')}</span>
              </div>
            </>
          ) : (
            <>
              <div className="install-step">
                <span className="step-number">1</span>
                <span>{t('install.tapThe')} <strong>{t('install.menu')}</strong> <MenuIcon /></span>
              </div>
              <div className="install-step">
                <span className="step-number">2</span>
                <span>{t('install.select')} <strong>{t('install.addToHomeScreenLower')}</strong> {t('install.or')} <strong>{t('install.installApp')}</strong></span>
              </div>
              <div className="install-step">
                <span className="step-number">3</span>
                <span>{t('install.tap')} <strong>{t('install.install')}</strong> {t('install.toConfirm')}</span>
              </div>
            </>
          )}
        </div>
        
        <div className="install-note">
          <span className="note-icon">🔒</span>
          <p>{t('install.note')}</p>
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
  // Subscribe to the active language so the app re-renders on language change.
  const { t } = useTranslation()
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

  // P2P offer deep link opened on iOS: link-opening isn't supported there, so we show
  // an explanatory notice no matter which screen is up (install prompt, lock, app…).
  // This lives at the top level on purpose — WalletApp isn't mounted on the iOS install
  // screen, so a notice inside it would never appear.
  const [iosNotice, setIosNotice] = useState(() => {
    try { const l = getOfferLinkFromURL(); return (l && detectIOS()) ? l : null } catch { return null }
  })
  // Offer link present in the URL (any platform) — used to explain on the install
  // screen that the link points at a P2P offer and the app must be installed/opened.
  const offerLinkInUrl = useMemo(() => { try { return getOfferLinkFromURL() } catch { return null } }, [])
  useEffect(() => {
    if (iosNotice) clearOfferLinkFromURL()
  }, [iosNotice])

  const iosNoticeModal = iosNotice ? (
    <div className="p2p-modal-overlay" onClick={() => setIosNotice(null)}>
      <div className="p2p-modal" onClick={(e) => e.stopPropagation()}>
        <div className="p2p-modal-head"><h3>{t('p2p.linkIosTitle')}</h3></div>
        <div className="escrow-info-card">
          <p>{iosNotice.currency
            ? t('p2p.linkIosBody', { code: iosNotice.currency })
            : t('p2p.linkIosBodyGeneric')}</p>
        </div>
        <button className="btn btn-action" onClick={() => setIosNotice(null)}>{t('common.done')}</button>
      </div>
    </div>
  ) : null
  
  // Show loading until check is complete
  if (!checkComplete) {
    return (
      <>
        <div className="landscape-overlay">
          <div className="rotate-icon">📱</div>
          <h2>{t('orientation.title')}</h2>
          <p>{t('orientation.subtitle')}</p>
        </div>
        <div className="app-background"><div className="light-streak" /></div>
        <div className="app-container">
          <LoadingScreen message={t('loading.generic')} />
        </div>
        {iosNoticeModal}
      </>
    )
  }
  
  // Show install prompt if on mobile and not standalone
  if (requiresInstall) {
    return (
      <>
        <div className="landscape-overlay">
          <div className="rotate-icon">📱</div>
          <h2>{t('orientation.title')}</h2>
          <p>{t('orientation.subtitle')}</p>
        </div>
        <div className="app-background"><div className="light-streak" /></div>
        <div className="app-container">
          <InstallPromptScreen offerLink={offerLinkInUrl} />
        </div>
        {iosNoticeModal}
      </>
    )
  }
  
  return (
    <>
      <div className="landscape-overlay">
        <div className="rotate-icon">📱</div>
        <h2>{t('orientation.title')}</h2>
        <p>{t('orientation.subtitle')}</p>
      </div>
      <div className="app-background"><div className="light-streak" /></div>
      <div className="app-container">
        {!connection ? <LoadingScreen message={t('loading.connecting')} /> : <WalletApp connection={connection} onRpcChange={handleRpcChange} />}
      </div>
      {iosNoticeModal}
    </>
  )
}

// ========== WALLET APP ==========
function WalletApp({ connection, onRpcChange }) {
  const { t } = useTranslation()
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
  const [messengerUnread, setMessengerUnread] = useState(() => {
    try { return messengerStore.getTotalUnread() } catch { return 0 }
  })
  // When set, the messenger opens directly on this peer's thread (e.g. from P2P).
  const [messengerTarget, setMessengerTarget] = useState(null)
  // Last seen h173k balance, used to detect incoming transfers for notifications.
  const prevH173kRef = useRef(null)

  // Open the messenger focused on a specific peer, ensuring the thread exists.
  const openMessengerWith = useCallback((address, suggestedName) => {
    try {
      const existing = messengerStore.getThread(address)
      messengerStore.addContact(address, existing ? null : (suggestedName || ''))
    } catch {}
    setMessengerTarget(address)
    setCurrentView('messenger')
  }, [])

  // Keep the envelope badge in sync with the messenger store.
  useEffect(() => {
    const update = () => setMessengerUnread(messengerStore.getTotalUnread())
    update()
    return messengerStore.subscribe(update)
  }, [])

  // Open the relevant conversation when a message notification is clicked.
  useEffect(() => {
    const openFrom = (address) => { if (address) openMessengerWith(address) }
    const onWinEvent = (e) => openFrom(e.detail)
    const onSwMessage = (e) => {
      if (e.data && e.data.type === 'h173k-open-thread') openFrom(e.data.from)
    }
    window.addEventListener('h173k-open-thread', onWinEvent)
    if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', onSwMessage)
    return () => {
      window.removeEventListener('h173k-open-thread', onWinEvent)
      if (navigator.serviceWorker) navigator.serviceWorker.removeEventListener('message', onSwMessage)
    }
  }, [openMessengerWith])
  
  // Check for referral code in URL on mount
  const [pendingReferral, setPendingReferral] = useState(() => getReferralFromURL())

  // Check for a P2P offer deep link in the URL on mount.
  // The link is split in two: a target we act on (non-iOS), and an iOS notice.
  // iOS can generate/share links but can't open them, so on iOS we explain why and
  // tell the user to open the marketplace and look in that currency's offers instead.
  const initialOfferLink = useMemo(() => getOfferLinkFromURL(), [])
  const isIOSDevice = useMemo(() => detectIOS(), [])
  const [pendingOfferLink, setPendingOfferLink] = useState(() => (initialOfferLink && !isIOSDevice ? initialOfferLink : null))

  // Strip the deep-link params from the address bar once, so refreshing won't re-trigger.
  useEffect(() => {
    if (initialOfferLink) clearOfferLinkFromURL()
  }, [initialOfferLink])

  // Once the wallet is usable, open the P2P marketplace so the linked offer can load.
  // The offer itself is fetched + shown inside P2PMarketplace (via the deepLink prop).
  useEffect(() => {
    if (pendingOfferLink && hasWallet && isUnlocked && connection) {
      setCurrentView('p2p')
    }
  }, [pendingOfferLink, hasWallet, isUnlocked, connection])
  
  const { price, toUSD } = useTokenPrice(connection)
  
  // Store last known price for referral calculations
  useEffect(() => {
    if (price && price > 0) {
      storeLastKnownPrice(price)
    }
  }, [price])
  
  useEffect(() => {
    // Apply the saved auto-lock timeout before any unlock happens.
    sessionWallet.autoLockMinutes = getAutoLockSeconds() / 60
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
          // Notify on incoming h173k (balance increased since the last refresh).
          const prev = prevH173kRef.current
          if (prev !== null && newBalance > prev + 1e-9 && getTxNotificationsEnabled()) {
            const delta = newBalance - prev
            showAppNotification('Received h173k', '+' + formatH173K(delta, h173kDecimals) + ' h173k', { tag: 'h173k-tx' })
          }
          prevH173kRef.current = newBalance
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

      // Scan for new encrypted messages alongside the balance refresh.
      try { await scanIncomingMessages(connection, publicKey) } catch (e) { /* non-fatal */ }
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

  // Cache the public address (not sensitive) so we can scan for message
  // notifications even on a cold start while the wallet is still locked.
  useEffect(() => {
    if (publicKey) {
      try { localStorage.setItem('h173k_cached_address', publicKey.toString()) } catch {}
    }
  }, [publicKey])

  // While LOCKED, run a lightweight scan that only detects new incoming messages
  // (no decryption) and fires a content-less "new message" notification.
  useEffect(() => {
    if (!hasWallet || isUnlocked || !connection) return
    const address = (publicKey && publicKey.toString()) ||
      (() => { try { return localStorage.getItem('h173k_cached_address') } catch { return null } })()
    if (!address) return
    const run = () => { scanLockedNotifications(connection, address).catch(() => {}) }
    run()
    const interval = setInterval(run, 30000)
    return () => clearInterval(interval)
  }, [hasWallet, isUnlocked, connection, publicKey])
  
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
  
  if (loading || !initialized) return <LoadingScreen message={t('loading.wallet')} />
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
          onMessenger={() => { setMessengerTarget(null); setCurrentView('messenger') }}
          messengerUnread={messengerUnread}
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
        <ReceiveView publicKey={publicKey} onBack={() => setCurrentView('main')} showToast={showToast} onWin={() => setCurrentView('lottery')} />
      )}

      {currentView === 'lottery' && (
        <LotteryView
          connection={connection} publicKey={publicKey}
          onBack={() => setCurrentView('receive')} showToast={showToast}
          onRefresh={fetchBalances} h173kDecimals={h173kDecimals}
        />
      )}

      {currentView === 'messenger' && (
        <MessengerView
          connection={connection} publicKey={publicKey}
          initialAddress={messengerTarget}
          onBack={() => setCurrentView('main')} showToast={showToast}
        />
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
          onOpenMessenger={openMessengerWith}
          deepLink={pendingOfferLink} onDeepLinkDone={() => setPendingOfferLink(null)}
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
            localStorage.removeItem('h173k_cached_address');
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
  const { t } = useTranslation()
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
      setError(t('onboarding.errRpcRequired'))
      return
    }
    
    setValidatingRpc(true)
    setError('')
    
    try {
      const isValid = await validateRpcEndpoint(rpcUrl.trim())
      if (!isValid) {
        setError(t('onboarding.errRpcInvalid'))
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
      setError(t('onboarding.errRpcValidate', { msg: err.message }))
    } finally {
      setValidatingRpc(false)
    }
  }, [rpcUrl, onRpcChange, t])
  
  const handleCreateWallet = useCallback(() => {
    const newMnemonic = generateMnemonic()
    setMnemonic(newMnemonic)
    setStep('backup')
  }, [])
  
  const [previewAddress, setPreviewAddress] = useState('')
  
  const handleImport = useCallback(async () => {
    if (!validateMnemonic(importMnemonic)) {
      setError(t('onboarding.errInvalidPhrase'))
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
      setError(t('onboarding.errDerive', { msg: err.message }))
    }
  }, [importMnemonic, t])
  
  const handleSetupPin = useCallback(async () => {
    if (pin.length < 4) { setError(t('onboarding.errPinMin')); return }
    if (pin !== confirmPin) { setError(t('onboarding.errPinMismatch')); return }
    if (!/^\d+$/.test(pin)) { setError(t('onboarding.errPinDigits')); return }
    
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
            <h1 className="onboarding-title">{t('onboarding.rpcTitle')}</h1>
            <p className="onboarding-subtitle">{t('onboarding.rpcSubtitle')}</p>
            {error && <div className="error-message">{error}</div>}
            <div className="form-group">
              <label className="form-label">{t('onboarding.rpcUrlLabel')}</label>
              <input 
                type="text" 
                className="form-input" 
                placeholder={t('onboarding.rpcPlaceholder')} 
                value={rpcUrl} 
                onChange={(e) => { setRpcUrl(e.target.value); setError('') }}
              />
              <span className="form-hint">{t('onboarding.rpcHint')}</span>
            </div>
            <button 
              className="btn btn-primary btn-action" 
              onClick={handleSaveRpc} 
              disabled={validatingRpc || !rpcUrl.trim()}
            >
              {validatingRpc ? t('onboarding.validating') : t('common.continue')}
            </button>
          </div>
        )}
        
        {step === 'welcome' && (
          <div className="onboarding-step">
            <div className="onboarding-logo"><img src="/logo.png" alt="H173K" className="logo-img large" /></div>
            <h1 className="onboarding-title">{t('onboarding.welcomeTitle')}</h1>
            <p className="onboarding-subtitle">{t('onboarding.welcomeSubtitle')}</p>
            <div className="onboarding-actions">
              <button className="btn btn-primary btn-action" onClick={handleCreateWallet}>{t('onboarding.createWallet')}</button>
              <button className="btn" onClick={() => setStep('import')}>{t('onboarding.importWallet')}</button>
            </div>
          </div>
        )}
        
        {step === 'import' && (
          <div className="onboarding-step">
            <button className="back-btn" onClick={() => setStep('welcome')}><BackIcon size={16} /> {t('common.back')}</button>
            <h2 className="onboarding-title">{t('onboarding.importTitle')}</h2>
            <p className="onboarding-subtitle">{t('onboarding.importSubtitle')}</p>
            <div className="form-group">
              <textarea className="form-input mnemonic-input" placeholder={t('onboarding.importPlaceholder')} value={importMnemonic}
                onChange={(e) => { setImportMnemonic(e.target.value); setError('') }} rows={4} />
            </div>
            {error && <div className="error-message">{error}</div>}
            <button className="btn btn-primary btn-action" onClick={handleImport} disabled={!importMnemonic.trim()}>{t('common.continue')}</button>
          </div>
        )}
        
        {step === 'confirmImport' && (
          <div className="onboarding-step">
            <button className="back-btn" onClick={() => { setStep('import'); setPreviewAddress('') }}><BackIcon size={16} /> {t('common.back')}</button>
            <h2 className="onboarding-title">{t('onboarding.verifyTitle')}</h2>
            <p className="onboarding-subtitle">{t('onboarding.verifySubtitle')}</p>
            <div className="address-preview-card">
              <div className="address-preview-label">{t('onboarding.walletAddress')}</div>
              <div className="address-preview-value">{previewAddress}</div>
            </div>
            <p className="onboarding-hint">{t('onboarding.verifyHint')}</p>
            <button className="btn btn-primary btn-action" onClick={() => setStep('pin')}>{t('onboarding.yesContinue')}</button>
          </div>
        )}
        
        {step === 'backup' && (
          <div className="onboarding-step">
            <h2 className="onboarding-title">{t('onboarding.backupTitle')}</h2>
            <p className="onboarding-subtitle">{t('onboarding.backupSubtitle')}</p>
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
                <button className="btn btn-reveal" onClick={() => setShowMnemonic(true)}>{t('onboarding.tapToReveal')}</button>
              )}
            </div>
            {showMnemonic && (
              <>
                <div className="backup-warning">
                  <span className="warning-icon">⚠️</span>
                  <p>{t('onboarding.backupWarning')}</p>
                </div>
                <label className="checkbox-label">
                  <input type="checkbox" checked={backupConfirmed} onChange={(e) => setBackupConfirmed(e.target.checked)} />
                  <span>{t('onboarding.backupConfirm')}</span>
                </label>
                <button className="btn btn-primary btn-action" onClick={() => setStep('pin')} disabled={!backupConfirmed}>{t('common.continue')}</button>
              </>
            )}
          </div>
        )}
        
        {step === 'pin' && (
          <div className="onboarding-step">
            <h2 className="onboarding-title">{t('onboarding.pinTitle')}</h2>
            <p className="onboarding-subtitle">{t('onboarding.pinSubtitle')}</p>
            <div className="form-group">
              <label className="form-label">{t('onboarding.pinCodeLabel')}</label>
              <input type="password" className="form-input pin-input" placeholder="••••••" value={pin}
                onChange={(e) => { setPin(e.target.value.replace(/\D/g, '').slice(0, 6)); setError('') }} inputMode="numeric" maxLength={6} />
            </div>
            <div className="form-group">
              <label className="form-label">{t('onboarding.confirmPinLabel')}</label>
              <input type="password" className="form-input pin-input" placeholder="••••••" value={confirmPin}
                onChange={(e) => { setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6)); setError('') }} inputMode="numeric" maxLength={6} />
            </div>
            {error && <div className="error-message">{error}</div>}
            <button className="btn btn-primary btn-action" onClick={handleSetupPin} disabled={loading || pin.length !== 6 || confirmPin.length !== 6}>
              {loading ? t('onboarding.creating') : t('onboarding.createWalletBtn')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ========== LOCK SCREEN ==========
function LockScreen({ onUnlock, showToast }) {
  const { t } = useTranslation()
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
        setError(t('lock.tooManyAttempts', { s: Math.ceil(lockout.remainingMs / 1000) }))
        return
      }
      verifyPIN(pin)
      const walletPassword = `${pin}_h173k_wallet_v1`
      sessionWallet.unlock(walletPassword)
      onUnlock(sessionWallet.getPublicKey())
    } catch (err) { setError(err.message); setPin('') }
    finally { setLoading(false) }
  }, [pin, onUnlock, t])
  
  const handleBiometricUnlock = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const password = await authenticateBiometric()
      sessionWallet.unlock(password)
      onUnlock(sessionWallet.getPublicKey())
    } catch { setError(t('lock.biometricFailed')) }
    finally { setLoading(false) }
  }, [onUnlock, t])
  
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
        <h2 className="lock-title">{t('lock.title')}</h2>
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
        {biometricAvailable && <button className="btn biometric-btn" onClick={handleBiometricUnlock} disabled={loading}><LockIcon /> {t('lock.useBiometric')}</button>}
      </div>
    </div>
  )
}

// ========== MAIN VIEW ==========
function MainView({ connection, publicKey, balance, solBalance, price, toUSD, onSend, onReceive, onHistory, onEscrow, onSettings, onMessenger, messengerUnread, onRefresh, onLock, showToast, rpcError, h173kDecimals }) {
  const { t } = useTranslation()
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
      showToast(t('main.noH173kToSwap'), 'error')
      return
    }
    
    setEmergencySwapping(true)
    try {
      const targetSOL = solReplenishTo  // use user-configured replenish target
      const { h173kNeeded, quote } = await calculateSwapForSOL(targetSOL)
      
      if (h173kNeeded > balance) {
        showToast(t('main.needH173k', { needed: h173kNeeded.toFixed(2), have: balance.toFixed(2) }), 'error')
        return
      }
      
      const result = await executeSwap(quote, 'H173KtoSOL')
      showToast(t('main.swappedForSol', { h: result.inputAmount.toFixed(2), s: result.outputAmount.toFixed(4) }), 'success')
      onRefresh()
    } catch (err) {
      showToast(t('main.swapFailed', { msg: err.message }), 'error')
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
      showToast(t('main.enterValidAmount'), 'error')
      return
    }
    if (numAmount > maxConvertableSOL) {
      showToast(t('main.amountExceedsSol'), 'error')
      return
    }
    
    try {
      const result = await convertSOLtoH173K(numAmount)
      showToast(t('main.convertedToH173k', { sol: numAmount, h: formatSmartNumber(result.h173kReceived) }), 'success')
      setShowConvertModal(false)
      setConvertAmount('')
      setConvertQuote(null)
      onRefresh()
    } catch (err) {
      // Check if wallet session expired
      if (err.message.includes('Wallet is locked') || !sessionWallet.isUnlocked()) {
        showToast(t('common.sessionExpired'), 'error')
      } else {
        showToast(t('main.conversionFailed', { msg: err.message }), 'error')
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
                <h2>{t('main.addH173kTitle')}</h2>
                <p>{t('main.addH173kDesc')}</p>

                <div className="sol-prompt-info">
                  <div className="sol-prompt-row">
                    <span>{t('main.currentSol')}</span>
                    <span className="sol-amount">{formatNumber(solBalance, 4)} SOL</span>
                  </div>
                  <div className="sol-prompt-row">
                    <span>{t('main.h173kBalance')}</span>
                    <span className="sol-amount">0 h173k</span>
                  </div>
                </div>

                <div className="sol-prompt-address">
                  <div className="sol-prompt-label">{t('main.receiveH173kAt')}</div>
                  <QRCodeGenerator data={publicKey.toString()} size={180} />
                  <div className="address-display" onClick={() => copyToClipboard(publicKey.toString())}>
                    <span className="address-text">{publicKey.toString()}</span>
                    <span className="copy-icon"><CopyIcon /></span>
                  </div>
                </div>

                <p className="sol-prompt-note">
                  {t('main.addH173kNote')}
                </p>
              </>
            ) : (
              <>
                <div className="sol-prompt-icon">⚡</div>
                <h2>{t('main.depositSolTitle')}</h2>
                <p>{t('main.depositSolDesc')}</p>
                
                <div className="sol-prompt-info">
                  <div className="sol-prompt-row">
                    <span>{t('main.recommended')}</span>
                    <span className="sol-amount">0.01 - 0.05 SOL</span>
                  </div>
                  <div className="sol-prompt-row">
                    <span>{t('main.approxCost')}</span>
                    <span className="sol-amount">~$2 - $10</span>
                  </div>
                </div>
                
                <div className="sol-prompt-address">
                  <div className="sol-prompt-label">{t('main.sendSolAt')}</div>
                  <QRCodeGenerator data={publicKey.toString()} size={180} />
                  <div className="address-display" onClick={() => copyToClipboard(publicKey.toString())}>
                    <span className="address-text">{publicKey.toString()}</span>
                    <span className="copy-icon"><CopyIcon /></span>
                  </div>
                </div>
                
                <p className="sol-prompt-note">
                  {t('main.depositSolNote')}
                </p>
              </>
            )}
            
            <div className="sol-prompt-actions">
              <button className="btn btn-primary btn-action" onClick={handleCheckDeposit} disabled={refreshing}>
                {refreshing ? t('main.checking') : isH173KProblem ? t('main.addedH173k') : t('main.depositedSol')}
              </button>
              {!isH173KProblem && balance > 0 && (
                <button 
                  className="btn btn-action" 
                  onClick={handleEmergencySwap} 
                  disabled={emergencySwapping || swapLoading}
                  style={{ backgroundColor: '#f59e0b', borderColor: '#f59e0b' }}
                >
                  {emergencySwapping ? t('main.swapping') : t('main.swapForSol', { n: solReplenishTo })}
                </button>
              )}
              <button className="btn" onClick={handleDismissSolPrompt}>
                {t('main.skipForNow')}
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
            <h2>{t('main.convertTitle')}</h2>
            <p>{t('main.convertDesc')}</p>
            
            <div className="form-group">
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                <label className="form-label" style={{margin:0}}>{t('main.amountSol')}</label>
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
                    {t('main.exceedsMax', { n: formatNumber(maxConvertableSOL, 4) })}
                  </div>
                : <div className="input-hint">
                    {t('main.maxReserved', { max: formatNumber(maxConvertableSOL, 4), reserved: formatNumber(effectiveThreshold + CONVERT_ATA_OVERHEAD + NEXT_SWAP_RESERVE, 4) })}

                  </div>
              }
            </div>
            
            {convertQuote && (
              <div className="convert-quote">
                <div className="convert-quote-row">
                  <span>{t('main.youllReceive')}</span>
                  <span className="convert-quote-amount">~{formatSmartNumber(convertQuote.outputAmount)} h173k</span>
                </div>
                {convertQuote.priceImpact > 1 && (
                  <div className="convert-quote-warning">
                    {t('main.priceImpact', { n: convertQuote.priceImpact.toFixed(2) })}
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
                {swapLoading ? t('main.converting') : t('main.convert')}
              </button>
              <button className="btn" onClick={() => { setShowConvertModal(false); setConvertAmount(''); setConvertQuote(null) }}>
                {t('common.cancel')}
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
          <span>{refreshing ? t('main.refreshing') : (pullProgress >= 1 ? t('main.releaseToRefresh') : t('main.pullToRefresh'))}</span>
        </div>
      )}
      
      {/* RPC Error Banner */}
      {rpcError === 'rpc_limit' && (
        <div className="rpc-error-banner" onClick={onSettings}>
          <div className="rpc-error-icon">⚠️</div>
          <div className="rpc-error-content">
            <div className="rpc-error-title">{t('main.rpcLimitTitle')}</div>
            <div className="rpc-error-message">{t('main.rpcLimitMsg')}</div>
          </div>
          <div className="rpc-error-arrow"><ChevronRightIcon /></div>
        </div>
      )}
      
      <div className="main-header">
        <button className="icon-btn" onClick={onSettings}><SettingsIcon /></button>
        <div className="header-address" onClick={() => copyToClipboard(publicKey.toString())}>{shortenAddress(publicKey.toString())}</div>
        <div className="main-header-right">
          <button className="icon-btn messenger-icon-btn" onClick={onMessenger} title={t('main.messenger')}>
            <EnvelopeIcon />
            {messengerUnread > 0 && (
              <span className="messenger-badge">{messengerUnread > 99 ? '99+' : messengerUnread}</span>
            )}
          </button>
          <button className="icon-btn" onClick={onLock}><LockIcon /></button>
        </div>
      </div>
      
      {/* Logo */}
      <div className="main-logo">
        <img src="/logo.png" alt="H173K" className="logo-img" />
      </div>
      
      <div className="balance-card">
        <div className="balance-label">{t('main.balance')}</div>
        <div className="balance-amount">{formatH173K(balance, h173kDecimals)} <span className="balance-symbol">h173k</span></div>
        {usdValue !== null && <div className="balance-usd">{formatUSD(usdValue)}</div>}
        <div className="balance-sol-row">
          <span className="balance-sol">{formatNumber(solBalance, 4)} SOL</span>
          {solBalance > convertThreshold  && (
            <button className="convert-sol-btn" onClick={() => setShowConvertModal(true)}>
              {t('main.convert')}
            </button>
          )}
        </div>
        <button className={`refresh-btn ${refreshing ? 'refreshing' : ''}`} onClick={handleRefresh} disabled={refreshing}><RefreshIcon size={18} /></button>
        {needsDeposit && (
          <div className="sol-warning critical" onClick={() => setShowSolPrompt(true)}>
            {t('main.lowSol')}
          </div>
        )}
      </div>
      
      <div className="action-row">
        <button className="action-btn" onClick={onSend} disabled={needsDeposit}>
          <div className="action-icon"><SendIcon size={24} /></div><span>{t('main.send')}</span>
        </button>
        <button className="action-btn" onClick={onReceive}>
          <div className="action-icon"><ReceiveIcon size={24} /></div><span>{t('main.receive')}</span>
        </button>
        <div className="action-btn-wrapper">
          <button className="action-btn" onClick={onEscrow} disabled={needsDeposit}>
            <div className="action-icon mad-icon"><EscrowIcon size={24} /></div>
            <span className="mad-label">MAD</span>
          </button>
          <button className="mad-info-btn" onClick={() => setShowMADInfo(true)}>?</button>
        </div>
      </div>
      
      {showMADInfo && (
        <div className="mad-info-overlay" onClick={() => setShowMADInfo(false)}>
          <div className="mad-info-card" onClick={(e) => e.stopPropagation()}>
            <h3>{t('main.madInfoTitle')}</h3>
            <p><strong>{t('main.madStrong')}</strong> {t('main.madInfoP1')}</p>
            <p>{t('main.madInfoP2pre')} <em>{t('main.madInfoP2em')}</em> {t('main.madInfoP2post')}</p>
            <p>{t('main.madInfoP3')}</p>
            <button className="btn" onClick={() => setShowMADInfo(false)}>{t('main.gotIt')}</button>
          </div>
        </div>
      )}
      
      <button className="action-btn-secondary" onClick={onHistory}>
        <HistoryIcon size={18} /><span>{t('main.transactionHistory')}</span>
      </button>
    </div>
  )
}

// ========== SEND VIEW ==========
function SendView({ connection, publicKey, balance, solBalance, price, toUSD, onBack, showToast, onRefresh }) {
  const { t } = useTranslation()
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
    if (!recipient.trim()) { showToast(t('send.enterRecipient'), 'error'); return }
    try { new PublicKey(recipient) } catch { showToast(t('send.invalidAddress'), 'error'); return }
    const sendAmount = parseFloat(amount)
    if (!sendAmount || sendAmount <= 0) { showToast(t('main.enterValidAmount'), 'error'); return }
    
    // Calculate total needed including referral bonus
    let totalNeeded = sendAmount
    if (referralBonusInfo && referralBonusInfo.tokenAmount) {
      totalNeeded += referralBonusInfo.tokenAmount
    }
    
    if (totalNeeded > balance) { 
      showToast(referralBonusInfo ? t('send.insufficientBalanceReferral') : t('send.insufficientBalance'), 'error')
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
            showToast(t('send.swappingH173kForSol'), 'info')
          } else if (swapInfo.status === 'swapped') {
            showToast(t('main.swappedForSol', { h: formatSmartNumber(swapInfo.h173kUsed), s: swapInfo.solReceived.toFixed(4) }), 'info')
            if (onRefresh) onRefresh()
          }
        },
        extraSOLNeeded  // sponsor transfer + recipient ATA rent — withAutoSOL factors this into replenish target
      )
      
      setTxSignature(signature)
      showToast(t('send.txSent'), 'success')
      onRefresh()
    } catch (err) { 
      console.error('Send error:', err)
      // Check if wallet session expired
      if (err.message.includes('Wallet is locked') || !sessionWallet.isUnlocked()) {
        showToast(t('common.sessionExpired'), 'error')
      } else {
        showToast(t('send.txFailed', { msg: err.message }), 'error')
      }
    }
    finally { setLoading(false) }
  }
  
  if (txSignature) {
    return (
      <div className="send-view">
        <div className="success-card">
          <div className="success-icon">✓</div>
          <h2>{t('send.successTitle')}</h2>
          <p className="success-amount">{formatH173K(parseFloat(amount))} h173k</p>
          <p className="success-to">{t('send.successTo', { addr: shortenAddress(recipient) })}</p>
          <a href={`https://solscan.io/tx/${txSignature}`} target="_blank" rel="noopener noreferrer" className="tx-link">{t('send.viewOnSolscan')}</a>
          <button className="btn btn-primary" onClick={onBack}>{t('common.done')}</button>
        </div>
      </div>
    )
  }
  
  if (showScanner) {
    return (
      <div className="send-view">
        <div className="view-header"><button className="back-btn" onClick={() => setShowScanner(false)}><BackIcon size={16} /> {t('common.back')}</button><h2>{t('send.scanTitle')}</h2></div>
        <QRCodeScanner onScan={handleScan} onError={() => showToast(t('send.scannerError'), 'error')} />
      </div>
    )
  }
  
  if (confirmStep) {
    return (
      <div className="send-view">
        <div className="view-header"><button className="back-btn" onClick={() => setConfirmStep(false)}><BackIcon size={16} /> {t('common.back')}</button><h2>{t('send.confirmTitle')}</h2></div>
        <div className="confirm-card">
          <div className="confirm-row"><span className="confirm-label">{t('send.amount')}</span><span className="confirm-value">{formatH173K(parseFloat(amount))} h173k{usdValue && <span className="confirm-usd">({formatUSD(usdValue)})</span>}</span></div>
          <div className="confirm-row"><span className="confirm-label">{t('send.to')}</span><span className="confirm-value address">{shortenAddress(recipient)}</span></div>
          {referrer && referralBonusInfo && referralBonusInfo.tokenAmount && (
            <div className="confirm-row referral-row">
              <span className="confirm-label">{t('send.referralBonus')}</span>
              <span className="confirm-value referral-value">+{formatH173K(referralBonusInfo.tokenAmount)} h173k <span className="confirm-usd">(${referralBonusInfo.usdAmount})</span></span>
            </div>
          )}
          <div className="confirm-row"><span className="confirm-label">{t('send.networkFee')}</span><span className="confirm-value">~0.000005 SOL</span></div>
          {sponsorAmtState > 0 && (
            <div className="confirm-row"><span className="confirm-label">{t('send.recipientTopup')}</span><span className="confirm-value">{formatNumber(sponsorAmtState, 6)} SOL</span></div>
          )}
          {referrer && referralBonusInfo && referralBonusInfo.tokenAmount && (
            <div className="confirm-row total-row">
              <span className="confirm-label">{t('send.total')}</span>
              <span className="confirm-value">{formatH173K(parseFloat(amount) + referralBonusInfo.tokenAmount)} h173k</span>
            </div>
          )}
          <button className="btn btn-primary btn-action" onClick={handleSend} disabled={loading || swapLoading}>{loading ? (swapLoading ? t('send.swappingSol') : t('send.sendingBtn')) : t('send.confirmAndSend')}</button>
        </div>
      </div>
    )
  }
  
  return (
    <div className="send-view">
      <div className="view-header"><button className="back-btn" onClick={onBack}><BackIcon size={16} /> {t('common.back')}</button><h2>{t('send.title')}</h2></div>
      <div className="form-group">
        <label className="form-label">{t('send.recipientLabel')}</label>
        <div className="input-with-action">
          <input type="text" className="form-input" placeholder={t('send.recipientPlaceholder')} value={recipient} onChange={(e) => setRecipient(e.target.value)} />
          <button className="input-action-btn" onClick={() => setShowScanner(true)}><ScanIcon size={18} /></button>
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">{t('send.amountLabel')}</label>
        <div className="amount-input-wrapper">
          <input type="number" className="form-input" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} step="0.01" />
          <button className="max-btn" onClick={() => setAmount(balance.toString())}>MAX</button>
        </div>
        <div className="form-hint-row">
          <span className="form-hint">{t('send.available', { n: formatH173K(balance) })}</span>
          {usdValue !== null && <span className="amount-usd-preview">{formatUSD(usdValue)}</span>}
        </div>
      </div>
      <button className="btn btn-primary btn-action" onClick={validateAndProceed} disabled={!recipient || !amount}>{t('common.continue')}</button>
    </div>
  )
}

// ========== RECEIVE VIEW ==========
function ReceiveView({ publicKey, onBack, showToast, onWin }) {
  const { t } = useTranslation()
  const address = publicKey.toString()
  // Use plain address for QR - universal, works for both SOL and any SPL tokens
  // Solana Pay format (solana:address) forces SOL in most wallets
  
  const handleCopy = async () => {
    const success = await copyToClipboard(address)
    showToast(success ? t('receive.addressCopied') : t('receive.copyFailed'), success ? 'success' : 'error')
  }
  
  return (
    <div className="receive-view">
      <div className="view-header"><button className="back-btn" onClick={onBack}><BackIcon size={16} /> {t('common.back')}</button><h2>{t('receive.title')}</h2></div>
      <div className="receive-card">
        <QRCodeGenerator data={address} size={220} />
        <div className="address-display" onClick={handleCopy}><span className="address-text">{address}</span><span className="copy-icon"><CopyIcon /></span></div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn btn-secondary" style={{ flex: 1 }} onClick={handleCopy}>{t('receive.copyAddress')}</button>
          <button className="btn btn-action" style={{ flex: 1 }} onClick={onWin}>{t('receive.winH173k')}</button>
        </div>
      </div>
      <div className="receive-info"><p>{t('receive.info1')}</p><p>{t('receive.info2')}</p></div>
    </div>
  )
}

// ========== HISTORY VIEW ==========
function HistoryView({ connection, publicKey, onBack, h173kDecimals }) {
  const { t } = useTranslation()
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
        <button className="back-btn" onClick={onBack}><BackIcon size={16} /> {t('common.back')}</button>
        <h2>{t('history.title')}</h2>
      </div>
      
      {/* Refresh button above transactions */}
      <div className="history-top-actions">
        <button className="history-refresh-btn" onClick={handleRefresh} disabled={refreshing}>
          <RefreshIcon size={18} />
          <span>{refreshing ? t('main.refreshing') : t('history.refresh')}</span>
        </button>
      </div>
      
      {/* Pull to refresh indicator */}
      {(pullProgress > 0 || refreshing) && (
        <div className="pull-refresh-indicator history-pull" style={{ opacity: refreshing ? 1 : pullProgress }}>
          {!refreshing && <RefreshIcon size={20} />}
          <span>{refreshing ? t('main.refreshing') : (pullProgress >= 1 ? t('main.releaseToRefresh') : t('main.pullToRefresh'))}</span>
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
          <p>{t('history.empty')}</p>
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
                <div className="tx-type">{tx.type === 'receive' ? t('history.received') : t('history.sent')} {tx.token}</div>
                <div className="tx-date">{tx.blockTime ? new Date(tx.blockTime * 1000).toLocaleDateString() : t('history.unknown')}</div>
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
  const { t } = useTranslation()
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
          showToast(t('escrow.created'), 'success')
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
          showToast(t('escrow.accepted'), 'success')
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
          showToast(t('escrow.imported'), 'success')
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
        <button className="back-btn" onClick={onBack}><BackIcon size={16} /> {t('common.back')}</button>
        <h2>{t('escrow.title')}</h2>
      </div>
      
      <div className="escrow-actions">
        <button className="btn btn-action" onClick={() => setSubView('new')}>
          {t('escrow.newContract')}
        </button>
        <button className="btn" onClick={() => setSubView('accept')}>
          {t('escrow.acceptContract')}
        </button>
      </div>

      <button className="btn btn-p2p" onClick={onOpenP2P}>
        {t('escrow.p2pMarketplace')}
      </button>

      {/* Action buttons above contracts */}
      <div className="escrow-top-actions">
        <button className="escrow-action-btn refresh-action-btn" onClick={handleRefresh} disabled={refreshing}>
          <RefreshIcon size={18} />
          <span>{refreshing ? t('main.refreshing') : t('history.refresh')}</span>
        </button>
        <button className="escrow-action-btn" onClick={() => setSubView('import')}>
          <ImportIcon size={18} />
          <span>{t('escrow.importContract')}</span>
        </button>
      </div>
      
      {/* Pull to refresh indicator */}
      {(pullProgress > 0 || refreshing) && (
        <div className="pull-refresh-indicator escrow-pull" style={{ opacity: refreshing ? 1 : pullProgress }}>
          {!refreshing && <RefreshIcon size={20} />}
          <span>{refreshing ? t('main.refreshing') : (pullProgress >= 1 ? t('main.releaseToRefresh') : t('main.pullToRefresh'))}</span>
        </div>
      )}
      
      {loading ? (
        <div className="loading-spinner-small" />
      ) : contracts.length === 0 ? (
        <div className="empty-state">
          <p>{t('escrow.empty')}</p>
          <p className="empty-hint">{t('escrow.emptyHint')}</p>
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
                  <span className="contract-name">{meta.name || t('escrow.unnamed')}</span>
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
  const { t } = useTranslation()
  const [amount, setAmount] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [createdCode, setCreatedCode] = useState(null)
  
  const { withAutoSOL, loading: swapLoading } = useSwap(connection, sessionWallet)
  
const handleCreate = async () => {
  const numAmount = parseFloat(amount)
  if (!numAmount || numAmount <= 0) {
    showToast(t('main.enterValidAmount'), 'error')
    return
  }
  const requiredDeposit = numAmount * 2

  if (requiredDeposit > balance) {
    showToast(t('newContract.errDeposit', { n: formatNumber(requiredDeposit) }), 'error')
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
          showToast(t('send.swappingH173kForSol'), 'info')
        } else if (swapInfo.status === 'swapped') {
          showToast(t('main.swappedForSol', { h: formatSmartNumber(swapInfo.h173kUsed), s: swapInfo.solReceived.toFixed(4) }), 'info')
          if (onRefresh) onRefresh()
        }
      },
      extraSOLNeeded
    )

    // Save metadata
    const meta = JSON.parse(localStorage.getItem('h173k_contracts_metadata') || '{}')
    const contractMeta = { name: name || t('newContract.defaultName'), code, createdAt: Date.now() }
    meta[result.offerPDA.toString()] = contractMeta
    localStorage.setItem('h173k_contracts_metadata', JSON.stringify(meta))

    setCreatedCode({ code, offerPDA: result.offerPDA.toString(), meta: contractMeta })
  } catch (err) {
    if (err.message.includes('Wallet is locked') || !sessionWallet.isUnlocked()) {
      showToast(t('common.sessionExpired'), 'error')
    } else {
      showToast(t('newContract.failedCreate', { msg: err.message }), 'error')
    }
  } finally {
    setLoading(false)
  }
}
  
  if (createdCode) {
    const handleCopyCode = async () => {
      const success = await copyToClipboard(createdCode.code)
      showToast(success ? t('newContract.codeCopied') : t('receive.copyFailed'), success ? 'success' : 'error')
    }
    
    return (
      <div className="new-contract-view">
        <div className="success-card">
          <div className="success-icon">✓</div>
          <h2>{t('newContract.successTitle')}</h2>
          <p>{t('newContract.shareCode')}</p>
          <div className="code-display" onClick={handleCopyCode}>
            <span className="code-text">{createdCode.code}</span>
            <span className="copy-hint">{t('newContract.tapToCopy')}</span>
          </div>
          <p className="code-warning">{t('newContract.codeWarning')}</p>
          <button className="btn btn-primary" onClick={() => onSuccess(createdCode)}>{t('common.done')}</button>
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
        <button className="back-btn" onClick={onBack}><BackIcon size={16} /> {t('common.back')}</button>
        <h2>{t('newContract.title')}</h2>
      </div>
      
      <div className="escrow-info-card">
        <p>{t('newContract.infoPre')} <strong>{t('newContract.infoBuyer')}</strong>{t('newContract.infoMid')} <strong>{t('newContract.infoBold')}</strong> {t('newContract.infoPost')}</p>
      </div>
      
      <div className="form-group">
        <label className="form-label">{t('newContract.nameLabel')}</label>
        <input 
          type="text" className="form-input" placeholder={t('newContract.namePlaceholder')}
          value={name} onChange={(e) => setName(e.target.value)} maxLength={50}
        />
      </div>
      
      <div className="form-group">
        <label className="form-label">{t('newContract.amountLabel')}</label>
        <div className="amount-input-wrapper">
          <input 
            type="number" className="form-input" placeholder="0.00"
            value={amount} onChange={(e) => setAmount(e.target.value)} step="0.01"
          />
          <button className="max-btn" onClick={() => setAmount((balance / 2).toFixed(2))}>MAX</button>
        </div>
        <div className="form-hint-row">
          <span className="form-hint">{t('newContract.available', { n: formatH173K(balance, h173kDecimals), max: formatH173K(balance / 2, h173kDecimals) })}</span>
          {usdValue && <span className="amount-usd-preview">{formatUSD(usdValue)}</span>}
        </div>
      </div>
      
      <div className={`deposit-preview${insufficientBalance ? ' deposit-preview--error' : ''}`}>
        <div className="deposit-row">
          <span>{t('newContract.yourDeposit')}</span>
          <span>{formatH173K(requiredDeposit, h173kDecimals)} h173k</span>
        </div>
        <div className={`deposit-row total${insufficientBalance ? ' deposit-row--error' : ''}`}>
          <span>{t('newContract.requiredBalance')}</span>
          <span>{formatH173K(requiredDeposit, h173kDecimals)} h173k</span>
        </div>
        {insufficientBalance && (
          <div className="deposit-row deposit-row--insufficient">
            <span>{t('newContract.insufficient')}</span>
            <span className="deposit-shortfall">−{formatH173K(requiredDeposit - balance, h173kDecimals)} h173k</span>
          </div>
        )}
      </div>
      
      <button className="btn btn-primary btn-action" onClick={handleCreate} disabled={loading || swapLoading || !amount || insufficientBalance}>
        {loading ? (swapLoading ? t('send.swappingSol') : t('newContract.creating')) : t('newContract.createBtn')}
      </button>
    </div>
  )
}

// ========== ACCEPT CONTRACT VIEW ==========
function AcceptContractView({ connection, escrow, balance, solBalance, price, toUSD, onBack, showToast, onSuccess, onRefresh, h173kDecimals }) {
  const { t } = useTranslation()
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [foundContract, setFoundContract] = useState(null)
  
  const { withAutoSOL, loading: swapLoading } = useSwap(connection, sessionWallet)
  
  const handleSearch = async () => {
    if (!code.trim()) {
      showToast(t('acceptContract.enterCode'), 'error')
      return
    }
    
    setLoading(true)
    try {
      const result = await escrow.findOfferByCode(code.trim())
      if (result) {
        setFoundContract(result)
      } else {
        showToast(t('acceptContract.notFound'), 'error')
      }
    } catch (err) {
      showToast(t('acceptContract.searchFailed', { msg: err.message }), 'error')
    } finally {
      setLoading(false)
    }
  }
  
  const handleAccept = async () => {
    if (!foundContract) return
    
    const amount = fromTokenAmount(foundContract.amount)
    
    if (amount > balance) {
      showToast(t('acceptContract.errDeposit', { n: formatNumber(amount) }), 'error')
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
            showToast(t('send.swappingH173kForSol'), 'info')
          } else if (swapInfo.status === 'swapped') {
            showToast(t('main.swappedForSol', { h: formatSmartNumber(swapInfo.h173kUsed), s: swapInfo.solReceived.toFixed(4) }), 'info')
            if (onRefresh) onRefresh()
          }
        },
        sellerIndexRent
      )
      
      // Save metadata
      const meta = JSON.parse(localStorage.getItem('h173k_contracts_metadata') || '{}')
      const contractMeta = { name: name || t('acceptContract.defaultName'), code: code.trim(), acceptedAt: Date.now() }
      meta[foundContract.publicKey.toString()] = contractMeta
      localStorage.setItem('h173k_contracts_metadata', JSON.stringify(meta))
      
      onSuccess({ offerPDA: foundContract.publicKey.toString(), meta: contractMeta })
    } catch (err) {
      // Check if wallet session expired
      if (err.message.includes('Wallet is locked') || !sessionWallet.isUnlocked()) {
        showToast(t('common.sessionExpired'), 'error')
      } else {
        showToast(t('acceptContract.failedAccept', { msg: err.message }), 'error')
      }
    } finally {
      setLoading(false)
    }
  }
  
  return (
    <div className="accept-contract-view">
      <div className="view-header">
        <button className="back-btn" onClick={onBack}><BackIcon size={16} /> {t('common.back')}</button>
        <h2>{t('acceptContract.title')}</h2>
      </div>
      
      <div className="escrow-info-card">
        <p>{t('acceptContract.infoPre')} <strong>{t('acceptContract.infoSeller')}</strong> {t('acceptContract.infoMid')} <strong>{t('acceptContract.infoBold')}</strong> {t('acceptContract.infoPost')}</p>
      </div>
      
      <div className="form-group">
        <label className="form-label">{t('acceptContract.codeLabel')}</label>
        <input 
          type="text" className="form-input" placeholder={t('acceptContract.codePlaceholder')}
          value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={20}
        />
      </div>
      
      {!foundContract ? (
        <button className="btn btn-primary btn-action" onClick={handleSearch} disabled={loading || !code.trim()}>
          {loading ? t('acceptContract.searching') : t('acceptContract.findContract')}
        </button>
      ) : (
        <>
          <div className="found-contract-card">
            <div className="found-row">
              <span>{t('send.amount')}</span>
              <span>{formatH173K(fromTokenAmount(foundContract.amount), h173kDecimals)} h173k</span>
            </div>
            {toUSD && (
              <div className="found-row">
                <span>{t('acceptContract.value')}</span>
                <span>{formatUSD(toUSD(fromTokenAmount(foundContract.amount)))}</span>
              </div>
            )}
            <div className="found-row">
              <span>{t('acceptContract.yourDeposit')}</span>
              <span>{formatH173K(fromTokenAmount(foundContract.amount), h173kDecimals)} h173k</span>
            </div>
          </div>
          
          <div className="form-group">
            <label className="form-label">{t('newContract.nameLabel')}</label>
            <input 
              type="text" className="form-input" placeholder={t('newContract.namePlaceholder')}
              value={name} onChange={(e) => setName(e.target.value)} maxLength={50}
            />
          </div>
          
          <button className="btn btn-primary btn-action" onClick={handleAccept} disabled={loading || swapLoading}>
            {loading ? (swapLoading ? t('send.swappingSol') : t('acceptContract.accepting')) : t('acceptContract.acceptDeposit')}
          </button>
        </>
      )}
    </div>
  )
}

// ========== IMPORT CONTRACT VIEW ==========
function ImportContractView({ escrow, onBack, showToast, onSuccess, h173kDecimals }) {
  const { t } = useTranslation()
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
      showToast(t('importContract.clipboardFail'), 'error')
    }
  }
  
  const handleSearch = async () => {
    if (!code.trim()) {
      setError(t('importContract.errEnterCode'))
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
        setError(t('importContract.errNotFound'))
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
        setName(t('importContract.importedName', { n: offer.nonce?.toString() || '?' }))
      }
    } catch (err) {
      console.error('Error searching for contract:', err)
      setError(err.message || t('importContract.errFindFailed'))
    } finally {
      setLoading(false)
    }
  }
  
  const handleImport = () => {
    if (!foundContract) return
    if (!name.trim()) {
      setError(t('importContract.errEnterName'))
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
        <button className="back-btn" onClick={onBack}><BackIcon size={16} /> {t('common.back')}</button>
        <h2>{t('importContract.title')}</h2>
      </div>
      
      <div className="escrow-info-card">
        <p>{t('importContract.info')}</p>
      </div>
      
      <div className="form-group">
        <label className="form-label">{t('acceptContract.codeLabel')}</label>
        <div className="input-with-paste">
          <input 
            type="text" 
            className="form-input" 
            placeholder={t('acceptContract.codePlaceholder')}
            value={code} 
            onChange={(e) => {
              setCode(e.target.value.toUpperCase())
              setError('')
              setFoundContract(null)
            }} 
            maxLength={20}
          />
          <button type="button" className="paste-btn" onClick={handlePaste}>
            {t('importContract.paste')}
          </button>
        </div>
      </div>
      
      {error && <div className="error-message">{error}</div>}
      
      {!foundContract ? (
        <button className="btn btn-primary btn-action" onClick={handleSearch} disabled={loading || !code.trim()}>
          {loading ? t('acceptContract.searching') : t('acceptContract.findContract')}
        </button>
      ) : (
        <>
          <div className="found-contract-card">
            <div className="found-row">
              <span>{t('importContract.status')}</span>
              <span className={`contract-status ${statusInfo?.class}`}>{statusInfo?.label}</span>
            </div>
            <div className="found-row">
              <span>{t('send.amount')}</span>
              <span>{formatH173K(amount, h173kDecimals)} h173k</span>
            </div>
            {foundContract.isClosed && (
              <div className="found-row closed-note">
                <span>{t('importContract.closedNote')}</span>
              </div>
            )}
          </div>
          
          <div className="form-group">
            <label className="form-label">{t('importContract.nameLabel')}</label>
            <input 
              type="text" 
              className="form-input" 
              placeholder={t('importContract.namePlaceholder')}
              value={name} 
              onChange={(e) => {
                setName(e.target.value)
                setError('')
              }} 
              maxLength={50}
            />
          </div>
          
          <button className="btn btn-primary btn-action" onClick={handleImport} disabled={!name.trim()}>
            {t('importContract.importBtn')}
          </button>
        </>
      )}
    </div>
  )
}

// ========== CONTRACT DETAIL VIEW ==========
function ContractDetailView({ connection, contract, metadata, escrow, publicKey, price, toUSD, onBack, showToast, onRefresh, onSaveMetadata, h173kDecimals }) {
  const { t } = useTranslation()
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
            showToast(t('contractDetail.swappedShort', { h: formatSmartNumber(swapInfo.h173kUsed) }), 'info')
          }
        }
      )
      showToast(t('contractDetail.releaseToast'), 'success')
      onRefresh()
      onBack()
    } catch (err) {
      // Check if wallet session expired
      if (err.message.includes('Wallet is locked') || !sessionWallet.isUnlocked()) {
        showToast(t('common.sessionExpired'), 'error')
      } else {
        showToast(t('contractDetail.releaseFailed', { msg: err.message }), 'error')
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
            showToast(t('contractDetail.swappedShort', { h: formatSmartNumber(swapInfo.h173kUsed) }), 'info')
          }
        }
      )
      showToast(t('contractDetail.cancelledToast'), 'success')
      onRefresh()
      onBack()
    } catch (err) {
      // Check if wallet session expired
      if (err.message.includes('Wallet is locked') || !sessionWallet.isUnlocked()) {
        showToast(t('common.sessionExpired'), 'error')
      } else {
        showToast(t('contractDetail.cancelFailed', { msg: err.message }), 'error')
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
            showToast(t('contractDetail.swappedShort', { h: formatSmartNumber(swapInfo.h173kUsed) }), 'info')
          }
        }
      )
      showToast(t('contractDetail.burnedToast'), 'success')
      onRefresh()
      onBack()
    } catch (err) {
      // Check if wallet session expired
      if (err.message.includes('Wallet is locked') || !sessionWallet.isUnlocked()) {
        showToast(t('common.sessionExpired'), 'error')
      } else {
        showToast(t('contractDetail.burnFailed', { msg: err.message }), 'error')
      }
    } finally {
      setLoading(false)
      setShowBurnConfirm(false)
      setBurnCodeInput('')
    }
  }
  
  const handleHideContract = () => {
    onSaveMetadata({ hidden: true })
    showToast(t('contractDetail.removedToast'), 'success')
    onRefresh() // Refresh the list to apply hidden filter
    onBack()
  }
  
  return (
    <div className="contract-detail-view">
      <div className="view-header">
        <button className="back-btn" onClick={onBack}><BackIcon size={16} /> {t('common.back')}</button>
        <h2>{metadata?.name || t('contractDetail.titleFallback')}</h2>
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
          <span>{t('contractDetail.yourRole')}</span>
          <span>{isBuyer ? t('contractDetail.buyer') : isSeller ? t('contractDetail.seller') : t('contractDetail.unknown')}</span>
        </div>
        
        <div className="detail-row">
          <span>{t('contractDetail.buyerDeposit')} <span className="deposit-note">{t('contractDetail.paymentDeposit')}</span></span>
          <span>{formatH173K(buyerDeposit, h173kDecimals)} h173k</span>
        </div>
        
        {sellerDeposit > 0 && (
          <div className="detail-row">
            <span>{t('contractDetail.sellerDeposit')} <span className="deposit-note">{t('contractDetail.depositOnly')}</span></span>
            <span>{formatH173K(sellerDeposit, h173kDecimals)} h173k</span>
          </div>
        )}
        
        <div className="detail-row code-row" onClick={async () => {
          if (metadata?.code) {
            const success = await copyToClipboard(metadata.code)
            showToast(success ? t('newContract.codeCopied') : t('receive.copyFailed'), success ? 'success' : 'error')
          } else {
            showToast(t('contractDetail.codeNotAvailable'), 'error')
          }
        }}>
          <span>{t('contractDetail.code')}</span>
          <span className="code-value">{metadata?.code || t('contractDetail.unavailable')} {metadata?.code && <CopyIcon size={14} />}</span>
        </div>
      </div>
      
      {/* Actions based on status */}
      <div className="detail-actions">
        {canCancelOffer(contract, publicKey) && (
          <button className="btn btn-secondary" onClick={handleCancel} disabled={loading || swapLoading}>
            {loading ? (swapLoading ? t('send.swappingSol') : t('contractDetail.cancelling')) : t('contractDetail.cancelContract')}
          </button>
        )}
        
        {canReleaseOffer(contract, publicKey) && (
          <button className="btn btn-primary btn-action" onClick={handleRelease} disabled={loading || swapLoading}>
            {loading ? (swapLoading ? t('send.swappingSol') : t('contractDetail.processing')) : t('contractDetail.confirmRelease')}
          </button>
        )}
        
        {/* Show confirmation status when user already confirmed */}
        {hasAlreadyConfirmed(contract, publicKey) && (
          <div className="release-confirmed-notice">
            <div className="confirmed-icon">✓</div>
            <div className="confirmed-text">
              <strong>{t('contractDetail.releaseConfirmedTitle')}</strong>
              <p>{t('contractDetail.releaseConfirmedText')}</p>
            </div>
          </div>
        )}
        
        {canBurnOffer(contract, publicKey) && (
          <>
            {!showBurnConfirm ? (
              <button className="btn btn-danger" onClick={() => setShowBurnConfirm(true)} disabled={loading || swapLoading}>
                {t('contractDetail.burnDeposits')}
              </button>
            ) : (
              <div className="burn-confirm">
                <p className="warning-text">{t('contractDetail.burnWarning')}</p>
                <p className="burn-code-instruction">{t('contractDetail.burnInstruction')}</p>
                <input
                  type="text"
                  className="form-input burn-code-input"
                  placeholder={t('contractDetail.burnPlaceholder')}
                  value={burnCodeInput}
                  onChange={(e) => setBurnCodeInput(e.target.value.toUpperCase())}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck="false"
                />
                <div className="burn-actions">
                  <button className="btn" onClick={() => { setShowBurnConfirm(false); setBurnCodeInput('') }}>{t('common.cancel')}</button>
                  <button 
                    className="btn btn-danger" 
                    onClick={handleBurn} 
                    disabled={loading || swapLoading || !metadata?.code || burnCodeInput !== metadata.code}
                  >
                    {loading ? (swapLoading ? t('send.swappingSol') : t('contractDetail.burning')) : t('contractDetail.burnAll')}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        
        {isTerminal && (
          <button className="btn btn-secondary" onClick={handleHideContract}>
            {t('contractDetail.removeFromList')}
          </button>
        )}
      </div>
    </div>
  )
}

// ========== REFERRAL SECTION ==========
function ReferralSection({ publicKey, showToast }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const [showReferralInfo, setShowReferralInfo] = useState(false)
  
  const referrer = getReferrer()
  const referralLink = generateReferralLink(publicKey.toString())
  
  const handleCopyLink = async () => {
    const success = await copyToClipboard(referralLink)
    if (success) {
      setCopied(true)
      showToast(t('referral.linkCopied'), 'success')
      setTimeout(() => setCopied(false), 2000)
    } else {
      showToast(t('referral.copyFail'), 'error')
    }
  }
  
  return (
    <div className="settings-section">
      <h3>{t('referral.title')}</h3>
      
      <div className="referral-link-section">
        <p className="referral-description">{t('referral.description')}</p>
        
        <div className="referral-link-box" onClick={handleCopyLink}>
          <span className="referral-link-text">{referralLink}</span>
          <span className="copy-icon">{copied ? '✓' : <CopyIcon size={16} />}</span>
        </div>
        
        <button className="btn btn-secondary referral-copy-btn" onClick={handleCopyLink}>
          {copied ? t('common.copied') : t('referral.copyLink')}
        </button>
      </div>
      
      {referrer && (
        <div className="referral-info">
          <div className="settings-item">
            <span>{t('referral.referredBy')}</span>
            <span className="address-small">{shortenAddress(referrer)}</span>
          </div>
          <p className="referral-note">{t('referral.note')}</p>
        </div>
      )}
      
      <button className="referral-info-btn" onClick={() => setShowReferralInfo(!showReferralInfo)}>
        {showReferralInfo ? t('referral.hide') : t('referral.learnMore')}
      </button>
      
      {showReferralInfo && (
        <div className="referral-details">
          <p><strong>{t('referral.howItWorks')}</strong></p>
          <ul>
            <li>{t('referral.point1')}</li>
            <li>{t('referral.point2')}</li>
            <li>{t('referral.point3')}</li>
            <li>{t('referral.point4')}</li>
          </ul>
        </div>
      )}
    </div>
  )
}

// ========== SPONSOR ACCOUNTS TOGGLE ==========
function SponsorAccountsToggle({ showToast }) {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useState(() => getSponsorAccounts())

  const handleToggle = () => {
    const next = !enabled
    saveSponsorAccounts(next)
    setEnabled(next)
    showToast(next ? t('sponsor.enabledToast') : t('sponsor.disabledToast'), 'info')
  }

  return (
    <div className="settings-item" onClick={handleToggle} style={{ cursor: 'pointer' }}>
      <div>
        <div>{t('sponsor.label')}</div>
        <div style={{ fontSize: '12px', opacity: 0.6, marginTop: '2px' }}>
          {t('sponsor.desc')}
        </div>
      </div>
      <span className={`badge ${enabled ? 'enabled' : ''}`}>{enabled ? t('common.on') : t('common.off')}</span>
    </div>
  )
}

// ========== MESSENGER SETTINGS ==========
function MessengerSettings({ showToast }) {
  const { t } = useTranslation()
  const [notif, setNotif] = useState(() => getNotificationsEnabled())
  const [txNotif, setTxNotif] = useState(() => getTxNotificationsEnabled())
  const [limit, setLimit] = useState(() => getMessengerScanLimit())

  // Ensure the platform allows notifications, prompting if needed. Returns true if granted.
  const ensurePermission = async () => {
    if (typeof Notification === 'undefined') {
      showToast(t('notifications.notSupported'), 'error')
      return false
    }
    let perm = Notification.permission
    if (perm === 'default') {
      try { perm = await Notification.requestPermission() } catch { perm = 'denied' }
    }
    if (perm !== 'granted') {
      showToast(t('notifications.permissionDenied'), 'error')
      return false
    }
    return true
  }

  const toggleNotif = async () => {
    if (!notif) {
      if (!(await ensurePermission())) { setNotificationsEnabled(false); setNotif(false); return }
      setNotificationsEnabled(true); setNotif(true)
      showToast(t('notifications.msgEnabled'), 'success')
    } else {
      setNotificationsEnabled(false); setNotif(false)
      showToast(t('notifications.msgDisabled'), 'info')
    }
  }

  const toggleTxNotif = async () => {
    if (!txNotif) {
      if (!(await ensurePermission())) { setTxNotificationsEnabled(false); setTxNotif(false); return }
      setTxNotificationsEnabled(true); setTxNotif(true)
      showToast(t('notifications.txEnabled'), 'success')
    } else {
      setTxNotificationsEnabled(false); setTxNotif(false)
      showToast(t('notifications.txDisabled'), 'info')
    }
  }

  const chooseLimit = (n) => {
    setMessengerScanLimit(n); setLimit(n)
    showToast(t('messengerSettings.scanningToast', { n }), 'success')
  }

  return (
    <>
      <div className="settings-section">
        <h3>{t('notifications.title')}</h3>
        <div className="settings-item" onClick={toggleTxNotif} style={{ cursor: 'pointer' }}>
          <div>
            <div>{t('notifications.incomingTx')}</div>
            <div style={{ fontSize: '12px', opacity: 0.6, marginTop: '2px' }}>
              {t('notifications.incomingTxDesc')}
            </div>
          </div>
          <span className={`badge ${txNotif ? 'enabled' : ''}`}>{txNotif ? t('common.on') : t('common.off')}</span>
        </div>
        <div className="settings-item" onClick={toggleNotif} style={{ cursor: 'pointer' }}>
          <div>
            <div>{t('notifications.newMessages')}</div>
            <div style={{ fontSize: '12px', opacity: 0.6, marginTop: '2px' }}>
              {t('notifications.newMessagesDesc')}
            </div>
          </div>
          <span className={`badge ${notif ? 'enabled' : ''}`}>{notif ? t('common.on') : t('common.off')}</span>
        </div>
      </div>

      <div className="settings-section">
        <h3>{t('messengerSettings.title')}</h3>
        <div className="settings-item" style={{ display: 'block' }}>
          <div>{t('messengerSettings.entriesPerRefresh')}</div>
          <div style={{ fontSize: '12px', opacity: 0.6, margin: '2px 0 10px' }}>
            {t('messengerSettings.entriesDesc')}
          </div>
          <div className="messenger-scan-options">
            {MESSENGER_SCAN_OPTIONS.map((n) => (
              <button key={n} className={`scan-opt ${limit === n ? 'active' : ''}`} onClick={() => chooseLimit(n)}>{n}</button>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

// ========== REPLENISH NOW BUTTON ==========
// Separate component so it can call useSwap as a hook
function ReplenishNowButton({ connection, solBalance, showToast }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const { swapForSOL, loading } = useSwap(connection, sessionWallet)

  const handleReplenish = async () => {
    const settings = getReplenishSettings()
    const neededSOL = Math.max(0, settings.replenishTo - solBalance)
    if (neededSOL <= 0) {
      showToast(t('replenish.alreadySufficient'), 'info')
      return
    }
    setBusy(true)
    try {
      const result = await swapForSOL(neededSOL)
      showToast(t('replenish.replenishOk', { n: result.solReceived.toFixed(4) }), 'success')
    } catch (err) {
      const msg = err.message.replace(/^NO_H173K:|^NO_SOL:/, '')
      showToast(t('replenish.replenishError', { msg }), 'error')
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
      {busy || loading ? t('replenish.swappingNow') : t('replenish.replenishNow')}
    </button>
  )
}

// ========== P2P SETTINGS SECTION (only visible once onboarded) ==========
function P2PSettingsSection({ showToast }) {
  const { t } = useTranslation()
  const initial = getP2PProfile()
  const [nickname, setNickname] = useState(initial?.nickname || '')
  if (!initial) return null // hidden until the user has used P2P at least once

  const save = () => {
    const n = nickname.trim()
    if (!n) { showToast(t('p2pSettings.emptyNick'), 'error'); return }
    if (n.length > 32) { showToast(t('p2pSettings.tooLong'), 'error'); return }
    const current = getP2PProfile() || initial
    saveP2PProfile({ ...current, nickname: n })
    showToast(t('p2pSettings.saved'), 'success')
  }

  return (
    <div className="settings-section">
      <h3>{t('p2pSettings.title')}</h3>
      <div className="form-group" style={{ marginBottom: 12 }}>
        <label className="form-label">{t('p2pSettings.nickname')}</label>
        <input className="form-input" maxLength={32} value={nickname} onChange={(e) => setNickname(e.target.value)} />
      </div>
      <button className="btn btn-secondary" onClick={save}>{t('p2pSettings.saveNickname')}</button>
    </div>
  )
}

// ========== SETTINGS VIEW ==========
function SettingsView({ connection, publicKey, solBalance, onBack, showToast, onDeleteWallet, onRpcChange, onDecimalsChange }) {
  const { t, language, setLanguage, languages } = useTranslation()
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
  const [autoLock, setAutoLock] = useState(() => String(getAutoLockSeconds()))
  
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
      showToast(t('rpc.urlRequired'), 'error')
      return
    }
    
    setValidatingRpc(true)
    
    try {
      const isValid = await validateRpcEndpoint(rpcUrl.trim())
      if (!isValid) {
        showToast(t('rpc.invalidEndpoint'), 'error')
        setValidatingRpc(false)
        return
      }
      
      saveRpcEndpoint(rpcUrl.trim())
      showToast(t('rpc.updated'), 'success')
      setShowRpcSettings(false)
      
      // Trigger reconnect
      if (onRpcChange) {
        onRpcChange()
      }
    } catch (err) {
      showToast(t('rpc.validateFail'), 'error')
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
      showToast(t('changePin.mustBe6'), 'error')
      return
    }
    if (newPin !== confirmNewPin) {
      showToast(t('changePin.mismatch'), 'error')
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
      showToast(t('changePin.changed'), 'success')
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
      showToast(t('biometric.disabledToast'), 'success')
    } else {
      // Need PIN to enable biometric
      setShowBiometricSetup(true)
    }
  }
  
  const handleEnableBiometric = async () => {
    if (pin.length < 4) {
      showToast(t('biometric.enterPin'), 'error')
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
      showToast(t('biometric.enabledToast'), 'success')
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

      if (isNaN(swapFeeSol) || swapFeeSol < MIN_SWAP_PRIORITY_FEE) { showToast(t('replenish.minSwapFee', { n: MIN_SWAP_PRIORITY_FEE }), 'error'); return }
      if (isNaN(threshold) || threshold < MIN_TRIGGER_THRESHOLD) { showToast(t('replenish.minTrigger', { n: MIN_TRIGGER_THRESHOLD }), 'error'); return }
      if (isNaN(replenishTo) || replenishTo < MIN_REPLENISH_TO) { showToast(t('replenish.minReplenishTo', { n: MIN_REPLENISH_TO }), 'error'); return }
      if (replenishTo <= threshold) { showToast(t('replenish.replenishGtThreshold'), 'error'); return }
      const minConvert = WSOL_ATA_RENT_CONST + swapFeeSol
      if (isNaN(convertThreshold) || convertThreshold < minConvert) { showToast(t('replenish.minConvert', { n: minConvert.toFixed(5) }), 'error'); return }
      if (convertThreshold < threshold) { showToast(t('replenish.convertGteThreshold', { n: threshold }), 'error'); return }

      saveReplenishSettings({ threshold, replenishTo, swapFeeSol, convertThreshold })
      showToast(t('replenish.savedToast'), 'success')
    }

    return (
      <div className="settings-view">
        <div className="view-header">
          <button className="back-btn" onClick={() => { setShowReplenishSettings(false); setReplenishForm(getReplenishSettings()) }}><BackIcon size={16} /> {t('common.back')}</button>
          <h2>{t('replenish.title')}</h2>
        </div>

        <div className="settings-section">
          <h3>{t('replenish.settingsTitle')}</h3>
          <div className="form-group">
            <label className="form-label">{t('replenish.triggerLabel')}</label>
            <input
              type="number"
              className="form-input"
              placeholder={DEFAULT_REPLENISH_SETTINGS.threshold}
              value={replenishForm.threshold}
              onChange={(e) => setReplenishForm(f => ({ ...f, threshold: e.target.value }))}
              step="0.001" min={MIN_TRIGGER_THRESHOLD}
            />
            <span className="form-hint">{t('replenish.triggerHint', { min: MIN_TRIGGER_THRESHOLD })}</span>
          </div>
          <div className="form-group">
            <label className="form-label">{t('replenish.replenishToLabel')}</label>
            <input
              type="number"
              className="form-input"
              placeholder={DEFAULT_REPLENISH_SETTINGS.replenishTo}
              value={replenishForm.replenishTo}
              onChange={(e) => setReplenishForm(f => ({ ...f, replenishTo: e.target.value }))}
              step="0.001" min={MIN_REPLENISH_TO}
            />
            <span className="form-hint">{t('replenish.replenishToHint', { min: MIN_REPLENISH_TO })}</span>
          </div>
          <div className="form-group">
            <label className="form-label">{t('replenish.swapFeeLabel')}</label>
            <input
              type="number"
              className="form-input"
              placeholder={DEFAULT_REPLENISH_SETTINGS.swapFeeSol}
              value={replenishForm.swapFeeSol}
              onChange={(e) => setReplenishForm(f => ({ ...f, swapFeeSol: e.target.value }))}
              step="0.0001" min={MIN_SWAP_PRIORITY_FEE} max="0.1"
            />
            <span className="form-hint">{t('replenish.swapFeeHint', { min: MIN_SWAP_PRIORITY_FEE })}</span>
          </div>

          <div className="form-group">
            <label className="form-label">{t('replenish.convertLabel')}</label>
            <input
              type="number"
              className="form-input"
              placeholder={DEFAULT_REPLENISH_SETTINGS.convertThreshold}
              value={replenishForm.convertThreshold}
              onChange={(e) => setReplenishForm(f => ({ ...f, convertThreshold: e.target.value }))}
              step="0.001" min={WSOL_ATA_RENT_CONST + parseFloat(replenishForm.swapFeeSol || 0)}
            />
            <span className="form-hint">{t('replenish.convertHint')}</span>
          </div>
          <button
            className="btn btn-primary"
            onClick={handleSaveReplenish}
            style={{ marginTop: '16px' }}
          >
            {t('replenish.saveSettings')}
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => setReplenishForm({ ...DEFAULT_REPLENISH_SETTINGS })}
            style={{ marginTop: '12px', width: '100%' }}
          >
            {t('replenish.resetDefaults')}
          </button>
        </div>

        <div className="settings-section">
          <h3>{t('replenish.manualTitle')}</h3>
          <div className="settings-item">
            <span>{t('replenish.currentBalance')}</span>
            <span>{formatNumber(solBalance, 4)} SOL</span>
          </div>
          <p style={{ fontSize: '13px', opacity: 0.7, margin: '8px 0 16px' }}>
            {t('replenish.manualDesc')}
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
          <button className="back-btn" onClick={() => { setShowRpcSettings(false); setRpcUrl(getRpcEndpoint()) }}><BackIcon size={16} /> {t('common.back')}</button>
          <h2>{t('rpc.title')}</h2>
        </div>
        <div className="settings-section">
          <div className="form-group">
            <label className="form-label">{t('rpc.urlLabel')}</label>
            <input 
              type="text" 
              className="form-input" 
              placeholder={t('onboarding.rpcPlaceholder')} 
              value={rpcUrl} 
              onChange={(e) => setRpcUrl(e.target.value)}
            />
            <span className="form-hint">{t('onboarding.rpcHint')}</span>
          </div>
          <button 
            className="btn btn-primary" 
            onClick={handleSaveRpc} 
            disabled={validatingRpc || !rpcUrl.trim()}
            style={{ marginTop: '16px' }}
          >
            {validatingRpc ? t('onboarding.validating') : t('rpc.saveRpc')}
          </button>
          <button 
            className="btn btn-secondary" 
            onClick={() => setRpcUrl(DEFAULT_RPC_ENDPOINT)}
            style={{ marginTop: '12px', width: '100%' }}
          >
            {t('rpc.resetDefault')}
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
          <button className="back-btn" onClick={() => { setShowChangePIN(false); setPin(''); setNewPin(''); setConfirmNewPin('') }}><BackIcon size={16} /> {t('common.back')}</button>
          <h2>{t('changePin.title')}</h2>
        </div>
        <div className="settings-section">
          <div className="form-group">
            <label className="form-label">{t('changePin.currentPin')}</label>
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
            <label className="form-label">{t('changePin.newPin')}</label>
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
            <label className="form-label">{t('changePin.confirmNewPin')}</label>
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
            {t('changePin.title')}
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
          <button className="back-btn" onClick={() => { setShowBiometricSetup(false); setPin('') }}><BackIcon size={16} /> {t('common.back')}</button>
          <h2>{t('biometric.title')}</h2>
        </div>
        <div className="settings-section">
          <p style={{ marginBottom: '16px', opacity: 0.8 }}>{t('biometric.enterToEnable')}</p>
          <input 
            type="password" 
            className="form-input pin-input" 
            placeholder={t('common.pinPlaceholder')} 
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
            {loading ? t('biometric.settingUp') : t('biometric.enableBtn')}
          </button>
        </div>
      </div>
    )
  }
  
  return (
    <div className="settings-view">
      <div className="view-header"><button className="back-btn" onClick={onBack}><BackIcon size={16} /> {t('common.back')}</button><h2>{t('settings.title')}</h2></div>
      
      {!showBackup ? (
        <div className="settings-section">
          <h3>{t('settings.security')}</h3>
          <div className="settings-item" onClick={() => setShowBackup(true)}><span>{t('settings.backupPhrase')}</span><span className="arrow"><ChevronRightIcon /></span></div>
          <div className="settings-item" onClick={() => setShowChangePIN(true)}><span>{t('settings.changePin')}</span><span className="arrow"><ChevronRightIcon /></span></div>
          {biometricAvailable && (
            <div className="settings-item" onClick={handleToggleBiometric}>
              <span>{t('settings.biometric')}</span>
              <span className={`badge ${biometricEnabled ? 'enabled' : ''}`}>{biometricEnabled ? t('common.enabled') : t('common.disabled')}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="backup-section">
          {!mnemonic ? (
            <>
              <p>{t('settings.enterPinForPhrase')}</p>
              <input type="password" className="form-input pin-input" placeholder={t('common.pinPlaceholder')} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" />
              <div className="backup-actions">
                <button className="btn btn-primary" onClick={handleShowBackup}>{t('settings.revealPhrase')}</button>
                <button className="btn" onClick={() => setShowBackup(false)}>{t('common.cancel')}</button>
              </div>
            </>
          ) : (
            <><div className="mnemonic-words">{mnemonic.split(' ').map((word, i) => <div key={i} className="mnemonic-word"><span className="word-number">{i + 1}</span><span className="word-text">{word}</span></div>)}</div><button className="btn" onClick={() => { setMnemonic(''); setShowBackup(false) }}>{t('common.done')}</button></>
          )}
        </div>
      )}
      
      <div className="settings-section">
        <h3>{t('settings.wallet')}</h3>
        <div className="settings-item">
          <span>{t('settings.address')}</span>
          <span className="address-small">{shortenAddress(publicKey.toString())}</span>
        </div>
      </div>
      
      <ReferralSection publicKey={publicKey} showToast={showToast} />

      <P2PSettingsSection showToast={showToast} />
      
      <div className="settings-section">
        <h3>{t('settings.network')}</h3>
        <div className="settings-item">
          <span>{t('settings.network')}</span>
          <span>{t('settings.solanaMainnet')}</span>
        </div>
        <div className="settings-item" onClick={() => setShowRpcSettings(true)}>
          <span>{t('settings.rpcEndpoint')}</span>
          <span className="arrow"><ChevronRightIcon /></span>
        </div>
        <div className="settings-item" onClick={() => setShowReplenishSettings(true)}>
          <span>{t('settings.replenishSol')}</span>
          <span className="arrow"><ChevronRightIcon /></span>
        </div>
      </div>

      <div className="settings-section">
        <h3>{t('settings.display')}</h3>
        <div className="settings-item">
          <span>{t('settings.decimalPlaces')}</span>
          <div className="decimal-picker">
            {[0, 2, 4, 6, 8, 9].map(d => (
              <button
                key={d}
                className={`decimal-btn${h173kDecimals === d ? ' active' : ''}`}
                onClick={() => { setH173kDecimals(d); saveH173KDecimals(d); if (onDecimalsChange) onDecimalsChange(d); showToast(t('settings.decimalsSet', { n: d }), 'success') }}
              >{d}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3>{t('settings.language')}</h3>
        <p className="language-description">{t('settings.languageDescription')}</p>
        <div className="language-list">
          {languages.map((lang) => (
            <div
              key={lang.code}
              className={`settings-item language-item${language === lang.code ? ' active' : ''}`}
              onClick={() => setLanguage(lang.code)}
              style={{ cursor: 'pointer' }}
            >
              <span>{lang.nativeName}</span>
              {language === lang.code && <span className="badge enabled">✓</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="settings-section">
        <h3>{t('settings.sending')}</h3>
        <SponsorAccountsToggle showToast={showToast} />
      </div>
      
      <div className="settings-section">
        <h3>{t('settings.security')}</h3>
        <div className="settings-item autolock-row">
          <span>{t('settings.autoLockAfter')}</span>
          <span className="autolock-field">
            <input className="autolock-input" type="text" inputMode="numeric" value={autoLock}
              onChange={(e) => setAutoLock(e.target.value.replace(/[^\d]/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.currentTarget.blur(); return }
                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                  e.preventDefault()
                  const cur = parseInt(autoLock, 10) || 0
                  const next = Math.min(86400, Math.max(30, cur + (e.key === 'ArrowUp' ? 1 : -1)))
                  setAutoLock(String(next))
                }
              }}
              onBlur={() => {
                let s = parseInt(autoLock, 10)
                if (!Number.isFinite(s)) s = DEFAULT_AUTO_LOCK_SECONDS
                s = Math.min(86400, Math.max(30, s))
                setAutoLock(String(s))
                saveAutoLockSeconds(s)
                sessionWallet.setAutoLockMinutes(s / 60)
                showToast(t('settings.autoLockUpdated'), 'success')
              }} />
            <span className="autolock-unit">{t('settings.seconds')}</span>
          </span>
        </div>
      </div>

      <MessengerSettings showToast={showToast} />

      <div className="settings-section danger">
        <h3>{t('settings.dangerZone')}</h3>
        {!showDelete ? <button className="btn btn-danger" onClick={() => setShowDelete(true)}>{t('settings.deleteWallet')}</button> : (
          <div className="delete-confirm">
            <p className="warning-text">{t('settings.deleteWarning')}</p>
            <input type="password" className="form-input pin-input" placeholder={t('common.pinPlaceholder')} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" />
            <div className="delete-actions"><button className="btn" onClick={() => { setShowDelete(false); setPin('') }}>{t('common.cancel')}</button><button className="btn btn-danger" onClick={handleDeleteWallet} disabled={pin.length !== 6}>{t('settings.deleteForever')}</button></div>
          </div>
        )}
      </div>

      <div className="settings-section"><h3>{t('settings.about')}</h3><div className="settings-item"><span>{t('settings.version')}</span><span>1.5.0.0</span></div></div>
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

function EnvelopeIcon({ size = 24 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 6L2 7" /></svg>
}

function SendIcon({ size = 24 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></svg>
}

function ReceiveIcon({ size = 24 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" /></svg>
}

function EscrowIcon({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <defs>
        <linearGradient id="madGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#EA6A4E" />
          <stop offset="100%" stopColor="#F5A623" />
        </linearGradient>
      </defs>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="url(#madGrad)" />
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
