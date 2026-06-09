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
  const existing = getProfile()
  const [nick, setNick] = useState(existing ? existing.nick : '')

  const save = () => {
    const trimmed = nick.trim()
    if (!trimmed) { showToast('Enter your nickname', 'error'); return }
    saveProfile(trimmed)
    showToast(isEdit ? 'Nickname updated' : 'Nickname saved', 'success')
    onDone()
  }

  return (
    <div className="messenger-view">
      <div className="view-header">
        <button className="back-btn" onClick={onBack}><BackIcon size={16} /> Back</button>
        <h2>{isEdit ? 'Edit nickname' : 'Messenger'}</h2>
      </div>
      <div className="nick-setup">
        <div className="nick-setup-icon">💬</div>
        <h3>{isEdit ? 'Change your nickname' : 'Choose your nickname'}</h3>
        <p className="nick-setup-desc">
          This is the nickname your contacts see. It's the same name used in the P2P marketplace.
        </p>
        <input
          className="messenger-input"
          type="text"
          value={nick}
          maxLength={32}
          placeholder="e.g. satoshi"
          onChange={(e) => setNick(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save() }}
          autoFocus
        />
        <button className="btn btn-primary" onClick={save}>{isEdit ? 'Save nickname' : 'Save nickname'}</button>
      </div>
    </div>
  )
}

// ========== CONVERSATION LIST ==========
function ConversationList({ connection, publicKey, onBack, onOpen, onEditNick, showToast }) {
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
    if (!addr) { showToast('Enter an address', 'error'); return }
    try { new PublicKey(addr) } catch { showToast('Invalid Solana address', 'error'); return }
    if (addr === publicKey.toBase58()) { showToast('You cannot add your own address', 'error'); return }
    store.addContact(addr, newName.trim())
    setNewAddr(''); setNewName(''); setShowAdd(false)
    showToast('Contact added', 'success')
    onOpen(addr)
  }

  const saveEdit = () => {
    store.renameContact(editAddr, editName.trim())
    setEditAddr(null); setEditName('')
    showToast('Name saved', 'success')
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
        <button className="back-btn" onClick={onBack}><BackIcon size={16} /> Back</button>
        <h2>Messenger</h2>
        <div className="messenger-header-actions">
          <button className={`messenger-refresh-btn ${refreshing ? 'refreshing' : ''}`} onClick={doRefresh} disabled={refreshing} title="Refresh">
            <RefreshIcon size={18} />
          </button>
          <button className="messenger-add-btn" onClick={() => setShowAdd(s => !s)} title="Add contact">
            <PlusIcon size={20} />
          </button>
        </div>
      </div>

      <div className="messenger-nick-bar">
        <span className="messenger-nick-label">Your nickname</span>
        <span className="messenger-nick-value">{myNick || '—'}</span>
        <button className="messenger-nick-edit" onClick={onEditNick} title="Edit nickname">
          <EditIcon size={15} /> Edit
        </button>
      </div>

      {(pullProgress > 0 || refreshing) && (
        <div className="pull-refresh-indicator" style={{ opacity: refreshing ? 1 : pullProgress }}>
          {!refreshing && <RefreshIcon size={24} />}
          <span>{refreshing ? 'Refreshing...' : (pullProgress >= 1 ? 'Release to refresh' : 'Pull to refresh')}</span>
        </div>
      )}

      {showAdd && (
        <div className="add-contact-box">
          <input
            className="messenger-input"
            type="text"
            value={newAddr}
            placeholder="Contact's Solana address"
            onChange={(e) => setNewAddr(e.target.value)}
            autoFocus
          />
          <input
            className="messenger-input"
            type="text"
            value={newName}
            maxLength={40}
            placeholder="Contact name (optional)"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addContact() }}
          />
          <button className="btn btn-primary" onClick={addContact}>Add & message</button>
        </div>
      )}

      <div className="conversation-list">
        {threads.length === 0 && (
          <div className="messenger-empty">
            <div className="messenger-empty-icon">✉️</div>
            <p>No conversations</p>
            <p className="messenger-empty-sub">Add a contact with the + button to start an encrypted conversation.</p>
          </div>
        )}

        {threads.map((t) => {
          const last = t.messages[t.messages.length - 1]
          return (
            <div key={t.address} className="conversation-item" onClick={() => onOpen(t.address)}>
              <div className="conversation-avatar">{displayName(t).charAt(0).toUpperCase()}</div>
              <div className="conversation-main">
                <div className="conversation-top">
                  <span className="conversation-name">{displayName(t)}</span>
                  {last && <span className="conversation-time">{fmtTime(last.ts)}</span>}
                </div>
                <div className="conversation-bottom">
                  <span className="conversation-preview">
                    {last ? (last.dir === 'out' ? 'You: ' : '') + last.text : 'No messages yet — send the first one'}
                  </span>
                  {t.unread > 0 && <span className="conversation-unread">{t.unread > 99 ? '99+' : t.unread}</span>}
                </div>
                {t.peerNick && t.contactName && (
                  <div className="conversation-nick">@{t.peerNick}</div>
                )}
              </div>
              <div className="conversation-actions" onClick={(e) => e.stopPropagation()}>
                <button className="conversation-action" title="Edit name" onClick={() => { setEditAddr(t.address); setEditName(t.contactName || '') }}>
                  <EditIcon size={15} />
                </button>
                <button className="conversation-action danger" title="Delete conversation" onClick={() => setConfirmDelete(t.address)}>
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
            <h3>Contact name</h3>
            <p className="messenger-modal-sub">{shortAddr(editAddr)}</p>
            <input
              className="messenger-input"
              type="text"
              value={editName}
              maxLength={40}
              placeholder="Contact name"
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveEdit() }}
              autoFocus
            />
            <div className="messenger-modal-actions">
              <button className="btn btn-secondary" onClick={() => setEditAddr(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveEdit}>Save</button>
            </div>
          </div>
        </div>
      )}
      {confirmDelete && (
        <div className="messenger-modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="messenger-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Delete conversation</h3>
            <p className="messenger-modal-sub">{shortAddr(confirmDelete)}</p>
            <p className="messenger-delete-warning">
              This permanently removes the conversation and all its messages from this device. If this person messages you again, a brand-new thread will be created.
            </p>
            <div className="messenger-modal-actions">
              <button className="btn btn-secondary" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => {
                store.deleteThread(confirmDelete)
                setConfirmDelete(null)
                showToast('Conversation deleted', 'info')
              }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
function ThreadView({ connection, publicKey, address, onBack, showToast }) {
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
    if (trimmed.length > MAX_MESSAGE_LENGTH) { showToast(`Max ${MAX_MESSAGE_LENGTH} characters`, 'error'); return }
    setSending(true)
    try {
      await sendMessage({ connection, publicKey, peerAddress: address, text: trimmed, withAutoSOL })
      setText('')
      showToast('Message sent', 'success')
    } catch (err) {
      if (err.message && (err.message.includes('Wallet is locked') || !sessionWallet.isUnlocked())) {
        showToast('Session expired. Please unlock your wallet again.', 'error')
      } else {
        showToast('Failed to send: ' + err.message, 'error')
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
        <button className="back-btn" onClick={onBack}><BackIcon size={16} /> Back</button>
        <div className="thread-title-block">
          <span className="thread-title">{title}</span>
          {thread.peerNick ? <span className="thread-subtitle">@{thread.peerNick} · {shortAddr(address)}</span>
            : <span className="thread-subtitle">{shortAddr(address)}</span>}
        </div>
        <button className={`messenger-refresh-btn ${refreshing ? 'refreshing' : ''}`} onClick={doRefresh} disabled={refreshing} title="Refresh">
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
            <span>{refreshing ? 'Refreshing...' : (pullProgress >= 1 ? 'Release to refresh' : 'Pull to refresh')}</span>
          </div>
        )}

        {thread.messages.length === 0 && (
          <div className="thread-empty">
            <p>No messages.</p>
            <p className="thread-empty-sub">The first message is a request to start the conversation (key exchange). Cost: {MSG_COST} h173k.</p>
          </div>
        )}

        {thread.messages.map((m) => (
          <div key={m.id} className={`message-bubble ${m.dir === 'out' ? 'out' : 'in'}`}>
            {m.type === 'req' && <div className="message-tag">{m.dir === 'out' ? 'Conversation request sent' : 'Conversation request'}</div>}
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
          placeholder="Type a message…"
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
