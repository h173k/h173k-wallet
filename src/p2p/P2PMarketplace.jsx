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

// ----- tiny inline icons (kept local to avoid touching App.jsx exports) -----
const Back = ({ s = 18 }) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>)
const Refresh = ({ s = 18 }) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 4v6h-6M1 20v-6h6" /><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" /></svg>)
const Close = ({ s = 18 }) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>)
const Plus = ({ s = 18 }) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>)
const Tg = ({ s = 18 }) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M21.94 4.6l-3.3 15.56c-.25 1.1-.9 1.37-1.82.85l-5.03-3.7-2.43 2.34c-.27.27-.5.5-1 .5l.36-5.1L18 6.78c.4-.36-.09-.56-.62-.2L6.9 13.5l-4.95-1.55c-1.08-.34-1.1-1.08.23-1.6L20.5 3.1c.9-.33 1.69.2 1.44 1.5z" /></svg>)
const Phone = ({ s = 18 }) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.36 1.9.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0122 16.92z" /></svg>)
const Chat = ({ s = 18 }) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" /></svg>)

function loadingMsg() { return 'Loading offers…' }

export default function P2PMarketplace({ connection, publicKey, balance, solBalance, price, toUSD, onBack, showToast, onOpenMessenger }) {
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
    />
  )
}

// ===========================================================================
// Onboarding
// ===========================================================================
function P2POnboarding({ onDone, onBack, showToast }) {
  const [nickname, setNickname] = useState('')
  const [currency, setCurrency] = useState('USD')

  const submit = () => {
    const n = nickname.trim()
    if (!n) { showToast('Please enter a nickname', 'error'); return }
    if (n.length > 32) { showToast('Nickname too long (max 32)', 'error'); return }
    onDone({ nickname: n, currency })
  }

  return (
    <div className="escrow-view p2p-view">
      <div className="view-header">
        <button className="back-btn" onClick={onBack}><Back /> Back</button>
        <h2>P2P Marketplace</h2>
      </div>

      <div className="escrow-info-card">
        <p>Welcome to the <strong>P2P Marketplace</strong>. Pick a display name and the currency
        you want to trade in. You can change both later in this section.</p>
      </div>

      <div className="form-group">
        <label className="form-label">Nickname</label>
        <input className="form-input" value={nickname} maxLength={32}
          onChange={(e) => setNickname(e.target.value)} placeholder="e.g. satoshi" />
      </div>

      <div className="form-group">
        <label className="form-label">Currency</label>
        <select className="form-input p2p-select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
          {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
        </select>
      </div>

      <button className="btn btn-action" onClick={submit}>Continue</button>
    </div>
  )
}

// ===========================================================================
// Main marketplace
// ===========================================================================
function P2PMain({ connection, publicKey, balance, solBalance, price, toUSD, onBack, showToast, profile, onProfileChange, onOpenMessenger }) {
  const { offers, loading, posting, fetchOffers, postOffer, cancelOffer } = useP2P(connection, publicKey)

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

  const onSwap = (info) => {
    if (info?.status === 'swapping') showToast('Topping up SOL…', 'info')
    else if (info?.status === 'swapped') showToast(`Swapped ${formatH173K(info.h173kUsed)} h173k for ${info.solReceived.toFixed(4)} SOL`, 'info')
  }

  const handlePost = async (data) => {
    try {
      const nick = (data.nickname || profile.nickname || '').trim()
      await postOffer({ ...data, nickname: nick, currency }, onSwap)
      if (nick && nick !== profile.nickname) onProfileChange({ ...profile, nickname: nick })
      showToast('Offer posted!', 'success')
      setShowCreate(false)
      reload()
    } catch (err) {
      console.error(err)
      const m = err?.message || 'Failed to post offer'
      showToast(m.includes('locked') ? 'Session expired — unlock wallet' : 'Post failed: ' + m, 'error')
    }
  }

  const handleCancel = async (offer) => {
    try {
      await cancelOffer(offer, onSwap)
      showToast('Offer cancelled', 'success')
      setSelected(null)
      reload()
    } catch (err) {
      showToast('Cancel failed: ' + (err?.message || 'error'), 'error')
    }
  }

  return (
    <div className="escrow-view p2p-view" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      <div className="view-header">
        <button className="back-btn" onClick={onBack}><Back /> Back</button>
        <h2>P2P Marketplace</h2>
      </div>

      {/* ===== Banner ===== */}
      <div className="p2p-banner">
        <div className="p2p-tabs">
          <button className={`p2p-tab ${side === 'buy' ? 'active' : ''}`} onClick={() => { setSide('buy'); setPmFilter('') }}>Buy Offers</button>
          <button className={`p2p-tab ${side === 'sell' ? 'active' : ''}`} onClick={() => { setSide('sell'); setPmFilter('') }}>Sell Offers</button>
        </div>

        <div className="p2p-controls">
          <select className="p2p-mini-select" value={currency} onChange={(e) => changeCurrency(e.target.value)} title="Currency">
            {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code}</option>)}
          </select>

          <select className="p2p-mini-select" value={sort} onChange={(e) => setSort(e.target.value)} title="Order by">
            <option value="price_desc">Price: High → Low</option>
            <option value="price_asc">Price: Low → High</option>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>

          <select className="p2p-mini-select" value={pmFilter} onChange={(e) => setPmFilter(e.target.value)} title="Payment method">
            <option value="">All methods</option>
            {pmOptions.map(m => <option key={m} value={m}>{m}</option>)}
          </select>

          <select className="p2p-mini-select" value={limit} onChange={(e) => changeLimit(Number(e.target.value))} title="Max offers to load">
            {FETCH_LIMIT_OPTIONS.map(n => <option key={n} value={n}>Last {n}</option>)}
          </select>

          <button className="p2p-icon-btn" onClick={handleRefresh} disabled={refreshing} title="Refresh">
            <Refresh />
          </button>
          <button className="p2p-icon-btn" onClick={() => setShowSettings(true)} title="P2P settings">⚙</button>
        </div>

        <button className="btn p2p-create-btn" onClick={() => setShowCreate(true)}>
          <Plus /> Create {side} offer
        </button>
      </div>

      {/* pull to refresh indicator */}
      {(pullProgress > 0 || refreshing) && (
        <div className="pull-refresh-indicator escrow-pull" style={{ opacity: refreshing ? 1 : pullProgress }}>
          {!refreshing && <Refresh s={20} />}
          <span>{refreshing ? 'Refreshing…' : (pullProgress >= 1 ? 'Release to refresh' : 'Pull to refresh')}</span>
        </div>
      )}

      {/* ===== Offer list ===== */}
      {loading && !refreshing ? (
        <div className="loading-spinner-small" />
      ) : visible.length === 0 ? (
        <div className="empty-state">
          <p>No {side} offers in {cur?.code}</p>
          <p className="empty-hint">Be the first — create an offer above</p>
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
          onSave={(p) => { onProfileChange(p); if (p.currency !== currency) changeCurrency(p.currency); setShowSettings(false); showToast('P2P settings saved', 'success') }} />
      )}
    </div>
  )
}

// ===========================================================================
// Offer card
// ===========================================================================
function OfferCard({ offer, cur, price, isMine, onClick }) {
  const sym = cur?.symbol || ''
  const date = offer.createdAt ? new Date(offer.createdAt * 1000) : null
  return (
    <div className="contract-item p2p-card" onClick={onClick}>
      <div className="contract-item-header">
        <span className="contract-name">{offer.nickname || 'anon'} <span className="p2p-card-action">is {offer.type === 'sell' ? 'selling' : 'buying'}</span> {isMine && <span className="p2p-you">you</span>}</span>
        <span className={`contract-status ${offer.type === 'buy' ? 'ongoing' : 'released'}`}>{offer.type.toUpperCase()}</span>
      </div>
      <div className="p2p-card-price">
        <strong>{formatNumber(offer.pricePerUsd, 4)} {cur?.code}</strong>
        <span className="p2p-card-sub"> per $1 in h173k</span>
      </div>
      <div className="p2p-card-row">
        <span>Size</span>
        <span>${formatNumber(offer.minUsd, 2)} – ${formatNumber(offer.maxUsd, 2)} h173k value</span>
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
    if (required == null) { showToast('Price unavailable right now — try again shortly', 'error'); return }
    if (enough) setRevealed(true)
    else showToast(`You need ≈ ${formatH173K(required)} h173k to take this offer`, 'error')
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
          <h3>{viewerAction === 'buy' ? 'Buy' : 'Sell'} h173k · {offer.nickname || 'anon'}</h3>
          <button className="p2p-icon-btn" onClick={onClose}><Close /></button>
        </div>

        <div className="deposit-preview">
          <div className="deposit-row"><span>Price</span><span>{formatNumber(offer.pricePerUsd, 4)} {cur?.code} / $1 h173k</span></div>
          <div className="deposit-row"><span>Size range</span><span>${formatNumber(offer.minUsd, 2)} – ${formatNumber(offer.maxUsd, 2)}</span></div>
        </div>

        {/* ---- Trade calculator ---- */}
        <div className="form-group" style={{ marginTop: 4 }}>
          <label className="form-label">
            {viewerAction === 'buy' ? 'How much do you want to buy? ($ value)' : 'How much do you want to sell? ($ value)'}
          </label>
          <input className="form-input" type="text" inputMode="decimal" value={amount}
            style={amt > 0 && !inRange ? { borderColor: 'var(--color-error)' } : undefined}
            onChange={setAmt} onKeyDown={stepAmt} placeholder={`${formatNumber(offer.minUsd, 2)} – ${formatNumber(offer.maxUsd, 2)}`} />
          {amt > 0 && !inRange && <span className="form-hint" style={{ color: 'var(--color-error)' }}>Outside the offer range (${formatNumber(offer.minUsd, 2)}–${formatNumber(offer.maxUsd, 2)}).</span>}
        </div>

        {calc && (
          <div className="deposit-preview">
            {viewerAction === 'buy' ? (
              <>
                <div className="deposit-row"><span>You receive</span><span><strong>≈ {formatH173K(calc.h173kAmount)} h173k</strong></span></div>
                <div className="deposit-row"><span>You pay</span><span>{formatNumber(calc.fiatAmount, 2)} {cur?.code}</span></div>
                <div className="deposit-row"><span>h173k needed (MAD)</span>
                  <span style={{ color: enoughForAmount === false ? 'var(--color-error)' : undefined }}>
                    ≈ {neededForAmount != null ? formatH173K(neededForAmount) : '—'} h173k
                  </span></div>
              </>
            ) : (
              <>
                <div className="deposit-row"><span>You receive</span><span><strong>{formatNumber(calc.fiatAmount, 2)} {cur?.code}</strong></span></div>
                <div className="deposit-row"><span>You send</span><span>≈ {formatH173K(calc.h173kAmount)} h173k</span></div>
                <div className="deposit-row"><span>h173k needed (MAD)</span>
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
            <p>You (the <strong>seller</strong>) <strong>create</strong> the MAD contract — there you're called the <em>buyer</em>, because in MAD h173k is the currency. You send h173k and lock 2× the size as deposit.</p>
          ) : (
            <p>You (the <strong>buyer</strong>) <strong>accept</strong> the MAD contract — there you're called the <em>seller</em>, because in MAD h173k is the currency. You receive h173k and lock 1× the size as deposit.</p>
          )}
        </div>

        {neededForAmount != null && enoughForAmount === false && (
          <div className="escrow-info-card" style={{ borderColor: 'var(--color-error)' }}>
            <p style={{ color: 'var(--color-error)' }}>⚠ You need ≈ {formatH173K(neededForAmount)} h173k for this amount but have {formatH173K(balance)} h173k.</p>
          </div>
        )}

        {offer.paymentMethods?.length > 0 && (
          <div className="form-group">
            <label className="form-label">Payment methods</label>
            <div className="p2p-chips">{offer.paymentMethods.map((m, i) => <span key={i} className="p2p-chip">{m}</span>)}</div>
          </div>
        )}

        {isMine ? (
          <>
            <div className="escrow-info-card"><p>This is your offer. Cancelling burns {CANCEL_FEE_H173K} h173k.</p></div>
            <button className="btn btn-danger" disabled={posting} onClick={onCancel}>{posting ? 'Cancelling…' : 'Cancel offer'}</button>
          </>
        ) : revealed ? (
          <div className="p2p-contact-box">
            <label className="form-label">{offer.contactType === 'wm' ? 'Wallet messenger address' : 'Contact'}</label>
            <div
              className={`p2p-contact-value ${offer.contactType === 'wm' ? 'p2p-contact-wm' : ''}`}
              onClick={offer.contactType === 'wm' ? openContact : undefined}
              title={offer.contactType === 'wm' ? 'Tap to message in wallet' : undefined}
            >
              <span>{offer.contactType === 'wm' ? offer.posterPubkey : offer.contact}</span>
              <button
                className="p2p-icon-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  const val = offer.contactType === 'wm' ? offer.posterPubkey : offer.contact
                  copyToClipboard(val); showToast('Copied', 'success')
                }}
                title="Copy"
              >⧉</button>
            </div>
            <button className="btn btn-action p2p-tg-btn" onClick={openContact}>
              {offer.contactType === 'ph' ? <><Phone /> Call</>
                : offer.contactType === 'wm' ? <><Chat /> Open in Messenger</>
                : <><Tg /> Open in Telegram</>}
            </button>
            <p className="form-hint">
              {offer.contactType === 'wm'
                ? 'Opens an encrypted chat with the advertiser inside the wallet. Settle via a MAD contract.'
                : 'Settle the trade via a MAD contract in direct chat.'}
            </p>
          </div>
        ) : (
          <>
            <div className="escrow-info-card">
              <p>To take this offer you must be able to open the MAD contract at the min size:
                you need <strong>≈ {required != null ? formatH173K(required) : '—'} h173k</strong>
                {' '}({sendsH173k ? '2× the min size, since you send h173k' : '1× the min size'}).
                Your balance: {formatH173K(balance)} h173k.</p>
            </div>
            <button className="btn btn-action" disabled={!enough} onClick={tryReveal}>
              {enough ? 'Reveal contact' : 'Not enough h173k'}
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
    if (methods.length >= MAX_PAYMENT_METHODS) { alertMsg(`Max ${MAX_PAYMENT_METHODS} payment methods`); return }
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
    if (!nickname.trim()) return alertMsg('Enter a nickname')
    if (!(p > 0)) return alertMsg('Enter a valid price')
    if (!(mn > 0)) return alertMsg('Enter a valid minimum size')
    if (!(mx >= mn)) return alertMsg('Max size must be ≥ min size')
    if (methods.length === 0) return alertMsg('Add at least one payment method')
    if (contactType !== 'wm' && !contact.trim()) return alertMsg('Enter your contact')
    onSubmit({ nickname: nickname.trim(), type, pricePerUsd: p, minUsd: mn, maxUsd: mx, paymentMethods: methods, contactType, contact: contactType === 'wm' ? '' : contact.trim() })
  }

  return (
    <div className="p2p-modal-overlay" onClick={onClose}>
      <div className="p2p-modal" onClick={(e) => e.stopPropagation()}>
        <div className="p2p-modal-head">
          <h3>Create offer</h3>
          <button className="p2p-icon-btn" onClick={onClose}><Close /></button>
        </div>

        <div className="p2p-type-toggle">
          <button className={`p2p-tab ${type === 'buy' ? 'active' : ''}`} onClick={() => setType('buy')}>Buy h173k</button>
          <button className={`p2p-tab ${type === 'sell' ? 'active' : ''}`} onClick={() => setType('sell')}>Sell h173k</button>
        </div>

        <div className="form-group">
          <label className="form-label">Nickname (shown on your offer)</label>
          <input className="form-input" maxLength={32} value={nickname}
            style={submitted && !nickname.trim() ? { borderColor: 'var(--color-error)' } : undefined}
            onChange={(e) => setNickname(e.target.value)} placeholder="e.g. satoshi" />
        </div>

        <div className="form-group">
          <label className="form-label">Price — {cur?.code} per $1 of h173k value</label>
          <input className="form-input" type="number" inputMode="decimal" min="0" step="any" value={pricePerUsd}
            style={errStyle(priceErr)}
            onKeyDown={blockMinus} onChange={setNum(setPrice)} placeholder={`Price in ${cur?.code}`} />
          {type === 'sell' ? (
            // creator sends h173k and receives fiat → show fiat received
            <span className="form-hint">
              You send h173k and receive {cur?.code}: $1 in h173k → {pricePerUsd ? formatNumber(parseFloat(pricePerUsd), 4) : '…'} {cur?.code}
              {' '}· $10 → {pricePerUsd ? formatNumber(parseFloat(pricePerUsd) * 10, 2) : '…'} {cur?.code}
            </span>
          ) : (
            // creator pays fiat and receives h173k → show h173k received
            <span className="form-hint">
              You pay {cur?.code} and receive h173k: $1 → ≈ {oneUsdH173k != null ? `${formatH173K(oneUsdH173k)} h173k` : '… h173k'}
              {' '}· $10 → ≈ {oneUsdH173k != null ? `${formatH173K(oneUsdH173k * 10)} h173k` : '… h173k'}
            </span>
          )}
        </div>

        <div className="p2p-row2">
          <div className="form-group">
            <label className="form-label">Min size ($ value)</label>
            <input className="form-input" type="number" inputMode="decimal" min="0" step="any" value={minUsd}
              style={errStyle(minErr)}
              onKeyDown={blockMinus} onChange={setNum(setMin)} placeholder="e.g. 5" />
          </div>
          <div className="form-group">
            <label className="form-label">Max size ($ value)</label>
            <input className="form-input" type="number" inputMode="decimal" min="0" step="any" value={maxUsd}
              style={errStyle(maxErr)}
              onKeyDown={blockMinus} onChange={setNum(setMax)} placeholder="e.g. 100" />
          </div>
        </div>

        {sizeInvalid && (
          <div className="escrow-info-card" style={{ borderColor: 'var(--color-error)' }}>
            <p style={{ color: 'var(--color-error)' }}>⚠ Max size must be greater than or equal to min size.</p>
          </div>
        )}

        {/* h173k requirement + balance check for the chosen min size */}
        {mn > 0 && (
          requiredPost == null ? (
            <div className="escrow-info-card"><p>Pool price unavailable — can't check your h173k requirement right now.</p></div>
          ) : (
            <div className="escrow-info-card" style={{ borderColor: enoughForPost ? 'var(--color-white-10)' : 'var(--color-error)' }}>
              <p style={{ color: enoughForPost ? 'var(--color-white-70)' : 'var(--color-error)' }}>
                {enoughForPost ? '✓ ' : '⚠ '}
                To back the min size (${formatNumber(mn, 2)}) you need ≈ <strong>{formatH173K(requiredPost)} h173k</strong>
                {' '}({type === 'sell' ? '2× — you pay in h173k' : '1× — you receive h173k'}).
                {' '}You have {formatH173K(balance)} h173k.
                {!enoughForPost && ' Not enough to fulfil this offer.'}
              </p>
            </div>
          )
        )}

        <div className="form-group">
          <label className="form-label">Payment methods · {methods.length}/{MAX_PAYMENT_METHODS}</label>
          <div className="input-with-action">
            <input className="form-input" value={pmInput} maxLength={MAX_METHOD_LEN}
              disabled={methods.length >= MAX_PAYMENT_METHODS}
              onChange={(e) => setPmInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addMethod() } }}
              placeholder={methods.length >= MAX_PAYMENT_METHODS ? 'Limit reached' : 'e.g. Revolut, Wise, Skrill'} />
            <button className="input-action-btn" onClick={addMethod} disabled={methods.length >= MAX_PAYMENT_METHODS}><Plus /></button>
          </div>
          <span className="form-hint">Up to {MAX_PAYMENT_METHODS} methods, {MAX_METHOD_LEN} characters each.</span>
          {methods.length > 0 && (
            <div className="p2p-chips" style={{ marginTop: 10 }}>
              {methods.map((m, i) => (
                <span key={i} className="p2p-chip removable" onClick={() => setMethods(methods.filter((_, j) => j !== i))}>{m} ✕</span>
              ))}
            </div>
          )}
        </div>

        <div className="form-group">
          <label className="form-label">Contact type</label>
          <div className="p2p-type-toggle">
            <button className={`p2p-tab ${contactType === 'tg' ? 'active' : ''}`} onClick={() => setContactType('tg')}>Telegram</button>
            <button className={`p2p-tab ${contactType === 'ph' ? 'active' : ''}`} onClick={() => setContactType('ph')}>Phone</button>
            <button className={`p2p-tab ${contactType === 'wm' ? 'active' : ''}`} onClick={() => setContactType('wm')}>Messenger</button>
          </div>
        </div>

        {contactType === 'wm' ? (
          <div className="form-group">
            <label className="form-label">Wallet messenger</label>
            <div className="escrow-info-card">
              <p>Takers will see your <strong>wallet address</strong> and can open an encrypted in-wallet chat with you. No handle or phone number is exposed.</p>
            </div>
          </div>
        ) : (
          <div className="form-group">
            <label className="form-label">{contactType === 'tg' ? 'Telegram handle' : 'Phone number'}</label>
            <input className="form-input" value={contact} maxLength={32} onChange={(e) => setContact(e.target.value)}
              placeholder={contactType === 'tg' ? '@username' : '+001234567'} />
            <span className="form-hint">⚠ Stored publicly on-chain. Choose what you're comfortable exposing.</span>
          </div>
        )}

        {err && <div className="escrow-info-card" style={{ borderColor: 'var(--color-error)' }}><p style={{ color: 'var(--color-error)' }}>{err}</p></div>}

        <div className="escrow-info-card"><p>Posting burns {POST_FEE_H173K} h173k + network fee. First offer in a currency also creates its account (~0.002 SOL rent). Your SOL: {formatNumber(solBalance, 4)}.</p></div>

        <button className="btn btn-action" disabled={posting || sizeInvalid} onClick={validateAndSubmit}>{posting ? 'Posting…' : 'Post offer'}</button>
      </div>
    </div>
  )
}

// ===========================================================================
// In-section P2P settings (nickname + currency)
// ===========================================================================
function P2PSettingsModal({ profile, onClose, onSave }) {
  const [nickname, setNickname] = useState(profile.nickname)
  const [currency, setCurrency] = useState(profile.currency)
  return (
    <div className="p2p-modal-overlay" onClick={onClose}>
      <div className="p2p-modal" onClick={(e) => e.stopPropagation()}>
        <div className="p2p-modal-head">
          <h3>P2P settings</h3>
          <button className="p2p-icon-btn" onClick={onClose}><Close /></button>
        </div>
        <div className="form-group">
          <label className="form-label">Nickname</label>
          <input className="form-input" maxLength={32} value={nickname} onChange={(e) => setNickname(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Currency</label>
          <select className="form-input p2p-select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
          </select>
        </div>
        <button className="btn btn-action" onClick={() => {
          const n = nickname.trim(); if (!n) return
          onSave({ ...profile, nickname: n, currency })
        }}>Save</button>
      </div>
    </div>
  )
}
