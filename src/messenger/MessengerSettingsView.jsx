/**
 * h173k Wallet - Messenger settings.
 *
 * Every messenger option lives here rather than in the wallet's global
 * settings: the fee charged for incoming messages, group defaults, the chat
 * list ordering, how much history each refresh reads, and the compatibility
 * switch for conversations on the wallet address.
 */

import React, { useState } from 'react'
import { useTranslation } from '../i18n'
import { BackIcon, CoinIcon } from './icons'
import {
  FEE_MODES,
  getFeePolicy,
  saveFeePolicy,
  setContactFee,
  sanitizeFee,
  getSortMode,
  setSortMode,
  SORT_MODES,
  getMessengerScanLimit,
  setMessengerScanLimit,
  MESSENGER_SCAN_OPTIONS,
  getSourcesPerRefresh,
  setSourcesPerRefresh,
  SOURCES_PER_REFRESH_OPTIONS,
  getNotificationsEnabled,
  setNotificationsEnabled,
  getLegacyModeEnabled,
  setLegacyModeEnabled,
  getGroupDefaults,
  saveGroupDefaults,
} from './prefs'
import { store } from './messenger'

function shortAddr(a) {
  if (!a) return ''
  return a.slice(0, 4) + '…' + a.slice(-4)
}

export default function MessengerSettingsView({ onBack, showToast }) {
  const { t } = useTranslation()

  const [policy, setPolicy] = useState(() => getFeePolicy())
  const [amountText, setAmountText] = useState(() => String(getFeePolicy().amount || 0))
  const [sort, setSort] = useState(() => getSortMode())
  const [scanLimit, setScanLimit] = useState(() => getMessengerScanLimit())
  const [sources, setSources] = useState(() => getSourcesPerRefresh())
  const [notif, setNotif] = useState(() => getNotificationsEnabled())
  const [legacy, setLegacy] = useState(() => getLegacyModeEnabled())
  const [groupDefaults, setGroupDefaults] = useState(() => getGroupDefaults())
  const [contactEdit, setContactEdit] = useState(null) // { address, value }

  const threads = store.getVisibleThreads()

  // ----- fee mode -----
  const chooseMode = (mode) => {
    const next = saveFeePolicy({ ...policy, mode })
    setPolicy(next)
    setAmountText(String(next.amount || 0))
  }

  const commitAmount = () => {
    const value = sanitizeFee(amountText.replace(',', '.'))
    const next = saveFeePolicy({ ...policy, amount: value })
    setPolicy(next)
    setAmountText(String(value))
    showToast(value > 0
      ? t('messengerSettings.feeSaved', { n: value })
      : t('messengerSettings.feeCleared'), 'success')
  }

  const saveContactFee = () => {
    if (!contactEdit) return
    const raw = String(contactEdit.value).trim()
    const next = raw === ''
      ? setContactFee(contactEdit.address, null)
      : setContactFee(contactEdit.address, sanitizeFee(raw.replace(',', '.')))
    setPolicy(next)
    setContactEdit(null)
    showToast(t('messengerSettings.contactFeeSaved'), 'success')
  }

  const toggleNotif = async () => {
    if (!notif) {
      if (typeof Notification === 'undefined') {
        showToast(t('notifications.notSupported'), 'error')
        return
      }
      let perm = Notification.permission
      if (perm === 'default') {
        try { perm = await Notification.requestPermission() } catch { perm = 'denied' }
      }
      if (perm !== 'granted') {
        showToast(t('notifications.permissionDenied'), 'error')
        return
      }
      setNotificationsEnabled(true); setNotif(true)
      showToast(t('notifications.msgEnabled'), 'success')
    } else {
      setNotificationsEnabled(false); setNotif(false)
      showToast(t('notifications.msgDisabled'), 'info')
    }
  }

  const saveDefaults = (patch) => {
    const next = { ...groupDefaults, ...patch }
    setGroupDefaults(next)
    saveGroupDefaults(next)
  }

  const feeApplies = policy.mode !== 'off' && policy.mode !== 'selected'

  return (
    <div className="messenger-view messenger-settings-view">
      <div className="view-header">
        <button className="back-btn" onClick={onBack}><BackIcon size={16} /> {t('common.back')}</button>
        <h2>{t('messengerSettings.title')}</h2>
      </div>

      <div className="messenger-settings-body">

        {/* ===== Anti-spam fee ===== */}
        <div className="msg-settings-section">
          <h3><CoinIcon size={15} /> {t('messengerSettings.feeTitle')}</h3>
          <p className="msg-settings-desc">{t('messengerSettings.feeDesc')}</p>

          <div className="msg-option-grid">
            {FEE_MODES.map((mode) => (
              <button
                key={mode}
                className={`msg-option ${policy.mode === mode ? 'active' : ''}`}
                onClick={() => chooseMode(mode)}
              >
                {t(`messengerSettings.feeMode.${mode}`)}
              </button>
            ))}
          </div>
          <p className="msg-settings-hint">{t(`messengerSettings.feeModeHint.${policy.mode}`)}</p>

          {feeApplies && (
            <>
              <label className="msg-field-label">{t('messengerSettings.feeAmount')}</label>
              <div className="msg-inline-field">
                <input
                  className="messenger-input"
                  type="text"
                  inputMode="decimal"
                  value={amountText}
                  placeholder="0"
                  onChange={(e) => setAmountText(e.target.value.replace(/[^\d.,]/g, ''))}
                  onBlur={commitAmount}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                />
                <span className="msg-unit">h173k</span>
              </div>
              <p className="msg-settings-hint">{t('messengerSettings.feeZeroHint')}</p>
            </>
          )}

          <div className="msg-note">{t('messengerSettings.feeHandshakeNote')}</div>
        </div>

        {/* ===== Per-contact fees ===== */}
        <div className="msg-settings-section">
          <h3>{t('messengerSettings.perContactTitle')}</h3>
          <p className="msg-settings-desc">{t('messengerSettings.perContactDesc')}</p>
          {threads.length === 0 && (
            <p className="msg-settings-hint">{t('messengerSettings.noContacts')}</p>
          )}
          {threads.map((th) => {
            const override = Object.prototype.hasOwnProperty.call(policy.perContact, th.address)
              ? policy.perContact[th.address]
              : null
            const name = (th.contactName && th.contactName.trim()) || th.peerNick || shortAddr(th.address)
            return (
              <div key={th.address} className="msg-contact-row">
                <div className="msg-contact-name">
                  <span>{name}</span>
                  <span className="msg-contact-addr">{shortAddr(th.address)}</span>
                </div>
                <button
                  className={`msg-contact-fee ${override != null ? 'set' : ''}`}
                  onClick={() => setContactEdit({ address: th.address, value: override != null ? String(override) : '' })}
                >
                  {override != null ? `${override} h173k` : t('messengerSettings.defaultFee')}
                </button>
              </div>
            )
          })}
        </div>

        {/* ===== Group defaults ===== */}
        <div className="msg-settings-section">
          <h3>{t('messengerSettings.groupDefaultsTitle')}</h3>
          <p className="msg-settings-desc">{t('messengerSettings.groupDefaultsDesc')}</p>

          <label className="msg-field-label">{t('groups.minBalance')}</label>
          <div className="msg-inline-field">
            <input
              className="messenger-input"
              type="text"
              inputMode="decimal"
              value={String(groupDefaults.minBalance)}
              onChange={(e) => setGroupDefaults({ ...groupDefaults, minBalance: e.target.value.replace(/[^\d.,]/g, '') })}
              onBlur={(e) => saveDefaults({ minBalance: sanitizeFee(String(e.target.value).replace(',', '.')) })}
            />
            <span className="msg-unit">h173k</span>
          </div>

          <label className="msg-field-label">{t('groups.msgCost')}</label>
          <div className="msg-inline-field">
            <input
              className="messenger-input"
              type="text"
              inputMode="decimal"
              value={String(groupDefaults.msgCost)}
              onChange={(e) => setGroupDefaults({ ...groupDefaults, msgCost: e.target.value.replace(/[^\d.,]/g, '') })}
              onBlur={(e) => saveDefaults({ msgCost: sanitizeFee(String(e.target.value).replace(',', '.')) })}
            />
            <span className="msg-unit">h173k</span>
          </div>
        </div>

        {/* ===== Chat list ordering ===== */}
        <div className="msg-settings-section">
          <h3>{t('messengerSettings.sortTitle')}</h3>
          <p className="msg-settings-desc">{t('messengerSettings.sortDesc')}</p>
          <div className="msg-option-grid">
            {SORT_MODES.map((mode) => (
              <button
                key={mode}
                className={`msg-option ${sort === mode ? 'active' : ''}`}
                onClick={() => { setSortMode(mode); setSort(mode) }}
              >
                {t(`messenger.sort.${mode}`)}
              </button>
            ))}
          </div>
        </div>

        {/* ===== Notifications ===== */}
        <div className="msg-settings-section">
          <h3>{t('notifications.title')}</h3>
          <div className="msg-toggle-row" onClick={toggleNotif}>
            <div>
              <div>{t('notifications.newMessages')}</div>
              <div className="msg-settings-hint">{t('notifications.newMessagesDesc')}</div>
            </div>
            <span className={`badge ${notif ? 'enabled' : ''}`}>{notif ? t('common.on') : t('common.off')}</span>
          </div>
        </div>

        {/* ===== Scanning ===== */}
        <div className="msg-settings-section">
          <h3>{t('messengerSettings.scanTitle')}</h3>
          <div>{t('messengerSettings.entriesPerRefresh')}</div>
          <p className="msg-settings-hint">{t('messengerSettings.entriesDesc')}</p>
          <div className="messenger-scan-options">
            {MESSENGER_SCAN_OPTIONS.map((n) => (
              <button
                key={n}
                className={`scan-opt ${scanLimit === n ? 'active' : ''}`}
                onClick={() => { setMessengerScanLimit(n); setScanLimit(n); showToast(t('messengerSettings.scanningToast', { n }), 'success') }}
              >{n}</button>
            ))}
          </div>

          <div style={{ marginTop: 16 }}>{t('messengerSettings.sourcesPerRefresh')}</div>
          <p className="msg-settings-hint">{t('messengerSettings.sourcesDesc')}</p>
          <div className="messenger-scan-options">
            {SOURCES_PER_REFRESH_OPTIONS.map((n) => (
              <button
                key={n}
                className={`scan-opt ${sources === n ? 'active' : ''}`}
                onClick={() => { setSourcesPerRefresh(n); setSources(n) }}
              >{n}</button>
            ))}
          </div>
        </div>

        {/* ===== Compatibility ===== */}
        <div className="msg-settings-section">
          <h3>{t('messengerSettings.compatTitle')}</h3>
          <div className="msg-toggle-row" onClick={() => { const next = !legacy; setLegacyModeEnabled(next); setLegacy(next) }}>
            <div>
              <div>{t('messengerSettings.legacyMode')}</div>
              <div className="msg-settings-hint">{t('messengerSettings.legacyModeDesc')}</div>
            </div>
            <span className={`badge ${legacy ? 'enabled' : ''}`}>{legacy ? t('common.on') : t('common.off')}</span>
          </div>
        </div>
      </div>

      {contactEdit && (
        <div className="messenger-modal-overlay" onClick={() => setContactEdit(null)}>
          <div className="messenger-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t('messengerSettings.contactFeeTitle')}</h3>
            <p className="messenger-modal-sub">{shortAddr(contactEdit.address)}</p>
            <input
              className="messenger-input"
              type="text"
              inputMode="decimal"
              value={contactEdit.value}
              placeholder={t('messengerSettings.contactFeePlaceholder')}
              onChange={(e) => setContactEdit({ ...contactEdit, value: e.target.value.replace(/[^\d.,]/g, '') })}
              onKeyDown={(e) => { if (e.key === 'Enter') saveContactFee() }}
              autoFocus
            />
            <p className="msg-settings-hint">{t('messengerSettings.contactFeeHint')}</p>
            <p className="msg-settings-hint">{t('messengerSettings.feeRiseHint')}</p>
            <div className="messenger-modal-actions">
              <button className="btn btn-secondary" onClick={() => setContactEdit(null)}>{t('common.cancel')}</button>
              <button className="btn btn-primary" onClick={saveContactFee}>{t('common.save')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
