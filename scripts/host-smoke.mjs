/**
 * host-smoke.mjs — end-to-end smoke test for the host half logic.
 *
 * Builds a fake $DSH_HOME in a temp dir with two archived sessions and one
 * non-archived session, then verifies:
 *   1. listArchives returns only archived sessions with metadata;
 *   2. deleteArchivedSessions removes an archived session (json + disk);
 *   3. a non-archived session id is rejected via `notArchived`;
 *   4. a live session id is rejected via `live`.
 */
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'dsh-ac-test-'))
process.env.DSH_HOME = home

const { listArchives, deleteArchivedSessions } = await import('../lib/index.js')

// ---- build fixture ----
mkdirSync(join(home, 'storages'), { recursive: true })
mkdirSync(join(home, 'sessions', 'proj-a', 'sess-archived-1'), { recursive: true })
mkdirSync(join(home, 'sessions', 'proj-a', 'sess-archived-2'), { recursive: true })
mkdirSync(join(home, 'sessions', 'proj-a', 'sess-active'), { recursive: true })
writeFileSync(join(home, 'sessions', 'proj-a', 'sess-archived-1', 'session.v4.jsonl'),
  JSON.stringify({ type: 'session', createdAt: 1700000000000, cwd: '/proj-a' }) + '\n' +
  JSON.stringify({ type: 'session/title/set', title: '归档会话一' }) + '\n')
writeFileSync(join(home, 'sessions', 'proj-a', 'sess-archived-2', 'session.v4.jsonl.zstd'),
  Buffer.from('not-a-real-zstd')) // decode failure tolerated; meta comes from projcache
writeFileSync(join(home, 'sessions', 'proj-a', 'sess-active', 'session.v4.jsonl'),
  JSON.stringify({ type: 'session', createdAt: 1700000002000, cwd: '/proj-a' }) + '\n')

writeFileSync(join(home, 'storages', 'workspace.json'), JSON.stringify({
  global: { archivedSessionIds: ['sess-archived-1', 'sess-archived-2', 'sess-live'] },
  tables: {
    workspaces: {
      'ws-1': { path: '/proj-a', title: 'proj-a', sessionIds: ['sess-archived-1', 'sess-archived-2', 'sess-active'] },
    },
  },
}))
// 0.2+ layout: one JSON per session under session_projcache/sessions/
mkdirSync(join(home, 'storages', 'session_projcache', 'sessions'), { recursive: true })
const meta = (createdAt, title, turns = 0) => JSON.stringify({
  version: 7,
  record: {
    identity: { createdAt },
    rows: { title: { val: title }, sessionStats: { val: { turns } } },
  },
})
writeFileSync(join(home, 'storages', 'session_projcache', 'sessions', 'sess-archived-1.json'),
  meta(1700000000000, '归档会话一', 3))
writeFileSync(join(home, 'storages', 'session_projcache', 'sessions', 'sess-active.json'),
  meta(1700000002000, '活跃会话', 1))

// fake cordis ctx, mimicking 0.2.2 behavior:
//   - the sessions store keeps EVERY known session entered (archived included),
//     so sessions.get() is truthy for all ids;
//   - only the agents registry distinguishes a running turn (status 'running').
const ctx = {
  sessions: {
    get: (id) => ({ id }), // 0.2.2: truthy for any known id
  },
  agents: {
    get: (id) => (id === 'sess-live' ? { id, status: 'running' } : undefined),
  },
  emit: () => {},
}

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg)
}

// 1. list
const list = listArchives(ctx)
assert(list.length === 3, 'expected 3 archived entries, got ' + list.length)
const one = list.find((a) => a.sessionId === 'sess-archived-1')
assert(one && one.title === '归档会话一', 'title from 0.2+ projcache record, got ' + (one && one.title))
assert(one && one.turns === 3, 'turns from 0.2+ projcache record')
assert(one && one.hasDataFile, 'hasDataFile')
assert(list.find((a) => a.sessionId === 'sess-live')?.live === true, 'live badge')
assert(list.find((a) => a.sessionId === 'sess-archived-2')?.live === false,
  'archived sessions must NOT be marked live even though the 0.2.2 store keeps them')

// 2. delete archived
let r = await deleteArchivedSessions(ctx, ['sess-archived-1'])
assert(r.removed.includes('sess-archived-1'), 'archived removed')
assert(!existsSync(join(home, 'sessions', 'proj-a', 'sess-archived-1')), 'disk dir removed')
assert(!existsSync(join(home, 'storages', 'session_projcache', 'sessions', 'sess-archived-1.json')), 'projcache record removed')

// 3. non-archived rejected
r = await deleteArchivedSessions(ctx, ['sess-active'])
assert(r.notArchived.includes('sess-active'), 'non-archived rejected')
assert(existsSync(join(home, 'sessions', 'proj-a', 'sess-active')), 'active session untouched')

// 4. live rejected
r = await deleteArchivedSessions(ctx, ['sess-live'])
assert(r.live.includes('sess-live'), 'live rejected')

// 5. list after deletion
const list2 = listArchives(ctx)
assert(!list2.some((a) => a.sessionId === 'sess-archived-1'), 'deleted entry gone from list')

console.log('host-smoke OK: list / delete / notArchived guard / live guard all pass')
