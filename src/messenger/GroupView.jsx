/**
 * H173K Wallet - Group chat screens.
 *
 *  CreateGroupView  admin sets the name, the h173k a member must hold to join
 *                   and the cost of a message inside the group
 *  JoinGroupView    applicant side; refuses to send the request at all when the
 *                   balance requirement is not met
 *  GroupChatView    the conversation itself, with replies
 *  GroupInfoView    invite link, pending requests, members, group rules
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from '../i18n'
import { useSwap } from '../hooks/useSwap'
import { sessionWallet } from '../crypto/wallet'
import {
  BackIcon, RefreshIcon, SendArrowIcon, ReplyIcon, CloseIcon, CheckIcon,
  LinkIcon, CopyIcon, TrashIcon, SettingsIcon, GroupIcon, TipIcon,
} from './icons'
import {
  groupStore,
  createGroup,
  sendGroupMessage,
  scanGroup,
  buildInviteLink,
  parseInviteParam,
  sendJoinRequest,
  approveJoinRequest,
  declineJoinRequest,
  removeMember,
  rotateInviteCode,
  leaveGroup,
  remainingGroupRoom,
  MAX_GROUP_NAME_LENGTH,
  MAX_GROUP_MESSAGE_LENGTH,
  MIN_GROUP_MSG_COST,
  INVITE_LINK_PARAM,
} from './groups'
import { getGroupDefaults, sanitizeFee } from './prefs'

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
function senderLabel(m) {
  return m.nick || shortAddr(m.from)
}
/** Pull an invitation out of whatever the user pasted: a full link or the raw code. */
export function inviteFromText(text) {
  const raw = String(text || '').trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    const param = url.searchParams.get(INVITE_LINK_PARAM)
    if (param) return parseInviteParam(param)
  } catch { /* not a URL — try the bare payload */ }
  const match = raw.match(/[?&]join=([^&\s]+)/)
  if (match) return parseInviteParam(match[1])
  return parseInviteParam(raw)
}

// ========== CREATE ==========
export function CreateGroupView({ connection, publicKey, onBack, onCreated, showToast }) {
  const { t } = useTranslation()
  const { withAutoSOL } = useSwap(connection, sessionWallet)
  const defaults = getGroupDefaults()

  const [name, setName] = useState('')
  const [minBalance, setMinBalance] = useState(String(defaults.minBalance || 0))
  const [msgCost, setMsgCost] = useState(String(defaults.msgCost || MIN_GROUP_MSG_COST))
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!name.trim()) { showToast(t('groups.enterName'), 'error'); return }
    setBusy(true)
    try {
      const group = await createGroup({
        connection,
        publicKey,
        name: name.trim(),
        minBalance: sanitizeFee(minBalance.replace(',', '.')),
        msgCost: sanitizeFee(msgCost.replace(',', '.')),
        withAutoSOL,
      })
      showToast(t('groups.created'), 'success')
      onCreated(group.id)
    } catch (err) {
      if (err.message === 'EMPTY_NAME') showToast(t('groups.enterName'), 'error')
      else showToast(t('groups.createFailed', { msg: err.message || '' }), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="messenger-view">
      <div className="view-header">
        <button className="back-btn" onClick={onBack}><BackIcon size={16} /> {t('common.back')}</button>
        <h2>{t('groups.createTitle')}</h2>
      </div>

      <div className="messenger-settings-body">
        <div className="msg-settings-section">
          <p className="msg-settings-desc">{t('groups.createDesc')}</p>

          <label className="msg-field-label">{t('groups.name')}</label>
          <input
            className="messenger-input"
            type="text"
            value={name}
            maxLength={MAX_GROUP_NAME_LENGTH}
            placeholder={t('groups.namePlaceholder')}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />

          <label className="msg-field-label">{t('groups.minBalance')}</label>
          <div className="msg-inline-field">
            <input
              className="messenger-input"
              type="text"
              inputMode="decimal"
              value={minBalance}
              onChange={(e) => setMinBalance(e.target.value.replace(/[^\d.,]/g, ''))}
            />
            <span className="msg-unit">h173k</span>
          </div>
          <p className="msg-settings-hint">{t('groups.minBalanceHint')}</p>

          <label className="msg-field-label">{t('groups.msgCost')}</label>
          <div className="msg-inline-field">
            <input
              className="messenger-input"
              type="text"
              inputMode="decimal"
              value={msgCost}
              onChange={(e) => setMsgCost(e.target.value.replace(/[^\d.,]/g, ''))}
            />
            <span className="msg-unit">h173k</span>
          </div>
          <p className="msg-settings-hint">{t('groups.msgCostHint', { n: MIN_GROUP_MSG_COST })}</p>

          <div className="msg-note">{t('groups.addressNote')}</div>

          <button className="btn btn-primary msg-full-btn" onClick={submit} disabled={busy}>
            {busy ? t('groups.creating') : t('groups.createBtn')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ========== JOIN ==========
export function JoinGroupView({ connection, publicKey, balance, initialInvite, onBack, showToast }) {
  const { t } = useTranslation()
  const { withAutoSOL } = useSwap(connection, sessionWallet)
  const [linkText, setLinkText] = useState('')
  const [invite, setInvite] = useState(initialInvite || null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  const parse = () => {
    const parsed = inviteFromText(linkText)
    if (!parsed) { showToast(t('groups.badLink'), 'error'); return }
    setInvite(parsed)
  }

  const required = invite ? Number(invite.minBalance) || 0 : 0
  const have = Number(balance) || 0
  // The requirement is enforced here, before anything is sent: an application
  // that cannot meet it never reaches the admin's inbox.
  const meetsRequirement = required <= 0 || have >= required

  const submit = async () => {
    if (!invite) return
    if (!meetsRequirement) {
      showToast(t('groups.requirementNotMet', { required, have: have.toFixed(4) }), 'error')
      return
    }
    setBusy(true)
    try {
      await sendJoinRequest({ connection, publicKey, invite, withAutoSOL, balance: have })
      setSent(true)
      showToast(t('groups.requestSent'), 'success')
    } catch (err) {
      const msg = String(err.message || '')
      if (msg.startsWith('INSUFFICIENT_BALANCE:')) {
        const [, req, has] = msg.split(':')
        showToast(t('groups.requirementNotMet', { required: req, have: Number(has).toFixed(4) }), 'error')
      } else if (msg === 'OWN_GROUP') {
        showToast(t('groups.ownGroup'), 'error')
      } else if (msg === 'INVALID_INVITE') {
        showToast(t('groups.badLink'), 'error')
      } else {
        showToast(t('groups.requestFailed', { msg }), 'error')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="messenger-view">
      <div className="view-header">
        <button className="back-btn" onClick={onBack}><BackIcon size={16} /> {t('common.back')}</button>
        <h2>{t('groups.joinTitle')}</h2>
      </div>

      <div className="messenger-settings-body">
        <div className="msg-settings-section">
          {!invite && (
            <>
              <p className="msg-settings-desc">{t('groups.joinDesc')}</p>
              <input
                className="messenger-input"
                type="text"
                value={linkText}
                placeholder={t('groups.linkPlaceholder')}
                onChange={(e) => setLinkText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') parse() }}
                autoFocus
              />
              <button className="btn btn-primary msg-full-btn" onClick={parse}>{t('groups.checkLink')}</button>
            </>
          )}

          {invite && (
            <>
              <div className="msg-invite-card">
                <div className="msg-invite-name"><GroupIcon size={16} /> {invite.name || t('groups.unnamed')}</div>
                <div className="msg-invite-row">
                  <span>{t('groups.admin')}</span><span>{shortAddr(invite.admin)}</span>
                </div>
                <div className="msg-invite-row">
                  <span>{t('groups.minBalance')}</span>
                  <span>{required > 0 ? `${required} h173k` : t('groups.noRequirement')}</span>
                </div>
                <div className="msg-invite-row">
                  <span>{t('groups.msgCost')}</span>
                  <span>{invite.msgCost || MIN_GROUP_MSG_COST} h173k</span>
                </div>
                <div className="msg-invite-row">
                  <span>{t('groups.yourBalance')}</span><span>{have.toFixed(5)} h173k</span>
                </div>
              </div>

              {!meetsRequirement && (
                <div className="msg-blocked">
                  <strong>{t('groups.blockedTitle')}</strong>
                  <p>{t('groups.blockedBody', { required, have: have.toFixed(5) })}</p>
                  <p className="msg-settings-hint">{t('groups.blockedHint')}</p>
                </div>
              )}

              {sent ? (
                <div className="msg-note">{t('groups.requestPending')}</div>
              ) : (
                <button
                  className="btn btn-primary msg-full-btn"
                  onClick={submit}
                  disabled={busy || !meetsRequirement}
                >
                  {busy ? t('groups.sending') : t('groups.sendRequest')}
                </button>
              )}
              {!sent && meetsRequirement && (
                <p className="msg-settings-hint">{t('groups.sendRequestHint')}</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ========== GROUP CHAT ==========
export function GroupChatView({ connection, publicKey, groupId, onBack, showToast, onTip }) {
  const { t } = useTranslation()
  const { withAutoSOL } = useSwap(connection, sessionWallet)
  const [refreshing, setRefreshing] = useState(false)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [replyTo, setReplyTo] = useState(null)
  const [showInfo, setShowInfo] = useState(false)

  const group = groupStore.get(groupId)
  const scrollRef = useRef(null)
  const touchStartY = useRef(0)
  const isPulling = useRef(false)
  const [pullProgress, setPullProgress] = useState(0)

  const doRefresh = useCallback(async () => {
    setRefreshing(true)
    try { await scanGroup(connection, publicKey, groupId); groupStore.markRead(groupId) }
    catch { /* quiet */ }
    setTimeout(() => setRefreshing(false), 400)
  }, [connection, publicKey, groupId])

  useEffect(() => { doRefresh() }, [doRefresh])

  useEffect(() => {
    try { window.__h173k_active_group = groupId } catch {}
    return () => { try { window.__h173k_active_group = null } catch {} }
  }, [groupId])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [group ? group.messages.length : 0])

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

  if (!group) {
    return (
      <div className="messenger-view">
        <div className="view-header">
          <button className="back-btn" onClick={onBack}><BackIcon size={16} /> {t('common.back')}</button>
          <h2>{t('groups.title')}</h2>
        </div>
        <div className="messenger-empty"><p>{t('groups.gone')}</p></div>
      </div>
    )
  }

  if (showInfo) {
    return (
      <GroupInfoView
        connection={connection}
        publicKey={publicKey}
        groupId={groupId}
        onBack={() => setShowInfo(false)}
        onLeft={onBack}
        showToast={showToast}
      />
    )
  }

  const send = async () => {
    const trimmed = text.trim()
    if (!trimmed) return
    setSending(true)
    try {
      await sendGroupMessage({
        connection, publicKey, groupId,
        text: trimmed,
        replyTo: replyTo ? { id: replyTo.id, nick: senderLabel(replyTo), text: replyTo.text } : null,
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

  const pending = Object.keys(group.pending || {}).length
  // Counted in memo bytes rather than characters, so non-Latin alphabets are
  // measured honestly instead of failing at send time.
  const remaining = remainingGroupRoom({
    groupId,
    myAddress: publicKey.toBase58(),
    text,
    replyTo: replyTo ? { id: replyTo.id, nick: senderLabel(replyTo), text: replyTo.text } : null,
  })
  const overflowing = remaining < 0

  return (
    <div className="messenger-view thread-view">
      <div className="view-header">
        <button className="back-btn" onClick={onBack}><BackIcon size={16} /> {t('common.back')}</button>
        <div className="thread-title-block">
          <span className="thread-title">{group.name}</span>
          <span className="thread-subtitle">
            {t('groups.membersCount', { n: Object.keys(group.members || {}).length + 1 })} · {group.msgCost} h173k
          </span>
        </div>
        <button className={`messenger-refresh-btn ${refreshing ? 'refreshing' : ''}`} onClick={doRefresh} disabled={refreshing} title={t('history.refresh')}>
          <RefreshIcon size={18} />
        </button>
        <button className="messenger-add-btn" onClick={() => setShowInfo(true)} title={t('groups.info')}>
          <SettingsIcon size={18} />
          {pending > 0 && <span className="messenger-badge small">{pending}</span>}
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

        {group.messages.length === 0 && (
          <div className="thread-empty">
            <p>{t('messenger.noMessages')}</p>
            <p className="thread-empty-sub">{t('groups.firstMessageNote', { n: group.msgCost })}</p>
          </div>
        )}


        {group.messages.map((m) => (
          <div key={m.id} className={`message-bubble ${m.dir === 'out' ? 'out' : 'in'}`}>
            {m.dir === 'in' && <div className="message-sender">{senderLabel(m)}</div>}
            {m.reply && (
              <div className="message-quote">
                <span className="message-quote-nick">{m.reply.nick || ''}</span>
                <span className="message-quote-text">{m.reply.text}</span>
              </div>
            )}
            <div className="message-text">{m.text}</div>
            <div className="message-meta">
              <button className="message-reply-btn" onClick={() => setReplyTo(m)} title={t('groups.reply')}>
                <ReplyIcon size={13} />
              </button>
              {m.dir === 'in' && m.from && onTip && (
                <button className="message-reply-btn" onClick={() => onTip(m.from)} title={t('messenger.tip')}>
                  <TipIcon size={13} />
                </button>
              )}
              {fmtTime(m.ts)}
            </div>
          </div>
        ))}
      </div>

      {replyTo && (
        <div className="reply-bar">
          <ReplyIcon size={14} />
          <div className="reply-bar-body">
            <span className="reply-bar-nick">{senderLabel(replyTo)}</span>
            <span className="reply-bar-text">{replyTo.text}</span>
          </div>
          <button className="reply-bar-close" onClick={() => setReplyTo(null)}><CloseIcon size={14} /></button>
        </div>
      )}

      <div className="thread-composer">
        <textarea
          className="thread-input"
          value={text}
          maxLength={MAX_GROUP_MESSAGE_LENGTH}
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

// ========== GROUP INFO / ADMIN ==========
export function GroupInfoView({ connection, publicKey, groupId, onBack, onLeft, showToast }) {
  const { t } = useTranslation()
  const { withAutoSOL } = useSwap(connection, sessionWallet)
  const [busy, setBusy] = useState(null)
  const [confirmLeave, setConfirmLeave] = useState(false)

  const group = groupStore.get(groupId)
  if (!group) {
    return (
      <div className="messenger-view">
        <div className="view-header">
          <button className="back-btn" onClick={onBack}><BackIcon size={16} /> {t('common.back')}</button>
          <h2>{t('groups.info')}</h2>
        </div>
        <div className="messenger-empty"><p>{t('groups.gone')}</p></div>
      </div>
    )
  }

  const link = group.isAdmin ? buildInviteLink(group) : null
  const pending = Object.entries(group.pending || {})
  const members = Object.entries(group.members || {})

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link)
      showToast(t('groups.linkCopied'), 'success')
    } catch {
      showToast(t('groups.copyFailed'), 'error')
    }
  }

  const approve = async (address) => {
    setBusy(address)
    try {
      await approveJoinRequest({ connection, publicKey, groupId, applicant: address, withAutoSOL })
      showToast(t('groups.approved'), 'success')
    } catch (err) {
      const msg = String(err.message || '')
      if (msg.startsWith('INSUFFICIENT_BALANCE:')) {
        const [, req, has] = msg.split(':')
        showToast(t('groups.applicantBelow', { required: req, have: Number(has).toFixed(4) }), 'error')
      } else {
        showToast(t('groups.approveFailed', { msg }), 'error')
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="messenger-view messenger-settings-view">
      <div className="view-header">
        <button className="back-btn" onClick={onBack}><BackIcon size={16} /> {t('common.back')}</button>
        <h2>{group.name}</h2>
      </div>

      <div className="messenger-settings-body">
        <div className="msg-settings-section">
          <h3>{t('groups.rules')}</h3>
          <div className="msg-invite-row"><span>{t('groups.minBalance')}</span>
            <span>{group.minBalance > 0 ? `${group.minBalance} h173k` : t('groups.noRequirement')}</span></div>
          <div className="msg-invite-row"><span>{t('groups.msgCost')}</span><span>{group.msgCost} h173k</span></div>
          <div className="msg-invite-row"><span>{t('groups.admin')}</span>
            <span>{group.isAdmin ? t('groups.you') : shortAddr(group.admin)}</span></div>
          <p className="msg-settings-hint">{t('groups.costGoesToAdmin')}</p>
          <p className="msg-settings-hint">{t('groups.addressPrivate')}</p>
        </div>

        {group.isAdmin && (
          <div className="msg-settings-section">
            <h3><LinkIcon size={15} /> {t('groups.inviteLink')}</h3>
            <p className="msg-settings-desc">{t('groups.inviteLinkDesc')}</p>
            <div className="msg-link-box">{link}</div>
            <div className="msg-btn-row">
              <button className="btn btn-secondary" onClick={copyLink}><CopyIcon size={14} /> {t('groups.copyLink')}</button>
              <button className="btn btn-secondary" onClick={() => { rotateInviteCode(groupId); showToast(t('groups.codeRotated'), 'info') }}>
                {t('groups.rotateCode')}
              </button>
            </div>
          </div>
        )}

        {group.isAdmin && (
          <div className="msg-settings-section">
            <h3>{t('groups.requests')} {pending.length > 0 && <span className="msg-count">{pending.length}</span>}</h3>
            {pending.length === 0 && <p className="msg-settings-hint">{t('groups.noRequests')}</p>}
            {pending.map(([address, entry]) => (
              <div key={address} className="msg-request-row">
                <div className="msg-contact-name">
                  <span>{entry.nick || shortAddr(address)}</span>
                  <span className="msg-contact-addr">{shortAddr(address)}</span>
                </div>
                <div className="msg-request-actions">
                  <button className="conversation-action" disabled={busy === address} onClick={() => approve(address)} title={t('groups.approve')}>
                    <CheckIcon size={15} />
                  </button>
                  <button className="conversation-action danger" onClick={() => { declineJoinRequest(groupId, address); showToast(t('groups.declined'), 'info') }} title={t('groups.decline')}>
                    <CloseIcon size={15} />
                  </button>
                </div>
              </div>
            ))}
            <p className="msg-settings-hint">{t('groups.autoFilterNote')}</p>
          </div>
        )}

        <div className="msg-settings-section">
          <h3>{t('groups.members')}</h3>
          {members.length === 0 && <p className="msg-settings-hint">{t('groups.noMembers')}</p>}
          {group.isAdmin && members.length > 0 && (
            <p className="msg-settings-hint">{t('groups.removeMemberWarning')}</p>
          )}
          {members.map(([address, entry]) => (
            <div key={address} className="msg-contact-row">
              <div className="msg-contact-name">
                <span>{entry.nick || shortAddr(address)}</span>
                <span className="msg-contact-addr">{shortAddr(address)}</span>
              </div>
              {group.isAdmin && (
                <button className="conversation-action danger" onClick={() => { removeMember(groupId, address); showToast(t('groups.memberRemoved'), 'info') }} title={t('groups.removeMember')}>
                  <TrashIcon size={14} />
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="msg-settings-section danger">
          <h3>{t('groups.dangerZone')}</h3>
          {!confirmLeave ? (
            <button className="btn btn-danger msg-full-btn" onClick={() => setConfirmLeave(true)}>
              {group.isAdmin ? t('groups.deleteGroup') : t('groups.leaveGroup')}
            </button>
          ) : (
            <>
              <p className="msg-settings-hint">{group.isAdmin ? t('groups.deleteWarning') : t('groups.leaveWarning')}</p>
              <div className="msg-btn-row">
                <button className="btn btn-secondary" onClick={() => setConfirmLeave(false)}>{t('common.cancel')}</button>
                <button className="btn btn-danger" onClick={() => { leaveGroup(groupId); showToast(t('groups.left'), 'info'); onLeft() }}>
                  {t('common.confirm')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
