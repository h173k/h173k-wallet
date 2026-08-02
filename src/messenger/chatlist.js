/**
 * h173k Wallet - Chat list assembly.
 *
 * Individual conversations and groups share one list, so the ordering and
 * filtering rules live here rather than inside the view: the same function
 * backs the chips on the list and the preference in messenger settings.
 */

import { store, lastTs } from './messenger'
import { groupStore, lastGroupTs } from './groups'

/**
 * Merge conversations and groups into a single ordered list.
 *
 * @param {string} mode one of SORT_MODES:
 *   recent       everything newest-first (default)
 *   groupsFirst  groups on top, individual conversations below
 *   directFirst  individual conversations on top, groups below
 *   groupsOnly   groups only (individual conversations hidden)
 *   directOnly   individual conversations only (groups hidden)
 * @returns {Array<{kind:'direct'|'group', key:string, ts:number, thread?, group?}>}
 */
export function buildChatList(mode) {
  const direct = store.getVisibleThreads().map((t) => ({
    kind: 'direct',
    key: 'd:' + t.address,
    ts: lastTs(t),
    thread: t,
  }))
  const groups = groupStore.all().map((g) => ({
    kind: 'group',
    key: 'g:' + g.id,
    ts: lastGroupTs(g),
    group: g,
  }))

  const byTime = (a, b) => b.ts - a.ts

  switch (mode) {
    case 'groupsOnly':
      return groups.sort(byTime)
    case 'directOnly':
      return direct.sort(byTime)
    case 'groupsFirst':
      return [...groups.sort(byTime), ...direct.sort(byTime)]
    case 'directFirst':
      return [...direct.sort(byTime), ...groups.sort(byTime)]
    case 'recent':
    default:
      return [...direct, ...groups].sort(byTime)
  }
}
