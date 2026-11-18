// dsh-role-card \u2014 Client half.
//
// Two slots matter here:
//   * `sidebar.panellist` gets the rail row (one icon, one id).
//   * `main` gets the keyed panel for the same id: this is the surface the user
//     opens, and the place the card library and the in-panel chat live.
//
// The chat itself is not this module's job: it posts to the Host route and reads
// back the transcript. The Host owns the Agent, so the role text never reaches
// any other session in the deployment.
window.__ModuleLoader__.load({
  id: 'dsh-role-card',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const VERSION = '1.8.4'
    const PANEL_ID = 'role-card'
    const API = '/api/dsh-role-card'
    const POLL_MS = 2500
    const POLL_HIDDEN_MS = 8000
    const API_TIMEOUT_MS = 20000
    const IMPORT_PREF_KEY = 'drc-import-prefs'

    const token = () => {
      const injected = window.__DSH_ROLE_CARD__
      return injected !== undefined && injected !== null && typeof injected.token === 'string' ? injected.token : 'ui'
    }

    /* Failures inside the panel are invisible from the host side, so every
     * thrown error is also reported to the host log (fire and forget). */
    let reporting = false
    const report = (where, error) => {
      if (reporting) return
      reporting = true
      const text = where + ': ' + String(error !== null && error !== undefined && error.message ? error.message : error)
      void api('POST', '/hello', {
        source: 'client-error',
        version: VERSION,
        href: String(window.location && window.location.href ? window.location.href : ''),
        ua: '',
        error: text,
      })
        .catch(() => {})
        .then(() => {
          reporting = false
        })
    }

    const api = async (method, path, body, timeoutMs) => {
      const limit = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : API_TIMEOUT_MS
      const controller = typeof AbortController === 'function' ? new AbortController() : null
      const init = { method, headers: { 'x-dsh-role-card': token() } }
      if (controller !== null) init.signal = controller.signal
      if (body !== undefined) {
        init.headers['content-type'] = 'application/json; charset=utf-8'
        init.body = JSON.stringify(body)
      }
      let response
      let timer = null
      if (controller !== null) {
        timer = setTimeout(() => {
          try { controller.abort() } catch (error) { void error }
        }, limit)
      }
      try {
        response = await fetch(API + path, init)
      } catch (error) {
        const aborted = error !== null && error !== undefined && error.name === 'AbortError'
        const failure = new Error(
          aborted
            ? '\u8BF7\u6C42\u8D85\u65F6\uFF08\u7B49\u4E86 ' + Math.round(limit / 1000) + ' \u79D2\uFF09\uFF0C\u5DF2\u505C\u6B62\u7B49\u5F85\uFF1A' + method + ' ' + path + '\n\u53EF\u80FD\u662F\u4E3B\u673A\u5728\u91CD\u542F\uFF0C\u5237\u65B0\u9875\u9762\u540E\u91CD\u8BD5\u3002'
            : '\u8FDE\u4E0D\u4E0A\u89D2\u8272\u5361\u670D\u52A1\uFF1A' + String(error && error.message ? error.message : error),
        )
        report(method + ' ' + path, failure)
        throw failure
      } finally {
        if (timer !== null) clearTimeout(timer)
      }
      const text = await response.text()
      let payload = null
      try {
        payload = text.length === 0 ? {} : JSON.parse(text)
      } catch {
        payload = null
      }
      if (response.ok !== true) {
        const detail = payload !== null && typeof payload.error === 'string' ? payload.error : text.slice(0, 160)
        const failure = new Error('HTTP ' + String(response.status) + '\uFF1A' + detail)
        report(method + ' ' + path, failure)
        throw failure
      }
      if (payload === null) {
        const failure = new Error('\u89D2\u8272\u5361\u670D\u52A1\u8FD4\u56DE\u4E86\u975E JSON \u5185\u5BB9\uFF1A' + text.slice(0, 120))
        report(method + ' ' + path, failure)
        throw failure
      }
      return payload
    }

    // 字号：auto 跟着屏幕走（媒体查询里给手机更小的字号），其余三档由用户钉住，
    // 存在本机 localStorage 里 —— 手机和电脑各存各的，互不影响。
    // \u5185\u5BB9\u6A21\u5F0F + \u4E09\u6863\u4E0B\u62C9\u7684\u9009\u9879\u8868\uFF1B\u987A\u5E8F\u5C31\u662F\u4E0B\u62C9\u91CC\u7684\u987A\u5E8F\u3002
    const MODE_CHOICES = [
      ['adult', '\u6210\u4EBA'],
      ['normal', '\u666E\u901A'],
    ]
    const TONE_CHOICES = [
      ['none', '\u65E0'],
      ['hint', '\u6697\u793A'],
      ['soft', '\u542B\u60C5'],
      ['explicit', '\u9732\u9AA8'],
      ['hard', '\u6781\u81F4'],
    ]
    const PACE_CHOICES = [
      ['slow', '\u6162\u70ED'],
      ['steady', '\u81EA\u7136'],
      ['direct', '\u76F4\u63A5'],
    ]
    const STYLE_CHOICES = [
      ['rp', '\u89D2\u8272\u626E\u6F14'],
      ['novel', '\u5C0F\u8BF4\u4F53'],
      ['chat', '\u804A\u5929\u4F53'],
      ['script', '\u5267\u672C\u4F53'],
      ['diary', '\u65E5\u8BB0\u4F53'],
    ]
    // 主页「小说导入」的范围：快速只抓前 40 章（秒出卡），全部就整本抓完。
    // 聊天界面里的「继续导入」固定每点一次 40 章，不再让用户算百分比。
    const SCOPE_CHOICES = [
      ['fast', '快速（前40章）'],
      ['full', '全部（整本，后台补更）'],
    ]
    const FONT_KEY = 'drc-font-step'
    const FONT_CHOICES = [
      { id: 'auto', label: '自动', bubble: null, line: null, composer: null },
      { id: 's', label: '小', bubble: '15px', line: '1.8', composer: '15px' },
      { id: 'm', label: '中', bubble: '17px', line: '1.9', composer: '16px' },
      { id: 'l', label: '大', bubble: '19px', line: '2', composer: '17px' },
    ]
    const STYLE_ID = 'drc-style'
    const CSS = [
      '.drc-root{display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px}',
      '.drc-head{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l2);flex:0 0 auto}',
      '.drc-title{font-size:14px;font-weight:600;margin:0 4px 0 0}',
      '.drc-spacer{flex:1 1 auto}',
      '.drc-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;padding:12px 16px;gap:10px;overflow:auto}',
      '.drc-btn{appearance:none;border:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer;line-height:18px}',
      '.drc-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.drc-btn[disabled]{opacity:.5;cursor:default}',
      '.drc-btn.danger{color:var(--dsw-alias-state-error-primary)}',
      '.drc-btn.danger:hover{background:var(--dsw-alias-interactive-bg-hover-danger)}',
      '.drc-btn.primary{background:var(--dsw-alias-button-primary-fill);border-color:transparent;color:var(--dsw-alias-label-primary-inverted)}',
      '.drc-btn.primary:hover{background:var(--dsw-alias-button-primary-hover)}',
      '.drc-pill{font-size:11px;padding:2px 8px;border-radius:999px;background:var(--dsw-alias-state-success-tertiary);color:var(--dsw-alias-state-success-primary)}',
      '.drc-hint{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}',
      '.drc-import{display:flex;gap:8px;align-items:center;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px 12px;background:var(--dsw-alias-bg-layer-1)}',
      '.drc-import input{flex:1 1 auto;min-width:0;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);padding:5px 8px;font-size:12px;outline:none}',
      '.drc-card{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:10px 12px;display:flex;align-items:center;gap:10px}',
      '.drc-card.on{border-color:var(--dsw-alias-state-success-primary)}',
      '.drc-cardmain{flex:1 1 auto;min-width:0}',
      '.drc-cardname{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.drc-cardmeta{color:var(--dsw-alias-label-tertiary);font-size:11px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.drc-editor{display:flex;flex-direction:column;gap:8px;flex:1 1 auto;min-height:0}',
      '.drc-editor input,.drc-editor textarea{border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:6px 9px;font-size:12px;outline:none;font-family:inherit}',
      '.drc-editor textarea{flex:1 1 auto;min-height:200px;resize:vertical;line-height:1.55;white-space:pre-wrap}',
      '.drc-notice{font-size:12px;padding:6px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}',
      '.drc-notice.err{color:var(--dsw-alias-state-error-primary)}',
      '.drc-chat{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:0}',
      '.drc-log{flex:1 1 auto;min-height:120px;overflow:auto;display:flex;flex-direction:column;gap:22px;padding:24px 16px 18px;background:var(--dsw-alias-bg-layer-2);border-radius:12px}',
      '.drc-row{display:flex;gap:10px;align-items:flex-start;max-width:100%}',
      '.drc-row.user{flex-direction:row-reverse}',
      '.drc-avatar{flex:0 0 auto;width:40px;height:40px;font-size:15px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600;letter-spacing:0;user-select:none;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l2)}',
      '.drc-avatar.user{background:#95ec69;color:#12331a;border-color:transparent}',
      '.drc-bubble{position:relative;max-width:min(92%,980px);padding:16px 20px;border-radius:10px;font-size:18px;line-height:2;letter-spacing:0.1px;white-space:pre-wrap;word-break:break-word;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);box-shadow:0 1px 1px rgba(0,0,0,0.04)}',
      '.drc-bubble:before{content:"";position:absolute;top:12px;left:-6px;width:10px;height:10px;transform:rotate(45deg);background:inherit;border-left:inherit;border-bottom:inherit}',
      '.drc-row.user .drc-bubble{background:#95ec69;color:#101010;border-color:#87e05c}',
      '.drc-row.user .drc-bubble:before{left:auto;right:-6px;border-left:none;border-bottom:none;border-right:1px solid #87e05c;border-top:1px solid #87e05c;background:#95ec69}',
      '.drc-composer{display:flex;gap:10px;align-items:flex-end;padding:12px 2px 4px;flex:0 0 auto}',
      '.drc-composer textarea{flex:1 1 auto;min-height:54px;max-height:240px;resize:none;border:1px solid var(--dsw-alias-border-l3);border-radius:12px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);padding:14px 16px;font-size:17px;line-height:1.6;font-family:inherit;outline:none}',
      '.drc-empty{color:var(--dsw-alias-label-tertiary);font-size:12px;padding:18px 0;text-align:center}',
  '.drc-open{margin-top:10px;display:flex;justify-content:center}',
      '.drc-lan{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:10px 12px;display:flex;flex-direction:column;gap:8px}',
      '.drc-lanhead{display:flex;align-items:center;gap:8px}',
      '.drc-lantitle{font-size:12px;font-weight:600}',
      '.drc-lanstate{font-size:11px;padding:2px 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary)}',
      '.drc-lanstate.on{background:var(--dsw-alias-state-success-tertiary);color:var(--dsw-alias-state-success-primary)}',
      '.drc-lanbody{display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap}',
      '.drc-qr{flex:0 0 auto;width:132px;height:132px;border-radius:8px;background:#fff;padding:4px;box-sizing:border-box}',
      '.drc-qr svg{width:100%;height:100%;display:block}',
      '.drc-lancol{flex:1 1 220px;min-width:0;display:flex;flex-direction:column;gap:6px}',
      '.drc-lanurl{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);padding:5px 8px;font-size:11px;font-family:ui-monospace,Consolas,monospace;outline:none}',
      '.drc-lanrow{display:flex;gap:8px;flex-wrap:wrap}',
      // 字号：默认跟着屏幕走（电脑大、手机小），用户也可以自己钉住一档。
      '.drc-root{--drc-fs:19px;--drc-lh:2;--drc-cfs:17px}',
      '.drc-bubble{font-size:var(--drc-fs);line-height:var(--drc-lh)}',
      '.drc-composer textarea{font-size:var(--drc-cfs)}',
      '.drc-head{position:relative}',
      '.drc-headmenu{display:flex;align-items:center;gap:8px}',
      '.drc-headtoggle{display:none}',
      // flex:0 0 auto 是必须的：这一行一旦允许收缩，作为 overflow:auto 的 flex 子项
      // 它的 min-height 会退化成 0，日志一长就把按钮挤成半截（手机上看到的“被遮挡”）。
      '.drc-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap;flex:0 0 auto}',
      '.drc-sel{display:inline-flex;align-items:center;gap:2px;flex:0 0 auto;height:26px;padding:0 3px 0 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);transition:border-color .16s ease,background .16s ease}',
      '.drc-sel:hover{border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-2)}',
      '.drc-sel:focus-within{border-color:var(--dsw-alias-border-l3);box-shadow:0 0 0 2px rgba(120,130,150,0.14)}',
      '.drc-sel>span{font-size:11px;line-height:1;color:var(--dsw-alias-label-tertiary);white-space:nowrap;letter-spacing:.2px;user-select:none}',
      '.drc-select{appearance:none;-webkit-appearance:none;-moz-appearance:none;border:0;outline:none;background-color:transparent;background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%2012%2012%27%3E%3Cpath%20d=%27M2.5%204.5%206%208l3.5-3.5%27%20fill=%27none%27%20stroke=%27%238a8f98%27%20stroke-width=%271.6%27%20stroke-linecap=%27round%27%20stroke-linejoin=%27round%27/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 3px center;background-size:9px 9px;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12px;font-weight:500;line-height:1;height:24px;padding:0 15px 0 4px;border-radius:999px;cursor:pointer;max-width:104px;text-overflow:ellipsis}',
      '.drc-select:hover{color:var(--dsw-alias-label-primary)}',
      '.drc-select option{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}',
      '.drc-select[disabled]{opacity:.4;cursor:default}',
      '.drc-sel{position:relative;display:inline-flex;align-items:center;gap:2px;height:26px;padding:0 3px 0 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,#e3e4e8);background:var(--dsw-alias-bg-layer-1,rgba(17,20,26,0.03))}',
      '.drc-sel:hover{border-color:var(--dsw-alias-border-l3,#c9cbd2);background:var(--dsw-alias-bg-layer-2,rgba(17,20,26,0.06))}',
      '.drc-sel.on{border-color:var(--dsw-alias-label-secondary,#6b7280);box-shadow:0 0 0 2px rgba(120,130,150,0.16)}',
      '.drc-sel.off{opacity:.45}',
      '.drc-sellabel{font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8f98);white-space:nowrap}',
      '.drc-selbtn{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 5px;border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-primary,#1f2226);font-size:12px;font-weight:500;cursor:pointer;font-family:inherit}',
      '.drc-selbtn:disabled{cursor:default}',
      '.drc-selbtn em{font-style:normal;max-width:76px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.drc-caret{width:0;height:0;border-left:3.5px solid transparent;border-right:3.5px solid transparent;border-top:4.5px solid currentColor;opacity:.45;transition:transform .12s ease}',
      '.drc-sel.on .drc-caret{transform:rotate(180deg)}',
      '.drc-menu{position:fixed;z-index:9000;min-width:110px;max-height:264px;overflow-y:auto;padding:4px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2,#e3e4e8);background:var(--dsw-alias-bg-base,#fff);box-shadow:0 12px 30px rgba(15,18,24,.16),0 2px 6px rgba(15,18,24,.08)}',
      '.drc-opt{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;padding:7px 9px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary,#1f2226);font-size:12.5px;text-align:left;cursor:pointer;font-family:inherit}',
      '.drc-opt:hover{background:var(--dsw-alias-bg-layer-2,rgba(17,20,26,.06))}',
      '.drc-opt.on{background:var(--dsw-alias-bg-layer-2,rgba(17,20,26,.06));font-weight:600}',
      '.drc-opt.on:after{content:"";flex:0 0 auto;width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-label-secondary,#6b7280)}',
      '@media (max-width:900px), (pointer: coarse) and (max-width:1180px){',
      '  .drc-root{--drc-fs:15px;--drc-lh:1.8;--drc-cfs:15px}',
      '  .drc-head{padding:8px 10px;gap:6px}',
      '  .drc-title{font-size:13px}',
      '  .drc-head .drc-hint{display:none}',
      '  .drc-headmenu{display:none}',
      '  .drc-headtoggle{display:inline-block}',
      '  .drc-head.open .drc-headmenu{display:flex;position:absolute;right:8px;top:38px;flex-direction:column;align-items:stretch;gap:6px;padding:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 8px 28px rgba(0,0,0,.22);z-index:30}',
      '  .drc-head.open .drc-headmenu .drc-nav{text-align:center;padding:8px 16px;font-size:13px;width:auto}',
      '  .drc-root.chatmode .drc-head{display:none}',
      '  .drc-body{padding:6px 6px 4px;gap:8px}',
  '.drc-sel{height:24px;padding:0 2px 0 7px}',
  '.drc-sel>span{font-size:10.5px}',
  '.drc-select{font-size:11.5px;height:22px;max-width:92px;padding:0 13px 0 3px}',
      '  .drc-tools{gap:6px;flex:0 0 auto;min-height:30px;overflow-x:auto;flex-wrap:nowrap;scrollbar-width:none;padding-bottom:2px}',
      '  .drc-tools::-webkit-scrollbar{display:none}',
      '  .drc-tools .drc-btn{flex:0 0 auto;padding:4px 8px}',
      '  .drc-chat{min-height:0}',
      '  .drc-log{padding:10px 8px 8px;gap:12px;border-radius:10px;min-height:0}',
      '  .drc-row{gap:6px}',
      '  .drc-avatar{width:30px;height:30px;font-size:12px;border-radius:4px}',
      '  .drc-bubble{max-width:100%;padding:9px 11px;border-radius:8px}',
      '  .drc-bubble:before{display:none}',
      '  .drc-composer{gap:6px;padding:6px 0 2px}',
      '  .drc-composer textarea{min-height:40px;max-height:150px;padding:8px 10px;border-radius:8px}',
      '  .drc-composer .drc-btn{padding:8px 12px}',
      '  .drc-lan{padding:8px 10px}',
      '  .drc-qr{width:104px;height:104px}',
      '  .drc-import{flex-direction:column;align-items:stretch;padding:8px 10px}',
      '  .drc-import input{width:100%;box-sizing:border-box;padding:7px 9px;font-size:13px}',
      '  .drc-card{padding:8px 10px;gap:8px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));align-items:center}',
      '  .drc-cardmain{grid-column:1/-1;min-width:0}',
      '  .drc-card .drc-btn{padding:6px 2px;font-size:12px;width:100%;min-width:0;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '  .drc-cardname{font-size:13.5px;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '  .drc-cardmeta{margin-top:3px}',
      '  .drc-editor textarea{min-height:140px}',
      '  .drc-sel{height:24px;padding:0 2px 0 7px;gap:1px}',
      '  .drc-sellabel{font-size:10.5px}',
      '  .drc-selbtn{height:22px;font-size:11.5px}',
      '  .drc-selbtn em{max-width:64px}',
      '  .drc-menu{min-width:104px;max-height:300px}',
      '  .drc-opt{padding:9px 9px;font-size:13px}',
      '}',
    ].join('\n')

    const installStyles = () => {
      const existing = document.getElementById(STYLE_ID)
      if (existing !== null && existing.textContent === CSS) return
      const style = existing === null ? document.createElement('style') : existing
      style.id = STYLE_ID
      style.textContent = CSS
      if (existing === null) document.head.appendChild(style)
    }

    const RailIcon = (props) => {
      const size = props !== null && props !== undefined && typeof props.size === 'number' ? props.size : 18
      const active = props !== null && props !== undefined && props.active === true
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: active ? 2 : 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        h('rect', { x: 3, y: 5, width: 18, height: 14, rx: 2.5 }),
        h('circle', { cx: 8.5, cy: 10, r: 1.8 }),
        h('path', { d: 'M5.6 16.2c.7-1.7 1.7-2.5 2.9-2.5s2.2.8 2.9 2.5' }),
        h('path', { d: 'M14 9.5h5M14 12.6h3.6' }),
      )
    }

    const avatarLetter = (name) => {
      const raw = String(name === null || name === undefined ? '' : name)
      const cleaned = raw.replace(/[^0-9A-Za-z\u4e00-\u9fff]/g, '')
      const picked = cleaned.slice(0, 1)
      return picked === '' ? '\u5979' : picked
    }

    const guessName = (body) => {
      const text = typeof body === 'string' ? body : ''
      const labelled = text.match(/(?:\u59D3\u540D|\u540D\u5B57|\u89D2\u8272\u540D|\u89D2\u8272|\u540D\u79F0|name)\s*[:\uFF1A]\s*([^\n\r]{1,32})/i)
      if (labelled !== null) return labelled[1].trim().slice(0, 24)
      const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0)
      if (firstLine === undefined) return ''
      return firstLine.replace(/^#+\s*/, '').slice(0, 24)
    }

    const RoleCardPanel = () => {
      const ctx = React.useContext(PanelCtx)
      const [snapshot, setSnapshot] = React.useState({ activeId: null, cards: [] })
      const [draft, setDraft] = React.useState(null)
      const [chat, setChat] = React.useState({ live: false, busy: false, error: null, partial: '', messages: [] })
      const [chatId, setChatId] = React.useState(null)
      const [input, setInput] = React.useState('')
      const [link, setLink] = React.useState('')
      const [busy, setBusy] = React.useState('')
      const [busySeconds, setBusySeconds] = React.useState(0)
      React.useEffect(() => {
        if (busy === '') {
          setBusySeconds(0)
          return undefined
        }
        const started = Date.now()
        setBusySeconds(0)
        const timer = setInterval(() => setBusySeconds(Math.round((Date.now() - started) / 1000)), 1000)
        return () => clearInterval(timer)
      }, [busy])
      const [notice, setNotice] = React.useState(null)
      // 提示是给当前这一步看的：几秒后自动消失，切界面时也一起清掉，
      // 否则回到列表页会再看到上一条，看起来像重复显示。
      React.useEffect(() => {
        if (notice === null) return undefined
        const ms = notice.kind === 'err' ? 9000 : 4200
        const timer = setTimeout(() => setNotice(null), ms)
        return () => clearTimeout(timer)
      }, [notice])
      const [confirmDelete, setConfirmDelete] = React.useState(null)
      // The list and the chat share one panel; the active role keeps chatId set,
      // so leaving the chat needs its own flag or it would bounce straight back.
      const [listMode, setListMode] = React.useState(true)
      React.useEffect(() => {
        setNotice(null)
      }, [listMode])

      React.useEffect(() => {
        const show = () => {
          homeWanted = false
          setListMode(true)
          setHeadOpen(false)
        }
        if (homeWanted) show()
        homeListeners.add(show)
        return () => {
          homeListeners.delete(show)
        }
      }, [])
      // 手机上的「⋯」菜单，只在窄屏出现（宽屏三个动作直接摆在标题栏里）。
      const [headOpen, setHeadOpen] = React.useState(false)
      const [expandReq, setExpandReq] = React.useState('')
      const readPref = (field, fallback) => {
        try {
          const raw = window.localStorage.getItem(IMPORT_PREF_KEY)
          const parsed = raw === null ? null : JSON.parse(raw)
          const value = parsed === null || parsed === undefined ? null : parsed[field]
          return typeof value === 'string' ? value : fallback
        } catch (error) {
          return fallback
        }
      }
      const [importMode, setImportMode] = React.useState(() => readPref('mode', 'normal'))
      const [importTone, setImportTone] = React.useState(() => readPref('tone', 'soft'))
      const [importStyle, setImportStyle] = React.useState(() => readPref('style', 'novel'))
      React.useEffect(() => {
        try {
          window.localStorage.setItem(IMPORT_PREF_KEY, JSON.stringify({ mode: importMode, tone: importTone, style: importStyle }))
        } catch (error) {
          void error
        }
      }, [importMode, importTone, importStyle])
      const [novelBusy, setNovelBusy] = React.useState(false)
      const [novelScope, setNovelScope] = React.useState('fast')
      // 「全部导入」的后台补更进度：{ running, imported, total, error }
      const [novelJob, setNovelJob] = React.useState(null)
      const [openSel, setOpenSel] = React.useState(null)
      const [selRect, setSelRect] = React.useState(null)
      React.useEffect(() => {
        if (openSel === null) return undefined
        if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return undefined
        const onView = () => setOpenSel(null)
        const onDoc = (event) => {
          const hit = event !== null && event !== undefined ? event.target : undefined
          if (hit !== null && hit !== undefined && typeof hit.closest === 'function' && hit.closest('.drc-sel') !== null) return
          setOpenSel(null)
        }
        window.addEventListener('scroll', onView, true)
        window.addEventListener('resize', onView)
        document.addEventListener('mousedown', onDoc, true)
        document.addEventListener('touchstart', onDoc, true)
        return () => {
          window.removeEventListener('scroll', onView, true)
          window.removeEventListener('resize', onView)
          document.removeEventListener('mousedown', onDoc, true)
          document.removeEventListener('touchstart', onDoc, true)
        }
      }, [openSel])
      const [fontStep, setFontStep] = React.useState(() => {
        try {
          const saved = window.localStorage.getItem(FONT_KEY)
          if (FONT_CHOICES.some((choice) => choice.id === saved)) return saved
        } catch (error) {
          // 隐私模式拿不到 localStorage，就当没设过。
        }
        return 'auto'
      })
      // 手机访问：状态由 Host 持有（socket 在 Host 进程里），这里只镜像。
      const [lan, setLan] = React.useState(null)
      const [lanBusy, setLanBusy] = React.useState('')
      const logRef = React.useRef(null)
      const stuckRef = React.useRef(true)
      const busyRef = React.useRef(false)

      const applySnapshot = (payload) => {
        if (payload === null || payload === undefined) return
        if (payload.ok === false) {
          setNotice({ kind: 'err', text: String(payload.error ?? '\u51FA\u9519\u4E86') })
          return
        }
        setSnapshot({
          activeId: typeof payload.activeId === 'string' ? payload.activeId : null,
          cards: Array.isArray(payload.cards) ? payload.cards : [],
        })
      }

      const refresh = React.useCallback(async () => {
        try {
          applySnapshot(await api('GET', '/state'))
        } catch (error) {
          setNotice({ kind: 'err', text: '\u8BFB\u4E0D\u5230\u89D2\u8272\u5361\uFF1A' + String(error && error.message ? error.message : error) })
        }
      }, [])

      React.useEffect(() => {
        // 第一次打开就把 main 区切到角色卡（相当于把这里设成主页）；
        // 用户自己点「返回对话」之后不再抢回来，只在每次加载时做一次。
        if (!homeApplied) {
          homeApplied = true
          try {
            const layout = ctx !== null && ctx !== undefined && typeof ctx.get === 'function' ? ctx.get('layout') : undefined
            if (layout !== null && layout !== undefined && typeof layout.selectPanel === 'function') {
              const snap = typeof layout.getSnapshot === 'function' ? layout.getSnapshot() : null
              const current = snap !== null && snap !== undefined && snap.panelInfo !== undefined ? snap.panelInfo.activePanelId : null
              if (current !== PANEL_ID) layout.selectPanel(PANEL_ID)
            }
          } catch {
            /* 拿不到 layout 就算了，面板照常能在侧栏点开 */
          }
        }
        void refresh()
        void api('POST', '/hello', {
          source: 'panel',
          version: VERSION,
          href: String(window.location && window.location.href ? window.location.href : ''),
          ua: String(navigator.userAgent || ''),
        }).catch(() => {})
      }, [refresh])

      /* ---------- 手机访问（局域网） ---------- */

      const loadLan = React.useCallback(async () => {
        try {
          const payload = await api('GET', '/lan')
          if (payload !== null && payload.ok !== false && payload.lan) setLan(payload.lan)
        } catch {
          /* 面板打开时读不到就保持 null，不打扰用户 */
        }
      }, [])

      React.useEffect(() => {
        void loadLan()
      }, [loadLan])

      const lanAction = React.useCallback(
        async (name, path, body) => {
          setLanBusy(name)
          try {
            const payload = await api('POST', path, body ?? {})
            if (payload !== null && payload.lan) setLan(payload.lan)
            if (payload !== null && payload.ok === false) {
              setNotice({ kind: 'err', text: String(payload.error ?? '\u5F00\u542F\u5931\u8D25') })
            }
          } catch (error) {
            setNotice({ kind: 'err', text: '\u624B\u673A\u8BBF\u95EE\u64CD\u4F5C\u5931\u8D25\uFF1A' + String(error && error.message ? error.message : error) })
          } finally {
            setLanBusy('')
          }
        },
        [],
      )

      const lanLink = lan !== null && Array.isArray(lan.urls) && lan.urls.length > 0 ? String(lan.urls[0].unlock) : ''

      const copyLanLink = async () => {
        if (lanLink.length === 0) return
        try {
          if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            await navigator.clipboard.writeText(lanLink)
          } else {
            const scratch = document.createElement('textarea')
            scratch.value = lanLink
            scratch.style.position = 'fixed'
            scratch.style.opacity = '0'
            document.body.appendChild(scratch)
            scratch.select()
            document.execCommand('copy')
            document.body.removeChild(scratch)
          }
          setNotice({ kind: 'ok', text: '\u94FE\u63A5\u5DF2\u590D\u5236\uFF0C\u53D1\u5230\u624B\u673A\u4E0A\u6253\u5F00\u5C31\u80FD\u7EE7\u7EED\u804A\u5929' })
        } catch (error) {
          setNotice({ kind: 'err', text: '\u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u624B\u52A8\u9009\u4E2D\u94FE\u63A5\u590D\u5236' })
        }
      }

      const targetId = chatId !== null ? chatId : snapshot.activeId

      // 字号档位：auto 不写内联变量，交给 CSS 里的媒体查询；钉住的档位才覆盖。
      const fontChoice = FONT_CHOICES.find((choice) => choice.id === fontStep) || FONT_CHOICES[0]
      const rootStyle =
        fontChoice.bubble === null
          ? undefined
          : { '--drc-fs': fontChoice.bubble, '--drc-lh': fontChoice.line, '--drc-cfs': fontChoice.composer }
      const cycleFont = () => {
        const index = FONT_CHOICES.findIndex((choice) => choice.id === fontStep)
        const next = FONT_CHOICES[(index + 1) % FONT_CHOICES.length] || FONT_CHOICES[0]
        setFontStep(next.id)
        try {
          window.localStorage.setItem(FONT_KEY, next.id)
        } catch (error) {
          // 存不下就算了，只影响下次打开时的默认值。
        }
      }

      React.useEffect(() => {
        busyRef.current = chat.busy === true
      }, [chat.busy])

      const loadChat = React.useCallback(
        async (id) => {
          if (typeof id !== 'string' || id.length === 0) {
            setChat({ live: false, busy: false, error: null, partial: '', messages: [] })
            return
          }
          try {
            const payload = await api('GET', '/chat?id=' + encodeURIComponent(id))
            if (payload !== null && payload.ok !== false) {
              setChat({
                live: payload.live === true,
                busy: payload.busy === true,
                error: payload.error === null || payload.error === undefined ? null : String(payload.error),
                messages: Array.isArray(payload.messages) ? payload.messages : [],
                partial: typeof payload.partial === 'string' ? payload.partial : '',
              })
            } else if (payload !== null && payload.ok === false) {
              setChat({ live: false, busy: false, error: String(payload.error ?? ''), messages: [] })
            }
          } catch {
            /* a transient poll failure is not worth a notice */
          }
        },
        [],
      )

      React.useEffect(() => {
        void loadChat(targetId)
      }, [targetId, loadChat])

      // Poll while the panel is open: the answer arrives from the Host, and a
      // finished turn also refreshes the card list (hasChat flips).
      React.useEffect(() => {
        if (typeof targetId !== 'string') return undefined
        let stopped = false
        let last = 0
        const timer = setInterval(() => {
          if (stopped) return
          const hidden = typeof document !== 'undefined' && document !== null && document.hidden === true
          const gap = hidden ? POLL_HIDDEN_MS : busyRef.current === true ? 700 : POLL_MS
          const now = Date.now()
          if (now - last < gap) return
          last = now
          void loadChat(targetId)
        }, POLL_MS)
        return () => {
          stopped = true
          clearInterval(timer)
        }
      }, [targetId, loadChat])

      React.useEffect(() => {
        const node = logRef.current
        if (node === null || node === undefined) return
        const distance = node.scrollHeight - node.scrollTop - node.clientHeight
        if (stuckRef.current === false && distance > 160) return
        node.scrollTop = node.scrollHeight
        stuckRef.current = true
      }, [chat.messages.length, chat.busy])

      const onLogScroll = () => {
        const node = logRef.current
        if (node === null || node === undefined) return
        const distance = node.scrollHeight - node.scrollTop - node.clientHeight
        stuckRef.current = distance < 160
      }

      const backToConversation = () => {
        try {
          const layout = ctx !== null && ctx !== undefined && typeof ctx.get === 'function' ? ctx.get('layout') : undefined
          if (layout !== undefined && layout !== null && typeof layout.selectPanel === 'function') {
            layout.selectPanel(null)
            return true
          }
        } catch {
          /* fall through: the button stays honest about doing nothing */
        }
        return false
      }

      const openEditor = async (id) => {
        try {
          const payload = await api('GET', '/card?id=' + encodeURIComponent(id))
          if (payload !== null && payload.ok !== false && payload.card !== undefined && payload.card !== null) {
            setDraft({ id: payload.card.id, name: payload.card.name, body: payload.card.body })
            return
          }
          setNotice({ kind: 'err', text: String(payload && payload.error ? payload.error : '\u8BFB\u4E0D\u5230\u8FD9\u5F20\u5361') })
        } catch (error) {
          setNotice({ kind: 'err', text: '\u8BFB\u4E0D\u5230\u8FD9\u5F20\u5361\uFF1A' + String(error && error.message ? error.message : error) })
        }
      }

      const saveDraft = async () => {
        if (draft === null) return
        const body = typeof draft.body === 'string' ? draft.body : ''
        if (body.trim().length === 0) {
          setNotice({ kind: 'err', text: '\u89D2\u8272\u5361\u6B63\u6587\u4E0D\u80FD\u4E3A\u7A7A\uFF08\u628A\u6574\u5F20\u5361\u7C98\u8FDB\u6765\u5C31\u884C\uFF09' })
          return
        }
        setBusy('save')
        try {
          const name = typeof draft.name === 'string' && draft.name.trim().length > 0 ? draft.name.trim() : guessName(body)
          const payload = await api('POST', '/save', { id: draft.id, name, body })
          if (payload === null || payload.ok === false) {
            setNotice({ kind: 'err', text: String(payload && payload.error ? payload.error : '\u4FDD\u5B58\u5931\u8D25') })
            return
          }
          applySnapshot(payload)
          const savedId = typeof draft.id === 'string' ? draft.id : payload.cards && payload.cards[0] ? payload.cards[0].id : null
          if (typeof savedId === 'string' && payload.activeId !== savedId) {
            const activated = await api('POST', '/activate', { id: savedId })
            applySnapshot(activated)
          }
          setDraft(null)
          setChatId(typeof savedId === 'string' ? savedId : null)
          setListMode(false)
          setListMode(false)
          setNotice({ kind: 'ok', text: '\u5DF2\u4FDD\u5B58\uFF0C\u53EF\u4EE5\u5F00\u59CB\u5BF9\u8BDD\u4E86' })
        } catch (error) {
          setNotice({ kind: 'err', text: '\u4FDD\u5B58\u5931\u8D25\uFF1A' + String(error && error.message ? error.message : error) })
        } finally {
          setBusy('')
        }
      }

      const importFromLink = async () => {
        const url = link.trim()
        if (url.length === 0) {
          setNotice({ kind: 'err', text: '\u5148\u7C98\u4E00\u4E2A\u89D2\u8272\u5361\u94FE\u63A5' })
          return
        }
        setBusy('import')
        try {
          const payload = await api('POST', '/import', { url, mode: importMode, tone: importTone, style: importStyle }, 90000)
          if (payload === null || payload.ok === false) {
            setNotice({ kind: 'err', text: String(payload && payload.error ? payload.error : '\u5BFC\u5165\u5931\u8D25') })
            return
          }
          applySnapshot(payload)
          const card = payload.card
          if (card !== null && card !== undefined) {
            setChatId(card.id)
            setListMode(false)
            setListMode(false)
            setDraft({ id: card.id, name: card.name, body: card.body })
          }
          setLink('')
          const source = payload.imported && payload.imported.source ? payload.imported.source : 'link'
          const chars = card !== null && card !== undefined && typeof card.body === 'string' ? card.body.length : 0
          setNotice({ kind: 'ok', text: '\u5DF2\u5BFC\u5165\uFF1A' + String(card && card.name ? card.name : '\u89D2\u8272\u5361') + '\uFF08' + source + '\uFF0C' + chars + ' \u5B57\uFF09\uFF0C\u786E\u8BA4\u65E0\u8BEF\u70B9\u300C\u4FDD\u5B58\u300D' })
        } catch (error) {
          setNotice({ kind: 'err', text: '\u5BFC\u5165\u5931\u8D25\uFF1A' + String(error && error.message ? error.message : error) })
        } finally {
          setBusy('')
        }
      }

      const send = async () => {
        const id = targetId
        const text = input
        if (typeof id !== 'string') {
          setNotice({ kind: 'err', text: '\u5148\u9009\u4E00\u4E2A\u89D2\u8272' })
          return
        }
        if (text.trim().length === 0) return
        setBusy('send')
        setInput('')
        try {
          const payload = await api('POST', '/chat', { id, text }, 300000)
          if (payload === null || payload.ok === false) {
            const message = String(payload && payload.error ? payload.error : '\u53D1\u9001\u5931\u8D25')
            setNotice({ kind: 'err', text: message })
            setInput(text)
            return
          }
          applySnapshot(payload)
          setChat({
            live: true,
            busy: payload.busy === true,
            error: null,
            messages: Array.isArray(payload.messages) ? payload.messages : [],
          })
        } catch (error) {
          setNotice({ kind: 'err', text: '\u53D1\u9001\u5931\u8D25\uFF1A' + String(error && error.message ? error.message : error) })
          setInput(text)
        } finally {
          setBusy('')
        }
      }

      const resetChat = async () => {
        if (typeof targetId !== 'string') return
        setBusy('reset')
        try {
          const payload = await api('POST', '/chat/reset', { id: targetId })
          if (payload !== null && payload.ok !== false) {
            setChat({ live: false, busy: false, error: null, messages: [] })
            setNotice({ kind: 'ok', text: '\u5BF9\u8BDD\u5DF2\u6E05\u7A7A\uFF0C\u89D2\u8272\u8BBE\u5B9A\u8FD8\u5728' })
          }
        } catch (error) {
          setNotice({ kind: 'err', text: '\u6E05\u7A7A\u5931\u8D25\uFF1A' + String(error && error.message ? error.message : error) })
        } finally {
          setBusy('')
        }
      }

      const expandFromLink = async () => {
        const url = link.trim()
        if (url.length === 0) {
          setNotice({ kind: 'err', text: '\u5148\u7C98\u4E00\u4E2A\u94FE\u63A5\uFF08\u89D2\u8272\u7AD9\u9875\u9762\u3001\u5C0F\u8BF4\u7AE0\u8282\u90FD\u884C\uFF09' })
          return
        }
        setBusy('expand')
        setNotice({ kind: 'ok', text: '\u6B63\u5728\u8BFB\u7D20\u6750\u5E76\u6269\u5199\uFF0C\u53EF\u80FD\u8981\u4E8C\u4E09\u5341\u79D2\u2026' })
        try {
          const payload = await api('POST', '/expand', {
            url,
            requirements: expandReq.trim(),
            mode: importMode,
            tone: importTone,
            style: importStyle,
          }, 300000)
          if (payload === null || payload.ok === false) {
            setNotice({ kind: 'err', text: '\u6269\u5199\u5931\u8D25\uFF1A' + String(payload && payload.error ? payload.error : '\u672A\u77E5\u539F\u56E0') })
            return
          }
          const name = payload.expanded && payload.expanded.name ? payload.expanded.name : ''
          setDraft({ id: null, name, body: String(payload.expanded.body) })
          setChatId(null)
          setListMode(false)
          const chars = payload.expanded && payload.expanded.chars ? payload.expanded.chars : 0
          const kind = payload.source && payload.source.kind ? payload.source.kind : 'page'
          setNotice({ kind: 'ok', text: '\u6269\u5199\u5B8C\u6210\uFF1A' + chars + ' \u5B57\uFF08\u7D20\u6750\u6765\u6E90\uFF1A' + kind + '\uFF09\uFF0C\u770B\u4E00\u773C\u6CA1\u95EE\u9898\u5C31\u70B9\u4FDD\u5B58' })
        } catch (error) {
          setNotice({ kind: 'err', text: '\u6269\u5199\u5931\u8D25\uFF1A' + String(error && error.message ? error.message : error) })
        } finally {
          setBusy('')
        }
      }

      const importNovel = async () => {
        const url = link.trim()
        if (url.length === 0) {
          setNotice({ kind: 'err', text: '\u5148\u7C98\u4E00\u4E2A\u5C0F\u8BF4\u94FE\u63A5\uFF08\u76EE\u5F55\u9875\u6216\u5355\u7AE0\u9875\u90FD\u884C\uFF09' })
          return
        }
        setNovelBusy(true)
        setBusy('novel')
        setNotice({
          kind: 'ok',
          text:
            novelScope === 'full'
              ? '\u6B63\u5728\u62D3\u524D 40 \u7AE0\u5148\u628A\u5361\u51FA\u6765\uFF0C\u5269\u4E0B\u7684\u7AE0\u8282\u4F1A\u5728\u540E\u53F0\u4E00\u6279\u6279\u8865\uFF08\u5BFC\u5165\u4E2D\u80FD\u6B63\u5E38\u804A\uFF09\u3002'
              : '正在抓前 40 章原文…一会儿就出卡，后面的章节在对话界面点「继续导入」一批批补。',
        })
        try {
          const payload = await api('POST', '/novel', { url, mode: importMode, tone: importTone, style: importStyle, full: novelScope === 'full' }, 240000)
          if (payload === null || payload.ok === false) {
            setNotice({ kind: 'err', text: '\u5C0F\u8BF4\u5BFC\u5165\u5931\u8D25\uFF1A' + String(payload && payload.error ? payload.error : '\u672A\u77E5\u539F\u56E0') })
            return
          }
          await refresh()
          setNovelJob(payload.job !== undefined && payload.job !== null ? payload.job : null)
          const info = payload.novel || {}
          const total = info.total ? info.total : 0
          const bookTotal = info.bookTotal ? info.bookTotal : total
          const name = info.title ? info.title : '\u672A\u547D\u540D\u5C0F\u8BF4'
          const failedCount = payload.failedCount ? payload.failedCount : 0
          const jobRunning = payload.job !== null && payload.job !== undefined && payload.job.running === true
          const moreText = jobRunning
            ? '全书 ' + bookTotal + ' 章，后台正在接着导入（已 ' + total + '/' + bookTotal + '），进度会自己涨，不用守着。'
            : info.hasMore === true
              ? '全书共 ' + bookTotal + ' 章，这次抓了前 ' + total + ' 章。想看后面就去这张卡的对话界面点「继续导入」，一次补 40 章。'
              : ''
          setNotice({
            kind: failedCount > 0 ? 'warn' : 'ok',
            text: '\u5DF2\u5EFA\u5361\uFF1A' + name + ' \u00B7 \u6293\u5230 ' + total + ' \u7AE0\uFF08\u539F\u6587\u7167\u6284\uFF0C\u5267\u60C5\u6309\u7AE0\u8D70\uFF09\u3002\u70B9\u300C\u8FDB\u5165\u89D2\u8272\u300D\u5F00\u59CB\uFF0C\u804A\u5B8C\u4E00\u7AE0\u70B9\u300C\u4E0B\u4E00\u7AE0\u300D\u3002' + moreText + (failedCount > 0 ? '\u53E6\u6709 ' + failedCount + ' \u7AE0\u6CA1\u6293\u5230\uFF08\u7AD9\u70B9\u6162\u6216\u53CD\u722C\uFF09\uFF0C\u53EF\u7A0D\u540E\u91CD\u5BFC\u3002' : ''),
          })
          setLink('')
        } catch (error) {
          setNotice({
            kind: 'err',
            text:
              '\u5C0F\u8BF4\u5BFC\u5165\u5931\u8D25\uFF1A' + String(error && error.message ? error.message : error) +
              (novelScope === 'full' ? '（全部导入太久可能被中途掐断：把「小说范围」换成「快速」，出卡后在对话界面点「继续导入」一批批补更稳）' : ''),
          })
        } finally {
          setNovelBusy(false)
          setBusy('')
        }
      }

      // 检查更新：书追到最新章节之后，问一下站点有没有贴新章。
      // 站点加了新章 → 按钮会变成可点的「有更新，接着抓」，点它才真正抓。
      const checkNovelUpdate = async () => {
        if (chatCard === null) {
          return
        }
        setBusy('novel')
        setNotice({ kind: 'ok', text: '正在问站点这本更到第几章了…' })
        try {
          const payload = await api('POST', '/novel/extend', { id: chatCard.id, mode: 'check' }, 240000)
          if (payload === null || payload.ok === false) {
            setNotice({ kind: 'err', text: String(payload && payload.error ? payload.error : '检查更新失败') })
            return
          }
          await refresh()
          setNotice({
            kind: 'ok',
            text: String(payload.message ? payload.message : payload.hasUpdate === true ? '有新章节' : '已是最新'),
          })
        } catch (error) {
          setNotice({ kind: 'err', text: '检查更新失败：' + String(error && error.message ? error.message : error) })
        } finally {
          setBusy('')
        }
      }

      // 继续导入：固定 40 章一次，从已经抓到的地方接着往后抓。
      // 上千章的书一拍一拍补，比让用户猜百分比直观得多。
      const extendNovel = async () => {
        if (chatCard === null) {
          return
        }
        const info = chatCard.novel || {}
        const fromNo = (info.total ? info.total : 0) + 1
        const bookTotal = info.bookTotal ? info.bookTotal : info.total ? info.total : 0
        const toNo = Math.min(fromNo + 39, Math.max(bookTotal, fromNo))
        setBusy('novel')
        setNotice({ kind: 'ok', text: '正在抓第 ' + fromNo + ' 章 到 第 ' + toNo + ' 章（全书 ' + bookTotal + ' 章）…' })
        try {
          const payload = await api('POST', '/novel/extend', { id: chatCard.id }, 240000)
          if (payload === null || payload.ok === false) {
            setNotice({ kind: 'err', text: '续导失败：' + String(payload && payload.error ? payload.error : '未知原因') })
            return
          }
          await refresh()
          setNovelJob(payload.job !== undefined && payload.job !== null ? payload.job : null)
          const after = payload.novel || {}
          const added = payload.added ? payload.added : 0
          const failedCount = payload.failedCount ? payload.failedCount : 0
          if (payload.skipped === true) {
            setNotice({ kind: 'ok', text: String(payload.message ? payload.message : '已经抓完了') })
            return
          }
          setNotice({
            kind: failedCount > 0 ? 'warn' : 'ok',
            text:
              '续导完成：新增 ' + added + ' 章，现在 ' + (after.total ? after.total : 0) + ' / ' + (after.bookTotal ? after.bookTotal : 0) + ' 章。' +
              (after.hasMore === true ? '要继续就再点一次「继续导入」。' : '已经抓完全书，之后按钮会变成「检查更新」。') +
              (failedCount > 0 ? '另有 ' + failedCount + ' 章没抓到（站点限流），再点一次会补。' : ''),
          })
        } catch (error) {
          setNotice({ kind: 'err', text: '续导失败：' + String(error && error.message ? error.message : error) })
        } finally {
          setBusy('')
        }
      }

      const nextChapter = async () => {
        if (chatCard === null) return
        setBusy('novel')
        try {
          const payload = await api('POST', '/novel/next', { id: chatCard.id })
          if (payload === null || payload.ok === false) {
            setNotice({ kind: 'err', text: String(payload && payload.error ? payload.error : '\u5207\u7AE0\u5931\u8D25') })
            return
          }
          await refresh()
          const info = payload.novel || {}
          const title = payload.chapter && payload.chapter.title ? payload.chapter.title : ''
          setNotice({
            kind: 'ok',
            text: '\u8FDB\u5165\u7B2C ' + (info.current ? info.current : '?') + ' \u7AE0 / \u5171 ' + (info.total ? info.total : '?') + ' \u7AE0' + (title ? '\uFF1A' + title : ''),
          })
        } catch (error) {
          setNotice({ kind: 'err', text: '\u5207\u7AE0\u5931\u8D25\uFF1A' + String(error && error.message ? error.message : error) })
        } finally {
          setBusy('')
        }
      }

      const expandDraft = async () => {
        if (draft === null) return
        const text = typeof draft.body === 'string' ? draft.body : ''
        if (text.trim().length === 0) {
          setNotice({ kind: 'err', text: '\u6B63\u6587\u662F\u7A7A\u7684\uFF0C\u5148\u7C98\u70B9\u7D20\u6750\u518D\u6269\u5199' })
          return
        }
        setBusy('expand')
        setNotice({ kind: 'ok', text: '\u6B63\u5728\u6309\u4F60\u7684\u8981\u6C42\u91CD\u5199\u8FD9\u5F20\u5361\uFF0C\u53EF\u80FD\u8981\u4E8C\u4E09\u5341\u79D2\u2026' })
        try {
          const payload = await api('POST', '/expand', {
            text,
            name: typeof draft.name === 'string' ? draft.name : '',
            requirements: expandReq.trim(),
            mode: importMode,
            tone: importTone,
            style: importStyle,
          }, 300000)
          if (payload === null || payload.ok === false) {
            setNotice({ kind: 'err', text: '\u6269\u5199\u5931\u8D25\uFF1A' + String(payload && payload.error ? payload.error : '\u672A\u77E5\u539F\u56E0') })
            return
          }
          setDraft({
            id: draft.id,
            name: payload.expanded && payload.expanded.name ? payload.expanded.name : draft.name,
            body: String(payload.expanded.body),
          })
          setNotice({ kind: 'ok', text: '\u5DF2\u91CD\u5199\uFF0C\u786E\u8BA4\u540E\u70B9\u4FDD\u5B58' })
        } catch (error) {
          setNotice({ kind: 'err', text: '\u6269\u5199\u5931\u8D25\uFF1A' + String(error && error.message ? error.message : error) })
        } finally {
          setBusy('')
        }
      }

      const openRole = async (id) => {
        if (typeof id !== 'string' || id.length === 0) return
        setBusy('open')
        try {
          const payload = await api('POST', '/open', { id }, 300000)
          if (payload === null || payload.ok === false) {
            setNotice({ kind: 'err', text: String(payload && payload.error ? payload.error : '\u5F00\u573A\u5931\u8D25') })
            return
          }
          applySnapshot(payload)
          setChatId(id)
          setListMode(false)
          setChat({
            live: true,
            busy: payload.busy === true,
            error: null,
            messages: Array.isArray(payload.messages) ? payload.messages : [],
          })
          if (payload.opened === false) {
            setNotice({ kind: 'err', text: '\u8FD9\u5F20\u5361\u5DF2\u7ECF\u6709\u5BF9\u8BDD\u4E86\uFF0C\u76F4\u63A5\u8FDB\u53BB\u7EE7\u7EED\uFF1B\u60F3\u91CD\u65B0\u5F00\u573A\u5C31\u5148\u6E05\u7A7A\u5BF9\u8BDD' })
          }
        } catch (error) {
          setNotice({ kind: 'err', text: '\u5F00\u573A\u5931\u8D25\uFF1A' + String(error && error.message ? error.message : error) })
        } finally {
          setBusy('')
        }
      }

      const FIELD_LABEL = { mode: '\u6A21\u5F0F', tone: '\u5C3A\u5EA6', pace: '\u8282\u594F', style: '\u6587\u98CE' }

      const HELP = {
        mode: '\u6A21\u5F0F\uFF1A\u6210\u4EBA / \u666E\u901A\u3002\u6210\u4EBA\u6309\u300C\u5C3A\u5EA6\u300D\u5199\u6027\u63CF\u5199\uFF1B\u666E\u901A\u5B8C\u5168\u4E0D\u5199\u6027\u5185\u5BB9\uFF0C\u5C3A\u5EA6\u4F1A\u88AB\u9501\u5728\u300C\u65E0/\u6697\u793A\u300D\u3002',
        tone: '\u5C3A\u5EA6\uFF1A\u80FD\u5199\u5230\u591A\u9732\u9AA8\u3002\u65E0 \u2192 \u6697\u793A \u2192 \u542B\u60C5 \u2192 \u9732\u9AA8 \u2192 \u6781\u81F4\u3002\u666E\u901A\u6A21\u5F0F\u4E0B\u6700\u9AD8\u53EA\u5230\u300C\u6697\u793A\u300D\u3002',
        pace: '\u8282\u594F\uFF1A\u63A8\u8FDB\u5FEB\u6162\u3002\u6162\u70ED\u5148\u94FA\u73AF\u5883\u4E0E\u5FC3\u7406\uFF1B\u81EA\u7136\u5747\u8861\uFF1B\u76F4\u63A5\u5F88\u5FEB\u8FDB\u6B63\u9898\u3002',
        style: '\u6587\u98CE\uFF1A\u8F93\u51FA\u4F53\u88C1\u3002\u89D2\u8272\u626E\u6F14=\u65C1\u767D+\u53F0\u8BCD\uFF1B\u5C0F\u8BF4\u4F53\uFF1B\u804A\u5929\u4F53=\u50CF\u5FAE\u4FE1\u8BB0\u5F55\uFF1B\u5267\u672C\u4F53\uFF1B\u65E5\u8BB0\u4F53\u3002',
      }
      const HELP_OPTION = {
        mode: { adult: '\u5141\u8BB8\u6027\u63CF\u5199', normal: '\u5B8C\u5168\u4E0D\u5199\u6027\u5185\u5BB9' },
        tone: { none: '\u7EAF\u5267\u60C5', hint: '\u53EA\u7ED9\u6C14\u6C1B\u4E0E\u6697\u793A', soft: '\u6709\u63A5\u89E6\u4E0E\u60C5\u7EEA\uFF0C\u4E0D\u9732\u9AA8', explicit: '\u6027\u573A\u9762\u6B63\u9762\u63CF\u5199', hard: '\u7EC6\u8282\u5BC6\u5EA6\u6700\u5927' },
        pace: { slow: '\u5148\u94FA\u73AF\u5883\u4E0E\u5FC3\u7406', steady: '\u63A8\u8FDB\u4E0E\u63CF\u5199\u5747\u8861', direct: '\u5F88\u5FEB\u8FDB\u5165\u6B63\u9898' },
        style: { rp: '\u65C1\u767D+\u53F0\u8BCD', novel: '\u7B2C\u4E09\u4EBA\u79F0\u53D9\u8FF0', chat: '\u50CF\u5FAE\u4FE1\u804A\u5929\u8BB0\u5F55', script: '\u573A\u666F\u6807\u9898+\u89D2\u8272\u540D\u53F0\u8BCD', diary: '\u7B2C\u4E00\u4EBA\u79F0\uFF0C\u5E26\u65E5\u671F' },
      }
      const hintFor = (field, value) => {
        const table = field === 'mode' ? MODE_CHOICES : field === 'tone' ? TONE_CHOICES : field === 'pace' ? PACE_CHOICES : STYLE_CHOICES
        const hit = table.find((entry) => entry[0] === value)
        const note = (HELP_OPTION[field] ?? {})[value]
        const name = hit === undefined ? String(value) : hit[1]
        return note === undefined ? name : name + ' —— ' + note
      }
      const labelOf = (field, value) => {
        const table =
          field === 'mode' ? MODE_CHOICES : field === 'tone' ? TONE_CHOICES : field === 'pace' ? PACE_CHOICES : STYLE_CHOICES
        const hit = table.find((entry) => entry[0] === value)
        return hit === undefined ? String(value) : hit[1]
      }

      const setCardField = async (card, field, value) => {
        if (card === null || card === undefined) return
        if (card[field] === value) return
        const path = field === 'mode' ? '/mode' : field === 'tone' ? '/tone' : field === 'pace' ? '/pace' : '/style'
        setBusy(field)
        try {
          const body = { id: card.id }
          body[field] = value
          const payload = await api('POST', path, body)
          if (payload === null || payload.ok === false) {
            setNotice({ kind: 'err', text: String(payload && payload.error ? payload.error : '\u5207\u6362\u5931\u8D25') })
            return
          }
          applySnapshot(payload)
          setNotice({ kind: 'ok', text: FIELD_LABEL[field] + '\uFF1A' + labelOf(field, value) + '\uFF08\u4E0B\u4E00\u53E5\u8D77\u751F\u6548\uFF09' })
        } catch (error) {
          setNotice({ kind: 'err', text: '\u5207\u6362\u5931\u8D25\uFF1A' + String(error && error.message ? error.message : error) })
        } finally {
          setBusy('')
        }
      }

      // \u804A\u5929\u5DE5\u5177\u6761\u4E0A\u7684\u4E0B\u62C9\uFF1A\u4E00\u4E2A\u63A7\u4EF6\u7BA1\u4E00\u4E2A\u5B57\u6BB5\uFF0C\u5207\u5B8C\u7ACB\u523B\u5237\u65B0 section\u3002
    /* 下拉菜单曾用 absolute 定位，被工具条的 overflow 和吸顶容器裁成半截，
     * 看起来像"另一个界面的东西"。改成 viewport 固定定位：坐标在打开那一刻
     * 按按钮的 rect 算，超出视口就往上翻，左右夹在视口里。 */
    const readRect = (event) => {
      try {
        const node =
          event !== null && event !== undefined
            ? event.currentTarget !== undefined && event.currentTarget !== null
              ? event.currentTarget
              : event.target
            : null
        if (node === null || node === undefined || typeof node.getBoundingClientRect !== 'function') return null
        const box = node.getBoundingClientRect()
        return { left: box.left, top: box.top, bottom: box.bottom, width: box.width }
      } catch (error) {
        return null
      }
    }

    const menuPos = (rect) => {
      const vw = typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 1280
      const vh = typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : 800
      const width = rect === null || rect.width < 120 ? 138 : Math.round(rect.width)
      const left = rect === null ? 12 : Math.max(8, Math.min(rect.left, vw - width - 8))
      const style = { position: 'fixed', left: left + 'px', minWidth: width + 'px', zIndex: 9000 }
      const below = rect === null ? 80 : rect.bottom + 6
      if (rect !== null && below + 300 > vh) style.bottom = Math.max(10, vh - rect.top + 6) + 'px'
      else style.top = below + 'px'
      return style
    }

    const DropSelect = (props) => {
      const choices = Array.isArray(props.choices) ? props.choices : []
      const disabled = props.disabled === true
      const value = props.value
      const open = props.open === true && !disabled
      const found = choices.filter((entry) => entry[0] === value)[0]
      const active = found === undefined ? (choices[0] ?? [value, String(value)]) : found
      return h(
        'div',
        { className: 'drc-sel' + (open ? ' on' : '') + (disabled ? ' off' : '') },
        h('span', { className: 'drc-sellabel' }, props.label),
        h(
          'button',
          {
            type: 'button',
            className: 'drc-selbtn',
            disabled: disabled,
            title:
              (props.hint === undefined ? props.label : props.hint) +
              '\n' +
              (disabled
                ? '\uFF08\u5F53\u524D\u6A21\u5F0F\u9501\u4F4F\u4E86\u8FD9\u4E2A\u9009\u9879\uFF09'
                : '\u5F53\u524D\uFF1A' + active[1] + '\n' + '\u70B9\u4E00\u4E0B\u5C55\u5F00\u9009\u9879'),
            onClick: () => {
              if (disabled) return
              if (typeof props.onToggle === 'function') props.onToggle()
            },
          },
          h('em', null, active[1]),
          h('i', { className: 'drc-caret', 'aria-hidden': 'true' }),
        ),
        open
          ? h(
              'div',
              { className: 'drc-menu', role: 'listbox', style: menuPos(props.rect === undefined ? null : props.rect) },
              choices.map((entry) =>
                h(
                  'button',
                  {
                    type: 'button',
                    key: entry[0],
                    role: 'option',
                    'aria-selected': entry[0] === value ? 'true' : 'false',
                    className: 'drc-opt' + (entry[0] === value ? ' on' : ''),
                    title: props.field === undefined ? undefined : hintFor(props.field, entry[0]),
                    onClick: () => {
                      if (typeof props.onPick === 'function') props.onPick(entry[0])
                    },
                  },
                  entry[1],
                ),
              ),
            )
          : null,
      )
    }
      const toggleSel = (field, event) => {
        const next = openSel === field ? null : field
        setOpenSel(next)
        setSelRect(next === null ? null : readRect(event))
      }

      const selector = (label, field, card, choices, disabled) => {
        const current = choices.some((entry) => entry[0] === card[field]) ? card[field] : choices[0][0]
        return DropSelect({
          label: label,
          field: field,
          hint: HELP[field],
          value: current,
          choices: choices,
          disabled: disabled === true,
          rect: selRect,
          open: openSel === field,
          onToggle: (event) => toggleSel(field, event),
          onPick: (value) => {
            setOpenSel(null)
            void setCardField(card, field, value)
          },
        })
      }

      const toggleTone = async (card) => {
        const next = card.tone === 'soft' ? 'explicit' : 'soft'
        setBusy('tone')
        try {
          const payload = await api('POST', '/tone', { id: card.id, tone: next })
          if (payload !== null && payload.ok !== false) {
            applySnapshot(payload)
            setNotice({
              kind: 'ok',
              text: next === 'soft' ? '\u5DF2\u5207\u5230\u542B\u84C4\u5C3A\u5EA6\uFF0C\u4E0B\u4E00\u53E5\u8D77\u751F\u6548' : '\u5DF2\u5207\u5230\u9732\u9AA8\u5C3A\u5EA6\uFF0C\u4E0B\u4E00\u53E5\u8D77\u751F\u6548',
            })
          }
        } catch (error) {
          setNotice({ kind: 'err', text: '\u5207\u6362\u5C3A\u5EA6\u5931\u8D25\uFF1A' + String(error && error.message ? error.message : error) })
        } finally {
          setBusy('')
        }
      }

      const toggleModel = async (card) => {
        const next = card.model === 'deepseek-flash' ? 'deepseek-v4-pro' : 'deepseek-flash'
        setBusy('model')
        try {
          const payload = await api('POST', '/model', { id: card.id, model: next })
          if (payload !== null && payload.ok !== false) {
            applySnapshot(payload)
            setNotice({
              kind: 'ok',
              text: next === 'deepseek-flash' ? '\u5DF2\u5207\u5230\u5FEB\u6A21\u578B\uFF08\u66F4\u5FEB\uFF0C\u5199\u5F97\u66F4\u6536\uFF09' : '\u5DF2\u5207\u5230\u5F3A\u6A21\u578B\uFF08\u66F4\u8D34\u8FD1\u89D2\u8272\uFF09',
            })
          }
        } catch (error) {
          setNotice({ kind: 'err', text: '\u5207\u6362\u6A21\u578B\u5931\u8D25\uFF1A' + String(error && error.message ? error.message : error) })
        } finally {
          setBusy('')
        }
      }

      const toggleAgeMode = async (card) => {
        const next = card.ageMode === 'original' ? 'adult' : 'original'
        setBusy('age')
        try {
          const payload = await api('POST', '/agemode', { id: card.id, ageMode: next })
          if (payload !== null && payload.ok !== false) {
            applySnapshot(payload)
            setNotice({
              kind: next === 'original' ? 'warn' : 'ok',
              text: next === 'original'
                ? '\u5DF2\u5207\u6210\u539F\u6587\u5E74\u9F84\uFF1A\u5361\u9762\u5199\u51E0\u5C81\u5C31\u51E0\u5C81\u3002\u6CE8\u610F\u2014\u2014\u5199\u6D89\u6027\u7684\u573A\u9762\u65F6\uFF0C\u6A21\u578B\u4F1A\u56E0\u4E3A\u8FD9\u4E2A\u5E74\u9F84\u76F4\u63A5\u62D2\u6F14\uFF0C\u90A3\u4E0D\u5199\u6027\u624D\u987A\u3002'
                : '\u5DF2\u5207\u6210\u6210\u5E74\u6A21\u5F0F\uFF1A\u5E74\u9F84\u7167\u539F\u6587\u8BBE\u5B9A\uFF0C\u4F46\u626E\u6F14\u91CC\u6309\u6210\u5E74\u4EBA\u8BF4\u3001\u6309\u6210\u5E74\u4EBA\u7684\u8EAB\u4F53\u5199\u3002',
            })
          }
        } catch (error) {
          setNotice({ kind: 'err', text: '\u5207\u6362\u5E74\u9F84\u6A21\u5F0F\u5931\u8D25\uFF1A' + String(error && error.message ? error.message : error) })
        } finally {
          setBusy('')
        }
      }

      const toggleStyle = async (card) => {
        const next = card.style === 'rp' ? 'novel' : 'rp'
        setBusy('style')
        try {
          const payload = await api('POST', '/style', { id: card.id, style: next })
          if (payload !== null && payload.ok !== false) {
            applySnapshot(payload)
            setNotice({
              kind: 'ok',
              text: next === 'rp' ? '\u5DF2\u5207\u5230\u5355\u4EBA\u89C6\u89D2\uFF08\u53EA\u6F14\u5979\uFF09' : '\u5DF2\u5207\u5230\u5C0F\u8BF4\u4F53\uFF08\u5408\u5199\uFF0C\u661F\u53F7\u52A8\u4F5C\uFF0B\u5F15\u53F7\u53F0\u8BCD\uFF09',
            })
          }
        } catch (error) {
          setNotice({ kind: 'err', text: '\u5207\u6362\u6587\u98CE\u5931\u8D25\uFF1A' + String(error && error.message ? error.message : error) })
        } finally {
          setBusy('')
        }
      }
      const togglePace = async (card) => {
        const next = card.pace === 'slow' ? 'direct' : 'slow'
        setBusy('pace')
        try {
          const payload = await api('POST', '/pace', { id: card.id, pace: next })
          if (payload !== null && payload.ok !== false) {
            applySnapshot(payload)
            setNotice({
              kind: 'ok',
              text: next === 'slow' ? '\u5DF2\u5207\u5230\u6162\u70ED\u8282\u594F\uFF08\u53EF\u4EE5\u6B32\u62D2\u8FD8\u8FCE\uFF09' : '\u5DF2\u5207\u5230\u76F4\u63A5\u8282\u594F\uFF08\u52A8\u4F5C\u5F53\u573A\u5B8C\u6210\uFF09',
            })
          }
        } catch (error) {
          setNotice({ kind: 'err', text: '\u5207\u6362\u8282\u594F\u5931\u8D25\uFF1A' + String(error && error.message ? error.message : error) })
        } finally {
          setBusy('')
        }
      }
      const enterRole = async (id) => {
        setBusy('enter')
        try {
          const payload = await api('POST', '/activate', { id })
          applySnapshot(payload)
          setChatId(id)
          setListMode(false)
          setListMode(false)
          setDraft(null)
          setNotice(null)
        } finally {
          setBusy('')
        }
      }

      const leaveRole = async () => {
        setBusy('leave')
        try {
          applySnapshot(await api('POST', '/deactivate', {}))
          setChatId(null)
          setChat({ live: false, busy: false, error: null, messages: [] })
        } finally {
          setBusy('')
        }
      }

      const remove = async (id) => {
        if (confirmDelete !== id) {
          setConfirmDelete(id)
          setTimeout(() => setConfirmDelete((current) => (current === id ? null : current)), 4000)
          return
        }
        setConfirmDelete(null)
        setBusy('delete')
        try {
          applySnapshot(await api('POST', '/delete', { id }))
          if (chatId === id) setChatId(null)
        } finally {
          setBusy('')
        }
      }

      const activeCard = snapshot.cards.find((card) => card.id === snapshot.activeId) || null
      const chatCard = listMode === true ? null : snapshot.cards.find((card) => card.id === targetId) || null

      // 「全部导入」的后台补更在插件进程里跑，界面靠轮询看进度：
      // 每 3 秒问一次 /novel，章节数会自己往上涨，跑完自动停。
      const jobCardId = chatCard === null ? null : chatCard.id
      const jobRunning = novelJob !== null && novelJob.running === true
      // 进对话先问一次：上次点「全部导入」的后台任务可能还在跑，界面得接着显示进度。
      React.useEffect(() => {
        if (jobCardId === null) {
          setNovelJob(null)
          return undefined
        }
        let alive = true
        void (async () => {
          try {
            const payload = await api('GET', '/novel?id=' + encodeURIComponent(jobCardId))
            if (!alive || payload === null || payload.ok === false) return
            setNovelJob(payload.job !== undefined && payload.job !== null ? payload.job : null)
          } catch {
            /* 拉不到就按「没有后台任务」处理 */
          }
        })()
        return () => {
          alive = false
        }
      }, [jobCardId])
      React.useEffect(() => {
        if (jobCardId === null || !jobRunning) return undefined
        let alive = true
        const tick = async () => {
          try {
            const payload = await api('GET', '/novel?id=' + encodeURIComponent(jobCardId))
            if (!alive || payload === null || payload.ok === false) return
            const nextJob = payload.job !== undefined && payload.job !== null ? payload.job : null
            setNovelJob(nextJob)
            await refresh()
            if (nextJob !== null && nextJob.running !== true) {
              setNotice(
                nextJob.error
                  ? { kind: 'err', text: '后台导入中断：' + String(nextJob.error) }
                  : {
                      kind: 'ok',
                      text: '后台导入完成：本地已有 ' + String(nextJob.imported) + '/' + String(nextJob.total) + ' 章',
                    },
              )
            }
          } catch {
            /* 轮询失败不打扰用户，下一轮再说 */
          }
        }
        const timer = setInterval(() => void tick(), 3000)
        void tick()
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [jobCardId, jobRunning])

      // 标题栏的三个动作：宽屏直接铺开，窄屏收进「⋯」；聊天界面在手机上整行隐藏
      // （.drc-root.chatmode .drc-head），回到列表/对话靠里面的工具条。
      const navThen = (action) => () => {
        setHeadOpen(false)
        action()
      }
      const headerActions = [
        h(
          'button',
          { key: 'back', className: 'drc-btn drc-nav', type: 'button', onClick: navThen(backToConversation) },
          '返回对话',
        ),
        activeCard !== null
          ? h(
              'button',
              { key: 'leave', className: 'drc-btn drc-nav', type: 'button', disabled: busy !== '', onClick: navThen(leaveRole) },
              '退出角色',
            )
          : null,
        h(
          'button',
          {
            key: 'new',
            className: 'drc-btn drc-nav',
            type: 'button',
            onClick: navThen(() => setDraft({ id: undefined, name: '', body: '' })),
          },
          '新建角色卡',
        ),
      ]

      const header = h(
        'div',
        { className: 'drc-head' + (headOpen ? ' open' : '') },
        h('h2', { className: 'drc-title' }, '角色卡'),
        chatCard !== null
          ? h('span', { className: 'drc-pill' }, String(chatCard.name))
          : h('span', { className: 'drc-hint' }, '角色只在这块面板里说话，不影响你其它会话'),
        h('div', { className: 'drc-spacer' }),
        h('div', { className: 'drc-headmenu' }, headerActions),
        h(
          'button',
          { className: 'drc-btn drc-headtoggle', type: 'button', onClick: () => setHeadOpen(!headOpen) },
          headOpen ? '×' : '⋯',
        ),
      )

      const BUSY_LABEL = {
        import: '\u6B63\u5728\u6293\u94FE\u63A5',
        expand: 'AI \u6B63\u5728\u6269\u5199\uFF08\u8981\u7B49\u6A21\u578B\uFF0C\u6700\u957F 5 \u5206\u949F\uFF09',
        novel: '\u6B63\u5728\u6293\u5C0F\u8BF4\u7AE0\u8282',
        save: '\u6B63\u5728\u4FDD\u5B58',
        chat: '\u6B63\u5728\u751F\u6210',
        open: '\u6B63\u5728\u5F00\u573A',
      }
      const busyNode =
        busy === ''
          ? null
          : h(
              'div',
              { className: 'drc-notice' },
              (BUSY_LABEL[busy] === undefined ? '\u6B63\u5728\u5904\u7406' : BUSY_LABEL[busy]) +
                '\u2026 ' +
                String(busySeconds) +
                's\u3002\u5982\u679C\u4E00\u76F4\u4E0D\u52A8\uFF0C\u5237\u65B0\u9875\u9762\u91CD\u8BD5\uFF08\u4E3B\u673A\u91CD\u542F\u540E\u65E7\u9875\u9762\u4F1A\u65AD\uFF09\u3002',
            )
      const noticeNode =
        notice === null
          ? busyNode
          : h('div', { className: 'drc-notice' + (notice.kind === 'err' ? ' err' : '') }, String(notice.text))

      if (draft !== null) {
        const editor = h(
          'div',
          { className: 'drc-editor' },
          h('input', {
            id: 'drc-name',
            placeholder: '\u89D2\u8272\u540D\uFF08\u7559\u7A7A\u4F1A\u81EA\u52A8\u4ECE\u6B63\u6587\u91CC\u53D6\uFF09',
            value: typeof draft.name === 'string' ? draft.name : '',
            onChange: (event) => setDraft({ ...draft, name: event.target.value }),
          }),
          h('textarea', {
            id: 'drc-body',
            placeholder: '\u628A\u6574\u5F20\u89D2\u8272\u5361\u7C98\u8FDB\u6765\uFF1A\u8BBE\u5B9A\u3001\u6027\u683C\u3001\u573A\u666F\u3001\u5F00\u573A\u767D\u3001\u5BF9\u8BDD\u793A\u4F8B\u90FD\u53EF\u4EE5\u3002',
            value: typeof draft.body === 'string' ? draft.body : '',
            onChange: (event) => {
              const body = event.target.value
              const currentName = typeof draft.name === 'string' ? draft.name : ''
              setDraft({ ...draft, body, name: currentName.trim().length > 0 ? currentName : guessName(body) })
            },
          }),
          h(
            'div',
            { className: 'drc-hint' },
            '\u6B63\u6587\u4F1A\u4F5C\u4E3A\u8FD9\u4E2A\u89D2\u8272\u7684\u7CFB\u7EDF\u63D0\u793A\u9644\u4EF6\uFF0C\u53EA\u5728\u8FD9\u5F20\u5361\u81EA\u5DF1\u7684\u5BF9\u8BDD\u91CC\u751F\u6548\u3002',
          ),
          h(
            'div',
            { style: { display: 'flex', gap: '8px' } },
            h('input', {
              id: 'drc-expand-req-edit',
              placeholder: '\u518D\u6269\u5199\u7684\u8981\u6C42\uFF08\u53EF\u9009\uFF09',
              value: expandReq,
              onChange: (event) => setExpandReq(event.target.value),
            }),
            h('button', { className: 'drc-btn', type: 'button', title: '\u518D\u6269\u5199\uFF1A\u7528\u7F16\u8F91\u6846\u91CC\u7684\u6B63\u6587\u5F53\u7D20\u6750\uFF0C\u91CD\u65B0\u6269\u4E00\u7248', disabled: busy !== '', onClick: expandDraft }, busy === 'expand' ? '\u6269\u5199\u4E2D\u2026' : 'AI \u6269\u5199'),
            h('button', { className: 'drc-btn primary', type: 'button', title: '\u4FDD\u5B58\uFF1A\u5199\u5165\u5361\u5E93\uFF08\u6A21\u5F0F/\u5C3A\u5EA6/\u6587\u98CE\u6309\u5BFC\u5165\u533A\u9009\u7684\u90A3\u4E09\u6863\uFF09', disabled: busy !== '', onClick: saveDraft }, busy === 'save' ? '\u4FDD\u5B58\u4E2D\u2026' : '\u4FDD\u5B58'),
            h('button', { className: 'drc-btn', type: 'button', onClick: () => setDraft(null) }, '\u53D6\u6D88'),
          ),
        )
        return h('div', { className: 'drc-root' }, header, h('div', { className: 'drc-body' }, noticeNode, editor))
      }


      /* \u624B\u673A\u8BBF\u95EE\u9762\u677F\uFF1A\u72B6\u6001\u5728 Host \u91CC\uFF0C\u8FD9\u91CC\u53EA\u8D1F\u8D23\u5F00\u5173\u3001\u4E8C\u7EF4\u7801\u548C\u94FE\u63A5\u3002 */
      const lanRunning = lan !== null && lan.running === true
      const lanAddresses = lan !== null && Array.isArray(lan.urls) ? lan.urls : []
      const lanBlock = h(
        'div',
        { className: 'drc-lan' },
        h(
          'div',
          { className: 'drc-lanhead' },
          h('div', { className: 'drc-lantitle' }, '\u624B\u673A\u8BBF\u95EE'),
          h('div', { className: 'drc-lanstate' + (lanRunning ? ' on' : '') }, lan === null ? '\u68C0\u67E5\u4E2D\u2026' : lanRunning ? '\u5DF2\u5F00\u542F' : '\u672A\u5F00\u542F'),
          h('div', { className: 'drc-spacer' }),
          lanRunning
            ? h('button', { className: 'drc-btn', type: 'button', title: '\u5173\u95ED\uFF1A\u5173\u6389\u624B\u673A\u8BBF\u95EE\u7AEF\u53E3\uFF08\u5DF2\u7ECF\u6253\u5F00\u7684\u624B\u673A\u9875\u9762\u4E0B\u6B21\u5237\u65B0\u4F1A\u5931\u6548\uFF09', disabled: lanBusy !== '', onClick: () => void lanAction('stop', '/lan/stop') }, lanBusy === 'stop' ? '\u5173\u95ED\u4E2D\u2026' : '\u5173\u95ED')
            : h('button', { className: 'drc-btn primary', type: 'button', title: '\u5F00\u542F\uFF1A\u5728\u5C40\u57DF\u7F51\u4E0A\u5F00\u4E00\u4E2A\u5E26\u53E3\u4EE4\u7684\u5165\u53E3\uFF0C\u624B\u673A\u540C WiFi \u5C31\u80FD\u8BBF\u95EE\u8FD9\u4E2A\u5DE5\u4F5C\u533A', disabled: lanBusy !== '', onClick: () => void lanAction('start', '/lan/start') }, lanBusy === 'start' ? '\u5F00\u542F\u4E2D\u2026' : '\u5F00\u542F'),
        ),
        lanRunning
          ? h(
              'div',
              { className: 'drc-lanbody' },
              lan && typeof lan.qr === 'string' && lan.qr.length > 0
                ? h('div', { className: 'drc-qr', dangerouslySetInnerHTML: { __html: String(lan.qr) } })
                : null,
              h(
                'div',
                { className: 'drc-lancol' },
                h('input', {
                  className: 'drc-lanurl',
                  readOnly: true,
                  value: lanLink,
                  onFocus: (event) => event.target.select(),
                }),
                h(
                  'div',
                  { className: 'drc-lanrow' },
                  h('button', { className: 'drc-btn primary', type: 'button', title: '\u590D\u5236\u94FE\u63A5\uFF1A\u628A\u53E3\u4EE4\u94FE\u63A5\u590D\u5236\u51FA\u6765\uFF0C\u53D1\u5230\u624B\u673A\u4E0A\u6253\u5F00\u5C31\u80FD\u63A5\u7740\u804A', onClick: copyLanLink }, '\u590D\u5236\u94FE\u63A5'),
                  h('button', { className: 'drc-btn', type: 'button', title: '\u6362\u53E3\u4EE4\uFF1A\u91CD\u65B0\u751F\u6210\u53E3\u4EE4\uFF0C\u4E4B\u524D\u53D1\u51FA\u53BB\u7684\u94FE\u63A5\u5168\u90E8\u5931\u6548', disabled: lanBusy !== '', onClick: () => void lanAction('rotate', '/lan/rotate') }, lanBusy === 'rotate' ? '\u66F4\u6362\u4E2D\u2026' : '\u6362\u53E3\u4EE4'),
                ),
                h('div', { className: 'drc-hint' }, '\u624B\u673A\u626B\u4E8C\u7EF4\u7801\uFF0C\u6216\u628A\u94FE\u63A5\u53D1\u5230\u624B\u673A\u6D4F\u89C8\u5668\u6253\u5F00\uFF1B\u540C\u4E00 WiFi \u5C31\u884C\uFF0C\u7B2C\u4E00\u6B21\u6253\u5F00\u5C31\u8BB0\u4F4F\u53E3\u4EE4\u3002'),
                lan && typeof lan.authNote === 'string' && lan.authNote.length > 0
                  ? h('div', { className: 'drc-hint', style: { color: '#f28b82' } }, '\u26A0\uFE0F \u624B\u673A\u53EF\u80FD\u8FDB\u4E0D\u53BB\u754C\u9762\uFF1A' + String(lan.authNote))
                  : null,
                lanAddresses.length > 1
                  ? h(
                      'div',
                      { className: 'drc-hint' },
                      '\u5176\u5B83\u7F51\u5361\uFF1A' + lanAddresses.slice(1).map((entry) => String(entry.ip) + ':' + String(lan.port)).join('\u3001'),
                    )
                  : null,
                h('div', { className: 'drc-hint' }, '\u7AEF\u53E3 ' + String(lan === null ? '' : lan.port) + ' \u00B7 \u6362\u53E3\u4EE4\u540E\u6240\u6709\u624B\u673A\u90FD\u8981\u91CD\u65B0\u6253\u5F00\u4E00\u6B21\u94FE\u63A5'),
              ),
            )
          : h('div', { className: 'drc-hint' }, '\u5F00\u542F\u540E\u8FD9\u53F0\u7535\u8111\u7684 DSH \u4F1A\u5728\u5C40\u57DF\u7F51\u4E0A\u591A\u542C\u4E00\u4E2A\u7AEF\u53E3\uFF0C\u624B\u673A\u7528\u5E26\u53E3\u4EE4\u7684\u94FE\u63A5\u5C31\u80FD\u6253\u5F00\u540C\u4E00\u4E2A\u5DE5\u4F5C\u533A\u63A5\u7740\u804A\uFF1B\u4E0D\u5E26\u53E3\u4EE4\u7684\u8BF7\u6C42\u53EA\u4F1A\u770B\u5230\u4E00\u9875\u53E3\u4EE4\u8F93\u5165\u6846\u3002'),
      )

      const listView = h(
        'div',
        { className: 'drc-body' },
        noticeNode,
        h(
          'div',
          { className: 'drc-import' },
          h('input', {
            id: 'drc-link',
            placeholder: '\u7C98\u94FE\u63A5\u5BFC\u5165\u89D2\u8272\u5361\uFF08\u89D2\u8272\u5361\u7AD9\u70B9\u9875\u9762\u6216 PNG \u76F4\u94FE\u90FD\u884C\uFF09',
            value: link,
            onChange: (event) => setLink(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') void importFromLink()
            },
          }),
          h('input', {
            id: 'drc-expand-req',
            placeholder: '\u6269\u5199\u8981\u6C42\uFF08\u53EF\u9009\uFF09\uFF1A\u60F3\u8BA9\u5979\u662F\u4EC0\u4E48\u8EAB\u4EFD\u3001\u53E3\u543B\u3001\u5173\u7CFB\u3001\u5267\u60C5\u8D70\u5411',
            value: expandReq,
            onChange: (event) => setExpandReq(event.target.value),
          }),
          DropSelect({
            label: '\u6A21\u5F0F',
            value: importMode,
            choices: MODE_CHOICES,
            disabled: false,
            rect: selRect,
            open: openSel === 'import-mode',
            field: 'mode',
            hint: '\u5EFA\u5361\u7528\u54EA\u79CD\u6A21\u5F0F\uFF1A\u6210\u4EBA=\u5141\u8BB8\u6309\u5C3A\u5EA6\u5199\u6027\u63CF\u5199\uFF1B\u666E\u901A=\u5B8C\u5168\u4E0D\u5199\u6027\u5185\u5BB9\uFF08\u5BFC\u5165\u666E\u901A\u5C0F\u8BF4\u3001\u666E\u901A\u89D2\u8272\u5C31\u9009\u5B83\uFF09',
            onToggle: (event) => toggleSel('import-mode', event),
            onPick: (next) => {
              setOpenSel(null)
              setImportMode(next)
            },
          }),
          DropSelect({
            label: '\u5C3A\u5EA6',
            value: importTone,
            choices: TONE_CHOICES,
            disabled: importMode === 'normal',
            rect: selRect,
            open: openSel === 'import-tone',
            field: 'tone',
            hint: '\u5EFA\u5361\u65F6\u9ED8\u8BA4\u7684\u5C3A\u5EA6\u6863\uFF1A\u65E0/\u6697\u793A/\u542B\u60C5/\u9732\u9AA8/\u6781\u81F4\uFF08\u666E\u901A\u6A21\u5F0F\u4E0B\u9501\u5B9A\uFF09',
            onToggle: (event) => toggleSel('import-tone', event),
            onPick: (next) => {
              setOpenSel(null)
              setImportTone(next)
            },
          }),
          DropSelect({
            label: '文风',
            value: importStyle,
            choices: STYLE_CHOICES,
            disabled: false,
            rect: selRect,
            open: openSel === 'import-style',
            field: 'style',
            hint: '建卡时默认的文风：角色扮演/小说体/聊天体/剧本体/日记体',
            onToggle: (event) => toggleSel('import-style', event),
            onPick: (next) => {
              setOpenSel(null)
              setImportStyle(next)
            },
          }),
          DropSelect({
            label: '小说范围',
            value: novelScope,
            choices: SCOPE_CHOICES,
            disabled: false,
            rect: selRect,
            open: openSel === 'import-scope',
            field: 'novelScope',
            hint: '「小说导入」抓多少章：快速=只抓前 40 章，几秒出卡，后面在对话界面按 40 章一批续；全部=整本抓完（上千章的书要等两三分钟）',
            onToggle: (event) => toggleSel('import-scope', event),
            onPick: (next) => {
              setOpenSel(null)
              setNovelScope(next)
            },
          }),
          h('button', { className: 'drc-btn primary', type: 'button', title: '\u5BFC\u5165\uFF1A\u53EA\u8BA4\u7ED3\u6784\u5316\u89D2\u8272\u5361\uFF08V2 JSON / PNG \u5361 / \u5E26 og \u4FE1\u606F\u7684\u9875\u9762\uFF09', disabled: busy !== '', onClick: importFromLink }, busy === 'import' ? '\u5BFC\u5165\u4E2D\u2026' : '\u5BFC\u5165'),
          h('button', { className: 'drc-btn primary', type: 'button', title: 'AI \u6269\u5199\uFF1A\u4EFB\u4F55\u94FE\u63A5\u90FD\u884C\uFF0C\u6293\u9875\u9762\u7D20\u6750 \u2192 \u6269\u6210\u4E00\u5F20\u80FD\u6F14\u7684\u5B8C\u6574\u5361\uFF08\u5148\u7ED9\u8349\u7A3F\uFF0C\u786E\u8BA4\u540E\u518D\u4FDD\u5B58\uFF09', disabled: busy !== '', onClick: expandFromLink }, busy === 'expand' ? '\u6269\u5199\u4E2D\u2026' : 'AI \u6269\u5199'),
          h('button', { className: 'drc-btn primary', type: 'button', title: '\u5C0F\u8BF4\u5BFC\u5165\uFF1A\u6293\u5C0F\u8BF4\u539F\u6587\uFF0C\u6309\u7AE0\u8282\u987A\u5E8F\u63A8\u8FDB\u5267\u60C5\uFF08\u539F\u6587\u7167\u6284\uFF0C\u4E0D\u6539\u5199\uFF09', disabled: busy !== '', onClick: importNovel }, busy === 'novel' ? '\u6293\u539F\u6587\u4E2D\u2026' : '\u5C0F\u8BF4\u5BFC\u5165'),
        ),
        lanBlock,
        h('div', { className: 'drc-hint' }, '\u5DF2\u4FDD\u5B58\u7684\u89D2\u8272\u5361\uFF08' + snapshot.cards.length + '\uFF09\u2014\u2014\u70B9\u300C\u5F00\u573A\u300D\u8BA9\u89D2\u8272\u5148\u8BF4\u8BDD\uFF0C\u70B9\u300C\u8FDB\u5165\u89D2\u8272\u300D\u63A5\u7740\u804A\uFF0C\u70B9\u540D\u65C1\u7684\u300C\u7F16\u8F91\u300D\u6539\u8BBE\u5B9A'),
        h('div', { className: 'drc-hint' }, '\u300C\u5BFC\u5165\u300D\u53EA\u8BA4\u7ED3\u6784\u5316\u89D2\u8272\u5361\uFF08V2/PNG/\u5E26 og \u7684\u9875\u9762\uFF09\uFF1B\u300CAI \u6269\u5199\u300D\u968F\u4FBF\u4EC0\u4E48\u94FE\u63A5\u90FD\u884C\u2014\u2014\u89D2\u8272\u7AD9\u7684\u4EBA\u7269\u7B80\u4ECB\u3001\u5C0F\u8BF4\u7AE0\u8282\uFF0C\u6293\u4E0B\u6765\u4EA4\u7ED9\u6A21\u578B\u6269\u6210\u4E00\u5F20\u80FD\u6F14\u7684\u5361\uFF0C\u6269\u5B8C\u7ED9\u4F60\u6539\u3002'),
        snapshot.cards.length === 0
          ? h('div', { className: 'drc-empty' }, '\u8FD8\u6CA1\u6709\u89D2\u8272\u5361\u3002\u7C98\u4E00\u4E2A\u94FE\u63A5\uFF0C\u6216\u8005\u70B9\u300C\u65B0\u5EFA\u89D2\u8272\u5361\u300D\u624B\u52A8\u7C98\u4E00\u5F20\u3002')
          : snapshot.cards.map((card) =>
              h(
                'div',
                { className: 'drc-card' + (card.id === snapshot.activeId ? ' on' : ''), key: card.id },
                h(
                  'div',
                  { className: 'drc-cardmain' },
                  h('div', { className: 'drc-cardname' }, String(card.name)),
                  h(
                    'div',
                    { className: 'drc-cardmeta' },
                    String(card.chars) + ' \u5B57 \u00B7 ' + (card.hasChat === true ? '\u6709\u5BF9\u8BDD\u8BB0\u5F55' : '\u65B0\u5BF9\u8BDD') + (card.novel ? ' \u00B7 \u539F\u8457 ' + card.novel.current + '/' + card.novel.total + ' \u7AE0' + (card.novel.hasMore === true ? '\uFF08\u5168\u4E66 ' + card.novel.bookTotal + '\uFF09' : '') : ''),
                  ),
                ),
                h('button', { className: 'drc-btn', type: 'button', title: '\u5F00\u573A\uFF1A\u8BA9\u89D2\u8272\u5148\u5F00\u53E3\uFF0C\u4ECE\u8FD9\u4E00\u5E55\u6700\u5F00\u59CB\u6F14\u8D77\uFF08\u5DF2\u6709\u5BF9\u8BDD\u7684\u5361\u4E0D\u80FD\u7528\uFF09', disabled: busy !== '', onClick: () => void openRole(card.id) }, busy === 'open' ? '\u5F00\u573A\u4E2D\u2026' : '\u5F00\u573A'),
                h('button', { className: 'drc-btn primary', type: 'button', title: '\u8FDB\u5165\u89D2\u8272\uFF1A\u6253\u5F00\u8FD9\u5F20\u5361\u7684\u5BF9\u8BDD\uFF1B\u7EE7\u7EED\u4E0A\u6B21\u7684\u5BF9\u8BDD\u5C31\u70B9\u5B83', disabled: busy !== '', onClick: () => enterRole(card.id) }, card.id === snapshot.activeId ? '\u7EE7\u7EED\u5BF9\u8BDD' : '\u8FDB\u5165\u89D2\u8272'),
                h('button', { className: 'drc-btn', type: 'button', title: '\u7F16\u8F91\uFF1A\u6539\u8FD9\u5F20\u5361\u7684\u8BBE\u5B9A\u6B63\u6587', onClick: () => void openEditor(card.id), }, '\u7F16\u8F91'),
                h('button', { className: 'drc-btn danger', type: 'button', title: '\u5220\u9664\uFF1A\u5220\u6389\u8FD9\u5F20\u5361\u548C\u5B83\u7684\u804A\u5929\u8BB0\u5F55\uFF08\u4F1A\u5148\u95EE\u4E00\u6B21\uFF09', disabled: busy !== '', onClick: () => remove(card.id) }, confirmDelete === card.id ? '\u518D\u70B9\u4E00\u6B21\u5220\u9664' : '\u5220\u9664'),
              ),
            ),
        h(
          'div',
          { style: { display: 'flex', gap: '8px' } },
          h('button', { className: 'drc-btn', type: 'button', title: '\u5237\u65B0\uFF1A\u91CD\u65B0\u8BFB\u53D6\u5361\u5E93', onClick: refresh }, '\u5237\u65B0'),
          chatCard !== null ? h('button', { className: 'drc-btn', type: 'button', onClick: () => setChatId(chatCard.id) }, '\u56DE\u5230\u5BF9\u8BDD') : null,
        ),
      )

      if (chatCard === null) return h('div', { className: 'drc-root', style: rootStyle }, header, listView)

      const chatView = h(
        'div',
        { className: 'drc-body' },
        noticeNode,
        h(
          'div',
          { className: 'drc-tools' },
          h('button', { className: 'drc-btn', type: 'button', title: '\u7F16\u8F91\u89D2\u8272\uFF1A\u6539\u8FD9\u5F20\u5361\u7684\u8BBE\u5B9A\u6B63\u6587\uFF08\u4EBA\u7269\u3001\u5173\u7CFB\u3001\u573A\u666F\uFF09\uFF0C\u6539\u5B8C\u7ACB\u5373\u751F\u6548', onClick: () => void openEditor(chatCard.id) }, '\u7F16\u8F91\u89D2\u8272'),
          selector('\u6A21\u5F0F', 'mode', chatCard, MODE_CHOICES, busy !== ''),
          selector('\u5C3A\u5EA6', 'tone', chatCard, TONE_CHOICES, busy !== '' || chatCard.mode === 'normal'),
          h(
            'button',
            {
              className: 'drc-btn',
              type: 'button',
              disabled: busy !== '',
              onClick: () => void toggleModel(chatCard),
            },
            chatCard.model === 'deepseek-flash' ? '\u6A21\u578B\uFF1A\u5FEB' : '\u6A21\u578B\uFF1A\u5F3A',
          ),
          selector('\u8282\u594F', 'pace', chatCard, PACE_CHOICES, busy !== ''),
          selector('\u6587\u98CE', 'style', chatCard, STYLE_CHOICES, busy !== ''),
          h('button', { className: 'drc-btn', type: 'button', title: '\u6A21\u578B\uFF1A\u5F3A=\u66F4\u7EC6\u81F4\u4F46\u6162\uFF0C\u5FEB=\u66F4\u5FEB\u4F46\u66F4\u7B80\uFF1B\u53EA\u5F71\u54CD\u8FD9\u5F20\u5361\u7684\u751F\u6210', title: '\u5B57\u53F7\uFF1A\u5207\u6362\u804A\u5929\u6B63\u6587\u5B57\u53F7\uFF08\u81EA\u52A8 / \u5C0F / \u4E2D / \u5927\uFF09\u3002\u624B\u673A\u7AEF\u9ED8\u8BA4\u504F\u5C0F\uFF0C\u5C4F\u5E55\u80FD\u591A\u663E\u793A\u51E0\u884C', onClick: cycleFont }, '\u5B57\u53F7\uFF1A' + fontChoice.label),
          chatCard.novel
            ? h('button', { className: 'drc-btn', type: 'button', title: '\u4E0B\u4E00\u7AE0\uFF1A\u628A\u5267\u60C5\u4E3B\u7EBF\u63A8\u8FDB\u5230\u539F\u8457\u7684\u4E0B\u4E00\u7AE0\uFF08\u4F1A\u91CD\u65B0\u6CE8\u5165\u8BE5\u7AE0\u539F\u6587\uFF0C\u65E7\u7AE0\u4E0D\u518D\u5141\u8BB8\u63D0\u524D\u4F7F\u7528\uFF09', disabled: busy !== '' || chatCard.novel.current >= chatCard.novel.total, onClick: () => void nextChapter() }, '\u4E0B\u4E00\u7AE0（' + chatCard.novel.current + '/' + chatCard.novel.total + '）')
            : null,
          chatCard.novel && chatCard.novel.hasMore === true && jobRunning
            ? h(
                'button',
                {
                  className: 'drc-btn primary',
                  type: 'button',
                  title: '后台正在把全书抓进来，进度自己会涨，不用守着',
                  disabled: true,
                },
                '后台导入中 ' + String(novelJob.imported) + '/' + String(novelJob.total),
              )
            : chatCard.novel && chatCard.novel.hasMore === true
              ? h(
                  'button',
                  {
                    className: 'drc-btn primary',
                    type: 'button',
                    title: '继续导入：从第 ' + (chatCard.novel.total + 1) + ' 章接着往后抓 40 章，已经抓过的章不重抓',
                    disabled: busy !== '',
                    onClick: () => void extendNovel(),
                  },
                  busy === 'novel'
                    ? '续导中…'
                    : '继续导入 40 章（' + chatCard.novel.total + '/' + chatCard.novel.bookTotal + '）',
                )
              : null,
          chatCard.novel && chatCard.novel.hasMore !== true && chatCard.novel.source
            ? h(
                'button',
                {
                  className: 'drc-btn',
                  type: 'button',
                  title: '检查更新：问一下站点这本追到第几章了。有更新就提示你，再点「继续导入」补上新章',
                  disabled: busy !== '',
                  onClick: () => void checkNovelUpdate(),
                },
                busy === 'novel' ? '检查中…' : '检查更新（' + chatCard.novel.total + ' 章）',
              )
            : null,
          h('button', { className: 'drc-btn', type: 'button', title: '\u5E74\u9F84\uFF1A\u6210\u5E74=\u89D2\u8272\u4E00\u5F8B\u6309\u6210\u5E74\u4EBA\u6F14\uFF1B\u539F\u6587=\u7167\u539F\u8457\u5E74\u9F84\u5199\uFF08\u4E00\u65E6\u6D89\u53CA\u6027\u573A\u9762\uFF0C\u6A21\u578B\u4F1A\u76F4\u63A5\u62D2\u6F14\uFF09', disabled: busy !== '', onClick: () => void toggleAgeMode(chatCard) }, '\u5E74\u9F84\uFF1A' + (chatCard.ageMode === 'original' ? '\u539F\u6587' : '\u6210\u5E74')),
          h('button', { className: 'drc-btn', type: 'button', title: '\u89D2\u8272\u5217\u8868\uFF1A\u56DE\u5230\u6240\u6709\u89D2\u8272\u5361\uFF0C\u804A\u5929\u8BB0\u5F55\u4E0D\u4F1A\u4E22', onClick: () => { setListMode(true); setChatId(null) } }, '\u89D2\u8272\u5217\u8868'),
          h('button', { className: 'drc-btn', type: 'button', title: '\u6E05\u7A7A\u5BF9\u8BDD\uFF1A\u5220\u6389\u8FD9\u5F20\u5361\u7684\u804A\u5929\u8BB0\u5F55\uFF0C\u89D2\u8272\u8BBE\u5B9A\u4FDD\u7559', disabled: busy !== '' || chat.messages.length === 0, onClick: resetChat }, '\u6E05\u7A7A\u5BF9\u8BDD'),
        ),
        chatCard.mode === 'normal'
          ? h('div', { className: 'drc-hint' }, '\u666E\u901A\u6A21\u5F0F\uFF1A\u8FD9\u4E00\u6863\u4E0D\u5199\u6027\u63CF\u5199\uFF08\u5C3A\u5EA6\u4E0B\u62C9\u5DF2\u9501\uFF09\u3002\u8981\u5199\u5C31\u628A\u300C\u6A21\u5F0F\u300D\u5207\u5230\u6210\u4EBA\u3002')
          : null,
        h(
          'div',
          { className: 'drc-chat' },
          h(
            'div',
            { className: 'drc-log', ref: logRef, onScroll: onLogScroll },
            chat.messages.length === 0
              ? h(
                  'div',
                  { className: 'drc-empty' },
                  '\u8FD8\u6CA1\u6709\u5BF9\u8BDD\u3002\u70B9\u4E0B\u9762\u7684\u6309\u94AE\uFF0C\u8BA9\u89D2\u8272\u5148\u5F00\u53E3\u3002',
                  h(
                    'div',
                    { className: 'drc-open' },
                    h('button', { className: 'drc-btn primary', type: 'button', title: '\u5F00\u573A\uFF1A\u8BA9\u89D2\u8272\u5148\u5F00\u53E3\uFF0C\u4ECE\u8FD9\u4E00\u5E55\u6700\u5F00\u59CB\u6F14\u8D77', disabled: busy !== '', onClick: () => void openRole(chatCard.id) }, busy === 'open' ? '\u5F00\u573A\u4E2D\u2026' : '\u8BA9\u89D2\u8272\u5F00\u573A'),
                  ),
                )
              : chat.messages.map((message, index) =>
                  h(
                    'div',
                    { className: 'drc-row' + (message.role === 'user' ? ' user' : ''), key: index },
                    h(
                      'div',
                      { className: 'drc-avatar' + (message.role === 'user' ? ' user' : '') },
                      message.role === 'user' ? '\u6211' : avatarLetter(chatCard.name),
                    ),
                    h('div', { className: 'drc-bubble' }, String(message.text)),
                  ),
                ),
            chat.busy === true ? h('div', { className: 'drc-hint' }, '\u6B63\u5728\u56DE\u5E94\u2026') : null,
            chat.error !== null ? h('div', { className: 'drc-notice err' }, String(chat.error)) : null,
          ),
          h(
            'div',
            { className: 'drc-composer' },
            h('textarea', {
              id: 'drc-input',
              placeholder: '\u8BF4\u70B9\u4EC0\u4E48\u2026\uFF08Enter \u53D1\u9001\uFF0CShift+Enter \u6362\u884C\uFF09',
              value: input,
              onChange: (event) => setInput(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter' && event.shiftKey !== true) {
                  event.preventDefault()
                  void send()
                }
              },
            }),
            h('button', { className: 'drc-btn primary', type: 'button', disabled: busy !== '' || input.trim().length === 0, onClick: send }, busy === 'send' ? '\u2026' : '\u53D1\u9001'),
          ),
        ),
      )

      return h('div', { className: 'drc-root chatmode', style: rootStyle }, header, chatView)
    }

    // The panel component needs `ctx.get('layout')`; the loader context is not
    // reachable from a component, so it travels through a React context.
    const PanelCtx = React.createContext(null)
    const homeListeners = new Set()
    let homeWanted = false
    const wantHome = () => {
      homeWanted = true
      for (const listener of homeListeners) {
        try { listener() } catch (error) { void error }
      }
    }
    let homeApplied = false

    const PanelHost = () => {
      const ctx = React.useContext(PanelCtx)
      // 面板里任何一处抛错，React 会把整棵子树摘掉 —— 主区就变成一片白，
      // 用户看不出发生了什么。这里兜住，直接把错误显示出来，方便一眼定位。
      try {
        return h(RoleCardPanel, { key: 'role-card-panel', ctx })
      } catch (error) {
        const detail = error && error.message ? error.message : String(error)
        try {
          if (typeof console !== 'undefined' && console.error) console.error('[dsh-role-card] panel crashed:', error)
        } catch (inner) {
          void inner
        }
        return h(
          'div',
          { className: 'drc-root' },
          h('div', { className: 'drc-head' }, h('div', { className: 'drc-title' }, '\u89D2\u8272\u5361')),
          h(
            'div',
            { className: 'drc-body' },
            h('div', { className: 'drc-notice err' }, '\u9762\u677F\u6E32\u67D3\u51FA\u9519\u4E86\uFF1A' + detail),
            h(
              'div',
              { className: 'drc-hint' },
              '\u5237\u65B0\u4E00\u4E0B\u9875\u9762\u8BD5\u8BD5\uFF1B\u5982\u679C\u4E00\u76F4\u8FD9\u6837\uFF0C\u628A\u8FD9\u884C\u6587\u5B57\u53D1\u7ED9\u6211\u3002',
            ),
          ),
        )
      }
    }

    const apply = (ctx) => {
      installStyles()
      const selectSelf = () => {
        wantHome()
        const select = () => {
          try {
            const layout = ctx.get('layout')
            if (layout === null || layout === undefined || typeof layout.selectPanel !== 'function') return false
            layout.selectPanel(PANEL_ID)
            return true
          } catch (error) {
            void error
            return false
          }
        }
        if (select() === true) return
        if (typeof setTimeout === 'function') setTimeout(select, 160)
      }
      const RailButton = (props) =>
        h(
          'span',
          {
            className: 'drc-rail',
            role: 'button',
            tabIndex: 0,
            onClick: selectSelf,
            onKeyDown: (event) => {
              if (event.key === 'Enter' || event.key === ' ') selectSelf()
            },
            style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
          },
          h(RailIcon, props),
        )
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 20,
            label: () => '\u89D2\u8272\u5361',
          },
          RailButton,
        ),
      )
      ctx.slots.inject('main', () =>
        ctx.slots.register(
          {
            name: 'main',
            key: PANEL_ID,
          },
          () => h(PanelCtx.Provider, { value: ctx }, h(PanelHost)),
        ),
      )
      // 启动信标：宿主半否则分不清「浏览器半从没跑过」和「跑了、面板只是没显示」。
      // GET /diag 会读最近一次上报，所以设备上看不到侧栏时也能从服务端定位。
      try {
        void api('POST', '/hello', {
          source: 'client-ready',
          version: VERSION,
          href: String(window.location && window.location.href ? window.location.href : ''),
          ua: String(navigator.userAgent === undefined ? '' : navigator.userAgent),
        }).catch(() => {})
      } catch (error) {
        report('client-ready', error)
      }
    }

    return { inject: ['slots'], apply, version: VERSION }
  },
})
