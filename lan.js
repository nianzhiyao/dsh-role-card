/**
 * dsh-role-card — LAN bridge (host half).
 *
 * Why this exists: DSH's web server binds 127.0.0.1 only, so a phone in the same
 * Wi-Fi cannot open the workspace and keep chatting. This module is a small,
 * dependency-free reverse proxy that listens on 0.0.0.0:<port> and forwards to
 * 127.0.0.1:<webPort> — HTTP *and* WebSocket upgrades, because the web client
 * streams over WS.
 *
 * Security model (the reason this is not just `netsh portproxy`):
 *   The DSH web app has no login. A raw port-forward on 0.0.0.0 would give every
 *   device on the Wi-Fi an unauthenticated shell. So the bridge refuses every
 *   request without a cookie that matches a per-boot secret, and the phone gets
 *   in through one link:
 *       http://<lan-ip>:<port>/__lan/unlock?t=<token>&next=/
 *   which sets `dsh_lan=<token>` and redirects to the app. Requests without the
 *   cookie get a one-field gate page instead of the app. Rotating the token
 *   kicks every phone off without touching the desktop browser session.
 *
 * Nothing here writes to disk, and the socket only exists while the user has
 * switched the bridge on from the role-card panel.
 */
import { createServer, request as httpRequest } from 'node:http'
import { connect } from 'node:net'
import { networkInterfaces } from 'node:os'
import { randomBytes, timingSafeEqual } from 'node:crypto'

const COOKIE = 'dsh_lan'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30
const UNLOCK_PATH = '/__lan/unlock'
const PING_PATH = '/__lan/ping'

/** 24 chars of base64url — long enough that guessing over Wi-Fi is not a plan. */
const newToken = () => randomBytes(18).toString('base64url')

function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ''), 'utf8')
  const right = Buffer.from(String(b ?? ''), 'utf8')
  if (left.length !== right.length || left.length === 0) return false
  try {
    return timingSafeEqual(left, right)
  } catch {
    return false
  }
}

function parseCookies(header) {
  const out = Object.create(null)
  if (typeof header !== 'string') return out
  for (const part of header.split(';')) {
    const at = part.indexOf('=')
    if (at < 0) continue
    out[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1).trim())
  }
  return out
}

/** Private-range IPv4 addresses, best candidate first (192.168 before 10./172.). */
export function lanAddresses() {
  const ranked = []
  const ifaces = networkInterfaces()
  for (const [name, entries] of Object.entries(ifaces ?? {})) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' && entry.family !== 4) continue
      if (entry.internal) continue
      const ip = entry.address
      if (ip.startsWith('169.254.')) continue
      if (ip.startsWith('198.18.')) continue // ShanHai / TUN adapters (Clash-style)
      let rank = 3
      if (ip.startsWith('192.168.')) rank = 0
      else if (/^10\./.test(ip)) rank = 1
      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) rank = 2
      ranked.push({ ip, rank, iface: name })
    }
  }
  ranked.sort((a, b) => a.rank - b.rank || a.ip.localeCompare(b.ip))
  return ranked
}

/* error 既可以是布尔（口令不对），也可以是一句话（换取 DSH 会话 cookie 失败的原因）。 */
const esc = (value) => String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const errorLine = (error) => {
  if (typeof error === 'string' && error.length > 0) return `<div class="err">${esc(error)}</div>`
  if (error === true) return '<div class="err">口令不对，或者已经被电脑端换掉了。</div>'
  return ''
}

const GATE_HTML = (token, error) => `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>DSH · 手机访问</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         font:16px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",system-ui,sans-serif;
         background:#0f1115; color:#e8eaed; padding:24px; }
  .box { width:100%; max-width:380px; }
  h1 { font-size:20px; margin:0 0 6px; font-weight:600; }
  p { margin:0 0 18px; color:#9aa0a6; font-size:13px; }
  input, button { width:100%; box-sizing:border-box; font:inherit; border-radius:12px; }
  input { padding:14px 16px; background:#1a1d23; border:1px solid #2a2f38; color:#e8eaed; letter-spacing:.02em; }
  button { margin-top:12px; padding:14px 16px; background:#4c8bf5; border:0; color:#fff; font-weight:600; }
  .err { color:#f28b82; font-size:13px; margin-top:12px; }
</style></head>
<body><div class="box">
  <h1>需要访问口令</h1>
  <p>这台电脑的 DSH 没有登录页，所以手机必须带上口令。口令在电脑端「角色卡」面板里，点「复制链接」发到手机最省事。</p>
  <form method="GET" action="${UNLOCK_PATH}">
    <input name="t" value="${error ? '' : token ? '' : ''}" placeholder="粘贴访问口令" autocomplete="off" autocapitalize="off" spellcheck="false">
    <input type="hidden" name="next" value="/">
    <button type="submit">进入 DSH</button>
  </form>
  ${errorLine(error)}
</div></body></html>`

export function createLanBridge(options = {}) {
  const log = options.log ?? ((...args) => console.log('[dsh-role-card:lan]', ...args))
  const targetHost = options.targetHost ?? '127.0.0.1'
  const resolveTargetPort = typeof options.targetPort === 'function'
    ? options.targetPort
    : () => options.targetPort ?? 11901

  let server = null
  let port = options.port ?? 11902
  let token = typeof options.token === 'string' && options.token.length >= 16 ? options.token : newToken()
  let startedAt = null
  const sockets = new Set()

  const authorized = (req) => safeEqual(parseCookies(req.headers.cookie)[COOKIE], token)

  /* DSH 的会话 cookie 由桥替手机保管（服务端保存 name=value），每个上游请求现拼进去。
   * 好处是手机只需要手里那一个口令 cookie：Safari 在 http://IP 上丢 cookie 的毛病
   * （dsh-pocket issue #91）不会再让界面 401，换浏览器也不用重新登录。 */
  let hostAuthPairs = []
  const keepAuthCookies = (lines) => {
    const pairs = []
    for (const line of lines) {
      if (typeof line !== 'string') continue
      const pair = line.split(';')[0].trim()
      if (/^dsh-auth-[^=]+=/.test(pair)) pairs.push(pair)
    }
    if (pairs.length > 0) hostAuthPairs = pairs
    return pairs
  }

  const rewriteHeaders = (headers, keepUpgrade) => {
    const out = { ...headers }
    out.host = `${targetHost}:${resolveTargetPort()}`
    // The web app builds absolute URLs and checks Origin on some endpoints; make
    // them look like the loopback origin the app was started with.
    if (out.origin) out.origin = `http://${targetHost}:${resolveTargetPort()}`
    if (out.referer) out.referer = String(out.referer).replace(/^http:\/\/[^/]+/, `http://${targetHost}:${resolveTargetPort()}`)
    if (hostAuthPairs.length > 0) {
      const mine = hostAuthPairs.join('; ')
      out.cookie = typeof out.cookie === 'string' && out.cookie.length > 0 ? `${out.cookie}; ${mine}` : mine
    }
    if (!keepUpgrade) {
      delete out['sec-websocket-key']
      delete out['sec-websocket-version']
      delete out['sec-websocket-extensions']
    }
    return out
  }

  const proxyHttp = (req, res) => {
    const upstream = httpRequest(
      { host: targetHost, port: resolveTargetPort(), method: req.method, path: req.url, headers: rewriteHeaders(req.headers, false) },
      (upRes) => {
        res.writeHead(upRes.statusCode ?? 502, upRes.headers)
        upRes.pipe(res)
      },
    )
    upstream.on('error', (error) => {
      log('upstream error', error?.message ?? error)
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
        res.end(`无法连接 DSH web（${targetHost}:${resolveTargetPort()}）：${error?.message ?? error}`)
      } else {
        res.destroy()
      }
    })
    req.pipe(upstream)
  }

  const handleUpgrade = (req, socket, head) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => socket.destroy())

    if (!authorized(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nconnection: close\r\ncontent-length: 0\r\n\r\n')
      socket.destroy()
      return
    }

    const headers = rewriteHeaders(req.headers, true)
    const lines = [`${req.method} ${req.url} HTTP/1.1`]
    for (const [key, value] of Object.entries(headers)) {
      if (Array.isArray(value)) for (const item of value) lines.push(`${key}: ${item}`)
      else if (value !== undefined) lines.push(`${key}: ${value}`)
    }
    const raw = Buffer.from(lines.join('\r\n') + '\r\n\r\n', 'utf8')

    const upstream = connect({ host: targetHost, port: resolveTargetPort() }, () => {
      upstream.write(raw)
      if (head && head.length > 0) upstream.write(head)
      upstream.pipe(socket)
      socket.pipe(upstream)
    })
    upstream.on('error', (error) => {
      log('upgrade error', error?.message ?? error)
      socket.destroy()
    })
    upstream.on('close', () => socket.destroy())
  }

  const handleRequest = async (req, res) => {
    let url
    try {
      url = new URL(req.url ?? '/', 'http://lan')
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('bad request')
      return
    }
    // unlock 分支要替手机换 DSH 的会话 cookie，是异步的；这里兜住意外异常，
    // 免得一个 throw 变成 node 的 unhandledRejection 把整个宿主拖下水。
    try {
      await routeRequest(url, req, res)
    } catch (error) {
      log('request failed', error?.message ?? error)
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('网关内部错误：' + String(error?.message ?? error))
      } else {
        res.destroy()
      }
    }
  }

  const routeRequest = async (url, req, res) => {

    if (url.pathname === UNLOCK_PATH) {
      const supplied = url.searchParams.get('t') ?? ''
      const next = url.searchParams.get('next') ?? '/'
      const target = next.startsWith('/') && !next.startsWith('//') ? next : '/'
      if (!safeEqual(supplied, token)) {
        log('unlock rejected (bad token) from', req.socket.remoteAddress)
        const body = GATE_HTML('', true)
        res.writeHead(401, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end(body)
        return
      }
      log('unlock ok from', req.socket.remoteAddress)
      /* DSH 的界面不是匿名可看的：它要一个 authority-bound 的签名 cookie。
       * 手机浏览器换不到那个 cookie（launch token 只活在宿主进程里），所以这里
       * 替它换一次，再把 Set-Cookie 原样带给手机 —— 否则手机看到的永远是
       * “dsh web authentication required”。换不到也照样放行，手机至少能看到
       * 桥自己的说明页，而不是卡在空白。 */
      const relayed = []
      let mintNote = null
      if (typeof options.mintAuthCookie === 'function') {
        try {
          const minted = await options.mintAuthCookie()
          const lines = Array.isArray(minted)
            ? minted
            : typeof minted === 'string'
              ? [minted]
              : minted !== null && typeof minted === 'object'
                ? (Array.isArray(minted.cookies) ? minted.cookies : [])
                : []
          for (const line of lines) if (typeof line === 'string') relayed.push(line)
          if (minted !== null && typeof minted === 'object' && typeof minted.note === 'string') mintNote = minted.note
        } catch (error) {
          mintNote = '换取 DSH 会话 cookie 时出错：' + String(error?.message ?? error)
          log('mint auth cookie failed', error?.message ?? error)
        }
      }
      /* 换不到 cookie 就别把手机丢进一片 401 白页：留在口令页上把原因说清楚。 */
      if (mintNote !== null && relayed.length === 0) {
        res.writeHead(502, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end(GATE_HTML(token, mintNote))
        return
      }
      // 桥自己也留一份，之后转发时补进上游请求（手机丢了 cookie 也照样能看界面）。
      const kept = keepAuthCookies(relayed)
      res.writeHead(302, {
        location: target,
        'set-cookie': [`${COOKIE}=${token}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax`, ...relayed],
        'cache-control': 'no-store',
      })
      res.end()
      return
    }

    if (url.pathname === PING_PATH) {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ ok: true, service: 'dsh-role-card-lan' }))
      return
    }

    if (!authorized(req)) {
      const body = GATE_HTML(token, false)
      res.writeHead(401, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(body)
      return
    }

    proxyHttp(req, res)
  }

  const status = () => ({
    running: server !== null,
    port,
    token,
    target: `${targetHost}:${resolveTargetPort()}`,
    startedAt,
    urls: lanAddresses().map((entry) => ({
      iface: entry.iface,
      ip: entry.ip,
      base: `http://${entry.ip}:${port}/`,
      unlock: `http://${entry.ip}:${port}${UNLOCK_PATH}?t=${token}&next=/`,
    })),
  })

  const start = async (nextPort = port) => {
    if (server !== null) return status()
    // 0 是合法输入：交给系统分配一个空闲端口（测试和“默认端口被占用”时都用得上）。
    const wanted = Number(nextPort)
    port = Number.isInteger(wanted) && wanted >= 0 && wanted < 65536 ? wanted : port
    const created = createServer(handleRequest)
    created.on('upgrade', handleUpgrade)
    created.on('connection', (socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
    })
    await new Promise((resolve, reject) => {
      created.once('error', reject)
      created.listen(port, '0.0.0.0', () => {
        created.removeListener('error', reject)
        resolve()
      })
    })
    created.on('error', (error) => log('server error', error?.message ?? error))
    const bound = created.address()
    if (bound !== null && typeof bound === 'object' && Number(bound.port) > 0) port = Number(bound.port)
    server = created
    startedAt = Date.now()
    if (typeof options.onPort === 'function') {
      try { options.onPort(port) } catch { /* 落盘失败不影响本次会话 */ }
    }
    log(`listening on 0.0.0.0:${port} -> ${targetHost}:${resolveTargetPort()}`)
    return status()
  }

  const stop = async () => {
    if (server === null) return status()
    const closing = server
    server = null
    startedAt = null
    for (const socket of sockets) socket.destroy()
    sockets.clear()
    await new Promise((resolve) => closing.close(() => resolve()))
    log('stopped')
    return status()
  }

  const rotate = () => {
    token = newToken()
    // 让宿主把新口令落盘：否则手机上的旧链接在下次启动后又会“复活”，口令等于没换。
    if (typeof options.onToken === 'function') {
      try { options.onToken(token) } catch { /* 落盘失败不影响本次会话 */ }
    }
    log('token rotated — every phone must re-open the unlock link')
    return status()
  }

  return { start, stop, rotate, status, isRunning: () => server !== null }
}
