/**
 * H173K Wallet - Messenger UI
 *
 * Screens:
 *  - Nick setup (first entry): choose the nickname shown to contacts.
 *  - Conversation list: add-contact field, list of threads, hide/rename.
 *  - Thread: encrypted conversation + composer, pull-to-refresh (mobile) /
 *    refresh button (desktop, hidden on mobile by CSS convention).
 */

import React, { useState, useEffect, useRef, useCallback, useSyncExternalStore } from 'react'
import { PublicKey } from '@solana/web3.js'
import { useTranslation } from '../i18n'
import { useSwap } from '../hooks/useSwap'
import { sessionWallet } from '../crypto/wallet'
import {
  store,
  getProfile,
  hasProfile,
  saveProfile,
  scanIncomingMessages,
  sendMessage,
  MSG_COST,
  MAX_MESSAGE_LENGTH,
} from './messenger'

// ========== ICONS ==========
function BackIcon({ size = 20 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
}
function RefreshIcon({ size = 18 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
}
function PlusIcon({ size = 20 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
}
function EditIcon({ size = 16 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
}
function TrashIcon({ size = 16 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
}
function SendArrowIcon({ size = 20 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
}

// ========== HELPERS ==========
function shortAddr(a) {
  if (!a) return ''
  return a.slice(0, 4) + '…' + a.slice(-4)
}
function fmtTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString([], { day: '2-digit', month: '2-digit' }) + ' ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
function displayName(t) {
  if (t.contactName && t.contactName.trim()) return t.contactName
  if (t.peerNick && t.peerNick.trim()) return t.peerNick
  return shortAddr(t.address)
}

// Subscribe to the messenger store with useSyncExternalStore.
function useMessengerVersion() {
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getVisibleThreads().length + ':' + store.getTotalUnread() + ':' + JSON.stringify(
      store.getVisibleThreads().map(t => [t.address, t.messages.length, t.unread, t.contactName, t.peerNick])
    )
  )
}

// ========== MAIN MESSENGER VIEW ==========
export default function MessengerView({ connection, publicKey, onBack, showToast, initialAddress }) {
  const [needsNick, setNeedsNick] = useState(() => !hasProfile())
  const [editingNick, setEditingNick] = useState(false)
  // If we arrived with a target peer and a nick is already set, open it directly.
  const [view, setView] = useState(() => (initialAddress && hasProfile()) ? 'thread' : 'list')
  const [activeAddress, setActiveAddress] = useState(() => initialAddress || null)
  // Remember a pending target to open after the nick is chosen on first entry.
  const pendingTarget = useRef(initialAddress || null)

  // Re-render whenever the store changes.
  useMessengerVersion()

  // Track which thread is open so background scans don't mark it unread.
  useEffect(() => {
    try { window.__h173k_active_thread = (view === 'thread') ? activeAddress : null } catch {}
    return () => { try { window.__h173k_active_thread = null } catch {} }
  }, [view, activeAddress])

  if (needsNick) {
    return <NickSetup onDone={() => {
      setNeedsNick(false)
      if (pendingTarget.current) {
        store.markRead(pendingTarget.current)
        setActiveAddress(pendingTarget.current)
        setView('thread')
      }
    }} onBack={onBack} showToast={showToast} />
  }

  if (editingNick) {
    return <NickSetup isEdit onDone={() => setEditingNick(false)} onBack={() => setEditingNick(false)} showToast={showToast} />
  }

  if (view === 'thread' && activeAddress) {
    return (
      <ThreadView
        connection={connection}
        publicKey={publicKey}
        address={activeAddress}
        onBack={() => { store.markRead(activeAddress); setView('list'); setActiveAddress(null) }}
        showToast={showToast}
      />
    )
  }

  return (
    <ConversationList
      connection={connection}
      publicKey={publicKey}
      onBack={onBack}
      onOpen={(addr) => { store.markRead(addr); setActiveAddress(addr); setView('thread') }}
      onEditNick={() => setEditingNick(true)}
      showToast={showToast}
    />
  )
}

// ========== NICK SETUP ==========
function NickSetup({ onDone, onBack, showToast, isEdit }) {
  const { t } = useTranslation()
  const existing = getProfile()
  const [nick, setNick] = useState(existing ? existing.nick : '')

  const save = () => {
    const trimmed = nick.trim()
    if (!trimmed) { showToast(t('messenger.enterNick'), 'error'); return }
    saveProfile(trimmed)
    showToast(isEdit ? t('messenger.nickUpdated') : t('messenger.nickSaved'), 'success')
    onDone()
  }

  return (
    <div className="messenger-view">
      <div className="view-header">
        <button className="back-btn" onClick={onBack}><BackIcon size={16} /> {t('common.back')}</button>
        <h2>{isEdit ? t('messenger.editNickTitle') : t('messenger.title')}</h2>
      </div>
      <div className="nick-setup">
        <div className="nick-setup-icon">💬</div>
        <h3>{isEdit ? t('messenger.changeNick') : t('messenger.chooseNick')}</h3>
        <p className="nick-setup-desc">
          {t('messenger.nickDesc')}
        </p>
        <input
          className="messenger-input"
          type="text"
          value={nick}
          maxLength={32}
          placeholder={t('messenger.nickPlaceholder')}
          onChange={(e) => setNick(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save() }}
          autoFocus
        />
        <button className="btn btn-primary" onClick={save}>{t('messenger.saveNick')}</button>
      </div>
    </div>
  )
}

// ========== CONVERSATION LIST ==========
function ConversationList({ connection, publicKey, onBack, onOpen, onEditNick, showToast }) {
  const { t } = useTranslation()
  const [refreshing, setRefreshing] = useState(false)
  const myNick = (getProfile() && getProfile().nick) || ''
  const [newAddr, setNewAddr] = useState('')
  const [newName, setNewName] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [editAddr, setEditAddr] = useState(null)
  const [editName, setEditName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)

  const threads = store.getVisibleThreads()

  // Pull-to-refresh
  const listRef = useRef(null)
  const touchStartY = useRef(0)
  const isPulling = useRef(false)
  const [pullProgress, setPullProgress] = useState(0)

  const doRefresh = useCallback(async () => {
    setRefreshing(true)
    try { await scanIncomingMessages(connection, publicKey) }
    catch (e) { /* keep quiet on background errors */ }
    setTimeout(() => setRefreshing(false), 400)
  }, [connection, publicKey])

  useEffect(() => { doRefresh() }, [doRefresh])

  const handleTouchStart = useCallback((e) => {
    if (listRef.current?.scrollTop === 0) {
      touchStartY.current = e.touches[0].clientY
      isPulling.current = true
    }
  }, [])
  const handleTouchMove = useCallback((e) => {
    if (!isPulling.current || refreshing) return
    const diff = e.touches[0].clientY - touchStartY.current
    if (diff > 0 && diff < 150) setPullProgress(Math.min(diff / 100, 1))
    if (diff > 100 && !refreshing) { doRefresh(); isPulling.current = false; setPullProgress(0) }
  }, [refreshing, doRefresh])
  const handleTouchEnd = useCallback(() => { isPulling.current = false; setPullProgress(0) }, [])

  const addContact = () => {
    const addr = newAddr.trim()
    if (!addr) { showToast(t('messenger.enterAddress'), 'error'); return }
    try { new PublicKey(addr) } catch { showToast(t('send.invalidAddress'), 'error'); return }
    if (addr === publicKey.toBase58()) { showToast(t('messenger.cannotAddSelf'), 'error'); return }
    store.addContact(addr, newName.trim())
    setNewAddr(''); setNewName(''); setShowAdd(false)
    showToast(t('messenger.contactAdded'), 'success')
    onOpen(addr)
  }

  const saveEdit = () => {
    store.renameContact(editAddr, editName.trim())
    setEditAddr(null); setEditName('')
    showToast(t('messenger.nameSaved'), 'success')
  }

  return (
    <div
      className="messenger-view"
      ref={listRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div className="view-header">
        <button className="back-btn" onClick={onBack}><BackIcon size={16} /> {t('common.back')}</button>
        <h2>{t('messenger.title')}</h2>
        <div className="messenger-header-actions">
          <button className={`messenger-refresh-btn ${refreshing ? 'refreshing' : ''}`} onClick={doRefresh} disabled={refreshing} title={t('history.refresh')}>
            <RefreshIcon size={18} />
          </button>
          <button className="messenger-add-btn" onClick={() => setShowAdd(s => !s)} title={t('messenger.addContact')}>
            <PlusIcon size={20} />
          </button>
        </div>
      </div>

      <div className="messenger-nick-bar">
        <span className="messenger-nick-label">{t('messenger.yourNickname')}</span>
        <span className="messenger-nick-value">{myNick || '—'}</span>
        <button className="messenger-nick-edit" onClick={onEditNick} title={t('messenger.editNickTitle')}>
          <EditIcon size={15} /> {t('messenger.edit')}
        </button>
      </div>

      {(pullProgress > 0 || refreshing) && (
        <div className="pull-refresh-indicator" style={{ opacity: refreshing ? 1 : pullProgress }}>
          {!refreshing && <RefreshIcon size={24} />}
          <span>{refreshing ? t('main.refreshing') : (pullProgress >= 1 ? t('main.releaseToRefresh') : t('main.pullToRefresh'))}</span>
        </div>
      )}

      {showAdd && (
        <div className="add-contact-box">
          <input
            className="messenger-input"
            type="text"
            value={newAddr}
            placeholder={t('messenger.addrPlaceholder')}
            onChange={(e) => setNewAddr(e.target.value)}
            autoFocus
          />
          <input
            className="messenger-input"
            type="text"
            value={newName}
            maxLength={40}
            placeholder={t('messenger.namePlaceholder')}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addContact() }}
          />
          <button className="btn btn-primary" onClick={addContact}>{t('messenger.addAndMessage')}</button>
        </div>
      )}

      <div className="conversation-list">
        {threads.length === 0 && (
          <div className="messenger-empty">
            <div className="messenger-empty-icon">✉️</div>
            <p>{t('messenger.noConversations')}</p>
            <p className="messenger-empty-sub">{t('messenger.noConversationsSub')}</p>
          </div>
        )}

        {threads.map((th) => {
          const last = th.messages[th.messages.length - 1]
          return (
            <div key={th.address} className="conversation-item" onClick={() => onOpen(th.address)}>
              <div className="conversation-avatar">{displayName(th).charAt(0).toUpperCase()}</div>
              <div className="conversation-main">
                <div className="conversation-top">
                  <span className="conversation-name">{displayName(th)}</span>
                  {last && <span className="conversation-time">{fmtTime(last.ts)}</span>}
                </div>
                <div className="conversation-bottom">
                  <span className="conversation-preview">
                    {last ? (last.dir === 'out' ? t('messenger.youPrefix') : '') + last.text : t('messenger.noMessagesPreview')}
                  </span>
                  {th.unread > 0 && <span className="conversation-unread">{th.unread > 99 ? '99+' : th.unread}</span>}
                </div>
                {th.peerNick && th.contactName && (
                  <div className="conversation-nick">@{th.peerNick}</div>
                )}
              </div>
              <div className="conversation-actions" onClick={(e) => e.stopPropagation()}>
                <button className="conversation-action" title={t('messenger.editName')} onClick={() => { setEditAddr(th.address); setEditName(th.contactName || '') }}>
                  <EditIcon size={15} />
                </button>
                <button className="conversation-action danger" title={t('messenger.deleteConversation')} onClick={() => setConfirmDelete(th.address)}>
                  <TrashIcon size={15} />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {editAddr && (
        <div className="messenger-modal-overlay" onClick={() => setEditAddr(null)}>
          <div className="messenger-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t('messenger.contactName')}</h3>
            <p className="messenger-modal-sub">{shortAddr(editAddr)}</p>
            <input
              className="messenger-input"
              type="text"
              value={editName}
              maxLength={40}
              placeholder={t('messenger.contactName')}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveEdit() }}
              autoFocus
            />
            <div className="messenger-modal-actions">
              <button className="btn btn-secondary" onClick={() => setEditAddr(null)}>{t('common.cancel')}</button>
              <button className="btn btn-primary" onClick={saveEdit}>{t('common.save')}</button>
            </div>
          </div>
        </div>
      )}
      {confirmDelete && (
        <div className="messenger-modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="messenger-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t('messenger.deleteConversation')}</h3>
            <p className="messenger-modal-sub">{shortAddr(confirmDelete)}</p>
            <p className="messenger-delete-warning">
              {t('messenger.deleteWarning')}
            </p>
            <div className="messenger-modal-actions">
              <button className="btn btn-secondary" onClick={() => setConfirmDelete(null)}>{t('common.cancel')}</button>
              <button className="btn btn-danger" onClick={() => {
                store.deleteThread(confirmDelete)
                setConfirmDelete(null)
                showToast(t('messenger.deleted'), 'info')
              }}>{t('messenger.delete')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
function ThreadView({ connection, publicKey, address, onBack, showToast }) {
  const { t } = useTranslation()
  const [refreshing, setRefreshing] = useState(false)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const { withAutoSOL } = useSwap(connection, sessionWallet)

  const thread = store.getThread(address) || { address, messages: [], contactName: '', peerNick: '', peerPubKey: null }

  const scrollRef = useRef(null)
  const touchStartY = useRef(0)
  const isPulling = useRef(false)
  const [pullProgress, setPullProgress] = useState(0)

  const doRefresh = useCallback(async () => {
    setRefreshing(true)
    try { await scanIncomingMessages(connection, publicKey); store.markRead(address) }
    catch (e) { /* quiet */ }
    setTimeout(() => setRefreshing(false), 400)
  }, [connection, publicKey, address])

  useEffect(() => { doRefresh() }, [doRefresh])

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [thread.messages.length])

  const handleTouchStart = useCallback((e) => {
    if (scrollRef.current?.scrollTop === 0) {
      touchStartY.current = e.touches[0].clientY
      isPulling.current = true
    }
  }, [])
  const handleTouchMove = useCallback((e) => {
    if (!isPulling.current || refreshing) return
    const diff = e.touches[0].clientY - touchStartY.current
    if (diff > 0 && diff < 150) setPullProgress(Math.min(diff / 100, 1))
    if (diff > 100 && !refreshing) { doRefresh(); isPulling.current = false; setPullProgress(0) }
  }, [refreshing, doRefresh])
  const handleTouchEnd = useCallback(() => { isPulling.current = false; setPullProgress(0) }, [])

  const send = async () => {
    const trimmed = text.trim()
    if (!trimmed) return
    if (trimmed.length > MAX_MESSAGE_LENGTH) { showToast(t('messenger.maxChars', { n: MAX_MESSAGE_LENGTH }), 'error'); return }
    setSending(true)
    try {
      await sendMessage({ connection, publicKey, peerAddress: address, text: trimmed, withAutoSOL })
      setText('')
      showToast(t('messenger.messageSent'), 'success')
    } catch (err) {
      if (err.message && (err.message.includes('Wallet is locked') || !sessionWallet.isUnlocked())) {
        showToast(t('common.sessionExpired'), 'error')
      } else {
        showToast(t('messenger.failedSend', { msg: err.message }), 'error')
      }
    } finally {
      setSending(false)
    }
  }

  const title = displayName(thread)
  const remaining = MAX_MESSAGE_LENGTH - text.length

  return (
    <div className="messenger-view thread-view">
      <div className="view-header">
        <button className="back-btn" onClick={onBack}><BackIcon size={16} /> {t('common.back')}</button>
        <div className="thread-title-block">
          <span className="thread-title">{title}</span>
          {thread.peerNick ? <span className="thread-subtitle">@{thread.peerNick} · {shortAddr(address)}</span>
            : <span className="thread-subtitle">{shortAddr(address)}</span>}
        </div>
        <button className={`messenger-refresh-btn ${refreshing ? 'refreshing' : ''}`} onClick={doRefresh} disabled={refreshing} title={t('history.refresh')}>
          <RefreshIcon size={18} />
        </button>
      </div>

      <div
        className="thread-messages"
        ref={scrollRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {(pullProgress > 0 || refreshing) && (
          <div className="pull-refresh-indicator thread-pull" style={{ opacity: refreshing ? 1 : pullProgress }}>
            {!refreshing && <RefreshIcon size={24} />}
            <span>{refreshing ? t('main.refreshing') : (pullProgress >= 1 ? t('main.releaseToRefresh') : t('main.pullToRefresh'))}</span>
          </div>
        )}

        {thread.messages.length === 0 && (
          <div className="thread-empty">
            <p>{t('messenger.noMessages')}</p>
            <p className="thread-empty-sub">{t('messenger.firstMessageNote', { n: MSG_COST })}</p>
          </div>
        )}

        {thread.messages.map((m) => (
          <div key={m.id} className={`message-bubble ${m.dir === 'out' ? 'out' : 'in'}`}>
            {m.type === 'req' && <div className="message-tag">{m.dir === 'out' ? t('messenger.requestSent') : t('messenger.request')}</div>}
            <div className="message-text">{m.text}</div>
            <div className="message-meta">{fmtTime(m.ts)}</div>
          </div>
        ))}
      </div>

      <div className="thread-composer">
        <textarea
          className="thread-input"
          value={text}
          maxLength={MAX_MESSAGE_LENGTH}
          placeholder={t('messenger.typeMessage')}
          rows={1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
        />
        <span className="thread-charcount">{remaining}</span>
        <button className="thread-send-btn" onClick={send} disabled={sending || !text.trim()}>
          <SendArrowIcon size={20} />
        </button>
      </div>
    </div>
  )
}
