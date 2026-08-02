/**
 * h173k Wallet - Per-message action menu.
 *
 * Reply and Tip used to be two 13px icons sitting side by side in the message
 * footer, which is well under the ~44px that a fingertip can reliably hit and
 * left the two targets adjacent — so a near miss on Reply landed on Tip, which
 * navigates away to the send screen. One comfortably sized trigger opening a
 * menu of full-width rows removes both problems.
 *
 * Used by individual conversations and by group chats, which differ only in who
 * the tip is addressed to.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from '../i18n'
import { ReplyIcon, TipIcon } from './icons'

function MoreIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.9" />
      <circle cx="12" cy="12" r="1.9" />
      <circle cx="19" cy="12" r="1.9" />
    </svg>
  )
}

/**
 * @param {function} onReply   quote this message in the composer
 * @param {function} onTip     open the send screen for this message's sender;
 *                             omit to hide the action (own messages, or when
 *                             the host provides no tip handler)
 * @param {string}   align     'start' for incoming bubbles, 'end' for outgoing
 */
export default function MessageActions({ onReply, onTip, align = 'start' }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  const close = useCallback(() => setOpen(false), [])

  // Close on an outside tap, on Escape, and on scroll — a menu anchored to a
  // bubble would otherwise drift away from it as the thread moves.
  useEffect(() => {
    if (!open) return
    const onPointer = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) close()
    }
    const onKey = (e) => { if (e.key === 'Escape') close() }
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('pointerdown', onPointer, true)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
    }
  }, [open, close])

  const run = (fn) => (e) => {
    e.stopPropagation()
    close()
    if (fn) fn()
  }

  return (
    <div className={`msg-actions ${align === 'end' ? 'align-end' : ''}`} ref={wrapRef}>
      <button
        type="button"
        className="msg-actions-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('messenger.messageActions')}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
      >
        <MoreIcon size={16} />
      </button>

      {open && (
        <div className="msg-actions-menu" role="menu">
          <button type="button" className="msg-actions-item" role="menuitem" onClick={run(onReply)}>
            <ReplyIcon size={15} />
            <span>{t('groups.reply')}</span>
          </button>
          {onTip && (
            <button type="button" className="msg-actions-item" role="menuitem" onClick={run(onTip)}>
              <TipIcon size={15} />
              <span>{t('messenger.tip')}</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
