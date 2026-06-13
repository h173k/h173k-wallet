/**
 * H173K Wallet — Lottery screen (Win h173k)
 *
 * Zawiera: bęben (slot reel) z logo h173k między emoji, wybór trybu (swipe),
 * swipe-to-spin, prompt powitalny, potwierdzenie kosztu, panel informacyjny
 * z uczciwym porównaniem szans/wypłat oraz panel wygranej.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useTranslation } from '../i18n'
import { sessionWallet } from '../crypto/wallet'
import { useLottery } from '../hooks/useLottery'
import {
  LOTTERY_MODES,
  LOTTERY_DEFAULT_MODE_INDEX,
  LOTTERY_HOUSE_EDGE,
  LOTTERY_MAX_PRIZE_H173K,
  getLotterySkipCostConfirm,
  saveLotterySkipCostConfirm,
  getLotteryIntroAck,
  saveLotteryIntroAck,
} from '../constants'
import { formatSmartNumber, shortenAddress } from '../utils'

// ── Reel symbols ──────────────────────────────────────────────────────────────
const LOGO = '__LOGO__'
const SYMBOLS = ['🍒', '🍋', '🔔', '💎', '7️⃣', '⭐', LOGO, '🍀', '🪙', '🎰']
const LOGO_INDEX = SYMBOLS.indexOf(LOGO)
const CELL = 72                 // szerokość przegródki (px) — równa --cell w CSS
const VISIBLE = 5               // widoczne przegródki (nieparzysta → środek = wynik)
const CENTER_SLOT = 2           // indeks środkowej przegródki (0-based)
const STRIP = SYMBOLS.length * CELL

// Uczciwe porównania szans (stosunek prawdopodobieństw — matematycznie dokładne).
// Wartości względem: Powerball 1:292,201,338 · Lotto PL 6/49 1:13,983,816 · top zdrapki 1:500,000.
const ODDS_FACTS = {
  1: { powerball: '29 200 000', lotto: '1 400 000', scratch: '50 000' },
  2: { powerball: '2 900 000', lotto: '140 000', scratch: '5 000' },
  3: { powerball: '292 000', lotto: '14 000', scratch: '500' },
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3)
}

// ── Ikony (lokalne, samowystarczalne) ────────────────────────────────────────
function BackIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
    </svg>
  )
}
function ChevronLeft({ size = 22 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
}
function ChevronRight({ size = 22 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
}
function ArrowRight({ size = 22 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
}
function TrophyIcon({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z" />
      <path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3" />
    </svg>
  )
}

// ── Reel cell ─────────────────────────────────────────────────────────────────
function ReelCell({ sym }) {
  return (
    <div className="reel-cell">
      {sym === LOGO
        ? <img src="/logo.png" alt="h173k" className="reel-logo" />
        : <span className="reel-emoji">{sym}</span>}
    </div>
  )
}

// ============================================================================
// Component
// ============================================================================
export default function LotteryView({ connection, publicKey, onBack, showToast, onRefresh, h173kDecimals }) {
  const { t } = useTranslation()
  const lottery = useLottery(connection, sessionWallet)

  // ── State ───────────────────────────────────────────────────────────────────
  const [modeIdx, setModeIdx] = useState(LOTTERY_DEFAULT_MODE_INDEX)
  const [spinning, setSpinning] = useState(false)
  const [stage, setStage] = useState(null) // 'commit' | 'waiting' | 'reveal'
  const [win, setWin] = useState(null) // { prize }
  const [reelWin, setReelWin] = useState(false)
  const [lastWinner, setLastWinner] = useState(undefined) // undefined=loading, null=none
  const [solCost, setSolCost] = useState(null) // szacowany koszt spinu w SOL

  const [showIntro, setShowIntro] = useState(!getLotteryIntroAck())
  const [introAck, setIntroAck] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const [showCost, setShowCost] = useState(false)
  const [dontShowCost, setDontShowCost] = useState(false)

  const mode = LOTTERY_MODES[modeIdx]

  // ── Reel animation (rAF-driven offset) ──────────────────────────────────────
  const stripRef = useRef(null)
  const offsetRef = useRef(0)
  const rafRef = useRef(0)
  const spinningRef = useRef(false)

  const applyTransform = () => {
    if (stripRef.current) {
      const x = -(offsetRef.current % STRIP)
      stripRef.current.style.transform = `translateX(${x}px)`
    }
  }

  const freeSpin = useCallback(() => {
    // wolny, ciągły obrót w trakcie oczekiwania na wynik on-chain
    offsetRef.current += 9
    applyTransform()
    rafRef.current = requestAnimationFrame(freeSpin)
  }, [])

  const startReel = useCallback(() => {
    spinningRef.current = true
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(freeSpin)
  }, [freeSpin])

  // zatrzymanie na docelowym symbolu (logo przy wygranej, losowy emoji przy przegranej)
  const stopReel = useCallback((didWin) => {
    return new Promise((resolve) => {
      cancelAnimationFrame(rafRef.current)
      spinningRef.current = false

      let targetIndex
      if (didWin) {
        targetIndex = LOGO_INDEX
      } else {
        // dowolny symbol poza logo
        do { targetIndex = Math.floor(Math.random() * SYMBOLS.length) } while (targetIndex === LOGO_INDEX)
      }
      // offset, przy którym targetIndex ląduje w środkowej przegródce
      const desired = ((targetIndex - CENTER_SLOT + SYMBOLS.length) % SYMBOLS.length) * CELL
      const start = offsetRef.current
      const minAhead = start + STRIP * 1.5
      const k = Math.ceil((minAhead - desired) / STRIP)
      const target = desired + k * STRIP

      const dur = 3300
      const t0 = performance.now()
      const animate = (now) => {
        const p = Math.min(1, (now - t0) / dur)
        offsetRef.current = start + (target - start) * easeOutCubic(p)
        applyTransform()
        if (p < 1) {
          rafRef.current = requestAnimationFrame(animate)
        } else {
          offsetRef.current = target % STRIP
          applyTransform()
          resolve()
        }
      }
      rafRef.current = requestAnimationFrame(animate)
    })
  }, [])

  useEffect(() => {
    applyTransform()
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  // ── Last winner (bounded scan) ──────────────────────────────────────────────
  const { configured: lotteryConfigured, getLastWinner } = lottery
  const refreshLastWinner = useCallback(async () => {
    if (!lotteryConfigured) { setLastWinner(null); return }
    setLastWinner(undefined)
    try {
      const w = await getLastWinner()
      setLastWinner(w || null)
    } catch {
      setLastWinner(null)
    }
  }, [lotteryConfigured, getLastWinner])

  useEffect(() => { refreshLastWinner() }, [refreshLastWinner])

  // ── Szacowany koszt spinu w SOL (rent biletu + opłaty) ──────────────────────
  const { estimateSpinSolCost } = lottery
  useEffect(() => {
    let alive = true
    estimateSpinSolCost().then((v) => { if (alive) setSolCost(v) }).catch(() => {})
    return () => { alive = false }
  }, [estimateSpinSolCost])

  // ── Mode swipe ──────────────────────────────────────────────────────────────
  const touchX = useRef(null)
  const onModeTouchStart = (e) => { touchX.current = e.touches[0].clientX }
  const onModeTouchEnd = (e) => {
    if (touchX.current == null || spinning) return
    const dx = e.changedTouches[0].clientX - touchX.current
    if (dx <= -40) setModeIdx((i) => Math.min(LOTTERY_MODES.length - 1, i + 1))
    else if (dx >= 40) setModeIdx((i) => Math.max(0, i - 1))
    touchX.current = null
  }

  // ── Spin flow ───────────────────────────────────────────────────────────────
  const runSpin = useCallback(async () => {
    if (spinning) return
    if (!lottery.configured) {
      showToast(t('lottery.notDeployed'), 'error')
      return
    }
    setWin(null)
    setReelWin(false)
    setSpinning(true)
    setStage('commit')
    startReel()

    try {
      const result = await lottery.play(mode, {
        onStage: (s) => setStage(s),
        onSwap: (info) => {
          if (info?.status === 'swapped') {
            showToast(t('lottery.solReplenished'), 'info')
            if (onRefresh) onRefresh()
          }
        },
      })

      await stopReel(result.won)

      if (result.won) {
        setReelWin(true)
        setWin({ prize: result.prize })
      } else {
        showToast(t('lottery.noWin'), 'info')
      }
      if (onRefresh) onRefresh()
      refreshLastWinner()
    } catch (err) {
      const msg = String(err?.message || err)
      if (msg.includes('SPIN_NOT_PLACED')) {
        // opłata nie została pobrana — potraktuj jak zwykły brak wygranej
        await stopReel(false)
        showToast(t('lottery.noWin'), 'info')
      } else {
        cancelAnimationFrame(rafRef.current)
        spinningRef.current = false
        if (msg.includes('Wallet is locked')) showToast(t('common.sessionExpired'), 'error')
        else if (msg.includes('LOTTERY_NOT_CONFIGURED')) showToast(t('lottery.notDeployed'), 'error')
        else showToast(t('lottery.spinFailed', { msg }), 'error')
      }
    } finally {
      setSpinning(false)
      setStage(null)
    }
  }, [spinning, lottery, mode, startReel, stopReel, showToast, t, onRefresh, refreshLastWinner])

  // wywoływane po przesunięciu suwaka „spin"
  const onSpinTriggered = useCallback(() => {
    if (spinning) return
    if (!lottery.configured) {
      showToast(t('lottery.notDeployed'), 'error')
      return
    }
    if (getLotterySkipCostConfirm()) {
      runSpin()
    } else {
      setDontShowCost(false)
      setShowCost(true)
    }
  }, [spinning, lottery.configured, runSpin, showToast, t])

  const confirmCost = () => {
    if (dontShowCost) saveLotterySkipCostConfirm(true)
    setShowCost(false)
    runSpin()
  }

  const confirmIntro = () => {
    saveLotteryIntroAck(true)
    setShowIntro(false)
  }

  // ── Stage label ─────────────────────────────────────────────────────────────
  const stageLabel = stage === 'commit'
    ? t('lottery.stageCommit')
    : stage === 'waiting'
      ? t('lottery.stageWaiting')
      : stage === 'reveal'
        ? t('lottery.stageReveal')
        : ''

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="lottery-view">
      <div className="view-header">
        <button className="back-btn" onClick={onBack}><BackIcon size={16} /> {t('common.back')}</button>
        <h2>{t('lottery.title')}</h2>
      </div>

      <div className="lottery-body">

      {/* Logo h173k (wyżej) */}
      <div className="lottery-logo"><img src="/logo.png" alt="h173k" /></div>

      {/* Duża nazwa trybu nad bębnem (przesuwa się jak picker) */}
      <div className="reel-group">
        <div className="chance-label">{t('lottery.chanceLabel')}</div>
        <div className="mode-name-window" onTouchStart={onModeTouchStart} onTouchEnd={onModeTouchEnd}>
          <div className="mode-name-track" style={{ transform: `translateX(${-modeIdx * 100}%)` }}>
            {LOTTERY_MODES.map((m, i) => (
              <div key={m.mode} className={`mode-name-slide${i === modeIdx ? ' active' : ''}`}>
                {t(`lottery.mode_${m.key}`)}
              </div>
            ))}
          </div>
        </div>

        {/* Bęben (poziomy) */}
        <div className="reel-wrap">
          <div className={`reel-window${reelWin ? ' win' : ''}`}>
            <div className="reel-strip" ref={stripRef}>
              {/* dwie kopie symboli dla płynnego zawijania */}
              {[...SYMBOLS, ...SYMBOLS].map((s, i) => <ReelCell key={i} sym={s} />)}
            </div>
            {/* krawędziowy blur: wlot (prawa) / wylot (lewa) */}
            <div className="reel-fade left" />
            <div className="reel-fade right" />
            {/* ramka centralnej przegródki wyniku */}
            <div className="reel-center" />
          </div>
        </div>
      </div>

      {/* Ostatni zwycięzca */}
      <div className="last-winner">
        {lastWinner === undefined ? (
          <span className="lw-empty">{t('lottery.lastWinnerLoading')}</span>
        ) : lastWinner ? (
          <>
            <div>
              {t('lottery.lastWinner')}{' '}
              <span className="lw-addr">{shortenAddress(lastWinner.winner)}</span>
            </div>
            <div>
              <span className="lw-amt">{formatSmartNumber(lastWinner.amount)} h173k</span>
              {lastWinner.time ? ` · ${new Date(lastWinner.time).toLocaleString()}` : ''}
            </div>
          </>
        ) : (
          <span className="lw-empty">{t('lottery.noWinnerYet')}</span>
        )}
      </div>

      {/* Wybór trybu (swipe) */}
      <div className="mode-section">
        <div className="mode-dots">
          {LOTTERY_MODES.map((_, i) => <span key={i} className={`mode-dot${i === modeIdx ? ' on' : ''}`} />)}
        </div>
        <div className="mode-picker" onTouchStart={onModeTouchStart} onTouchEnd={onModeTouchEnd}>
          <div className="mode-track" style={{ transform: `translateX(${-modeIdx * 100}%)` }}>
            {LOTTERY_MODES.map((m, i) => (
              <div key={m.mode} className={`mode-slide${i === modeIdx ? ' active' : ''}`}>
                <div className="mode-odds">1:{m.oneIn}</div>
                <div className="mode-cost">{t('lottery.cost')}: {formatSmartNumber(m.feeH173k)} h173k</div>
              </div>
            ))}
          </div>
          <div className="mode-arrows">
            <button className="mode-arrow" onClick={() => setModeIdx((i) => Math.max(0, i - 1))} disabled={modeIdx === 0 || spinning}><ChevronLeft /></button>
            <button className="mode-arrow" onClick={() => setModeIdx((i) => Math.min(LOTTERY_MODES.length - 1, i + 1))} disabled={modeIdx === LOTTERY_MODES.length - 1 || spinning}><ChevronRight /></button>
          </div>
        </div>

        <button className="mode-info-btn" onClick={() => setShowInfo(true)}>{t('lottery.whatIsThis')}</button>
      </div>

      </div>{/* /lottery-body */}

      {/* Swipe to spin — przyklejone do dołu ekranu */}
      <div className="spin-zone">
        <SpinSlider disabled={spinning} onTrigger={onSpinTriggered} label={t('lottery.spin')} />
        <div className="spin-hint">{spinning ? stageLabel : ''}</div>
      </div>

      {/* ── Modale ── */}
      {showIntro && (
        <div className="lottery-modal-overlay">
          <div className="lottery-modal">
            <h3>{t('lottery.introTitle')}</h3>
            <p>{t('lottery.introBody1')}</p>
            <p>{t('lottery.introBody2')}</p>
            <p className="muted">{t('lottery.introBody3')}</p>
            <label className="modal-check">
              <input type="checkbox" checked={introAck} onChange={(e) => setIntroAck(e.target.checked)} />
              {t('lottery.introConfirm')}
            </label>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={onBack}>{t('common.back')}</button>
              <button className="btn btn-action" disabled={!introAck} onClick={confirmIntro}>{t('lottery.introOk')}</button>
            </div>
          </div>
        </div>
      )}

      {showInfo && (
        <div className="lottery-modal-overlay" onClick={() => setShowInfo(false)}>
          <div className="lottery-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t('lottery.infoTitle')}</h3>
            <p>{t('lottery.infoNaming')}</p>

            <table className="odds-table">
              <thead>
                <tr>
                  <th>{t('lottery.colMode')}</th>
                  <th className="num">{t('lottery.colOdds')}</th>
                  <th className="num">{t('lottery.colCost')}</th>
                  <th className="num">{t('lottery.colPrize')}</th>
                </tr>
              </thead>
              <tbody>
                {LOTTERY_MODES.map((m) => (
                  <tr key={m.mode}>
                    <td>{t(`lottery.mode_${m.key}`)}</td>
                    <td className="num">1:{m.oneIn}</td>
                    <td className="num">{formatSmartNumber(m.feeH173k)}</td>
                    <td className="num">≤ {LOTTERY_MAX_PRIZE_H173K}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p className="muted">{t('lottery.infoOddsLead')}</p>
            {LOTTERY_MODES.map((m) => {
              const f = ODDS_FACTS[m.mode]
              return (
                <div className="fact-block" key={m.mode}>
                  <div className="fact-mode">{t(`lottery.mode_${m.key}`)} · 1:{m.oneIn}</div>
                  <ul>
                    <li>{t('lottery.vsPowerball', { n: f.powerball })}</li>
                    <li>{t('lottery.vsLotto', { n: f.lotto })}</li>
                    <li>{t('lottery.vsScratch', { n: f.scratch })}</li>
                  </ul>
                </div>
              )
            })}

            <div className="honest-note">
              {t('lottery.infoHonest', {
                edge: Math.round(LOTTERY_HOUSE_EDGE * 100),
                rtp: Math.round((1 - LOTTERY_HOUSE_EDGE) * 100),
                prize: LOTTERY_MAX_PRIZE_H173K,
              })}
            </div>

            <div className="modal-actions">
              <button className="btn btn-action" onClick={() => setShowInfo(false)}>{t('common.done')}</button>
            </div>
          </div>
        </div>
      )}

      {showCost && (
        <div className="lottery-modal-overlay">
          <div className="lottery-modal center">
            <h3>{t('lottery.costTitle')}</h3>
            <p>{t('lottery.costBody', { amount: formatSmartNumber(mode.feeH173k), mode: t(`lottery.mode_${mode.key}`) })}</p>
            <p className="muted">{t('lottery.costSol', { sol: solCost != null ? solCost.toFixed(4) : '~0.0019' })}</p>
            <label className="modal-check" style={{ justifyContent: 'center' }}>
              <input type="checkbox" checked={dontShowCost} onChange={(e) => setDontShowCost(e.target.checked)} />
              {t('lottery.dontShowAgain')}
            </label>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowCost(false)}>{t('common.cancel')}</button>
              <button className="btn btn-action" onClick={confirmCost}>{t('lottery.iAgree')}</button>
            </div>
          </div>
        </div>
      )}

      {win && (
        <div className="lottery-modal-overlay" onClick={() => setWin(null)}>
          <div className="lottery-modal center" onClick={(e) => e.stopPropagation()}>
            <div className="win-trophy"><TrophyIcon size={42} /></div>
            <h3>{t('lottery.winTitle')}</h3>
            <div className="win-amount">+{formatSmartNumber(win.prize)} h173k</div>
            <div className="win-sub">{t('lottery.winSub')}</div>
            <div className="modal-actions">
              <button className="btn btn-action" onClick={() => setWin(null)}>{t('common.done')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Swipe-to-spin slider ──────────────────────────────────────────────────────
function SpinSlider({ disabled, onTrigger, label }) {
  const trackRef = useRef(null)
  const thumbRef = useRef(null)
  const [x, setX] = useState(0)
  const [snap, setSnap] = useState(false)
  const dragging = useRef(false)
  const maxRef = useRef(0)

  const getMax = () => {
    const tw = trackRef.current?.offsetWidth || 0
    return Math.max(0, tw - 60) // szerokość thumb + margines
  }

  const onDown = (e) => {
    if (disabled) return
    dragging.current = true
    setSnap(false)
    maxRef.current = getMax()
    if (thumbRef.current?.setPointerCapture && e.pointerId != null) {
      try { thumbRef.current.setPointerCapture(e.pointerId) } catch {}
    }
  }
  const onMove = (e) => {
    if (!dragging.current || disabled) return
    const rect = trackRef.current.getBoundingClientRect()
    const clientX = e.clientX ?? (e.touches && e.touches[0]?.clientX) ?? 0
    let nx = clientX - rect.left - 30
    nx = Math.max(0, Math.min(maxRef.current, nx))
    setX(nx)
  }
  const onUp = () => {
    if (!dragging.current) return
    dragging.current = false
    const max = maxRef.current || getMax()
    if (max > 0 && x >= max * 0.72) {
      // próg osiągnięty → odpal i zresetuj
      setSnap(true)
      setX(0)
      onTrigger()
    } else {
      setSnap(true)
      setX(0)
    }
  }

  // reset gdy zmienia się disabled (np. po zakończeniu spinu)
  useEffect(() => { setSnap(true); setX(0) }, [disabled])

  const fillW = x + 56

  return (
    <div
      ref={trackRef}
      className={`spin-track${disabled ? ' disabled' : ''}`}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerLeave={onUp}
    >
      <div className="spin-fill" style={{ width: `${fillW}px` }} />
      <div className="spin-label">{label}</div>
      <div
        ref={thumbRef}
        className={`spin-thumb${snap ? ' snap' : ''}`}
        style={{ left: `${4 + x}px` }}
        onPointerDown={onDown}
      >
        <ArrowRight size={22} />
      </div>
    </div>
  )
}
