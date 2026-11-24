/**
 * ui-test.mjs — real render & interaction test for the client bundle.
 *
 * Mounts the actual lib/client.js in jsdom with real React/react-dom and
 * simulates the full click flow:
 *   sidebar button -> panel opens -> list loads -> checkbox -> batch delete
 *   -> double-confirm modal -> confirm -> POST sent.
 */
import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

const here = dirname(fileURLToPath(import.meta.url))
const code = readFileSync(join(here, '..', '..', 'lib', 'client.js'), 'utf8')

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://127.0.0.1:3080/',
  pretendToBeVisual: true,
  runScripts: 'outside-only',
})
const { window } = dom
window.IS_REACT_ACT_ENVIRONMENT = true

// react-dom runs in the Node realm and needs the DOM globals there too.
globalThis.window = window
globalThis.document = window.document
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })
globalThis.IS_REACT_ACT_ENVIRONMENT = true

let loaded = null
window.__ModuleLoader__ = {
  load(spec) { loaded = spec },
}

// ---- fake host API state ----
const archiveRows = [
  { sessionId: 's-1', title: '测试会话一', workspaceTitle: 'proj-a', createdAt: 1700000000000, turns: 2, dataSize: 2048, ghost: false, live: false },
  { sessionId: 's-2', title: '测试会话二', workspaceTitle: 'proj-a', createdAt: 1700000100000, turns: 5, dataSize: 4096, ghost: false, live: false },
]
const calls = []
function fakeFetch(url, options) {
  calls.push({ url, options })
  let body
  if (url.endsWith('/archives')) {
    body = { archives: archiveRows, total: archiveRows.length }
  } else if (url.endsWith('/delete')) {
    const req = JSON.parse(options.body)
    body = { removed: req.sessionIds || [req.sessionId], notFound: [], notArchived: [], live: [], errors: [] }
  } else {
    return Promise.resolve({ ok: false, status: 404, statusText: 'not found', text: () => Promise.resolve('{"error":"not found"}') })
  }
  return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(body)), json: () => Promise.resolve(body) })
}
window.fetch = fakeFetch

// evaluate the bundle inside the jsdom realm (window/document/navigator come from jsdom)
window.eval(code)

if (!loaded || typeof loaded.factory !== 'function') throw new Error('bundle did not register')
const mod = loaded.factory((id) => {
  if (id === 'react') return React
  throw new Error('unexpected require: ' + id)
})

// ---- fake cordis ctx ----
let dict = {}
const slotEntries = new Map()
const ctx = {
  effect: (fn) => { fn() },
  locale: {
    register: (ns, table) => { dict = table.zh; return () => {} },
    bind: () => (k) => dict[k] ?? k,
    getSnapshot: () => ({ revision: 0 }),
    subscribe: () => () => {},
  },
  slots: {
    inject: (name, cb) => cb(),
    register: (desc, comp) => {
      if (!slotEntries.has(desc.name)) slotEntries.set(desc.name, [])
      slotEntries.get(desc.name).push({ options: desc, comp })
      return () => {}
    },
  },
}
mod.apply(ctx)

const footerEntries = slotEntries.get('sidebar.footer.action') || []
const sectionEntries = slotEntries.get('settings.section') || []
if (footerEntries.length === 0) throw new Error('sidebar.footer.action not registered')
if (sectionEntries.length === 0) throw new Error('settings.section not registered')

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg)
}

function click(el) {
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

// ================= sidebar entry flow =================
const container = window.document.createElement('div')
window.document.body.appendChild(container)
const root = createRoot(container)

const SidebarEntry = footerEntries[0].comp
await act(async () => { root.render(React.createElement(SidebarEntry, { wide: true })) })

const btn = container.querySelector('.dac-sidebar-btn')
assert(btn, 'sidebar button rendered')
assert(btn.textContent.includes('归档清理'), 'button label shows 归档清理, got: ' + btn.textContent)

// click 1: open the panel
await act(async () => { click(btn) })
const panel = window.document.querySelector('.dac-panel')
assert(panel, 'panel opens on single click')

// list loads
await flush()
await flush()
const items = window.document.querySelectorAll('.dac-panel .dac-item')
assert(items.length === 2, 'two archived sessions listed, got ' + items.length)
assert(window.document.querySelector('.dac-panel').textContent.includes('测试会话一'), 'title shown')

// click checkbox of first row
const checkbox = window.document.querySelector('.dac-panel .dac-item input[type="checkbox"]')
assert(checkbox, 'row checkbox exists')
await act(async () => { click(checkbox) })
assert(window.document.querySelector('.dac-selected-count')?.textContent.includes('1'), 'selected count shows 1')

// click batch delete -> double-confirm modal appears (nothing deleted yet)
const delBtn = [...window.document.querySelectorAll('.dac-panel .dac-btn-danger')].find((b) => b.textContent.includes('删除选中'))
assert(delBtn, 'batch delete button exists')
assert(!delBtn.disabled, 'batch delete button enabled')
await act(async () => { click(delBtn) })
const modal = window.document.querySelector('.dac-modal')
assert(modal, 'double-confirm modal appears')
assert(modal.textContent.includes('测试会话一'), 'modal lists the session title')
assert(!calls.some((c) => c.url.endsWith('/delete')), 'no delete request before confirm')

// cancel first (proves two-step), then reopen and confirm
const cancelBtn = [...modal.querySelectorAll('button')].find((b) => b.textContent.includes('取消'))
await act(async () => { click(cancelBtn) })
assert(!window.document.querySelector('.dac-modal'), 'modal closed on cancel')
assert(!calls.some((c) => c.url.endsWith('/delete')), 'cancel did not delete')

await act(async () => { click(delBtn) })
const modal2 = window.document.querySelector('.dac-modal')
const confirmBtn = [...modal2.querySelectorAll('button')].find((b) => b.textContent.includes('确认删除'))
assert(confirmBtn, 'confirm button exists')
await act(async () => { click(confirmBtn) })
await flush()
const delCalls = calls.filter((c) => c.url.endsWith('/delete'))
assert(delCalls.length === 1, 'exactly one delete request sent')
assert(JSON.parse(delCalls[0].options.body).sessionIds[0] === 's-1', 'deleted the selected session')

// close the panel via backdrop click? use close button
const closeBtn = window.document.querySelector('.dac-panel .dac-toast-close')
await act(async () => { click(closeBtn) })
assert(!window.document.querySelector('.dac-panel'), 'panel closes')

// ================= settings section flow =================
const container2 = window.document.createElement('div')
window.document.body.appendChild(container2)
const root2 = createRoot(container2)
const Section = sectionEntries[0].comp
await act(async () => { root2.render(React.createElement(Section, {})) })
await flush()
await flush()
assert(container2.textContent.includes('测试会话一'), 'settings section lists sessions')
assert(container2.textContent.includes('归档清理'), 'settings section header shown')

console.log('ui-test OK: sidebar one-click open / list / select / double-confirm / delete / close all work')
process.exit(0)
