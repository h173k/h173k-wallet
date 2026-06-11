/**
 * H173K P2P Marketplace — UI
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { CURRENCIES, getCurrency } from './currencies'
import {
  useP2P,
  getP2PProfile, saveP2PProfile,
  getP2PFetchLimit, saveP2PFetchLimit,
  FETCH_LIMIT_OPTIONS,
  POST_FEE_H173K, CANCEL_FEE_H173K,
  computeTrade, requiredH173KToTake, requiredH173KToPost, viewerPaysInH173K, contactLink,
  MAX_PAYMENT_METHODS, MAX_METHOD_LEN,
} from './useP2P'
import { formatH173K, formatNumber, copyToClipboard } from '../utils'
import { generateOfferLink } from './deeplink'
import { useTranslation, translate } from '../i18n'

// ----- tiny inline icons (kept local to avoid touching App.jsx exports) -----
const Back = ({ s = 18 }) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>)
const Refresh = ({ s = 18 }) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 4v6h-6M1 20v-6h6" /><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" /></svg>)
const Close = ({ s = 18 }) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>)
const Plus = ({ s = 18 }) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>)
const Tg = ({ s = 18 }) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M21.94 4.6l-3.3 15.56c-.25 1.1-.9 1.37-1.82.85l-5.03-3.7-2.43 2.34c-.27.27-.5.5-1 .5l.36-5.1L18 6.78c.4-.36-.09-.56-.62-.2L6.9 13.5l-4.95-1.55c-1.08-.34-1.1-1.08.23-1.6L20.5 3.1c.9-.33 1.69.2 1.44 1.5z" /></svg>)
const Phone = ({ s = 18 }) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.36 1.9.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0122 16.92z" /></svg>)
const Chat = ({ s = 18 }) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" /></svg>)
const Link = ({ s = 18 }) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" /></svg>)

function loadingMsg() { return translate('p2p.loadingOffers') }

export default function P2PMarketplace({ connection, publicKey, balance, solBalance, price, toUSD, onBack, showToast, onOpenMessenger, deepLink, onDeepLinkDone }) {
  const [profile, setProfile] = useState(() => getP2PProfile())
  const onboarded = !!profile

  // ----- onboarding (first ever use) -----
  if (!onboarded) {
    return <P2POnboarding showToast={showToast} onBack={onBack} onDone={(p) => { saveP2PProfile(p); setProfile(p) }} />
  }

  return (
    <P2PMain
      connection={connection} publicKey={publicKey} balance={balance} solBalance={solBalance}
      price={price} toUSD={toUSD} onBack={onBack} showToast={showToast}
      profile={profile}
      onProfileChange={(p) => { saveP2PProfile(p); setProfile(p) }}
      onOpenMessenger={onOpenMessenger}
      deepLink={deepLink} onDeepLinkDone={onDeepLinkDone}
    />
  )
}

// ===========================================================================
// Onboarding
// ===========================================================================
function P2POnboarding({ onDone, onBack, showToast }) {
  const { t } = useTranslation()
  const [nickname, setNickname] = useState('')
  const [currency, setCurrency] = useState('USD')

  const submit = () => {
    const n = nickname.trim()
    if (!n) { showToast(t('p2p.enterNickname'), 'error'); return }
    if (n.length > 32) { showToast(t('p2pSettings.tooLong'), 'error'); return }
    onDone({ nickname: n, currency })
  }

  return (
    <div className="escrow-view p2p-view">
      <div className="view-header">
        <button className="back-btn" onClick={onBack}><Back /> {t('common.back')}</button>
        <h2>{t('p2p.title')}</h2>
      </div>

      <div className="escrow-info-card">
        <p>{t('p2p.welcomePre')} <strong>{t('p2p.welcomeBold')}</strong>{t('p2p.welcomePost')}</p>
      </div>

      <div className="form-group">
        <label className="form-label">{t('p2p.nickname')}</label>
        <input className="form-input" value={nickname} maxLength={32}
          onChange={(e) => setNickname(e.target.value)} placeholder={t('p2p.nickPlaceholder')} />
      </div>

      <div className="form-group">
        <label className="form-label">{t('p2p.currency')}</label>
        <select className="form-input p2p-select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
          {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
        </select>
      </div>

      <button className="btn btn-action" onClick={submit}>{t('common.continue')}</button>
    </div>
  )
}

// ===========================================================================
// Main marketplace
// ===========================================================================
function P2PMain({ connection, publicKey, balance, solBalance, price, toUSD, onBack, showToast, profile, onProfileChange, onOpenMessenger, deepLink, onDeepLinkDone }) {
  const { t } = useTranslation()
  const { offers, loading, posting, fetchOffers, fetchOfferBySignature, postOffer, cancelOffer } = useP2P(connection, publicKey)

  const [currency, setCurrency] = useState(profile.currency)
  const [side, setSide] = useState('buy')          // 'buy' | 'sell'
  const [sort, setSort] = useState('newest')       // price_desc | price_asc | newest | oldest
  const [pmFilter, setPmFilter] = useState('')     // '' = all
  const [limit, setLimit] = useState(() => getP2PFetchLimit())
  const [showCreate, setShowCreate] = useState(false)
  const [selected, setSelected] = useState(null)   // offer in detail modal
  const [refreshing, setRefreshing] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  // pull-to-refresh
  const touchStartY = useRef(0)
  const isPulling = useRef(false)
  const [pullProgress, setPullProgress] = useState(0)

  const cur = getCurrency(currency)

  const reload = useCallback(async () => {
    await fetchOffers(currency, limit)
  }, [fetchOffers, currency, limit])

  useEffect(() => { reload() }, [reload])

  const handleRefresh = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    await reload()
    setTimeout(() => setRefreshing(false), 400)
  }, [reload, refreshing])

  const onTouchStart = useCallback((e) => {
    if (window.scrollY === 0) { touchStartY.current = e.touches[0].clientY; isPulling.current = true }
  }, [])
  const onTouchMove = useCallback((e) => {
    if (!isPulling.current || refreshing) return
    const diff = e.touches[0].clientY - touchStartY.current
    if (diff > 0 && diff < 150) setPullProgress(Math.min(diff / 100, 1))
    if (diff > 100 && !refreshing) { handleRefresh(); isPulling.current = false; setPullProgress(0) }
  }, [refreshing, handleRefresh])
  const onTouchEnd = useCallback(() => { isPulling.current = false; setPullProgress(0) }, [])

  // payment methods present in current (side-filtered) offers
  const pmOptions = useMemo(() => {
    const set = new Set()
    offers.filter(o => o.type === side).forEach(o => (o.paymentMethods || []).forEach(m => set.add(m)))
    return Array.from(set).sort()
  }, [offers, side])

  const visible = useMemo(() => {
    let list = offers.filter(o => o.type === side)
    if (pmFilter) list = list.filter(o => (o.paymentMethods || []).includes(pmFilter))
    const cmp = {
      price_desc: (a, b) => b.pricePerUsd - a.pricePerUsd,
      price_asc: (a, b) => a.pricePerUsd - b.pricePerUsd,
      newest: (a, b) => b.createdAt - a.createdAt,
      oldest: (a, b) => a.createdAt - b.createdAt,
    }[sort]
    return [...list].sort(cmp)
  }, [offers, side, pmFilter, sort])

  const changeCurrency = (code) => {
    setCurrency(code)
    setPmFilter('')
    onProfileChange({ ...profile, currency: code })
  }

  const changeLimit = (n) => { setLimit(n); saveP2PFetchLimit(n) }

  // Open an offer that arrived via a deep link: switch to its currency (the hint) and
  // read the offer straight from its transaction signature, then pop the offer card.
  // One-shot per signature; shows a "not found" toast if the tx can't be loaded.
  const deepLinkHandled = useRef(null)
  useEffect(() => {
    if (!deepLink || !deepLink.signature || !connection) return
    if (deepLinkHandled.current === deepLink.signature) return
    deepLinkHandled.current = deepLink.signature
    let cancelled = false
    ;(async () => {
      if (deepLink.currency && deepLink.currency !== currency) changeCurrency(deepLink.currency)
      const offer = await fetchOfferBySignature(deepLink.signature)
      if (cancelled) return
      if (offer) setSelected(offer)
      else showToast(t('p2p.offerLinkNotFound'), 'error')
      onDeepLinkDone && onDeepLinkDone()
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLink, connection])

  const onSwap = (info) => {
    if (info?.status === 'swapping') showToast(t('p2p.toppingUp'), 'info')
    else if (info?.status === 'swapped') showToast(t('main.swappedForSol', { h: formatH173K(info.h173kUsed), s: info.solReceived.toFixed(4) }), 'info')
  }

  const handlePost = async (data) => {
    try {
      const nick = (data.nickname || profile.nickname || '').trim()
      await postOffer({ ...data, nickname: nick, currency }, onSwap)
      if (nick && nick !== profile.nickname) onProfileChange({ ...profile, nickname: nick })
      showToast(t('p2p.offerPosted'), 'success')
      setShowCreate(false)
      reload()
    } catch (err) {
      console.error(err)
      const m = err?.message || 'error'
      showToast(m.includes('locked') ? t('p2p.sessionExpiredShort') : t('p2p.postFailed', { msg: m }), 'error')
    }
  }

  const handleCancel = async (offer) => {
    try {
      await cancelOffer(offer, onSwap)
      showToast(t('p2p.offerCancelled'), 'success')
      setSelected(null)
      reload()
    } catch (err) {
      showToast(t('p2p.cancelFailed', { msg: err?.message || 'error' }), 'error')
    }
  }

  return (
    <div className="escrow-view p2p-view" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      <div className="view-header">
        <button className="back-btn" onClick={onBack}><Back /> {t('common.back')}</button>
        <h2>{t('p2p.title')}</h2>
      </div>

      {/* ===== Banner ===== */}
      <div className="p2p-banner">
        <div className="p2p-tabs">
          <button className={`p2p-tab ${side === 'buy' ? 'active' : ''}`} onClick={() => { setSide('buy'); setPmFilter('') }}>{t('p2p.buyOffers')}</button>
          <button className={`p2p-tab ${side === 'sell' ? 'active' : ''}`} onClick={() => { setSide('sell'); setPmFilter('') }}>{t('p2p.sellOffers')}</button>
        </div>

        <div className="p2p-controls">
          <select className="p2p-mini-select" value={currency} onChange={(e) => changeCurrency(e.target.value)} title={t('p2p.currency')}>
            {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code}</option>)}
          </select>

          <select className="p2p-mini-select" value={sort} onChange={(e) => setSort(e.target.value)} title={t('p2p.orderBy')}>
            <option value="price_desc">{t('p2p.sortPriceDesc')}</option>
            <option value="price_asc">{t('p2p.sortPriceAsc')}</option>
            <option value="newest">{t('p2p.sortNewest')}</option>
            <option value="oldest">{t('p2p.sortOldest')}</option>
          </select>

          <select className="p2p-mini-select" value={pmFilter} onChange={(e) => setPmFilter(e.target.value)} title={t('p2p.paymentMethods')}>
            <option value="">{t('p2p.allMethods')}</option>
            {pmOptions.map(m => <option key={m} value={m}>{m}</option>)}
          </select>

          <select className="p2p-mini-select" value={limit} onChange={(e) => changeLimit(Number(e.target.value))} title={t('p2p.maxOffersLoad')}>
            {FETCH_LIMIT_OPTIONS.map(n => <option key={n} value={n}>{t('p2p.lastN', { n })}</option>)}
          </select>

          <button className="p2p-icon-btn" onClick={handleRefresh} disabled={refreshing} title={t('history.refresh')}>
            <Refresh />
          </button>
          <button className="p2p-icon-btn" onClick={() => setShowSettings(true)} title={t('p2p.settingsTitle')}>⚙</button>
        </div>

        <button className="btn p2p-create-btn" onClick={() => setShowCreate(true)}>
          <Plus /> {side === 'buy' ? t('p2p.createBuyOffer') : t('p2p.createSellOffer')}
        </button>
      </div>

      {/* pull to refresh indicator */}
      {(pullProgress > 0 || refreshing) && (
        <div className="pull-refresh-indicator escrow-pull" style={{ opacity: refreshing ? 1 : pullProgress }}>
          {!refreshing && <Refresh s={20} />}
          <span>{refreshing ? t('main.refreshing') : (pullProgress >= 1 ? t('main.releaseToRefresh') : t('main.pullToRefresh'))}</span>
        </div>
      )}

      {/* ===== Offer list ===== */}
      {loading && !refreshing ? (
        <div className="loading-spinner-small" />
      ) : visible.length === 0 ? (
        <div className="empty-state">
          <p>{side === 'buy' ? t('p2p.emptyBuy', { code: cur?.code }) : t('p2p.emptySell', { code: cur?.code })}</p>
          <p className="empty-hint">{t('p2p.emptyHint')}</p>
        </div>
      ) : (
        <div className="contracts-list">
          {visible.map(o => (
            <OfferCard key={o.id} offer={o} cur={cur} price={price}
              isMine={o.posterPubkey === publicKey?.toString()}
              onClick={() => setSelected(o)} />
          ))}
        </div>
      )}

      {/* ===== Detail modal ===== */}
      {selected && (
        <OfferDetail offer={selected} cur={cur} price={price} balance={balance}
          isMine={selected.posterPubkey === publicKey?.toString()}
          posting={posting}
          onClose={() => setSelected(null)}
          onCancel={() => handleCancel(selected)}
          onMessage={(addr, name) => { setSelected(null); onOpenMessenger && onOpenMessenger(addr, name) }}
          showToast={showToast} />
      )}

      {/* ===== Create modal ===== */}
      {showCreate && (
        <CreateOffer cur={cur} defaultType={side} posting={posting} solBalance={solBalance}
          balance={balance} price={price} nickname={profile.nickname}
          onClose={() => setShowCreate(false)} onSubmit={handlePost} />
      )}

      {/* ===== Settings modal ===== */}
      {showSettings && (
        <P2PSettingsModal profile={profile} onClose={() => setShowSettings(false)}
          onSave={(p) => { onProfileChange(p); if (p.currency !== currency) changeCurrency(p.currency); setShowSettings(false); showToast(t('p2p.settingsSaved'), 'success') }} />
      )}
    </div>
  )
}

// ===========================================================================
// Offer card
// ===========================================================================
function OfferCard({ offer, cur, price, isMine, onClick }) {
  const { t } = useTranslation()
  const sym = cur?.symbol || ''
  const date = offer.createdAt ? new Date(offer.createdAt * 1000) : null
  return (
    <div className="contract-item p2p-card" onClick={onClick}>
      <div className="contract-item-header">
        <span className="contract-name">{offer.nickname || t('p2p.anon')} <span className="p2p-card-action">{offer.type === 'sell' ? t('p2p.isSelling') : t('p2p.isBuying')}</span> {isMine && <span className="p2p-you">{t('p2p.you')}</span>}</span>
        <span className={`contract-status ${offer.type === 'buy' ? 'ongoing' : 'released'}`}>{offer.type.toUpperCase()}</span>
      </div>
      <div className="p2p-card-price">
        <strong>{formatNumber(offer.pricePerUsd, 4)} {cur?.code}</strong>
        <span className="p2p-card-sub"> {t('p2p.perUsd')}</span>
      </div>
      <div className="p2p-card-row">
        <span>{t('p2p.size')}</span>
        <span>{t('p2p.sizeValue', { min: '$' + formatNumber(offer.minUsd, 2), max: '$' + formatNumber(offer.maxUsd, 2) })}</span>
      </div>
      {offer.paymentMethods?.length > 0 && (
        <div className="p2p-chips">
          {offer.paymentMethods.slice(0, 4).map((m, i) => <span key={i} className="p2p-chip">{m}</span>)}
        </div>
      )}
      {date && <div className="p2p-card-date">{date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>}
    </div>
  )
}

// ===========================================================================
// Offer detail (with gated contact)
// ===========================================================================
function OfferDetail({ offer, cur, price, balance, isMine, posting, onClose, onCancel, onMessage, showToast }) {
  const { t } = useTranslation()
  const [revealed, setRevealed] = useState(false)
  const [amount, setAmount] = useState(() => String(offer.minUsd || ''))

  // My side of this trade:
  //  - my own offer  => I'm the advertiser, on the offer's own side.
  //  - someone else's => I'm the taker, on the OPPOSITE side.
  // Who sends h173k? sell offer: advertiser sends / taker receives. buy offer: advertiser receives / taker sends.
  const sendsH173k = isMine ? (offer.type === 'sell') : (offer.type === 'buy')
  const viewerAction = sendsH173k ? 'sell' : 'buy'    // sell h173k = send it; buy h173k = receive it
  const multiplier = sendsH173k ? 2 : 1               // MAD deposit: buyer(send h173k)=2×, seller(receive)=1×
  const minH173k = price > 0 ? offer.minUsd / price : null
  const required = minH173k != null ? minH173k * multiplier : null   // h173k to back the MIN size (reveal gate)
  const enough = required != null && balance >= required

  // Calculator for the amount the user wants to trade (within the offer range).
  const amt = parseFloat(amount)
  const inRange = amt >= offer.minUsd && amt <= offer.maxUsd
  const calc = (amt > 0 && price > 0) ? computeTrade(offer, amt, price) : null
  // h173k you must hold to run the MAD contract for THIS amount (deposit: ×2 if you
  // send h173k, ×1 if you receive it — for a buyer that equals what you receive).
  const neededForAmount = (calc?.h173kAmount != null) ? calc.h173kAmount * multiplier : null
  const enoughForAmount = neededForAmount == null ? null : balance >= neededForAmount

  const setAmt = (e) => {
    const v = e.target.value.replace(',', '.')
    if (v === '' || /^\d*\.?\d*$/.test(v)) setAmount(v)
  }
  // Up/Down arrows step the value by 1 (laptop convenience; type=text has no native spinner).
  const stepAmt = (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    const cur = parseFloat(amount) || 0
    const next = e.key === 'ArrowUp' ? cur + 1 : Math.max(0, cur - 1)
    setAmount(String(Number(next.toFixed(6))))
  }

  const tryReveal = () => {
    if (isMine) return
    if (required == null) { showToast(t('p2p.priceUnavailable'), 'error'); return }
    if (enough) setRevealed(true)
    else showToast(t('p2p.needToTake', { n: formatH173K(required) }), 'error')
  }

  const openContact = () => {
    if (offer.contactType === 'wm') {
      onMessage && onMessage(offer.posterPubkey, offer.nickname)
      return
    }
    const link = contactLink(offer.contactType, offer.contact)
    if (!link) return
    if (offer.contactType === 'ph') window.location.href = link
    else window.open(link, '_blank')
  }

  return (
    <div className="p2p-modal-overlay" onClick={onClose}>
      <div className="p2p-modal" onClick={(e) => e.stopPropagation()}>
        <div className="p2p-modal-head">
          <h3>{viewerAction === 'buy' ? t('p2p.buyWord') : t('p2p.sellWord')} h173k · {offer.nickname || t('p2p.anon')}</h3>
          <div className="p2p-modal-head-actions">
            {offer.signature && (
              <button className="p2p-icon-btn" title={t('p2p.shareOffer')}
                onClick={() => { copyToClipboard(generateOfferLink(offer.signature, offer.currency)); showToast(t('p2p.offerLinkCopied'), 'success') }}>
                <Link s={16} />
              </button>
            )}
            <button className="p2p-icon-btn" onClick={onClose}><Close /></button>
          </div>
        </div>

        <div className="deposit-preview">
          <div className="deposit-row"><span>{t('p2p.price')}</span><span>{formatNumber(offer.pricePerUsd, 4)} {cur?.code} / $1 h173k</span></div>
          <div className="deposit-row"><span>{t('p2p.sizeRange')}</span><span>${formatNumber(offer.minUsd, 2)} – ${formatNumber(offer.maxUsd, 2)}</span></div>
        </div>

        {/* ---- Trade calculator ---- */}
        <div className="form-group" style={{ marginTop: 4 }}>
          <label className="form-label">
            {viewerAction === 'buy' ? t('p2p.howMuchBuy') : t('p2p.howMuchSell')}
          </label>
          <input className="form-input" type="text" inputMode="decimal" value={amount}
            style={amt > 0 && !inRange ? { borderColor: 'var(--color-error)' } : undefined}
            onChange={setAmt} onKeyDown={stepAmt} placeholder={`${formatNumber(offer.minUsd, 2)} – ${formatNumber(offer.maxUsd, 2)}`} />
          {amt > 0 && !inRange && <span className="form-hint" style={{ color: 'var(--color-error)' }}>{t('p2p.outsideRange', { min: '$' + formatNumber(offer.minUsd, 2), max: '$' + formatNumber(offer.maxUsd, 2) })}</span>}
        </div>

        {calc && (
          <div className="deposit-preview">
            {viewerAction === 'buy' ? (
              <>
                <div className="deposit-row"><span>{t('p2p.youReceive')}</span><span><strong>≈ {formatH173K(calc.h173kAmount)} h173k</strong></span></div>
                <div className="deposit-row"><span>{t('p2p.youPay')}</span><span>{formatNumber(calc.fiatAmount, 2)} {cur?.code}</span></div>
                <div className="deposit-row"><span>{t('p2p.h173kNeeded')}</span>
                  <span style={{ color: enoughForAmount === false ? 'var(--color-error)' : undefined }}>
                    ≈ {neededForAmount != null ? formatH173K(neededForAmount) : '—'} h173k
                  </span></div>
              </>
            ) : (
              <>
                <div className="deposit-row"><span>{t('p2p.youReceive')}</span><span><strong>{formatNumber(calc.fiatAmount, 2)} {cur?.code}</strong></span></div>
                <div className="deposit-row"><span>{t('p2p.youSend')}</span><span>≈ {formatH173K(calc.h173kAmount)} h173k</span></div>
                <div className="deposit-row"><span>{t('p2p.h173kNeeded')}</span>
                  <span style={{ color: enoughForAmount === false ? 'var(--color-error)' : undefined }}>
                    ≈ {neededForAmount != null ? formatH173K(neededForAmount) : '—'} h173k
                  </span></div>
              </>
            )}
          </div>
        )}

        {/* ---- Role note ---- */}
        <div className="escrow-info-card">
          {viewerAction === 'sell' ? (
            <p>{t('p2p.roleNoteSell')}</p>
          ) : (
            <p>{t('p2p.roleNoteBuy')}</p>
          )}
        </div>

        {neededForAmount != null && enoughForAmount === false && (
          <div className="escrow-info-card" style={{ borderColor: 'var(--color-error)' }}>
            <p style={{ color: 'var(--color-error)' }}>{t('p2p.needForAmount', { needed: formatH173K(neededForAmount), have: formatH173K(balance) })}</p>
          </div>
        )}

        {offer.paymentMethods?.length > 0 && (
          <div className="form-group">
            <label className="form-label">{t('p2p.paymentMethods')}</label>
            <div className="p2p-chips">{offer.paymentMethods.map((m, i) => <span key={i} className="p2p-chip">{m}</span>)}</div>
          </div>
        )}

        {isMine ? (
          <>
            <div className="escrow-info-card"><p>{t('p2p.yourOfferNote', { n: CANCEL_FEE_H173K })}</p></div>
            <button className="btn btn-danger" disabled={posting} onClick={onCancel}>{posting ? t('p2p.cancelling') : t('p2p.cancelOffer')}</button>
          </>
        ) : revealed ? (
          <div className="p2p-contact-box">
            <label className="form-label">{offer.contactType === 'wm' ? t('p2p.wmAddress') : t('p2p.contact')}</label>
            <div
              className={`p2p-contact-value ${offer.contactType === 'wm' ? 'p2p-contact-wm' : ''}`}
              onClick={offer.contactType === 'wm' ? openContact : undefined}
              title={offer.contactType === 'wm' ? t('p2p.tapToMessage') : undefined}
            >
              <span>{offer.contactType === 'wm' ? offer.posterPubkey : offer.contact}</span>
              <button
                className="p2p-icon-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  const val = offer.contactType === 'wm' ? offer.posterPubkey : offer.contact
                  copyToClipboard(val); showToast(t('common.copied'), 'success')
                }}
                title={t('p2p.copy')}
              >⧉</button>
            </div>
            <button className="btn btn-action p2p-tg-btn" onClick={openContact}>
              {offer.contactType === 'ph' ? <><Phone /> {t('p2p.call')}</>
                : offer.contactType === 'wm' ? <><Chat /> {t('p2p.openInMessenger')}</>
                : <><Tg /> {t('p2p.openInTelegram')}</>}
            </button>
            <p className="form-hint">
              {offer.contactType === 'wm'
                ? t('p2p.contactHintWm')
                : t('p2p.contactHint')}
            </p>
          </div>
        ) : (
          <>
            <div className="escrow-info-card">
              <p>{t('p2p.takeOfferNote', { n: required != null ? formatH173K(required) : '—', mult: sendsH173k ? t('p2p.mult2x') : t('p2p.mult1x'), balance: formatH173K(balance) })}</p>
            </div>
            <button className="btn btn-action" disabled={!enough} onClick={tryReveal}>
              {enough ? t('p2p.revealContact') : t('p2p.notEnough')}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ===========================================================================
// Create offer
// ===========================================================================
function CreateOffer({ cur, defaultType, posting, solBalance, balance, price, nickname: initialNickname, onClose, onSubmit }) {
  const { t } = useTranslation()
  const [type, setType] = useState(defaultType)
  const [nickname, setNickname] = useState(initialNickname || '')
  const [pricePerUsd, setPrice] = useState('')
  const [minUsd, setMin] = useState('')
  const [maxUsd, setMax] = useState('')
  const [pmInput, setPmInput] = useState('')
  const [methods, setMethods] = useState([])
  const [contactType, setContactType] = useState('tg')
  const [contact, setContact] = useState('')
  const [err, setErr] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const alertMsg = (m) => setErr(m)

  // Only accept empty or non-negative numbers (no minus, no negative values).
  const setNum = (setter) => (e) => {
    const v = e.target.value
    if (v === '' || (parseFloat(v) >= 0 && !v.includes('-'))) setter(v)
  }
  const blockMinus = (e) => { if (e.key === '-' || e.key === 'e' || e.key === 'E' || e.key === '+') e.preventDefault() }

  const addMethod = () => {
    // Title-case each word (e.g. "bank transfer" -> "Bank Transfer", "m-pesa" -> "M-Pesa").
    const titleCase = (s) => s.replace(/(^|[\s\-/])(\p{L})/gu, (_, b, ch) => b + ch.toUpperCase())
    const m = titleCase(pmInput.trim().slice(0, MAX_METHOD_LEN))
    if (!m) return
    if (methods.includes(m)) { setPmInput(''); return }
    if (methods.length >= MAX_PAYMENT_METHODS) { alertMsg(t('p2p.maxMethods', { n: MAX_PAYMENT_METHODS })); return }
    setMethods([...methods, m]); setPmInput(''); setErr('')
  }

  // Live h173k figures based on the current pool price.
  const poolOk = price && price > 0
  const oneUsdH173k = poolOk ? 1 / price : null
  const mn = parseFloat(minUsd)
  const mxNum = parseFloat(maxUsd)
  const sizeInvalid = mn > 0 && mxNum > 0 && mxNum < mn
  const requiredPost = requiredH173KToPost(type, mn, price)        // h173k needed to back the min size
  const enoughForPost = requiredPost == null ? null : balance >= requiredPost

  // Per-field error highlighting (only after a submit attempt).
  const priceErr = submitted && !(parseFloat(pricePerUsd) > 0)
  const minErr = submitted && !(mn > 0)
  const maxErr = submitted && (!(mxNum > 0) || sizeInvalid)
  const errStyle = (on) => on ? { borderColor: 'var(--color-error)' } : undefined

  const validateAndSubmit = () => {
    setSubmitted(true)
    const p = parseFloat(pricePerUsd)
    const mx = parseFloat(maxUsd)
    if (!nickname.trim()) return alertMsg(t('p2p.errNickname'))
    if (!(p > 0)) return alertMsg(t('p2p.errPrice'))
    if (!(mn > 0)) return alertMsg(t('p2p.errMinSize'))
    if (!(mx >= mn)) return alertMsg(t('p2p.errMaxSize'))
    if (methods.length === 0) return alertMsg(t('p2p.errMethods'))
    if (enoughForPost === false) return alertMsg(t('p2p.notEnoughFulfil'))
    if (contactType !== 'wm' && !contact.trim()) return alertMsg(t('p2p.errContact'))
    onSubmit({ nickname: nickname.trim(), type, pricePerUsd: p, minUsd: mn, maxUsd: mx, paymentMethods: methods, contactType, contact: contactType === 'wm' ? '' : contact.trim() })
  }

  return (
    <div className="p2p-modal-overlay" onClick={onClose}>
      <div className="p2p-modal" onClick={(e) => e.stopPropagation()}>
        <div className="p2p-modal-head">
          <h3>{t('p2p.createTitle')}</h3>
          <button className="p2p-icon-btn" onClick={onClose}><Close /></button>
        </div>

        <div className="p2p-type-toggle">
          <button className={`p2p-tab ${type === 'buy' ? 'active' : ''}`} onClick={() => setType('buy')}>{t('p2p.buyH173k')}</button>
          <button className={`p2p-tab ${type === 'sell' ? 'active' : ''}`} onClick={() => setType('sell')}>{t('p2p.sellH173k')}</button>
        </div>

        <div className="form-group">
          <label className="form-label">{t('p2p.nickOfferLabel')}</label>
          <input className="form-input" maxLength={32} value={nickname}
            style={submitted && !nickname.trim() ? { borderColor: 'var(--color-error)' } : undefined}
            onChange={(e) => setNickname(e.target.value)} placeholder={t('p2p.nickPlaceholder')} />
        </div>

        <div className="form-group">
          <label className="form-label">{t('p2p.priceLabel', { code: cur?.code })}</label>
          <input className="form-input" type="number" inputMode="decimal" min="0" step="any" value={pricePerUsd}
            style={errStyle(priceErr)}
            onKeyDown={blockMinus} onChange={setNum(setPrice)} placeholder={t('p2p.pricePlaceholder', { code: cur?.code })} />
          {type === 'sell' ? (
            // creator sends h173k and receives fiat → show fiat received
            <span className="form-hint">
              {t('p2p.sellHint', { code: cur?.code, p1: pricePerUsd ? formatNumber(parseFloat(pricePerUsd), 4) : '…', p10: pricePerUsd ? formatNumber(parseFloat(pricePerUsd) * 10, 2) : '…' })}
            </span>
          ) : (
            // creator pays fiat and receives h173k → show h173k received
            <span className="form-hint">
              {t('p2p.buyHint', { code: cur?.code, h1: oneUsdH173k != null ? `${formatH173K(oneUsdH173k)} h173k` : '… h173k', h10: oneUsdH173k != null ? `${formatH173K(oneUsdH173k * 10)} h173k` : '… h173k' })}
            </span>
          )}
        </div>

        <div className="p2p-row2">
          <div className="form-group">
            <label className="form-label">{t('p2p.minSize')}</label>
            <input className="form-input" type="number" inputMode="decimal" min="0" step="any" value={minUsd}
              style={errStyle(minErr)}
              onKeyDown={blockMinus} onChange={setNum(setMin)} placeholder={t('p2p.minPlaceholder')} />
          </div>
          <div className="form-group">
            <label className="form-label">{t('p2p.maxSize')}</label>
            <input className="form-input" type="number" inputMode="decimal" min="0" step="any" value={maxUsd}
              style={errStyle(maxErr)}
              onKeyDown={blockMinus} onChange={setNum(setMax)} placeholder={t('p2p.maxPlaceholder')} />
          </div>
        </div>

        {sizeInvalid && (
          <div className="escrow-info-card" style={{ borderColor: 'var(--color-error)' }}>
            <p style={{ color: 'var(--color-error)' }}>{t('p2p.sizeError')}</p>
          </div>
        )}

        {/* h173k requirement + balance check for the chosen min size */}
        {mn > 0 && (
          requiredPost == null ? (
            <div className="escrow-info-card"><p>{t('p2p.poolUnavailable')}</p></div>
          ) : (
            <div className="escrow-info-card" style={{ borderColor: enoughForPost ? 'var(--color-white-10)' : 'var(--color-error)' }}>
              <p style={{ color: enoughForPost ? 'var(--color-white-70)' : 'var(--color-error)' }}>
                {enoughForPost ? '✓ ' : '⚠ '}
                {t('p2p.backMinSize', { min: '$' + formatNumber(mn, 2), n: formatH173K(requiredPost), mult: type === 'sell' ? t('p2p.multPay') : t('p2p.multReceive'), balance: formatH173K(balance) })}
                {!enoughForPost && ' ' + t('p2p.notEnoughFulfil')}
              </p>
            </div>
          )
        )}

        <div className="form-group">
          <label className="form-label">{t('p2p.pmLabel', { n: methods.length, max: MAX_PAYMENT_METHODS })}</label>
          <div className="input-with-action">
            <input className="form-input" value={pmInput} maxLength={MAX_METHOD_LEN}
              disabled={methods.length >= MAX_PAYMENT_METHODS}
              onChange={(e) => setPmInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addMethod() } }}
              placeholder={methods.length >= MAX_PAYMENT_METHODS ? t('p2p.limitReached') : (cur?.crypto ? t('p2p.pmPlaceholderCrypto') : t('p2p.pmPlaceholder'))} />
            <button className="input-action-btn" onClick={addMethod} disabled={methods.length >= MAX_PAYMENT_METHODS}><Plus /></button>
          </div>
          <span className="form-hint">{t('p2p.pmHint', { max: MAX_PAYMENT_METHODS, len: MAX_METHOD_LEN })}</span>
          {methods.length > 0 && (
            <div className="p2p-chips" style={{ marginTop: 10 }}>
              {methods.map((m, i) => (
                <span key={i} className="p2p-chip removable" onClick={() => setMethods(methods.filter((_, j) => j !== i))}>{m} ✕</span>
              ))}
            </div>
          )}
        </div>

        <div className="form-group">
          <label className="form-label">{t('p2p.contactType')}</label>
          <div className="p2p-type-toggle">
            <button className={`p2p-tab ${contactType === 'tg' ? 'active' : ''}`} onClick={() => setContactType('tg')}>{t('p2p.telegram')}</button>
            <button className={`p2p-tab ${contactType === 'ph' ? 'active' : ''}`} onClick={() => setContactType('ph')}>{t('p2p.phone')}</button>
            <button className={`p2p-tab ${contactType === 'wm' ? 'active' : ''}`} onClick={() => setContactType('wm')}>{t('p2p.messengerTab')}</button>
          </div>
        </div>

        {contactType === 'wm' ? (
          <div className="form-group">
            <label className="form-label">{t('p2p.walletMessenger')}</label>
            <div className="escrow-info-card">
              <p>{t('p2p.wmInfo')}</p>
            </div>
          </div>
        ) : (
          <div className="form-group">
            <label className="form-label">{contactType === 'tg' ? t('p2p.tgHandle') : t('p2p.phoneNumber')}</label>
            <input className="form-input" value={contact} maxLength={32} onChange={(e) => setContact(e.target.value)}
              placeholder={contactType === 'tg' ? '@username' : '+001234567'} />
            <span className="form-hint">{t('p2p.contactPublicWarning')}</span>
          </div>
        )}

        {err && <div className="escrow-info-card" style={{ borderColor: 'var(--color-error)' }}><p style={{ color: 'var(--color-error)' }}>{err}</p></div>}

        <div className="escrow-info-card"><p>{t('p2p.postingInfo', { fee: POST_FEE_H173K, sol: formatNumber(solBalance, 4) })}</p></div>

        <button className="btn btn-action" disabled={posting || sizeInvalid || enoughForPost === false} onClick={validateAndSubmit}>{posting ? t('p2p.posting') : t('p2p.postOffer')}</button>
      </div>
    </div>
  )
}

// ===========================================================================
// In-section P2P settings (nickname + currency)
// ===========================================================================
function P2PSettingsModal({ profile, onClose, onSave }) {
  const { t } = useTranslation()
  const [nickname, setNickname] = useState(profile.nickname)
  const [currency, setCurrency] = useState(profile.currency)
  return (
    <div className="p2p-modal-overlay" onClick={onClose}>
      <div className="p2p-modal" onClick={(e) => e.stopPropagation()}>
        <div className="p2p-modal-head">
          <h3>{t('p2p.settingsTitle')}</h3>
          <button className="p2p-icon-btn" onClick={onClose}><Close /></button>
        </div>
        <div className="form-group">
          <label className="form-label">{t('p2p.nickname')}</label>
          <input className="form-input" maxLength={32} value={nickname} onChange={(e) => setNickname(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">{t('p2p.currency')}</label>
          <select className="form-input p2p-select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
          </select>
        </div>
        <button className="btn btn-action" onClick={() => {
          const n = nickname.trim(); if (!n) return
          onSave({ ...profile, nickname: n, currency })
        }}>{t('common.save')}</button>
      </div>
    </div>
  )
}
