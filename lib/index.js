/**
 * dsh-archived-cleaner — host half (plain JavaScript, zero external deps).
 *
 * Registers HTTP routes under /api/dsh-archived-cleaner/* that let the browser
 * settings section list archived sessions and permanently delete them.
 *
 * Routes (loopback-only, same-origin):
 *   GET  /api/dsh-archived-cleaner/archives — list archived sessions with metadata
 *   POST /api/dsh-archived-cleaner/delete   — permanently delete archived sessions
 *
 * Safety guarantees:
 *   - ONLY archived sessions can be deleted: any id not present in the archived
 *     set (workspaceRegistry state / workspace.json global.archivedSessionIds)
 *     is rejected with `notArchived`.
 *   - Live (in-memory, running) sessions are rejected with `live`.
 *   - Deletion is permanent: the on-disk session directory under
 *     $DSH_HOME/sessions/ is physically removed, and the session id is pruned
 *     from workspace.json / session_projcache.json / workspaceRegistry state.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  rmSync,
  statSync,
  readdirSync,
} from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { homedir } from 'node:os'
import { zstdDecompressSync } from 'node:zlib'

/** Stable cordis plugin name. */
export const name = 'archived-cleaner'

/** Services required (webServer for route registration, workspaceRegistry for live state sync). */
export const inject = ['webServer', 'workspaceRegistry']

/** API path prefix. */
const API_PREFIX = '/api/dsh-archived-cleaner'

/** Cap on JSON request bodies. */
const MAX_JSON_BODY_BYTES = 512 * 1024

const ZSTD_MAGIC = 4247762216

/** DSH home directory (env override first, then the official default). */
export function dshHome() {
  const env = process.env.DSH_HOME
  if (typeof env === 'string' && env.trim()) return env.trim()
  return join(homedir(), '.dsh')
}

/** Path to workspace.json. */
export function workspacePath() {
  return join(dshHome(), 'storages', 'workspace.json')
}

/** Legacy single-file projection cache path (pre-0.2 layout). */
export function projcachePath() {
  return join(dshHome(), 'storages', 'session_projcache.json')
}

/** Per-session projection cache directory (0.2+ layout: one JSON per session). */
export function projcacheSessionsDir() {
  return join(dshHome(), 'storages', 'session_projcache', 'sessions')
}

/** Path to sessions directory. */
export function sessionsDir() {
  return join(dshHome(), 'sessions')
}

/** Read and parse JSON safely. */
export function readJsonFile(filePath) {
  if (!existsSync(filePath)) return undefined
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return undefined
  }
}

/** Write JSON atomically (tmp + rename). */
export function writeJsonFile(filePath, data) {
  const dir = dirname(filePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tmp = filePath + '.tmp'
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
  renameSync(tmp, filePath)
}

/** Encode segment helper matching dsh internal session persistence. */
export function encodeSegment(raw) {
  if (!raw || raw.length === 0) return ''
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) out += ch
    else out += '~' + code.toString(16).toUpperCase().padStart(4, '0')
  }
  return out
}

/**
 * Find the session data directory for a given session id.
 * Searches all workspace sub-directories under ~/.dsh/sessions/.
 */
export function findSessionDir(sessionId) {
  const root = sessionsDir()
  if (!existsSync(root)) return undefined
  const encoded = encodeSegment(sessionId)
  try {
    for (const entry of readdirSync(root)) {
      const dir = join(root, entry)
      try {
        if (statSync(dir).isDirectory()) {
          const directDir = join(dir, sessionId)
          if (existsSync(directDir)) return directDir
          if (encoded && encoded !== sessionId) {
            const encodedDir = join(dir, encoded)
            if (existsSync(encodedDir)) return encodedDir
          }
        }
      } catch {
        // skip unreadable entries
      }
    }
  } catch {}
  return undefined
}

/** Safely remove a directory with retry on Windows. */
export function safeRemoveDir(targetDir, maxRetries = 3) {
  if (!existsSync(targetDir)) return true
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      rmSync(targetDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
      return true
    } catch (err) {
      if (attempt === maxRetries) throw err
      const wait = 150 * attempt
      const start = Date.now()
      while (Date.now() - start < wait) {}
    }
  }
  return false
}

/** Clean up empty project directory under ~/.dsh/sessions/. */
export function cleanEmptyProjectDir(sessionDirPath) {
  try {
    const parentDir = dirname(sessionDirPath)
    const root = sessionsDir()
    if (parentDir !== root && dirname(parentDir) === root) {
      const remaining = readdirSync(parentDir)
      if (remaining.length === 0) {
        rmSync(parentDir, { recursive: true, force: true })
      }
    }
  } catch {}
}

/** Get total size of a directory (recursive). */
export function dirSize(dir) {
  let total = 0
  if (!existsSync(dir)) return 0
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      const stat = statSync(full)
      if (stat.isDirectory()) {
        total += dirSize(full)
      } else {
        total += stat.size
      }
    }
  } catch {
    // best effort
  }
  return total
}

/** Scan Zstandard frames from a concatenated buffer. */
export function scanZstdFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) break
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) break
    offset += 4
    if (offset === buffer.length) break
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 24) !== 0) break
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) break
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) break
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      if (blockType === 3) break
      const payloadBytes = blockType === 1 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) break
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) break
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return frames
}

/** Decompress multi-frame zstd session log to UTF-8 text using Node built-in zlib. */
export function decodeZstdLog(filePath) {
  if (!existsSync(filePath)) return ''
  try {
    const buf = readFileSync(filePath)
    const frames = scanZstdFrames(buf)
    if (frames.length === 0) {
      try {
        return zstdDecompressSync(buf).toString('utf8')
      } catch {
        return ''
      }
    }
    const chunks = []
    for (const { start, end } of frames) {
      try {
        chunks.push(zstdDecompressSync(buf.subarray(start, end)))
      } catch {
        // tolerate trailing damaged frame
      }
    }
    return Buffer.concat(chunks).toString('utf8')
  } catch {
    return ''
  }
}

/** Find the transcript file inside a session data directory (any format version,
 *  e.g. session.jsonl, session.jsonl.zstd, session.v4.jsonl.zstd). */
export function findTranscriptFile(dataDir) {
  try {
    for (const entry of readdirSync(dataDir)) {
      if (/^session(?:\.v\d+)?\.jsonl(\.zstd)?$/.test(entry)) return join(dataDir, entry)
    }
  } catch {}
  return undefined
}

/** Read full transcript text from a session data directory. */
export function readTranscriptText(dataDir) {
  const file = findTranscriptFile(dataDir)
  if (!file) return ''
  if (file.endsWith('.zstd')) {
    return decodeZstdLog(file)
  }
  try {
    return readFileSync(file, 'utf8')
  } catch {}
  return ''
}

/** Read title and metadata directly from the session log data file (fallback path). */
export function readSessionMetaFromDataFile(dataDir) {
  const rawText = readTranscriptText(dataDir)
  if (!rawText) return {}

  let title = null
  let createdAt = null
  let firstUserMsg = null
  let turns = 0

  const lines = rawText.split('\n')
  for (const line of lines) {
    if (!line) continue
    try {
      const ev = JSON.parse(line)
      if (ev.type === 'session') {
        if (ev.createdAt) createdAt = ev.createdAt
      } else if (ev.type === 'session/title/set' || ev.type === 'title') {
        title = ev.title || ev.data?.title || title
      } else if (ev.type === 'turn/start') {
        turns++
      } else if (!firstUserMsg && ev.type === 'user/message') {
        const contents = ev.data?.content || []
        for (const item of contents) {
          if (item && item.type === 'text' && typeof item.text === 'string') {
            let clean = item.text
            const reminderIdx = clean.indexOf('<system-reminder>')
            if (reminderIdx !== -1) clean = clean.slice(0, reminderIdx).trim()
            const runtimeIdx = clean.indexOf('Current runtime context.')
            if (runtimeIdx !== -1) clean = clean.slice(0, runtimeIdx).trim()
            if (clean) {
              firstUserMsg = clean.slice(0, 50)
              break
            }
          }
        }
      }
    } catch {}
  }
  return { title: title || firstUserMsg, createdAt, turns }
}

/** Resolve the authoritative archived-session id set. */
export function getArchivedIds(ctx, workspace) {
  const fromRegistry = ctx?.workspaceRegistry?.archivedSessionIds
  if (Array.isArray(fromRegistry)) return fromRegistry
  if (Array.isArray(workspace?.global?.archivedSessionIds)) return workspace.global.archivedSessionIds
  return []
}

/**
 * Read one session's projection record, supporting both storage layouts:
 *   - 0.2+:  storages/session_projcache/sessions/<id>.json  -> { version, record: { identity, rows } }
 *   - pre-0.2 (legacy single file): tables.sessions[id]     -> { identity, rows }
 */
export function readSessionMetaRecord(sid, legacySessions) {
  const p = join(projcacheSessionsDir(), sid + '.json')
  const data = readJsonFile(p)
  if (data) {
    if (data.record && typeof data.record === 'object') return data.record
    if (data.identity || data.rows) return data
  }
  return legacySessions?.[sid]
}

/** Remove a session's per-file projection record (0.2+ layout). */
export function removeSessionMetaRecord(sid) {
  const p = join(projcacheSessionsDir(), sid + '.json')
  if (!existsSync(p)) return false
  try {
    rmSync(p, { force: true })
    return true
  } catch {
    return false
  }
}

/** Check whether a session has an actively RUNNING agent turn.
 *  Note: in 0.2+ the sessions store keeps non-running (e.g. archived) sessions
 *  entered as well, so `sessions.get(id)` is NOT a reliable running signal —
 *  the agents registry's `status === 'running'` is. */
function isRunningSession(ctx, sid) {
  try {
    const agents = ctx?.get?.('agents') || ctx?.agents
    if (agents && typeof agents.get === 'function') {
      const agent = agents.get(sid)
      if (agent !== undefined) return agent?.status === 'running'
      return false
    }
  } catch {}
  // Fallback for old versions where only live sessions entered the store.
  try {
    const sessions = ctx?.get?.('sessions') || ctx?.sessions
    if (sessions && typeof sessions.get === 'function') {
      return Boolean(sessions.get(sid))
    }
  } catch {}
  return false
}

/**
 * List every archived session with metadata.
 * Ghost entries (no disk file AND no projcache record) are kept visible so the
 * user can still delete them to clean up the archived set.
 */
export function listArchives(ctx) {
  const workspace = readJsonFile(workspacePath())
  const legacyProjcache = readJsonFile(projcachePath())
  const legacySessions = legacyProjcache?.tables?.sessions ?? {}

  const archivedIds = getArchivedIds(ctx, workspace)
  const workspaces = workspace?.tables?.workspaces ?? {}

  // Build a reverse map: sessionId -> workspace info
  const sessionToWorkspace = new Map()
  for (const [wsId, ws] of Object.entries(workspaces)) {
    const wsPath = ws.path ?? ''
    const wsTitle = ws.title || (wsPath ? basename(wsPath) : '')
    for (const sid of ws.sessionIds ?? []) {
      sessionToWorkspace.set(sid, { id: wsId, path: wsPath, title: wsTitle })
    }
  }

  const result = []

  for (const sid of archivedIds) {
    const wsInfo = sessionToWorkspace.get(sid)
    const sessionMeta = readSessionMetaRecord(sid, legacySessions)
    const rows = sessionMeta?.rows ?? {}

    let title = rows.title?.val ?? null
    let createdAt = sessionMeta?.identity?.createdAt ?? null
    let turns = rows.sessionStats?.val?.turns ?? 0

    const dataDir = findSessionDir(sid)
    let dataSize = 0
    let hasDataFile = false

    if (dataDir !== undefined) {
      dataSize = dirSize(dataDir)
      hasDataFile = findTranscriptFile(dataDir) !== undefined

      // Fallback extraction from data file
      if (hasDataFile && (!title || !createdAt || turns === 0)) {
        const fileMeta = readSessionMetaFromDataFile(dataDir)
        if (!title && fileMeta.title) title = fileMeta.title
        if (!createdAt && fileMeta.createdAt) createdAt = fileMeta.createdAt
        if (turns === 0 && fileMeta.turns) turns = fileMeta.turns
      }
    }

    result.push({
      sessionId: sid,
      title: title || null,
      workspacePath: wsInfo?.path ?? null,
      workspaceTitle: wsInfo?.title ?? null,
      workspaceId: wsInfo?.id ?? null,
      createdAt,
      turns,
      dataSize,
      hasDataFile,
      ghost: !hasDataFile && !sessionMeta,
      live: isRunningSession(ctx, sid),
    })
  }

  result.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  return result
}

/**
 * Permanently delete one or more ARCHIVED sessions.
 *
 * Hard rules:
 *   - ids not in the archived set are rejected (`notArchived`) — this plugin
 *     will never delete a non-archived conversation;
 *   - live sessions are rejected (`live`).
 *
 * For each accepted id:
 *   1. Detach any lingering in-memory session entry & emit 'session/disposed'
 *      so dsh-host-apiproxy broadcasts 'host/session-removed' to all frontends
 *   2. Prune workspaceRegistry memory indexes & sessionProjectionCache rows
 *   3. Remove from workspace.json -> global.archivedSessionIds
 *   4. Remove from every workspace in workspace.json -> tables.workspaces[id].sessionIds
 *   5. Remove metadata from session_projcache.json
 *   6. Physically remove the on-disk session data directory
 *   7. Push updated state to workspaceRegistry (notifies all frontend clients)
 *   8. Persist JSON stores atomically
 */
export async function deleteArchivedSessions(ctx, sessionIds) {
  const removed = []
  const notFound = []
  const notArchived = []
  const live = []
  const errors = []

  const workspace = readJsonFile(workspacePath())
  const legacyProjcache = readJsonFile(projcachePath())

  const archivedSet = new Set(getArchivedIds(ctx, workspace))

  let wsChanged = false
  let pcChanged = false

  for (const sid of sessionIds) {
    // Hard rule 1: archived only.
    if (!archivedSet.has(sid)) {
      notArchived.push(sid)
      continue
    }

    // Hard rule 2: never delete a session with a running agent turn.
    if (isRunningSession(ctx, sid)) {
      live.push(sid)
      continue
    }

    let found = false

    // 1. Detach a lingering (non-live) in-memory session entry, then broadcast.
    try {
      const sessions = ctx?.get?.('sessions') || ctx?.sessions
      if (sessions && typeof sessions.get === 'function') {
        const liveEntry = sessions.get(sid)
        if (liveEntry) {
          const entry = sessions.liveEntryFor?.(liveEntry) || sessions.store?.get?.(sid)
          if (entry && typeof entry.detach === 'function') {
            entry.detach()
          }
        }
      }
    } catch {}

    try {
      if (typeof ctx?.emit === 'function') {
        ctx.emit('session/disposed', { id: sid, session: { id: sid } })
      }
    } catch {}

    // 2. Clear workspaceRegistry / projection cache internal memory mappings.
    try {
      const registry = ctx?.workspaceRegistry
      if (registry) {
        if (registry.headers instanceof Map) registry.headers.delete(sid)
        if (registry.sessionPaths instanceof Map) registry.sessionPaths.delete(sid)
        if (registry.invalidSessionPaths instanceof Map) registry.invalidSessionPaths.delete(sid)
      }
    } catch {}

    try {
      const projCacheService = ctx?.get?.('sessionProjectionCache') || ctx?.sessionProjectionCache
      if (projCacheService?.cachedRows instanceof Map) {
        projCacheService.cachedRows.delete(sid)
      }
    } catch {}

    // 3. Remove from workspace.json -> global.archivedSessionIds
    if (workspace?.global?.archivedSessionIds) {
      const before = workspace.global.archivedSessionIds.length
      workspace.global.archivedSessionIds = workspace.global.archivedSessionIds.filter((id) => id !== sid)
      if (workspace.global.archivedSessionIds.length !== before) {
        wsChanged = true
        found = true
      }
    }

    // 4. Remove from every workspace's sessionIds in workspace.json
    if (workspace?.tables?.workspaces) {
      for (const ws of Object.values(workspace.tables.workspaces)) {
        if (Array.isArray(ws.sessionIds)) {
          const before = ws.sessionIds.length
          ws.sessionIds = ws.sessionIds.filter((id) => id !== sid)
          if (ws.sessionIds.length !== before) {
            wsChanged = true
            found = true
          }
        }
      }
    }

    // 5. Remove projection cache metadata (0.2+ per-file layout, then legacy)
    if (removeSessionMetaRecord(sid)) {
      found = true
    }
    if (legacyProjcache?.tables?.sessions && legacyProjcache.tables.sessions[sid] !== undefined) {
      delete legacyProjcache.tables.sessions[sid]
      pcChanged = true
      found = true
    }

    // 6. Physically remove the session data directory on disk
    const dataDir = findSessionDir(sid)
    if (dataDir !== undefined) {
      try {
        safeRemoveDir(dataDir)
        cleanEmptyProjectDir(dataDir)
        found = true
      } catch (err) {
        errors.push(sid + ': ' + (err instanceof Error ? err.message : String(err)))
      }
    }

    if (found) {
      removed.push(sid)
    } else {
      notFound.push(sid)
    }
  }

  // 7. Sync workspaceRegistry live memory via public detachSession & setState
  const registry = ctx?.workspaceRegistry
  if (registry && removed.length > 0) {
    try {
      if (registry.entities && typeof registry.entities.values === 'function') {
        for (const entity of registry.entities.values()) {
          if (typeof entity.detachSession === 'function') {
            for (const sid of removed) {
              try {
                await entity.detachSession(sid)
              } catch {}
            }
          }
        }
      }

      const table = typeof registry.requireTable === 'function' ? registry.requireTable() : null
      if (table && workspace?.tables?.workspaces) {
        for (const [wsId, ws] of Object.entries(workspace.tables.workspaces)) {
          try {
            await table.set(wsId, ws)
          } catch {}
        }
      }

      if (typeof registry.requireState === 'function' && typeof registry.setState === 'function') {
        const state = registry.requireState()
        const currentArchived = Array.isArray(state.archivedSessionIds) ? [...state.archivedSessionIds] : []
        const nextArchived = currentArchived.filter((id) => !removed.includes(id))
        if (nextArchived.length !== currentArchived.length) {
          await registry.setState({
            ...state,
            archivedSessionIds: nextArchived,
          })
        }
      }
    } catch (err) {
      errors.push('workspaceRegistry sync: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  // 8. Persist atomic writes to disk
  if (wsChanged && workspace !== undefined) {
    try {
      writeJsonFile(workspacePath(), workspace)
    } catch (err) {
      errors.push('workspace.json write: ' + (err instanceof Error ? err.message : String(err)))
    }
  }
  if (pcChanged && legacyProjcache !== undefined) {
    try {
      writeJsonFile(projcachePath(), legacyProjcache)
    } catch (err) {
      errors.push('session_projcache.json write: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  return { removed, notFound, notArchived, live, errors }
}

/** Loopback literal check plus browser same-origin markers. */
function isLoopbackRequest(request) {
  const address = request.socket?.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl
  try {
    hostUrl = new URL('http://' + host)
  } catch {
    return false
  }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/** Write a JSON response. */
function writeJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'referrer-policy': 'no-referrer',
  })
  res.end(payload)
}

/** Read a JSON request body. */
async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk
    size += buffer.length
    if (size > MAX_JSON_BODY_BYTES) return undefined
    chunks.push(buffer)
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined
  } catch {
    return undefined
  }
}

/** Mount the archived-cleaner HTTP routes. */
export function apply(ctx, _config) {
  const listRoute = {
    kind: 'exact',
    path: API_PREFIX + '/archives',
    handler: async (req, res) => {
      if (!isLoopbackRequest(req)) {
        writeJson(res, 403, { error: 'forbidden: loopback-only' })
        return
      }
      if (req.method !== 'GET') {
        writeJson(res, 405, { error: 'method not allowed: ' + req.method })
        return
      }
      try {
        const archives = listArchives(ctx)
        writeJson(res, 200, { archives, total: archives.length })
      } catch (err) {
        writeJson(res, 500, { error: err instanceof Error ? err.message : String(err) })
      }
    },
  }

  const deleteRoute = {
    kind: 'exact',
    path: API_PREFIX + '/delete',
    handler: async (req, res) => {
      if (!isLoopbackRequest(req)) {
        writeJson(res, 403, { error: 'forbidden: loopback-only' })
        return
      }
      if (req.method !== 'POST') {
        writeJson(res, 405, { error: 'method not allowed: ' + req.method })
        return
      }
      const body = await readJsonBody(req)
      if (body === undefined) {
        writeJson(res, 400, { error: 'invalid JSON body' })
        return
      }
      const ids = Array.isArray(body.sessionIds)
        ? body.sessionIds.filter((x) => typeof x === 'string')
        : typeof body.sessionId === 'string'
          ? [body.sessionId]
          : []
      if (ids.length === 0) {
        writeJson(res, 400, { error: 'sessionIds (array) or sessionId (string) is required' })
        return
      }
      try {
        const result = await deleteArchivedSessions(ctx, ids)
        // 409 when nothing could be deleted because of the archived-only /
        // live-only guards, so the UI can surface a clear message.
        const guarded = result.notArchived.length > 0 || result.live.length > 0
        writeJson(res, guarded && result.removed.length === 0 ? 409 : 200, result)
      } catch (err) {
        writeJson(res, 500, { error: err instanceof Error ? err.message : String(err) })
      }
    },
  }

  const routes = [listRoute, deleteRoute]

  ctx.effect(
    () => {
      const disposers = routes.map((r) => ctx.webServer.register(r))
      return () => {
        for (const dispose of disposers) dispose()
      }
    },
    'dsh-archived-cleaner: routes',
  )
}
