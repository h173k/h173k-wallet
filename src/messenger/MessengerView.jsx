/**
 * h173k Wallet - Messenger UI
 *
 * Screens:
 *  - Nick setup (first entry)
 *  - Chat list: individual conversations and groups together, with sorting and
 *    filtering available straight from the list, a "+" that opens either kind
 *    of new chat, and the messenger's own settings next to it
 *  - Thread: an individual conversation (its own dedicated address)
 *  - Group screens (see GroupView.jsx)
 *  - Messenger settings (see MessengerSettingsView.jsx)
 */

import React, { useState, useEffect, useRef, useCallback, useSyncExternalStore } from 'react'
import { PublicKey } from '@solana/web3.js'
import { useTranslation } from '../i18n'
import { useSwap } from '../hooks/useSwap'
import { sessionWallet } from '../crypto/wallet'
import {
  BackIcon, RefreshIcon, PlusIcon, EditIcon, TrashIcon, SendArrowIcon,
  SettingsIcon, GroupIcon, PersonIcon, LinkIcon, ReplyIcon, CloseIcon, CoinIcon,
} from './icons'
import {
  store,
  getProfile,
  hasProfile,
  saveProfile,
  scanIncomingMessages,
  sendMessage,
  startConversation,
  resolveTarget,
  requiredFeeFrom,
  feeRiseUnannounced,
  remainingRoomFor,
  unpaidCount,
  MSG_COST,
  MAX_MESSAGE_LENGTH,
  MAX_INVITE_LENGTH,
} from './messenger'
import { groupStore } from './groups'
import { buildChatList } from './chatlist'
import { getSortMode, setSortMode, SORT_MODES, subscribePrefs } from './prefs'
import MessageActions from './MessageActions'
import MessengerSettingsView from './MessengerSettingsView'
import { CreateGroupView, JoinGroupView, GroupChatView } from './GroupView'

// ========== HELPERS ==========
function shortAddr(a) {
  if (!a) return ''
  return a.slice(0, 4) + '…' + a.slice(-4)
}
function fmtTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString([], { day: '2-digit', month: '2-digit' }) + ' ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
function displayName(t) {
  if (t.contactName && t.contactName.trim()) return t.contactName
  if (t.peerNick && t.peerNick.trim()) return t.peerNick
  return shortAddr(t.address)
}

/** Re-render whenever the threads, the groups or the preferences change. */
function useMessengerVersion() {
  return useSyncExternalStore(
    (cb) => {
      const un1 = store.subscribe(cb)
      const un2 = groupStore.subscribe(cb)
      const un3 = subscribePrefs(cb)
      return () => { un1(); un2(); un3() }
    },
    () => {
      const threads = store.getVisibleThreads()
      const groups = groupStore.all()
      return JSON.stringify([
        getSortMode(),
        threads.map((t) => [t.address, t.messages.length, t.unread, unpaidCount(t), t.contactName, t.peerNick, t.channelConfirmed]),
        groups.map((g) => [g.id, g.messages.length, g.unread, Object.keys(g.pending || {}).length, g.name]),
      ])
    }
  )
}

// ========== MAIN VIEW ==========
export default function MessengerView({ connection, publicKey, balance, onBack, showToast, initialAddress, initialInvite, initialGroup, onInviteConsumed, onTip }) {
  const [needsNick, setNeedsNick] = useState(() => !hasProfile())
  const [editingNick, setEditingNick] = useState(false)
  const [view, setView] = useState(() => {
    if (initialInvite) return 'joinGroup'
    if (initialGroup) return 'group'
    return (initialAddress && hasProfile()) ? 'thread' : 'list'
  })
  const [activeAddress, setActiveAddress] = useState(() => initialAddress || null)
  const [activeGroup, setActiveGroup] = useState(() => initialGroup || null)
  const pendingTarget = useRef(initialAddress || null)

  useMessengerVersion()

  // Track what is open so background scans don't mark it unread.
  useEffect(() => {
    try { window.__h173k_active_thread = (view === 'thread') ? activeAddress : null } catch {}
    return () => { try { window.__h173k_active_thread = null } catch {} }
  }, [view, activeAddress])

  // Tipping leaves the messenger, so hand over the chat to return to. The
  // caller passes the recipient; the context comes from whatever is open.
  const handleTip = useCallback((address) => {
    if (!onTip) return
    if (view === 'group' && activeGroup) onTip(address, { group: activeGroup })
    else if (activeAddress) onTip(address, { thread: activeAddress })
    else onTip(address)
  }, [onTip, view, activeGroup, activeAddress])

  const openThread = useCallback((addr) => {
    store.markRead(addr)
    setActiveAddress(addr)
    setView('thread')
  }, [])
  const openGroup = useCallback((id) => {
    groupStore.markRead(id)
    setActiveGroup(id)
    setView('group')
  }, [])

  // A notification can name a group while the messenger is already open.
  useEffect(() => {
    if (initialGroup) openGroup(initialGroup)
  }, [initialGroup, openGroup])

  if (needsNick) {
    return (
      <NickSetup
        onDone={() => {
          setNeedsNick(false)
          if (initialInvite) { setView('joinGroup'); return }
          if (initialGroup) { openGroup(initialGroup); return }
          if (pendingTarget.current) openThread(pendingTarget.current)
        }}
        onBack={onBack}
        showToast={showToast}
      />
    )
  }

  if (editingNick) {
    return <NickSetup isEdit onDone={() => setEditingNick(false)} onBack={() => setEditingNick(false)} showToast={showToast} />
  }

  if (view === 'settings') {
    return (
      <MessengerSettingsView
        onBack={() => setView('list')}
        showToast={showToast}
      />
    )
  }

  if (view === 'newGroup') {
    return (
      <CreateGroupView
        connection={connection}
        publicKey={publicKey}
        onBack={() => setView('list')}
        onCreated={(id) => openGroup(id)}
        showToast={showToast}
      />
    )
  }

  if (view === 'joinGroup') {
    return (
      <JoinGroupView
        connection={connection}
        publicKey={publicKey}
        balance={balance}
        initialInvite={initialInvite}
        onBack={() => { setView('list'); if (onInviteConsumed) onInviteConsumed() }}
        showToast={showToast}
      />
    )
  }

  if (view === 'group' && activeGroup) {
    return (
      <GroupChatView
        connection={connection}
        publicKey={publicKey}
        groupId={activeGroup}
        onTip={handleTip}
        onBack={() => { groupStore.markRead(activeGroup); setView('list'); setActiveGroup(null) }}
        showToast={showToast}
      />
    )
  }

  if (view === 'thread' && activeAddress) {
    return (
      <ThreadView
        connection={connection}
        publicKey={publicKey}
        address={activeAddress}
        onTip={handleTip}
        onBack={() => { store.markRead(activeAddress); setView('list'); setActiveAddress(null) }}
        showToast={showToast}
      />
    )
  }

  return (
    <ChatList
      connection={connection}
      publicKey={publicKey}
      onBack={onBack}
      onOpenThread={openThread}
      onOpenGroup={openGroup}
      onEditNick={() => setEditingNick(true)}
      onSettings={() => setView('settings')}
      onNewGroup={() => setView('newGroup')}
      onJoinGroup={() => setView('joinGroup')}
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
        <p className="nick-setup-desc">{t('messenger.nickDesc')}</p>
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

// ========== CHAT LIST ==========
function ChatList({ connection, publicKey, onBack, onOpenThread, onOpenGroup, onEditNick, onSettings, onNewGroup, onJoinGroup, showToast }) {
  const { t } = useTranslation()
  const [refreshing, setRefreshing] = useState(false)
  const myNick = (getProfile() && getProfile().nick) || ''
  const [showMenu, setShowMenu] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [newAddr, setNewAddr] = useState('')
  const [newName, setNewName] = useState('')
  const [editAddr, setEditAddr] = useState(null)
  const [editName, setEditName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)

  const sortMode = getSortMode()
  const items = buildChatList(sortMode)

  const listRef = useRef(null)
  const touchStartY = useRef(0)
  const isPulling = useRef(false)
  const [pullProgress, setPullProgress] = useState(0)

  const doRefresh = useCallback(async () => {
    setRefreshing(true)
    try { await scanIncomingMessages(connection, publicKey) } catch { /* quiet */ }
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

  const startNewConversation = () => {
    const addr = newAddr.trim()
    if (!addr) { showToast(t('messenger.enterAddress'), 'error'); return }
    try { new PublicKey(addr) } catch { showToast(t('send.invalidAddress'), 'error'); return }
    if (addr === publicKey.toBase58()) { showToast(t('messenger.cannotAddSelf'), 'error'); return }
    startConversation(addr, newName.trim())
    setNewAddr(''); setNewName(''); setShowAdd(false)
    showToast(t('messenger.contactAdded'), 'success')
    onOpenThread(addr)
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
          <div className="messenger-plus-wrap">
            <button className="messenger-add-btn" onClick={() => { setShowMenu((s) => !s); setShowAdd(false) }} title={t('messenger.newChat')}>
              <PlusIcon size={20} />
            </button>
            {showMenu && (
              <>
                <div className="messenger-menu-backdrop" onClick={() => setShowMenu(false)} />
                <div className="messenger-menu">
                  <button className="messenger-menu-item" onClick={() => { setShowMenu(false); setShowAdd(true) }}>
                    <PersonIcon size={17} />
                    <span>
                      <strong>{t('messenger.newDirect')}</strong>
                      <em>{t('messenger.newDirectDesc')}</em>
                    </span>
                  </button>
                  <button className="messenger-menu-item" onClick={() => { setShowMenu(false); onNewGroup() }}>
                    <GroupIcon size={17} />
                    <span>
                      <strong>{t('messenger.newGroup')}</strong>
                      <em>{t('messenger.newGroupDesc')}</em>
                    </span>
                  </button>
                  <button className="messenger-menu-item" onClick={() => { setShowMenu(false); onJoinGroup() }}>
                    <LinkIcon size={17} />
                    <span>
                      <strong>{t('messenger.joinGroup')}</strong>
                      <em>{t('messenger.joinGroupDesc')}</em>
                    </span>
                  </button>
                </div>
              </>
            )}
          </div>
          <button className="messenger-add-btn" onClick={onSettings} title={t('messengerSettings.title')}>
            <SettingsIcon size={19} />
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

      {/* Sorting and filtering, straight from the list. */}
      <div className="messenger-sort-bar">
        {SORT_MODES.map((mode) => (
          <button
            key={mode}
            className={`messenger-sort-chip ${sortMode === mode ? 'active' : ''}`}
            onClick={() => setSortMode(mode)}
          >
            {t(`messenger.sort.${mode}`)}
          </button>
        ))}
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
            onKeyDown={(e) => { if (e.key === 'Enter') startNewConversation() }}
          />
          <p className="msg-settings-hint">{t('messenger.newAddressNote')}</p>
          <button className="btn btn-primary" onClick={startNewConversation}>{t('messenger.addAndMessage')}</button>
        </div>
      )}

      <div className="conversation-list">
        {items.length === 0 && (
          <div className="messenger-empty">
            <div className="messenger-empty-icon">✉️</div>
            <p>{t(sortMode === 'groupsOnly' ? 'messenger.noGroups' : 'messenger.noConversations')}</p>
            <p className="messenger-empty-sub">{t('messenger.noConversationsSub')}</p>
          </div>
        )}

        {items.map((item) => item.kind === 'group'
          ? (
            <GroupRow
              key={item.key}
              group={item.group}
              onOpen={() => onOpenGroup(item.group.id)}
            />
          )
          : (
            <ThreadRow
              key={item.key}
              thread={item.thread}
              onOpen={() => onOpenThread(item.thread.address)}
              onRename={() => { setEditAddr(item.thread.address); setEditName(item.thread.contactName || '') }}
              onDelete={() => setConfirmDelete(item.thread.address)}
            />
          )
        )}
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
            <p className="messenger-delete-warning">{t('messenger.deleteWarning')}</p>
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

function ThreadRow({ thread, onOpen, onRename, onDelete }) {
  const { t } = useTranslation()
  const last = thread.messages[thread.messages.length - 1]
  return (
    <div className="conversation-item" onClick={onOpen}>
      <div className="conversation-avatar">{displayName(thread).charAt(0).toUpperCase()}</div>
      <div className="conversation-main">
        <div className="conversation-top">
          <span className="conversation-name">{displayName(thread)}</span>
          {last && <span className="conversation-time">{fmtTime(last.ts)}</span>}
        </div>
        <div className="conversation-bottom">
          <span className="conversation-preview">
            {last ? (last.dir === 'out' ? t('messenger.youPrefix') : '') + last.text : t('messenger.noMessagesPreview')}
          </span>
          {thread.unread > 0 && <span className="conversation-unread">{thread.unread > 99 ? '99+' : thread.unread}</span>}
        </div>
        <div className="conversation-tags">
          {thread.channel && thread.channelConfirmed && (
            <span className="conversation-tag">{t('messenger.ownAddressTag')}</span>
          )}
          {thread.legacyPeer && <span className="conversation-tag legacy">{t('messenger.legacyTag')}</span>}
          {unpaidCount(thread) > 0 && <span className="conversation-tag warn">{t('messenger.unpaidTag', { n: unpaidCount(thread) })}</span>}
          {thread.peerNick && thread.contactName && <span className="conversation-nick">@{thread.peerNick}</span>}
        </div>
      </div>
      <div className="conversation-actions" onClick={(e) => e.stopPropagation()}>
        <button className="conversation-action" title={t('messenger.editName')} onClick={onRename}>
          <EditIcon size={15} />
        </button>
        <button className="conversation-action danger" title={t('messenger.deleteConversation')} onClick={onDelete}>
          <TrashIcon size={15} />
        </button>
      </div>
    </div>
  )
}

function GroupRow({ group, onOpen }) {
  const { t } = useTranslation()
  const last = group.messages[group.messages.length - 1]
  const pending = Object.keys(group.pending || {}).length
  return (
    <div className="conversation-item group" onClick={onOpen}>
      <div className="conversation-avatar group"><GroupIcon size={18} /></div>
      <div className="conversation-main">
        <div className="conversation-top">
          <span className="conversation-name">{group.name}</span>
          {last && <span className="conversation-time">{fmtTime(last.ts)}</span>}
        </div>
        <div className="conversation-bottom">
          <span className="conversation-preview">
            {last
              ? (last.dir === 'out' ? t('messenger.youPrefix') : (last.nick ? last.nick + ': ' : '')) + last.text
              : t('messenger.noMessagesPreview')}
          </span>
          {group.unread > 0 && <span className="conversation-unread">{group.unread > 99 ? '99+' : group.unread}</span>}
        </div>
        <div className="conversation-tags">
          <span className="conversation-tag">{t('messenger.groupTag')}</span>
          {group.isAdmin && <span className="conversation-tag">{t('groups.adminTag')}</span>}
          {pending > 0 && <span className="conversation-tag warn">{t('groups.pendingTag', { n: pending })}</span>}
        </div>
      </div>
    </div>
  )
}

// ========== DIRECT THREAD ==========
function ThreadView({ connection, publicKey, address, onBack, showToast, onTip }) {
  const { t } = useTranslation()
  const [refreshing, setRefreshing] = useState(false)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [replyTo, setReplyTo] = useState(null)
  const [showUnpaid, setShowUnpaid] = useState(false)
  const { withAutoSOL } = useSwap(connection, sessionWallet)

  const thread = store.getThread(address) || {
    address, messages: [], contactName: '', peerNick: '', peerPubKey: null,
  }
  const routing = resolveTarget(address)
  const limit = routing.isInvite ? MAX_INVITE_LENGTH : MAX_MESSAGE_LENGTH
  const myFee = requiredFeeFrom(address)
  const peerFee = thread.peerFee || 0
  // A rise only binds once it has been announced, so say so plainly rather than
  // letting the user think it is already in force.
  const riseUnannounced = feeRiseUnannounced(address)

  const scrollRef = useRef(null)
  const touchStartY = useRef(0)
  const isPulling = useRef(false)
  const [pullProgress, setPullProgress] = useState(0)

  const doRefresh = useCallback(async () => {
    setRefreshing(true)
    try { await scanIncomingMessages(connection, publicKey, { activeAddress: address }); store.markRead(address) }
    catch { /* quiet */ }
    setTimeout(() => setRefreshing(false), 400)
  }, [connection, publicKey, address])

  useEffect(() => { doRefresh() }, [doRefresh])

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
    if (trimmed.length > limit) { showToast(t('messenger.maxChars', { n: limit }), 'error'); return }
    setSending(true)
    try {
      await sendMessage({
        connection, publicKey, peerAddress: address, text: trimmed,
        replyTo: replyTo ? { id: replyTo.id, text: replyTo.text } : null,
        withAutoSOL,
      })
      setText('')
      setReplyTo(null)
      showToast(t('messenger.messageSent'), 'success')
    } catch (err) {
      const msg = String(err.message || '')
      if (msg === 'MEMO_TOO_LONG') showToast(t('messenger.tooLong'), 'error')
      else if (msg.includes('Wallet is locked') || !sessionWallet.isUnlocked()) showToast(t('common.sessionExpired'), 'error')
      else showToast(t('messenger.failedSend', { msg }), 'error')
    } finally {
      setSending(false)
    }
  }

  const title = displayName(thread)
  // The real limit is the memo size in bytes, not the character count: an
  // accented or non-Latin alphabet costs 2-3 bytes per character.
  const remaining = remainingRoomFor({
    peerAddress: address,
    publicKey,
    text,
    replyTo: replyTo ? { id: replyTo.id, text: replyTo.text } : null,
  })
  const overflowing = remaining < 0
  const visible = thread.messages.filter((m) => showUnpaid || !m.unpaid)
  const hiddenCount = thread.messages.filter((m) => m.unpaid).length

  return (
    <div className="messenger-view thread-view">
      <div className="view-header">
        <button className="back-btn" onClick={onBack}><BackIcon size={16} /> {t('common.back')}</button>
        <div className="thread-title-block">
          <span className="thread-title">{title}</span>
          <span className="thread-subtitle">
            {thread.peerNick ? `@${thread.peerNick} · ` : ''}{shortAddr(address)}
          </span>
        </div>
        <button className={`messenger-refresh-btn ${refreshing ? 'refreshing' : ''}`} onClick={doRefresh} disabled={refreshing} title={t('history.refresh')}>
          <RefreshIcon size={18} />
        </button>
      </div>

      {/* Where this conversation lives and what it costs. */}
      <div className="thread-info-bar">
        {routing.legacy ? (
          <span className="thread-info-chip legacy">{t('messenger.onWalletAddress')}</span>
        ) : routing.isInvite ? (
          <span className="thread-info-chip">{t('messenger.invitePending')}</span>
        ) : (
          <span className="thread-info-chip ok">{t('messenger.onOwnAddress')}</span>
        )}
        {peerFee > 0 && (
          <span className="thread-info-chip warn"><CoinIcon size={12} /> {t('messenger.peerCharges', { n: peerFee })}</span>
        )}
        {myFee > 0 && (
          <span className="thread-info-chip">{t('messenger.youCharge', { n: myFee })}</span>
        )}
        {riseUnannounced && (
          <span className="thread-info-chip warn">{t('messenger.feeNotAnnounced')}</span>
        )}
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

        {visible.length === 0 && (
          <div className="thread-empty">
            <p>{t('messenger.noMessages')}</p>
            <p className="thread-empty-sub">{t('messenger.firstMessageNote', { n: MSG_COST })}</p>
          </div>
        )}

        {visible.map((m) => (
          <div key={m.id} className={`message-bubble ${m.dir === 'out' ? 'out' : 'in'} ${m.unpaid ? 'unpaid' : ''}`}>
            {m.type === 'req' && (
              <div className="message-tag">{m.dir === 'out' ? t('messenger.requestSent') : t('messenger.request')}</div>
            )}
            {m.unpaid && <div className="message-tag warn">{t('messenger.unpaidTagFull', { n: m.feeRequired })}</div>}
            {m.graced && <div className="message-tag">{t('messenger.firstContactFree')}</div>}
            {m.reply && (
              <div className="message-quote">
                <span className="message-quote-text">{m.reply.text}</span>
              </div>
            )}
            <div className="message-text">{m.text}</div>
            <div className="message-meta">
              <MessageActions
                align={m.dir === 'out' ? 'end' : 'start'}
                onReply={() => setReplyTo(m)}
                onTip={(m.dir === 'in' && onTip) ? () => onTip(address) : null}
              />
              <span className="message-time">{fmtTime(m.ts)}</span>
            </div>
          </div>
        ))}

        {hiddenCount > 0 && (
          <button className="thread-unpaid-toggle" onClick={() => setShowUnpaid((s) => !s)}>
            {showUnpaid
              ? t('messenger.hideUnpaid')
              : t('messenger.showUnpaid', { n: hiddenCount })}
          </button>
        )}
      </div>

      {replyTo && (
        <div className="reply-bar">
          <ReplyIcon size={14} />
          <div className="reply-bar-body">
            <span className="reply-bar-text">{replyTo.text}</span>
          </div>
          <button className="reply-bar-close" onClick={() => setReplyTo(null)}><CloseIcon size={14} /></button>
        </div>
      )}

      <div className="thread-composer">
        <textarea
          className="thread-input"
          value={text}
          maxLength={limit}
          placeholder={t('messenger.typeMessage')}
          rows={1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
        />
        <span className={`thread-charcount ${overflowing ? 'over' : ''}`} title={t('messenger.bytesLeft')}>
          {remaining}
        </span>
        <button className="thread-send-btn" onClick={send} disabled={sending || !text.trim() || overflowing}>
          <SendArrowIcon size={20} />
        </button>
      </div>
    </div>
  )
}
