/**
 * eval-check.mjs — smoke check for the client bundle.
 *
 * Evaluates lib/client.js with a fake window.__ModuleLoader__ and a fake
 * react module, then verifies that apply() registers the settings.section
 * slot and the locale namespace without throwing.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const code = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')

let loaded = null
const fakeWindow = {
  __ModuleLoader__: {
    load(spec) {
      loaded = spec
    },
  },
}

// Minimal React stub: hooks throw only when actually rendering, which we do not do.
const fakeReact = {
  createElement: () => ({}),
  useState: (v) => [v, () => {}],
  useEffect: () => {},
  useRef: (v) => ({ current: v }),
}

const factoryRequire = (id) => {
  if (id === 'react') return fakeReact
  throw new Error('unexpected require: ' + id)
}

// Minimal browser stubs (client code guards most access, the effect disposer
// touches document.querySelector directly).
const fakeDocument = {
  querySelector: () => null,
  createElement: () => ({ dataset: {}, textContent: '' }),
  head: { appendChild: () => {} },
}

const fn = new Function('window', 'document', 'navigator', code)
fn(fakeWindow, fakeDocument, undefined)

if (!loaded || typeof loaded.factory !== 'function') {
  throw new Error('client bundle did not call window.__ModuleLoader__.load()')
}
if (loaded.id !== 'dsh-archived-cleaner') {
  throw new Error('unexpected module id: ' + loaded.id)
}

const mod = loaded.factory(factoryRequire)
if (typeof mod.apply !== 'function') throw new Error('exports.apply missing')
if (!Array.isArray(mod.inject) || !mod.inject.includes('slots') || !mod.inject.includes('locale')) {
  throw new Error('exports.inject must include slots and locale')
}

// Fake cordis ctx capturing slot + locale registrations.
const registeredSlots = []
const registeredLocales = []
const ctx = {
  effect: (fn2) => {
    const dispose = fn2()
    if (typeof dispose === 'function') dispose()
  },
  locale: {
    register: (ns, table) => {
      registeredLocales.push({ ns, keys: Object.keys(table.zh || {}).length })
      return () => {}
    },
    bind: () => (k) => k,
  },
  slots: {
    inject: (name, cb) => cb(),
    register: (desc, component) => {
      registeredSlots.push({ name: desc.name, id: desc.id })
      return () => {}
    },
  },
}

mod.apply(ctx)

if (!registeredSlots.some((s) => s.name === 'settings.section' && s.id === 'archived-cleaner')) {
  throw new Error('settings.section slot was not registered')
}
if (!registeredSlots.some((s) => s.name === 'sidebar.footer.action' && s.id === 'archived-cleaner')) {
  throw new Error('sidebar.footer.action slot was not registered')
}
if (!registeredLocales.some((l) => l.ns === 'archived-cleaner' && l.keys > 10)) {
  throw new Error('locale namespace was not registered')
}

console.log('eval-check OK: slot + locale registered, apply() ran clean')
