/**
 * dsh-archived-cleaner — browser half (settings section, zero-build).
 *
 * Registers a "归档清理 / Archived Cleaner" settings section in DeepSeek Harness
 * Settings:
 *   1. Lists all archived sessions (searchable, newest first).
 *   2. Single delete + checkbox batch delete + delete-all.
 *   3. Every delete goes through an in-app double-confirmation modal that warns
 *      the operation is irreversible.
 *   4. The host only deletes ARCHIVED sessions; live/non-archived ids are
 *      rejected and reported.
 */

(function () {
  'use strict';

  window.__ModuleLoader__.load({
    id: 'dsh-archived-cleaner',
    factory: function (require) {
      var module = { exports: {} };
      var exports = module.exports;
      Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

      var React = require('react');
      var h = React.createElement;
      var useState = React.useState;
      var useEffect = React.useEffect;
      var useRef = React.useRef;

      var API_BASE = '/api/dsh-archived-cleaner';
      var CSS_ID = 'dsh-archived-cleaner-styles';
      var NS = 'archived-cleaner';

      // ---- SVG icons (lucide style) ----
      function svgEl(children, size) {
        size = size || 14;
        return h('svg', {
          width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
          stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round',
          strokeLinejoin: 'round', xmlns: 'http://www.w3.org/2000/svg'
        }, children);
      }
      function IconArchive(s) { return svgEl([h('rect', { width: 20, height: 5, x: 2, y: 3, rx: 1 }), h('path', { d: 'M4 8v11a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V8' }), h('path', { d: 'M10 12h4' })], s); }
      function IconSearch(s) { return svgEl([h('circle', { cx: 11, cy: 11, r: 8 }), h('path', { d: 'm21 21-4.3-4.3' })], s); }
      function IconTrash(s) { return svgEl([h('path', { d: 'M3 6h18' }), h('path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6' }), h('path', { d: 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }), h('line', { x1: 10, x2: 10, y1: 11, y2: 17 }), h('line', { x1: 14, x2: 14, y1: 11, y2: 17 })], s); }
      function IconClose(s) { return svgEl([h('path', { d: 'M18 6 6 18' }), h('path', { d: 'm6 6 12 12' })], s); }
      function IconRefresh(s) { return svgEl([h('path', { d: 'M3 12a9 9 0 0 1 15.3-6.4L21 8' }), h('path', { d: 'M21 3v5h-5' }), h('path', { d: 'M21 12a9 9 0 0 1-15.3 6.4L3 16' }), h('path', { d: 'M3 21v-5h5' })], s); }
      function IconHardDrive(s) { return svgEl([h('line', { x1: 22, x2: 2, y1: 12, y2: 12 }), h('path', { d: 'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z' }), h('line', { x1: 6, x2: 6.01, y1: 16, y2: 16 }), h('line', { x1: 10, x2: 10.01, y1: 16, y2: 16 })], s); }
      function IconWarn(s) { return svgEl([h('path', { d: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3' }), h('path', { d: 'M12 9v4' }), h('path', { d: 'M12 17h.01' })], s); }

      // ---- CSS ----
      var CSS_TEXT = [
        '.dac-section-header { display: flex; align-items: flex-start; gap: 12px; padding: 4px 4px 16px 4px; }',
        '.dac-section-icon { color: var(--dsw-alias-label-secondary, #61666b); display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 8px; background: var(--dsw-alias-bg-module-platform, #f5f6f7); flex-shrink: 0; margin-top: 2px; }',
        '.dac-section-titles { display: flex; flex-direction: column; gap: 2px; min-width: 0; }',
        '.dac-section-title { font-size: 18px; font-weight: 600; color: var(--dsw-alias-label-primary, #0f1115); line-height: 1.3; margin: 0; }',
        '.dac-section-lede { font-size: 13px; color: var(--dsw-alias-label-tertiary, #86909c); margin: 0; line-height: 1.4; }',
        '.dac-container { padding: 4px 0 6px 0; display: flex; flex-direction: column; gap: 12px; box-sizing: border-box; width: 100%; position: relative; }',
        '.dac-container * { box-sizing: border-box; }',
        '.dac-search-row { width: 100%; position: relative; box-sizing: border-box; }',
        '.dac-search-icon { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--dsw-alias-label-tertiary, #86909c); pointer-events: none; display: inline-flex; }',
        '.dac-search-input { width: 100%; height: 36px; padding: 0 34px 0 34px; background: var(--dsw-alias-bg-module-platform, #f5f6f7); border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1)); border-radius: 18px; color: var(--dsw-alias-label-primary, #0f1115); font-size: 13px; outline: none; box-sizing: border-box; transition: border-color 0.15s, background 0.15s; }',
        '.dac-search-input:focus { border-color: var(--dsw-alias-brand-primary, #3b82f6); background: var(--dsw-alias-bg-base, #ffffff); }',
        '.dac-search-input::placeholder { color: var(--dsw-alias-label-tertiary, #86909c); }',
        '.dac-search-clear { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); width: 20px; height: 20px; border-radius: 50%; background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06)); border: none; color: var(--dsw-alias-label-tertiary, #86909c); cursor: pointer; display: flex; align-items: center; justify-content: center; }',
        '.dac-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }',
        '.dac-select-all { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--dsw-alias-label-secondary, #61666b); cursor: pointer; user-select: none; }',
        '.dac-select-all input { accent-color: var(--dsw-alias-brand-primary, #3b82f6); cursor: pointer; }',
        '.dac-selected-count { font-size: 12px; color: var(--dsw-alias-label-tertiary, #86909c); }',
        '.dac-spacer { flex: 1; }',
        '.dac-btn { height: 30px; padding: 0 12px; border-radius: 16px; font-size: 12.5px; font-weight: 500; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; transition: all 0.15s; border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1)); background: var(--dsw-alias-bg-module-platform, rgba(0, 0, 0, 0.04)); color: var(--dsw-alias-label-primary, #0f1115); white-space: nowrap; }',
        '.dac-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.07)); }',
        '.dac-btn:disabled { opacity: 0.45; cursor: default; }',
        '.dac-btn-danger { border-color: var(--dsw-alias-state-error-secondary, rgba(220, 38, 38, 0.35)); background: transparent; color: var(--dsw-alias-state-error-primary, #dc2626); }',
        '.dac-btn-danger:hover { background: var(--dsw-alias-interactive-bg-hover-danger, rgba(220, 38, 38, 0.08)); border-color: var(--dsw-alias-state-error-primary, #dc2626); }',
        '.dac-btn-danger-solid { border-color: var(--dsw-alias-state-error-primary, #dc2626); background: var(--dsw-alias-state-error-primary, #dc2626); color: #fff; }',
        '.dac-btn-danger-solid:hover { background: var(--dsw-alias-state-error-primary, #b91c1c); }',
        '.dac-list { background: var(--dsw-alias-bg-layer-1, rgba(0, 0, 0, 0.02)); border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.08)); border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; }',
        '.dac-item { display: flex; align-items: center; padding: 10px 14px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.06)); transition: background 0.12s; gap: 10px; }',
        '.dac-item:last-child { border-bottom: none; }',
        '.dac-item:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.04)); }',
        '.dac-item input[type="checkbox"] { accent-color: var(--dsw-alias-brand-primary, #3b82f6); cursor: pointer; flex-shrink: 0; }',
        '.dac-item-main { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }',
        '.dac-item-title { color: var(--dsw-alias-label-primary, inherit); font-size: 13.5px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.4; }',
        '.dac-item-meta { display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--dsw-alias-label-tertiary, #86909c); flex-wrap: wrap; }',
        '.dac-badge { display: inline-flex; align-items: center; gap: 4px; padding: 1px 6px; border-radius: 4px; font-size: 11px; background: var(--dsw-alias-bg-module-platform, rgba(0,0,0,0.05)); }',
        '.dac-badge-ghost { background: var(--dsw-alias-state-warning-tertiary, rgba(234, 179, 8, 0.12)); color: var(--dsw-alias-state-warning-primary, #ca8a04); }',
        '.dac-badge-live { background: var(--dsw-alias-state-success-tertiary, rgba(34, 197, 94, 0.12)); color: var(--dsw-alias-state-success-primary, #16a34a); }',
        '.dac-item-delete { height: 28px; padding: 0 10px; border-radius: 6px; font-size: 12px; font-weight: 500; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; border: 1px solid transparent; background: transparent; color: var(--dsw-alias-state-error-primary, #dc2626); transition: all 0.15s; flex-shrink: 0; }',
        '.dac-item-delete:hover { background: var(--dsw-alias-interactive-bg-hover-danger, rgba(220, 38, 38, 0.08)); }',
        '.dac-item-delete:disabled { opacity: 0.4; cursor: default; background: transparent; }',
        '.dac-empty { padding: 32px 16px; text-align: center; color: var(--dsw-alias-label-tertiary, #86909c); font-size: 13px; }',
        '.dac-loading { padding: 24px; text-align: center; color: var(--dsw-alias-label-tertiary, #86909c); font-size: 13px; }',
        '.dac-toast { padding: 8px 12px; border-radius: 6px; font-size: 12.5px; display: flex; align-items: center; justify-content: space-between; gap: 8px; animation: dacFadeIn 0.15s ease-out; }',
        '.dac-toast-error { background: var(--dsw-alias-interactive-bg-hover-danger, rgba(239, 68, 68, 0.12)); color: var(--dsw-alias-state-error-primary, #ef4444); border: 1px solid var(--dsw-alias-state-error-secondary, rgba(239, 68, 68, 0.3)); }',
        '.dac-toast-success { background: var(--dsw-alias-state-success-tertiary, rgba(34, 197, 94, 0.12)); color: var(--dsw-alias-state-success-primary, #22c55e); border: 1px solid var(--dsw-alias-state-success-secondary, rgba(34, 197, 94, 0.3)); }',
        '.dac-toast-close { background: transparent; border: none; color: inherit; opacity: 0.7; cursor: pointer; padding: 2px; border-radius: 4px; display: flex; align-items: center; justify-content: center; }',
        '.dac-toast-close:hover { opacity: 1; }',
        '/* double-confirm modal */',
        '.dac-modal-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.45); z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 20px; animation: dacFadeIn 0.15s ease-out; }',
        '.dac-modal { width: 100%; max-width: 460px; background: var(--dsw-alias-bg-layer-2, #ffffff); border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1)); border-radius: 12px; box-shadow: 0 16px 36px rgba(0, 0, 0, 0.22); display: flex; flex-direction: column; overflow: hidden; animation: dacSlideUp 0.18s ease-out; }',
        '.dac-modal-header { padding: 16px 20px 0 20px; display: flex; align-items: center; gap: 10px; color: var(--dsw-alias-state-error-primary, #dc2626); }',
        '.dac-modal-title { font-size: 15px; font-weight: 600; margin: 0; color: var(--dsw-alias-label-primary, inherit); }',
        '.dac-modal-body { padding: 12px 20px; font-size: 13px; color: var(--dsw-alias-label-secondary, #61666b); line-height: 1.6; display: flex; flex-direction: column; gap: 8px; max-height: 50vh; overflow-y: auto; }',
        '.dac-modal-list { margin: 0; padding: 0 0 0 18px; color: var(--dsw-alias-label-primary, inherit); }',
        '.dac-modal-list li { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
        '.dac-modal-warning { color: var(--dsw-alias-state-error-primary, #dc2626); font-weight: 500; }',
        '.dac-modal-footer { padding: 12px 20px 16px 20px; display: flex; align-items: center; justify-content: flex-end; gap: 10px; }',
        '/* sidebar footer entry */',
        '.dac-sidebar-btn { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 10px; border: none; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary, #61666b); font-size: 13px; cursor: pointer; transition: background 0.12s, color 0.12s; }',
        '.dac-sidebar-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06)); color: var(--dsw-alias-label-primary, #0f1115); }',
        '.dac-sidebar-btn:not(.wide) { justify-content: center; padding: 6px; }',
        '.dac-sidebar-btn-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }',
        '/* one-click panel */',
        '.dac-panel-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.45); z-index: 9998; display: flex; align-items: center; justify-content: center; padding: 24px; animation: dacFadeIn 0.15s ease-out; }',
        '.dac-panel { width: 100%; max-width: 760px; max-height: 85vh; background: var(--dsw-alias-bg-layer-2, #ffffff); border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1)); border-radius: 12px; box-shadow: 0 16px 36px rgba(0, 0, 0, 0.22); display: flex; flex-direction: column; overflow: hidden; animation: dacSlideUp 0.18s ease-out; }',
        '.dac-panel-head { padding: 14px 18px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.08)); display: flex; align-items: center; justify-content: space-between; gap: 10px; }',
        '.dac-panel-title { margin: 0; font-size: 15px; font-weight: 600; color: var(--dsw-alias-label-primary, inherit); display: inline-flex; align-items: center; gap: 8px; }',
        '.dac-panel-body { padding: 8px 18px 18px 18px; overflow-y: auto; flex: 1; }',
        'body[data-ds-dark-theme] .dac-panel { background: var(--dsw-alias-bg-layer-2, #1e1e20); border-color: var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.14)); box-shadow: 0 16px 36px rgba(0, 0, 0, 0.55); }',
        'body[data-ds-dark-theme] .dac-section-icon { background: var(--dsw-alias-bg-module-platform, #353638); color: var(--dsw-alias-label-secondary, #9ca3af); }',
        'body[data-ds-dark-theme] .dac-section-title { color: var(--dsw-alias-label-primary, #f9fafb); }',
        'body[data-ds-dark-theme] .dac-search-input { background: var(--dsw-alias-bg-module-platform, #353638); border-color: var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.12)); color: var(--dsw-alias-label-primary, #f9fafb); }',
        'body[data-ds-dark-theme] .dac-search-input:focus { background: var(--dsw-alias-bg-base, #151517); }',
        'body[data-ds-dark-theme] .dac-btn { background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.06)); border-color: var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.12)); color: var(--dsw-alias-label-primary, #f9fafb); }',
        'body[data-ds-dark-theme] .dac-btn-danger { background: transparent; color: var(--dsw-alias-state-error-primary, #f87171); }',
        'body[data-ds-dark-theme] .dac-modal { background: var(--dsw-alias-bg-layer-2, #1e1e20); border-color: var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.14)); box-shadow: 0 16px 36px rgba(0, 0, 0, 0.55); }',
        '@keyframes dacFadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }',
        '@keyframes dacSlideUp { from { opacity: 0; transform: translateY(12px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }'
      ].join('\n');

      function injectStyles() {
        if (typeof document === 'undefined') return;
        var existing = document.querySelector('style[data-plugin-css="' + CSS_ID + '"]');
        if (existing) existing.remove();
        var tag = document.createElement('style');
        tag.dataset.plugin = 'dsh-archived-cleaner';
        tag.dataset.pluginCss = CSS_ID;
        tag.textContent = CSS_TEXT;
        document.head.appendChild(tag);
      }

      // ---- helpers ----
      function fetchJson(url, options) {
        return fetch(url, options).then(function (res) {
          return res.text().then(function (text) {
            var body = null;
            try { body = text ? JSON.parse(text) : null; } catch (e) { /* not json */ }
            if (!res.ok) {
              var err = new Error((body && body.error) || text || res.statusText);
              err.status = res.status;
              err.body = body;
              throw err;
            }
            return body;
          });
        });
      }

      function formatDate(ts) {
        if (!ts) return '—';
        var d = new Date(ts);
        if (isNaN(d.getTime())) return '—';
        try {
          return d.toLocaleString(navigator.language || 'zh-CN', {
            year: 'numeric', month: 'numeric', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
          });
        } catch (e) {
          var min = d.getMinutes(); if (min < 10) min = '0' + min;
          return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + ':' + min;
        }
      }

      function formatSize(bytes) {
        if (!bytes || bytes <= 0) return '0 B';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
      }

      function fmt(t, key, a, b) {
        var s = (t && typeof t === 'function') ? (t(key) || key) : key;
        if (a !== undefined) s = s.replace('{0}', String(a));
        if (b !== undefined) s = s.replace('{1}', String(b));
        return s;
      }

      // ---- ArchivedCleanerSection (React) ----
      function ArchivedCleanerSection(props) {
        var t = (props && typeof props.t === 'function') ? props.t : function (k) { return k; };

        var s0 = useState([]); var archives = s0[0], setArchives = s0[1];
        var s1 = useState(true); var loading = s1[0], setLoading = s1[1];
        var s2 = useState(null); var error = s2[0], setError = s2[1];
        var s3 = useState(null); var success = s3[0], setSuccess = s3[1];
        var s4 = useState(''); var query = s4[0], setQuery = s4[1];
        var s5 = useState({}); var selected = s5[0], setSelected = s5[1];
        var s6 = useState(false); var busy = s6[0], setBusy = s6[1];
        // double-confirm modal: null | { ids: [sid...], titles: [title...] }
        var s7 = useState(null); var confirmState = s7[0], setConfirmState = s7[1];

        var pollRef = useRef(null);
        var toastRef = useRef(null);
        var composingRef = useRef(false);

        function showToast(kind, msg) {
          if (toastRef.current) { clearTimeout(toastRef.current); toastRef.current = null; }
          if (kind === 'success') { setSuccess(msg); setError(null); }
          else { setError(msg); setSuccess(null); }
          toastRef.current = setTimeout(function () { setError(null); setSuccess(null); toastRef.current = null; }, 4000);
        }

        function load() {
          return fetchJson(API_BASE + '/archives').then(function (d) {
            setLoading(false);
            var list = Array.isArray(d.archives) ? d.archives : [];
            setArchives(list);
            // drop selections that no longer exist
            setSelected(function (prev) {
              var next = {};
              var keep = {};
              for (var i = 0; i < list.length; i++) keep[list[i].sessionId] = true;
              for (var k in prev) { if (prev[k] && keep[k]) next[k] = true; }
              return next;
            });
            setError(null);
          }).catch(function (e) {
            setLoading(false);
            setError(fmt(t, 'loadFailed') + ': ' + (e.message || String(e)));
          });
        }

        function toggleOne(sid) {
          setSelected(function (prev) {
            var next = Object.assign({}, prev);
            if (next[sid]) delete next[sid]; else next[sid] = true;
            return next;
          });
        }

        function selectedIds() {
          var out = [];
          for (var k in selected) { if (selected[k]) out.push(k); }
          return out;
        }

        // step 1 of the double confirmation: open the modal
        function requestDelete(ids) {
          if (busy || !ids || ids.length === 0) return;
          var titles = ids.map(function (sid) {
            for (var i = 0; i < archives.length; i++) {
              if (archives[i].sessionId === sid) return archives[i].title || sid;
            }
            return sid;
          });
          setConfirmState({ ids: ids, titles: titles });
        }

        // step 2 of the double confirmation: user clicked "confirm delete"
        function doDelete() {
          if (busy || !confirmState) return;
          var ids = confirmState.ids;
          setBusy(true);
          fetchJson(API_BASE + '/delete', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionIds: ids })
          }).then(function (r) {
            setBusy(false);
            setConfirmState(null);
            var n = r && Array.isArray(r.removed) ? r.removed.length : ids.length;
            showToast('success', fmt(t, 'deletedToast', n));
            load();
          }).catch(function (e) {
            setBusy(false);
            setConfirmState(null);
            var body = e && e.body;
            if (body && (body.notArchived && body.notArchived.length || body.live && body.live.length)) {
              showToast('error', fmt(t, 'deleteGuarded'));
            } else {
              showToast('error', fmt(t, 'deleteFailed') + ': ' + (e.message || String(e)));
            }
            load();
          });
        }

        useEffect(function () {
          load();
          pollRef.current = setInterval(function () {
            if (document.visibilityState === 'visible' && !busy && !confirmState) {
              fetchJson(API_BASE + '/archives').then(function (d) {
                setArchives(Array.isArray(d.archives) ? d.archives : []);
              }).catch(function () {});
            }
          }, 3000);
          return function () {
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
            if (toastRef.current) { clearTimeout(toastRef.current); toastRef.current = null; }
          };
        }, [busy, confirmState]);

        var q = query.trim().toLowerCase();
        var filtered = archives.filter(function (a) {
          if (!q) return true;
          var mt = (a.title || '').toLowerCase().indexOf(q) >= 0;
          var mw = (a.workspaceTitle || '').toLowerCase().indexOf(q) >= 0;
          var mi = (a.sessionId || '').toLowerCase().indexOf(q) >= 0;
          return mt || mw || mi;
        });

        var deletableFiltered = filtered.filter(function (a) { return !a.live; });
        var allChecked = deletableFiltered.length > 0 && deletableFiltered.every(function (a) { return selected[a.sessionId]; });
        var selIds = selectedIds();

        function toggleAll() {
          setSelected(function (prev) {
            var next = Object.assign({}, prev);
            if (allChecked) {
              for (var i = 0; i < deletableFiltered.length; i++) delete next[deletableFiltered[i].sessionId];
            } else {
              for (var j = 0; j < deletableFiltered.length; j++) next[deletableFiltered[j].sessionId] = true;
            }
            return next;
          });
        }

        return h('div', { className: 'dac-container' },
          h('div', { className: 'dac-section-header' },
            h('span', { className: 'dac-section-icon' }, IconArchive(18)),
            h('div', { className: 'dac-section-titles' },
              h('h2', { className: 'dac-section-title' }, t('title')),
              h('p', { className: 'dac-section-lede' }, t('description'))
            )
          ),
          error ? h('div', { className: 'dac-toast dac-toast-error' },
            h('span', null, error),
            h('button', { type: 'button', className: 'dac-toast-close', onClick: function () { setError(null); } }, IconClose(14))
          ) : null,
          success ? h('div', { className: 'dac-toast dac-toast-success' },
            h('span', null, success),
            h('button', { type: 'button', className: 'dac-toast-close', onClick: function () { setSuccess(null); } }, IconClose(14))
          ) : null,
          h('div', { className: 'dac-search-row' },
            h('span', { className: 'dac-search-icon' }, IconSearch(14)),
            h('input', {
              type: 'text', className: 'dac-search-input', placeholder: t('searchPlaceholder'),
              value: query,
              onCompositionStart: function () { composingRef.current = true; },
              onCompositionEnd: function (e) { composingRef.current = false; setQuery(e.target.value); },
              onChange: function (e) { if (!composingRef.current) setQuery(e.target.value); }
            }),
            query ? h('button', { type: 'button', className: 'dac-search-clear', title: t('clearSearch'), onClick: function () { setQuery(''); } }, IconClose(14)) : null
          ),
          h('div', { className: 'dac-toolbar' },
            h('label', { className: 'dac-select-all' },
              h('input', {
                type: 'checkbox',
                checked: allChecked,
                disabled: busy || deletableFiltered.length === 0,
                onChange: toggleAll
              }),
              h('span', null, t('selectAll'))
            ),
            selIds.length > 0 ? h('span', { className: 'dac-selected-count' }, fmt(t, 'selectedCount', selIds.length)) : null,
            h('span', { className: 'dac-spacer' }),
            h('button', {
              type: 'button', className: 'dac-btn', title: t('refreshTip'),
              disabled: busy, onClick: function () { setLoading(true); load(); }
            }, IconRefresh(13), h('span', null, t('refresh'))),
            h('button', {
              type: 'button', className: 'dac-btn dac-btn-danger', title: t('deleteSelectedTip'),
              disabled: busy || selIds.length === 0,
              onClick: function () { requestDelete(selIds); }
            }, IconTrash(13), h('span', null, fmt(t, 'deleteSelected', selIds.length)))
          ),
          loading ? h('div', { className: 'dac-loading' }, t('loading'))
          : archives.length === 0 ? h('div', { className: 'dac-empty' }, t('empty'))
          : filtered.length === 0 ? h('div', { className: 'dac-empty' }, t('noMatch'))
          : h('div', { className: 'dac-list' },
            filtered.map(function (item) {
              var checked = !!selected[item.sessionId];
              return h('div', { className: 'dac-item', key: item.sessionId },
                h('input', {
                  type: 'checkbox', checked: checked, disabled: busy || item.live,
                  title: item.live ? t('liveTip') : undefined,
                  onChange: function () { toggleOne(item.sessionId); }
                }),
                h('div', { className: 'dac-item-main' },
                  h('div', { className: 'dac-item-title', title: item.title || item.sessionId }, item.title || t('untitled')),
                  h('div', { className: 'dac-item-meta' },
                    item.workspaceTitle ? h('span', null, item.workspaceTitle) : null,
                    h('span', null, formatDate(item.createdAt)),
                    item.turns ? h('span', null, fmt(t, 'turnsUnit', item.turns)) : null,
                    item.dataSize > 0 ? h('span', { className: 'dac-badge' }, IconHardDrive(11), formatSize(item.dataSize)) : null,
                    item.ghost ? h('span', { className: 'dac-badge dac-badge-ghost' }, t('ghostBadge')) : null,
                    item.live ? h('span', { className: 'dac-badge dac-badge-live' }, t('liveBadge')) : null
                  )
                ),
                h('button', {
                  type: 'button', className: 'dac-item-delete',
                  title: item.live ? t('liveTip') : t('deleteTip'),
                  disabled: busy || item.live,
                  onClick: function () { requestDelete([item.sessionId]); }
                }, IconTrash(13), h('span', null, t('delete')))
              );
            })
          ),

          /* double-confirmation modal */
          confirmState ? h('div', {
            className: 'dac-modal-backdrop',
            onClick: function (e) { if (!busy && e.target === e.currentTarget) setConfirmState(null); }
          },
            h('div', { className: 'dac-modal' },
              h('div', { className: 'dac-modal-header' },
                IconWarn(18),
                h('h3', { className: 'dac-modal-title' }, fmt(t, 'confirmTitle', confirmState.ids.length))
              ),
              h('div', { className: 'dac-modal-body' },
                h('div', null, fmt(t, 'confirmBody', confirmState.ids.length)),
                h('ul', { className: 'dac-modal-list' },
                  confirmState.titles.slice(0, 5).map(function (title, idx) {
                    return h('li', { key: idx, title: title }, title);
                  }),
                  confirmState.titles.length > 5 ? h('li', { key: '__more' }, fmt(t, 'confirmMore', confirmState.titles.length - 5)) : null
                ),
                h('div', { className: 'dac-modal-warning' }, t('confirmWarning'))
              ),
              h('div', { className: 'dac-modal-footer' },
                h('button', {
                  type: 'button', className: 'dac-btn', disabled: busy,
                  onClick: function () { setConfirmState(null); }
                }, t('cancel')),
                h('button', {
                  type: 'button', className: 'dac-btn dac-btn-danger-solid', disabled: busy,
                  onClick: doDelete
                }, IconTrash(13), h('span', null, busy ? t('deleting') : t('confirmDelete')))
              )
            )
          ) : null
        );
      }

      // ---- SidebarEntry (sidebar.footer.action: one-click panel) ----
      function SidebarEntry(props) {
        var wide = !props || props.wide !== false;
        var t = (props && typeof props.t === 'function') ? props.t : function (k) { return k; };
        var s = useState(false); var open = s[0], setOpen = s[1];

        return h(React.Fragment, null,
          h('button', {
            type: 'button',
            className: 'dac-sidebar-btn' + (wide ? ' wide' : ''),
            title: t('title') + ' — ' + t('openPanelTip'),
            onClick: function () { setOpen(true); }
          },
            IconArchive(16),
            wide ? h('span', { className: 'dac-sidebar-btn-label' }, t('title')) : null
          ),
          open ? h('div', {
            className: 'dac-panel-backdrop',
            onClick: function (e) { if (e.target === e.currentTarget) setOpen(false); }
          },
            h('div', { className: 'dac-panel' },
              h('div', { className: 'dac-panel-head' },
                h('h3', { className: 'dac-panel-title' }, IconArchive(16), t('title')),
                h('button', {
                  type: 'button', className: 'dac-toast-close', title: t('close'),
                  onClick: function () { setOpen(false); }
                }, IconClose(16))
              ),
              h('div', { className: 'dac-panel-body' },
                h(ArchivedCleanerSection, { t: t })
              )
            )
          ) : null
        );
      }

      // ---- locales ----
      var zh = {
        title: '归档清理', description: '查看并彻底删除已归档的对话。仅已归档会话可被删除；删除为永久操作，不可恢复。',
        openPanelTip: '一键打开归档清理面板', close: '关闭',
        searchPlaceholder: '搜索已归档对话（标题 / 工作区 / ID）', clearSearch: '清空搜索',
        selectAll: '全选', selectedCount: '已选 {0} 项',
        refresh: '刷新', refreshTip: '重新加载归档列表',
        deleteSelected: '删除选中 ({0})', deleteSelectedTip: '永久删除所有勾选的归档会话',
        delete: '删除', deleteTip: '永久删除该归档会话',
        loading: '加载已归档对话中…', empty: '暂无已归档的对话。', noMatch: '未找到匹配的归档对话。',
        untitled: '未命名会话', turnsUnit: '{0} 轮对话',
        ghostBadge: '记录缺失', liveBadge: '运行中', liveTip: '会话正在运行，无法删除',
        confirmTitle: '确认删除 {0} 个已归档会话？',
        confirmBody: '即将永久删除以下 {0} 个已归档会话的磁盘文件与全部记录：',
        confirmMore: '…以及另外 {0} 个',
        confirmWarning: '此操作不可撤销，删除后无法恢复！',
        cancel: '取消', confirmDelete: '确认删除', deleting: '删除中…',
        deletedToast: '已永久删除 {0} 个归档会话。',
        loadFailed: '加载失败', deleteFailed: '删除失败',
        deleteGuarded: '部分会话被拒绝删除：只能删除已归档且未在运行的会话。'
      };
      var en = {
        title: 'Archived Cleaner', description: 'View and permanently delete archived conversations. Only archived sessions can be deleted; deletion is permanent and cannot be undone.',
        openPanelTip: 'Open the archived cleaner panel', close: 'Close',
        searchPlaceholder: 'Search archived chats (title / workspace / id)', clearSearch: 'Clear search',
        selectAll: 'Select all', selectedCount: '{0} selected',
        refresh: 'Refresh', refreshTip: 'Reload the archived list',
        deleteSelected: 'Delete selected ({0})', deleteSelectedTip: 'Permanently delete all checked archived sessions',
        delete: 'Delete', deleteTip: 'Permanently delete this archived session',
        loading: 'Loading archived chats...', empty: 'No archived conversations.', noMatch: 'No matching archived chats.',
        untitled: 'Untitled session', turnsUnit: '{0} turns',
        ghostBadge: 'missing', liveBadge: 'live', liveTip: 'Session is running and cannot be deleted',
        confirmTitle: 'Delete {0} archived session(s)?',
        confirmBody: 'The following {0} archived session(s) will be permanently removed from disk:',
        confirmMore: '...and {0} more',
        confirmWarning: 'This action cannot be undone!',
        cancel: 'Cancel', confirmDelete: 'Delete permanently', deleting: 'Deleting...',
        deletedToast: 'Permanently deleted {0} archived session(s).',
        loadFailed: 'Load failed', deleteFailed: 'Delete failed',
        deleteGuarded: 'Some sessions were rejected: only archived, non-running sessions can be deleted.'
      };

      // ---- apply ----
      function apply(ctx) {
        injectStyles();
        if (ctx && ctx.effect) {
          ctx.effect(function () {
            return function () {
              var styleTag = document.querySelector('style[data-plugin-css="' + CSS_ID + '"]');
              if (styleTag) styleTag.remove();
            };
          }, 'dsh-archived-cleaner: ui mount');
        }
        var tBound = function (k) { return k; };
        if (ctx && ctx.locale) {
          var off = ctx.locale.register(NS, { zh: zh, en: en });
          tBound = ctx.locale.bind(NS);
          if (ctx.effect) ctx.effect(function () { return function () { if (off) off(); }; }, 'dsh-archived-cleaner: locale');
        }
        // Inject our locale t() into components when the host shell does not pass one.
        function withT(Component) {
          return function (props) {
            var t = (props && typeof props.t === 'function') ? props.t : tBound;
            return h(Component, Object.assign({}, props, { t: t }));
          };
        }
        if (ctx && ctx.slots) {
          ctx.slots.inject('settings.section', function () {
            return ctx.slots.register({
              name: 'settings.section', id: 'archived-cleaner', order: 1000,
              label: function () { return tBound('title'); },
              locale: NS
            }, withT(ArchivedCleanerSection));
          });
          ctx.slots.inject('sidebar.footer.action', function () {
            return ctx.slots.register({
              name: 'sidebar.footer.action', id: 'archived-cleaner', order: 100,
              label: function () { return tBound('title'); },
              locale: NS
            }, withT(SidebarEntry));
          });
        }
      }

      exports.apply = apply;
      exports.inject = ['slots', 'locale'];
      exports.default = { apply: apply, inject: ['slots', 'locale'] };

      return module.exports;
    }
  });
})();
