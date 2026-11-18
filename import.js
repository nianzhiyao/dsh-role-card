/**
 * dsh-role-card - URL importer.
 *
 * Turns a link to a published character card into the same kind of plain text
 * body the panel accepts when the user pastes a card by hand. Three shapes are
 * recognised, in this order:
 *
 *   1. a PNG tavern card (tEXt/zTXt/iTXt `chara` / `ccv3` chunk, base64 JSON)
 *   2. a React Server Components payload that embeds `characterData:{...}`
 *      (dzmm / huoacg style pages)
 *   3. generic HTML: `__NEXT_DATA__`, JSON-LD, then OpenGraph title/description
 *
 * Everything here is best-effort and offline-safe: no writes, no globals, a hard
 * byte cap and a timeout, and every failure raises a message the panel can show.
 */
import { inflateSync } from 'node:zlib'

const FETCH_TIMEOUT_MS = 25_000
const FETCH_ATTEMPTS = 4
const FETCH_RETRY_DELAY_MS = 700
const CHAPTER_CONCURRENCY = 6
const MAX_BYTES = 4 * 1024 * 1024
/**
 * UA 池。有些站（ixdzs8 这类）不屏蔽爬虫，反过来屏蔽浏览器 UA ——
 * 同一个链接 Chrome UA 返回 403、curl UA 返回 200。所以遇到 403/404
 * 不是报错，是换一个 UA 再问一次；问通了就把这个站记下来，后面
 * 几百章都直接用它，不再重复试错。
 */
const UA_PROFILES = [
  { id: 'chrome', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' },
  { id: 'curl', ua: 'curl/8.7.1' },
  { id: 'wget', ua: 'Wget/1.21.4' },
  { id: 'bot', ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
  { id: 'none', ua: null },
]
const UA_DEFAULT = 0
/** host → 已经验证可用的 UA 下标 */
const UA_CACHE = new Map()
const BASE_HEADERS = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
}

function headersFor(profileIndex) {
  const profile = UA_PROFILES[profileIndex] ?? UA_PROFILES[UA_DEFAULT]
  const headers = { ...BASE_HEADERS }
  if (profile.ua !== null) headers['user-agent'] = profile.ua
  return headers
}

function hostOf(url) {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ *
 * 抓取
 *
 * 线路抖动（ECONNRESET / TLS 握手被打断）和站点偶尔的 5xx 都很常见，
 * 一次失败就报错等于把偶发当常态 —— 所以这里退避重试几次，只有真
 * 失败才往上报，而且报的是人话，不是 undici 的 "fetch failed"。
 * ------------------------------------------------------------------ */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const NETWORK_ERROR_TEXT = {
  ECONNRESET: '连接被重置（站点反爬或代理线路不稳）',
  ECONNREFUSED: '连接被拒绝',
  ETIMEDOUT: '连接超时',
  ENOTFOUND: '域名解析失败（DNS 没有返回结果）',
  EAI_AGAIN: '域名解析暂时失败（DNS 抖动）',
  EPROTO: 'TLS 握手失败',
  EHOSTUNREACH: '主机不可达',
  ENETUNREACH: '网络不可达',
  CERT_HAS_EXPIRED: '站点证书已过期',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'TLS 证书校验失败',
  UND_ERR_CONNECT_TIMEOUT: '建立连接超时',
  UND_ERR_HEADERS_TIMEOUT: '等响应头超时',
  UND_ERR_BODY_TIMEOUT: '读响应体超时',
  UND_ERR_SOCKET: '连接被对端关闭',
}

function errorCode(error) {
  const seen = new Set()
  let current = error
  while (current !== null && current !== undefined && !seen.has(current)) {
    seen.add(current)
    if (typeof current.code === 'string') return current.code
    current = current.cause
  }
  return null
}

function describeFetchFailure(error, url, attempts) {
  const tries = Number.isInteger(attempts) && attempts > 1 ? `（换了 ${attempts} 种请求方式都没成功）` : ''
  const code = errorCode(error)
  if (error?.challenge === true) {
    return `站点一直在返回"加载中"空壳页（限流）。等几分钟再导，或者少导几章`
  }
  if (error?.httpStatus !== undefined && error.httpStatus !== 0) {
    const hint =
      error.httpStatus === 403 || error.httpStatus === 404 || error.httpStatus === 418
        ? '。这个站在挑 User-Agent 或要过 JS 校验，换 UA 也没过'
        : ''
    return `站点返回 HTTP ${error.httpStatus}${error.statusText === undefined ? '' : ' ' + error.statusText}${tries}${hint}`
  }
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError' || code === 'UND_ERR_ABORTED') {
    return `抓 ${url} 超过 ${Math.round(FETCH_TIMEOUT_MS / 1000)} 秒没响应（站点慢或线路卡住）`
  }
  const text = code === null ? null : NETWORK_ERROR_TEXT[code]
  if (text !== null && text !== undefined) return `抓 ${url} 失败：${text}${tries}`
  return `抓 ${url} 失败：${String(error?.message ?? error)}${tries}`
}

function retryable(error) {
  if (error === null || error === undefined) return false
  if (error.httpStatus !== undefined) {
    return error.httpStatus === 408 || error.httpStatus === 425 || error.httpStatus === 429 || error.httpStatus >= 500
  }
  // 连接层错误（DNS / 握手 / 重置 / 超时）一律重试
  return true
}

/**
 * 有的站被访问急了会回一个 200 的"Loading..." 空壳页（等 JS 落 cookie 才放行），
 * 它不是 4xx，但内容等于没有。这种软限流必须认出来，否则会当成"页面没正文"
 * 一路报错，或者更糟 —— 把空壳当正文存进卡里。
 */
function looksLikeChallenge(bytes) {
  if (bytes.length > 3000) return false
  const head = bytes.toString('utf8')
  if (/Loading\.\.\.|正在加载|请稍候|Just a moment/i.test(head)) return true
  return false
}

async function fetchOnce(url, profileIndex = UA_DEFAULT) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: headersFor(profileIndex),
    })
    if (!res.ok) {
      const error = new Error(`HTTP ${res.status} ${res.statusText}`)
      error.httpStatus = res.status
      error.statusText = res.statusText
      error.uaProfile = profileIndex
      throw error
    }
    const declared = Number(res.headers.get('content-length') ?? '0')
    if (declared > MAX_BYTES) throw new Error(`资源过大（${declared} 字节）`)
    const bytes = Buffer.from(await res.arrayBuffer())
    if (bytes.length > MAX_BYTES) throw new Error(`资源过大（${bytes.length} 字节）`)
    if (looksLikeChallenge(bytes)) {
      const error = new Error('站点返回的是"加载中"空壳页（限流）')
      error.challenge = true
      error.httpStatus = 0
      throw error
    }
    return {
      bytes,
      contentType: (res.headers.get('content-type') ?? '').toLowerCase(),
      finalUrl: res.url || url,
      httpStatus: res.status,
      uaProfile: profileIndex,
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 一个资源，先按"这个站历史上能用的 UA"去问；403/404/405 就换 UA 再问，
 * 限流空壳页就等一会儿再问，连接层错误就退避重试。全部失败才抛，抛的是人话。
 */
async function fetchResource(url) {
  const host = hostOf(url)
  const start = (host !== null && UA_CACHE.get(host)) || UA_DEFAULT
  const order = [start, ...UA_PROFILES.map((_, index) => index).filter((index) => index !== start)]
  let last = null
  let attempts = 0
  for (const profileIndex of order) {
    for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
      attempts += 1
      try {
        const result = await fetchOnce(url, profileIndex)
        // 这个 UA 在这个站能用：记下来，后面几百章直接走它。
        if (host !== null && profileIndex !== start) UA_CACHE.set(host, profileIndex)
        return result
      } catch (error) {
        last = error
        // 换 UA 能救的错误：直接出内层循环，换下一个档
        if (error.httpStatus === 403 || error.httpStatus === 404 || error.httpStatus === 405) break
        if (error.challenge === true) {
          await sleep(FETCH_RETRY_DELAY_MS * 2 * attempt)
          continue
        }
        if (attempt === FETCH_ATTEMPTS || !retryable(error)) break
        await sleep(FETCH_RETRY_DELAY_MS * attempt)
      }
    }
  }
  throw new Error(describeFetchFailure(last, url, attempts))
}

/* ------------------------------------------------------------------ *
 * 1. PNG tavern card
 * ------------------------------------------------------------------ */

function pngTextChunks(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return null
  const out = new Map()
  let off = 8
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('latin1', off + 4, off + 8)
    if (off + 12 + len > buf.length) break
    const data = buf.subarray(off + 8, off + 8 + len)
    off += 12 + len
    if (type === 'IEND') break
    if (type !== 'tEXt' && type !== 'zTXt' && type !== 'iTXt') continue
    const sep = data.indexOf(0)
    if (sep <= 0) continue
    const keyword = data.toString('latin1', 0, sep)
    try {
      if (type === 'tEXt') {
        out.set(keyword, data.subarray(sep + 1).toString('latin1'))
      } else if (type === 'zTXt') {
        out.set(keyword, inflateSync(data.subarray(sep + 2)).toString('utf8'))
      } else {
        const compressed = data[sep + 1] === 1
        let p = sep + 3
        p = data.indexOf(0, p) + 1
        p = data.indexOf(0, p) + 1
        const raw = data.subarray(p)
        out.set(keyword, compressed ? inflateSync(raw).toString('utf8') : raw.toString('utf8'))
      }
    } catch {
      /* one broken chunk must not lose the others */
    }
  }
  return out
}

function cardFromPng(buf) {
  const chunks = pngTextChunks(buf)
  if (chunks === null) return null
  const key = ['ccv3', 'chara', 'character'].find((name) => chunks.has(name))
  if (key === undefined) return null
  const raw = chunks.get(key).trim()
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    try {
      parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'))
    } catch {
      return null
    }
  }
  const card = parsed?.data ?? parsed
  if (card === null || typeof card !== 'object') return null
  return fieldsFromTavern(card, 'png-card')
}

/* ------------------------------------------------------------------ *
 * 2. RSC payload (`characterData:{...}` next to `$R[n]=`)
 * ------------------------------------------------------------------ */

function balancedObject(text, marker) {
  const at = text.indexOf(marker)
  if (at < 0) return null
  // `characterData:{...}` and `"characterData":{...}` both occur; the payload may
  // also sit inside a JS string literal, where quotes arrive as \" — handled below.
  const open = text.indexOf('{', at)
  if (open < 0) return null
  let depth = 0
  let quote = ''
  let escape = false
  for (let i = open; i < text.length; i++) {
    const ch = text[i]
    if (quote !== '') {
      if (escape) escape = false
      else if (ch === '\\') escape = true
      else if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(open, i + 1)
    }
  }
  return null
}

/** One object literal (plain or still string-escaped) -> the fields we care about. */
function fieldsFromRscLiteral(literal) {
  const stringField = (key) => {
    const match = literal.match(new RegExp(`(?:^|[,{\\s])${key}\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`))
    if (match === null) return null
    try {
      return JSON.parse(`"${match[1]}"`)
    } catch {
      return match[1]
    }
  }
  const name = stringField('name')
  if (name === null) return null
  const fields = {
    name,
    creatorNotes: stringField('creatorNotes'),
    description: stringField('description'),
    personality: stringField('personality'),
    scenario: stringField('scenario'),
    firstMes: stringField('firstMes') ?? stringField('firstMessage'),
    mesExample: stringField('mesExample') ?? stringField('mes_example'),
    systemPrompt: stringField('systemPrompt'),
    postHistory: stringField('postHistoryInstructions'),
    avatar: stringField('avatarUrl') ?? stringField('cardFilename'),
  }
  const tags = literal.match(/tags\s*:\s*\$R\[\d+\]\s*=\s*\[([^\]]*)\]/)
  if (tags !== null) {
    fields.tags = tags[1]
      .split(',')
      .map((entry) => entry.trim().replace(/^"|"$/g, ''))
      .filter((entry) => entry.length > 0)
  }
  return fieldsFromTavern(fields, 'rsc-characterData')
}

function cardFromRsc(html) {
  // A payload can be raw (`characterData:{...}`) or still escaped inside a
  // `<script>` string literal (`\"characterData\":{...}`); scan both.
  const variants = [html]
  if (html.includes('\\"')) variants.push(html.replace(/\\"/g, '"').replace(/\\\\n/g, '\\n'))
  for (const variant of variants) {
    const literal = balancedObject(variant, 'characterData')
    if (literal === null) continue
    const fields = fieldsFromRscLiteral(literal)
    if (fields !== null) return fields
  }
  return null
}

/* ------------------------------------------------------------------ *
 * 3. Generic HTML / JSON
 * ------------------------------------------------------------------ */

function fieldsFromTavern(card, source) {
  const pick = (...keys) => {
    for (const key of keys) {
      const value = card[key]
      if (typeof value === 'string' && value.trim().length > 0) return value.trim()
    }
    return null
  }
  const name = pick('name', 'char_name', 'charName', 'title')
  const tags = Array.isArray(card.tags)
    ? card.tags.filter((tag) => typeof tag === 'string')
    : typeof card.tags === 'string' && card.tags.length > 0
      ? [card.tags]
      : []
  return {
    source,
    name,
    description: pick('description', 'char_persona', 'charPersona', 'intro'),
    personality: pick('personality', 'char_personality'),
    scenario: pick('scenario', 'world_scenario'),
    firstMes: pick('first_mes', 'firstMes', 'firstMessage', 'greeting', 'first_message'),
    mesExample: pick('mes_example', 'example_dialogue', 'mesExample', 'exampleDialogue'),
    systemPrompt: pick('system_prompt', 'systemPrompt'),
    postHistory: pick('post_history_instructions', 'postHistoryInstructions'),
    creatorNotes: pick('creator_notes', 'creatorNotes', 'creatorcomment'),
    alternateGreetings: Array.isArray(card.alternate_greetings)
      ? card.alternate_greetings.filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
      : [],
    tags,
  }
}

/** Depth-first search for the first object that looks like a character card. */
function deepFindCard(value, depth = 0) {
  if (depth > 8 || value === null || typeof value !== 'object') return null
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = deepFindCard(entry, depth + 1)
      if (found !== null) return found
    }
    return null
  }
  const looksLikeCard =
    typeof value.name === 'string' &&
    (typeof value.description === 'string' ||
      typeof value.personality === 'string' ||
      typeof value.first_mes === 'string' ||
      typeof value.creatorNotes === 'string' ||
      typeof value.scenario === 'string')
  if (looksLikeCard) return value
  for (const entry of Object.values(value)) {
    const found = deepFindCard(entry, depth + 1)
    if (found !== null) return found
  }
  return null
}

function metaContent(html, re) {
  const match = html.match(re)
  return match === null ? null : decodeEntities(match[1]).trim()
}

function decodeEntities(text) {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&')
}

function cardFromHtml(html) {
  const rsc = cardFromRsc(html)
  if (rsc !== null && rsc.name !== null) return rsc

  const nextData = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i)
  if (nextData !== null) {
    try {
      const found = deepFindCard(JSON.parse(nextData[1]))
      if (found !== null) return fieldsFromTavern(found, '__NEXT_DATA__')
    } catch {
      /* fall through */
    }
  }

  const ld = [...html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)]
  for (const entry of ld) {
    try {
      const found = deepFindCard(JSON.parse(entry[1]))
      if (found !== null) return fieldsFromTavern(found, 'json-ld')
    } catch {
      /* keep looking */
    }
  }

  const title =
    metaContent(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i) ??
    metaContent(html, /<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:title["']/i) ??
    metaContent(html, /<title[^>]*>([\s\S]*?)<\/title>/i)
  const description =
    metaContent(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i) ??
    metaContent(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
  if (title === null && description === null) return null
  // A bare <title> is not a card (that is how a 404 page looks); require the
  // summary that OpenGraph pages carry for real character sheets.
  if (description === null) return null
  return {
    source: 'og-meta',
    name: title,
    description,
    personality: null,
    scenario: null,
    firstMes: null,
    mesExample: null,
    systemPrompt: null,
    postHistory: null,
    creatorNotes: null,
    alternateGreetings: [],
    tags: [],
  }
}

/* ------------------------------------------------------------------ *
 * 4. 组装成卡片正文
 * ------------------------------------------------------------------ */

function section(title, body) {
  const text = typeof body === 'string' ? body.trim() : ''
  return text.length === 0 ? '' : `## ${title}\n${text}\n`
}

export function composeBody(fields, sourceUrl) {
  const parts = []
  const name = fields.name ?? '未命名角色'
  parts.push(`# ${name}`)
  if (typeof sourceUrl === 'string' && sourceUrl.length > 0) parts.push(`> 来源：${sourceUrl}`)
  parts.push('')
  parts.push(section('角色简介', fields.description))
  parts.push(section('设定', fields.creatorNotes))
  parts.push(section('性格', fields.personality))
  parts.push(section('场景', fields.scenario))
  parts.push(section('系统设定', fields.systemPrompt))
  parts.push(section('开场白', fields.firstMes))
  if (Array.isArray(fields.alternateGreetings) && fields.alternateGreetings.length > 0) {
    parts.push(section('备选开场', fields.alternateGreetings.map((entry, i) => `(${i + 1}) ${entry}`).join('\n\n')))
  }
  parts.push(section('对话示例', fields.mesExample))
  parts.push(section('追加指令', fields.postHistory))
  if (Array.isArray(fields.tags) && fields.tags.length > 0) {
    parts.push(`## 标签\n${fields.tags.join(' · ')}\n`)
  }
  return parts
    .filter((part) => part !== '')
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/* ------------------------------------------------------------------ *
 * 3.5 素材抓取（给「AI 扩写」用）
 *
 * 和 importCardFromUrl 的区别：那边只认结构化角色卡（V2/PNG/RSC/og），
 * 抓不到就报错；这边要的是"能喂给模型的原始素材"——角色站的人物简介、
 * 小说章节正文都行，网页就剥标签取可见文本。
 * ------------------------------------------------------------------ */

export function stripHtml(html) {
  const withoutCode = String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
  const text = withoutCode
    .replace(/<\/(p|div|li|h[1-6]|br|tr|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  return decodeEntities(text)
    .replace(/[\t\u00A0]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')
}

/* ------------------------------------------------------------------ *
 * 3.6 正文容器
 *
 * 章节页除了正文，还糊着站点自己的浮层（最近阅读、分类菜单、排行榜、
 * 评论区）。单靠正则删行永远删不干净，但正文几乎总在一个固定容器里 ——
 * 先把容器切出来，浮层根本不会进正文。
 * ------------------------------------------------------------------ */

const BODY_CONTAINER_RE =
  /<(div|article|section|main)[^>]+(?:id|class)=["'][^"']*(?:j_readContent|read-content|read_content|chapter-content|chapter_content|chapterContent|content-body|article-content|book-content|booktext|yd_text2|showtxt|txtnav|content_txt|chaptercontent)[^"']*["'][^>]*>/i

// 从某个开标签开始，按同类标签的嵌套深度找配对的闭标签。
function sliceBalanced(html, start, tag) {
  const re = new RegExp(`<${tag}\\b|</${tag}\\s*>`, 'gi')
  re.lastIndex = start
  let depth = 0
  for (let match = re.exec(html); match !== null; match = re.exec(html)) {
    if (match[0].indexOf('/') === 1) {
      depth -= 1
      if (depth === 0) return html.slice(start, match.index)
    } else {
      depth += 1
    }
  }
  return html.slice(start)
}

function mainContentHtml(html) {
  const source = String(html ?? '')
  const tag = BODY_CONTAINER_RE.exec(source)
  if (tag === null) return null
  const inner = sliceBalanced(source, tag.index, tag[1].toLowerCase())
  return inner.length > 0 ? inner : null
}

const ogTitle = (html) =>
  metaContent(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i) ??
  metaContent(html, /<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:title["']/i) ??
  metaContent(html, /<title[^>]*>([\s\S]*?)<\/title>/i)

const ogDescription = (html) =>
  metaContent(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i) ??
  metaContent(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)

/**
 * 抓一段"素材"回来：结构化卡优先，否则网页可见文本。
 * @param {string} url
 * @param {{ limit?: number }} [options]
 * @returns {Promise<{ name: string | null, brief: string, text: string, finalUrl: string, kind: string, chars: number }>}
 */
const JS_SHELL_RE = /内容努力加载中|内容加载中|正在加载正文|please enable javascript|開啟 javascript/i

/**
 * 有些站（aabook 这类）正文是脚本渲染的，HTML 里只有推荐位和一行「内容努力加载中」。
 * 这种抓下来喂给模型只会得到垃圾，直接给一句能操作的提示更有用。
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeScriptShell(text) {
  const sample = String(text ?? '')
  if (JS_SHELL_RE.test(sample) === true) return true
  const cjk = (sample.match(/[\u4e00-\u9fff]/g) ?? []).length
  if (sample.length > 400 && cjk / sample.length < 0.12) return true
  // 正文页面总有成段的句子；全是短行（推荐位、导航、广告标题）就是空壳。
  const lines = sample.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
  if (lines.length >= 10) {
    const prose = lines.filter((line) => line.length >= 40 || /[。！？…]/.test(line)).length
    if (prose / lines.length < 0.2) return true
  }
  return false
}

export async function importMaterialFromUrl(url, options = {}) {  const target = String(url ?? '').trim()
  if (!/^https?:\/\//i.test(target)) throw new Error('请填写 http(s) 链接')
  const limit = Number.isInteger(options.limit) && options.limit > 2000 ? options.limit : 16000
  const { bytes, contentType, finalUrl } = await fetchResource(target)

  if (contentType.includes('image') || (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50)) {
    const fields = cardFromPng(bytes)
    if (fields === null) throw new Error('这张 PNG 里没有识别到角色卡')
    const text = composeBody(fields, finalUrl)
    return { name: fields.name ?? null, brief: fields.description ?? '', text, finalUrl, kind: 'png-card', chars: text.length }
  }

  const raw = bytes.toString('utf8')

  if (contentType.includes('json') || /^\s*[[{]/.test(raw)) {
    try {
      const found = deepFindCard(JSON.parse(raw))
      if (found !== null) {
        const fields = fieldsFromTavern(found, 'json')
        const text = composeBody(fields, finalUrl)
        return { name: fields.name ?? null, brief: fields.description ?? '', text, finalUrl, kind: 'json-card', chars: text.length }
      }
    } catch {
      /* 不是 JSON 卡，当网页处理 */
    }
  }

  const rsc = cardFromRsc(raw)
  if (rsc !== null && rsc.name !== null) {
    const text = composeBody(rsc, finalUrl)
    return { name: rsc.name, brief: rsc.description ?? '', text, finalUrl, kind: 'rsc-card', chars: text.length }
  }

  const scoped = mainContentHtml(raw)
  const scopedText = scoped === null ? '' : stripHtml(scoped)
  // 有正文容器就只吃容器，没有才退回整页 —— 否则站点头部/分类菜单会一起喂给模型。
  const picked = scopedText.length > 200 ? scopedText : stripHtml(raw)
  // 目录页当素材没意义（"可见正文"是一串章名），改取第一章正文。
  const links = chapterLinks(raw, finalUrl)
  if (links.length >= 3) {
    try {
      const first = await fetchResource(links[0].url)
      const firstText = (
        await chapterText(first.bytes.toString('utf8'), first.finalUrl || links[0].url, links[0].title)
      ).slice(0, limit)
      if (firstText.length > 300) {
        if (looksLikeScriptShell(firstText) === true) {
          throw new Error(
            '这个页面的正文是脚本加载的，抓不到真正的正文（只剩推荐位）：换一个能直接看到正文的链接，或者把正文复制进「扩写要求」再点 AI 扩写',
          )
        }
        return {
          name: novelTitle(raw, null),
          brief: ogDescription(raw) ?? '',
          text: firstText,
          finalUrl,
          kind: 'novel-chapter',
          chars: firstText.length,
        }
      }
    } catch {
      /* 第一章抓不到就当普通页面处理 */
    }
  }
  const text = cleanChapterBody(picked, ogTitle(raw)).slice(0, limit)
  if (text.length < 30) throw new Error('这个链接里没抓到可用文字（可能需要登录，或者正文是 JS 渲染的）')
  if (looksLikeScriptShell(text) === true) {
    throw new Error(
      '这个页面的正文是脚本加载的，抓不到真正的正文（只剩推荐位）：换一个能直接看到正文的链接，或者把正文复制进「扩写要求」再点 AI 扩写',
    )
  }
  return {
    name: ogTitle(raw),
    brief: ogDescription(raw) ?? '',
    text,
    finalUrl,
    kind: 'page',
    chars: text.length,
  }
}

/**
 * @param {string} url
 * @returns {Promise<{ name: string | null, body: string, source: string, finalUrl: string, chars: number }>}
 */
export async function importCardFromUrl(url) {
  const target = String(url ?? '').trim()
  if (!/^https?:\/\//i.test(target)) throw new Error('请填写 http(s) 链接')
  const { bytes, contentType, finalUrl } = await fetchResource(target)

  let fields = cardFromPng(bytes)
  if (fields === null) {
    const text = bytes.toString('utf8')
    if (contentType.includes('json') || /^\s*[[{]/.test(text)) {
      try {
        const found = deepFindCard(JSON.parse(text))
        fields = found === null ? null : fieldsFromTavern(found, 'json')
      } catch {
        fields = null
      }
    }
    if (fields === null) fields = cardFromHtml(text)
  }
  if (fields === null) throw new Error('这个链接里没有识别到角色卡内容')

  const body = composeBody(fields, finalUrl)
  if (body.trim().length === 0) throw new Error('解析到的角色卡正文为空')
  const name = typeof fields.name === 'string' && fields.name.trim().length > 0 ? fields.name.trim() : null
  return { name, body, source: fields.source ?? 'unknown', finalUrl, chars: body.length }
}

/* ------------------------------------------------------------------ *
 * 小说：原文抓取 + 按章切分
 *
 * 这里的硬规矩是"原汁原味"：章节标题、章节正文一律照抄原文，不改写、
 * 不缩写、不润色、不纠正错别字。剧情推进靠 current 指针（存在
 * novels/<cardId>.json 里）逐章往前挪，正文每轮由插件注入。
 * ------------------------------------------------------------------ */

/** 一行是不是一个章节标题（中文"第X章/节/回/卷/幕"、English Chapter N、纯编号行） */
const CHAPTER_TITLE_RE =
  /^[ \t\u3000]*((?:第\s*[一二三四五六七八九十百千零〇两0-9０-９]{1,6}\s*[章节回卷幕][^\n]{0,40})|(?:Chapter\s+[0-9IVXLC]{1,8}[^\n]{0,40})|(?:正文[ \t]*第[^\n]{0,40})|(?:[（(][0-9０-９]{1,4}[）)][^\n]{0,30})|(?:[0-9０-９]{1,4}[.、][^\n]{0,30}))[ \t\u3000]*$/

// 整本上限只管「别把内存撑爆」，不能当成内容闸门：长篇（斗破 1663 章 ≈ 460 万字）
// 以前被 200 万卡在 585 章，章节数对得上但后面全丢，用户看到的就是「导完了却少了三分之二」。
const MAX_NOVEL_CHARS = 20_000_000
const MAX_CHAPTER_CHARS = 40_000

/**
 * 一行/一条链接文字是不是章节标题。目录页的链接常常写成
 * "【书名】第003章 新的家，新的开始"，所以不能只认行首的"第"。
 */
function looksLikeChapterTitle(text) {
  const line = String(text ?? '').trim()
  if (line.length === 0 || line.length > 60) return false
  if (/第\s*[一二三四五六七八九十百千零〇两0-9０-９]{1,6}\s*[章节回卷幕]/.test(line)) return true
  if (/Chapter\s+[0-9IVXLC]{1,8}/i.test(line)) return true
  if (/^(正文|番外|序章|楔子|尾声|后记|章节后记|终章|大结局)/.test(line) && line.length <= 40) return true
  return false
}

function splitChapters(text) {
  const lines = String(text ?? '').split('\n')
  const chapters = []
  let current = null
  const preamble = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (looksLikeChapterTitle(trimmed)) {
      current = { title: trimmed.replace(/[ \t\u3000]+$/g, ''), lines: [] }
      chapters.push(current)
      continue
    }
    if (current === null) preamble.push(line)
    else current.lines.push(line)
  }
  const cut = chapters
    .map((chapter, index) => ({
      no: index + 1,
      title: chapter.title,
      text: chapter.lines.join('\n').trim(),
    }))
    .filter((chapter) => chapter.text.length > 0)
  return { chapters: cut, preamble: preamble.join('\n').trim() }
}

const CN_NUM = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }

function numericValue(raw) {
  const text = String(raw ?? '')
  if (text.length === 0) return null
  if (/^[0-9０-９]+$/.test(text)) {
    return Number(text.replace(/[０-９]/g, (ch) => String(ch.charCodeAt(0) - 0xff10)))
  }
  if (text === '十') return 10
  const tenIndex = text.indexOf('十')
  if (tenIndex >= 0) {
    const tens = tenIndex === 0 ? 1 : CN_NUM[text[tenIndex - 1]]
    const rest = text.slice(tenIndex + 1)
    const ones = rest.length === 0 ? 0 : CN_NUM[rest[0]]
    if (tens === undefined || ones === undefined) return null
    return tens * 10 + ones
  }
  let value = 0
  for (const char of text) {
    const digit = CN_NUM[char]
    if (digit === undefined) return null
    value = value * 10 + digit
  }
  return value
}

/** 从章名里取章号（"【书】第003章 …"→3，"第三十四章"→34），取不到返回 null */
function chapterNumber(title) {
  const text = String(title ?? '')
  const match = /第\s*([一二三四五六七八九十百千零〇两0-9０-９]{1,6})\s*[章节回卷幕]/.exec(text)
  if (match === null) return null
  const no = numericValue(match[1])
  if (no === null) return null
  // 「第二部 第一章」这种分部的书，把部号折进排序键，避免部之间的章号打架
  const part = /第\s*([一二三四五六七八九十百千零〇两0-9０-９]{1,3})\s*部/.exec(text)
  const partNo = part === null ? null : numericValue(part[1])
  if (partNo !== null && partNo > 1) return partNo * 1000 + no
  return no
}

/**
 * 有的站（ixdzs8 这种）目录页只放出最近一百章，完整目录要登录 / JS 才给，
 * 但章节地址本身是编号连续的：/read/38804/p1.html … p1663.html。
 * 这种站硬等目录页等于永远只能导前一百章，所以这里反推编号模板，
 * 后面直接按编号构造链接 —— 条件是"编号从 1 附近起、样本里有连续段"，
 * 满足不了（章节地址是随机 ID 的站）就老老实实用目录页给的链接。
 */
function numberedChapterTemplate(html, baseUrl) {
  const groups = new Map()
  for (const match of String(html ?? '').matchAll(/<a[^>]+href=["']([^"']+)["']/gi)) {
    const href = match[1]
    const shape = /^(.*?)(\d{1,5})(\.html?)$/.exec(href)
    if (shape === null) continue
    const key = `${shape[1]}|${shape[3]}`
    if (!groups.has(key)) groups.set(key, { prefix: shape[1], suffix: shape[3], nums: [] })
    groups.get(key).nums.push(Number(shape[2]))
  }
  let best = null
  for (const group of groups.values()) {
    const nums = [...new Set(group.nums)].sort((a, b) => a - b)
    if (nums.length < 3) continue
    const min = nums[0]
    const max = nums[nums.length - 1]
    if (min > 3) continue
    if (max < 300) continue
    // 目录页已经把章节列全了，构造反而多此一举
    if (nums.length >= max * 0.6) continue
    const neighbours = nums.slice(1).filter((value, index) => value - nums[index] <= 2).length
    if (neighbours < 3) continue
    if (best === null || max > best.max) best = { ...group, min, max }
  }
  if (best === null) return null
  let base
  try {
    base = new URL(best.prefix, baseUrl).href
  } catch {
    return null
  }
  return { base, suffix: best.suffix, min: best.min, max: best.max }
}

function numberedChapterLinks(template) {
  const links = []
  for (let n = template.min; n <= template.max; n += 1) {
    links.push({ title: `第${n}章`, url: `${template.base}${n}${template.suffix}` })
  }
  return links
}

/** 章节页自己的 <title> 通常写着"第12章 章名_书名_…"，比构造的占位标题准 */
function chapterTitleFromPage(html, fallback) {
  const raw = ogTitle(html)
  if (raw === null || raw.length === 0) return fallback
  const head = raw.split(/[_｜|－—-]{1,2}/)[0].trim()
  if (head.length === 0 || head.length > 60) return fallback
  if (/第\s*[一二三四五六七八九十百千零〇两0-9]{1,6}\s*[章节回卷幕]/.test(head)) return head
  if (String(fallback ?? '').startsWith('第') && /^\d+章$/.test(String(fallback).slice(1))) return head
  return fallback
}

function chapterLinks(html, baseUrl) {
  const found = []
  const seen = new Set()
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  for (const match of String(html ?? '').matchAll(re)) {
    const href = match[1]
    const text = stripHtml(match[2]).replace(/\s+/g, ' ').trim()
    if (text.length === 0 || text.length > 60) continue
    if (!looksLikeChapterTitle(text)) continue
    let absolute
    try {
      absolute = new URL(href, baseUrl).href
    } catch {
      continue
    }
    if (seen.has(absolute)) continue
    seen.add(absolute)
    found.push({ title: text, url: absolute })
  }
  return found
}

const INDEX_PAGE_LIMIT = 12

/**
 * 目录页常常分页（"?p=2" 这种），只抓第一页就只能拿到半本书。
 * 顺着「下一页」把目录页翻完，最多翻 INDEX_PAGE_LIMIT 页。
 */
function nextIndexPage(html, baseUrl) {
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  for (const match of String(html ?? '').matchAll(re)) {
    const label = stripHtml(match[2]).replace(/\s+/g, '')
    if (!/^(下一页|下页|后一页|下一頁|›|»|>)$/.test(label)) continue
    if (!/[?&](?:p|page)=\d+/i.test(match[1])) continue
    try {
      return new URL(match[1], baseUrl).href
    } catch {
      return null
    }
  }
  return null
}

async function collectChapterLinks(html, baseUrl) {
  const seen = new Set()
  const all = []
  const push = (list) => {
    for (const link of list) {
      if (seen.has(link.url)) continue
      seen.add(link.url)
      all.push(link)
    }
  }
  push(chapterLinks(html, baseUrl))
  const visited = new Set([baseUrl])
  let currentHtml = html
  let currentUrl = baseUrl
  for (let page = 1; page < INDEX_PAGE_LIMIT; page += 1) {
    const next = nextIndexPage(currentHtml, currentUrl)
    if (next === null || visited.has(next)) break
    visited.add(next)
    let fetched
    try {
      fetched = await fetchResource(next)
    } catch {
      break
    }
    const raw = fetched.bytes.toString('utf8')
    const more = chapterLinks(raw, fetched.finalUrl || next)
    if (more.length === 0) break
    push(more)
    currentHtml = raw
    currentUrl = fetched.finalUrl || next
  }
  return all
}

/**
 * 去掉站点导航行：原文正文照抄，但"首页 / 目录 / 上一章 / 笔趣阁"这类
 * 模板行不是原著内容，留着只会让模型以为那是小说的一部分。
 * 只删明显是模板的行，正文段落一律保留。
 */
function cleanChapterBody(text, title) {
  const noise =
    /^(首页|目录|上一章|下一章|加入书签|投票|推荐票|月票|下载|字体|章节报错|返回|排行|书架|手机版|全文阅读|百度搜索|本站|版权|禁忌书屋|cool18|酷18|版主|所有跟帖|回复本帖|用户前期主贴|返回主帖|手机扫描|最近阅读|继续阅读|查看全部|快速导航|分类[:：]|最新章节[:：]|查看更多|章节目录|内容努力加载中|内容加载中|正在加载正文|性福宝|鲜辣AV|春潮AV|黄果短剧|禁漫|半糖|黄游|抖阴|精品推荐|下载排行榜|推荐排行|热门视频|疯情|书库|漫画|短剧|原声|中文字幕|\[(?:版主管理|所有跟帖|回复本帖|前期主贴)\])/
  const titleWords = String(title ?? '')
    .split(/[\s_]+/)
    .map((word) => word.replace(/[（(].*?[）)]/g, '').trim())
    .filter((word) => word.length >= 2)
  // 站点把导航和正文挤在同一行时，先把开头的模板词剥掉（只认这些固定词）
  const menuPrefix =
    /^(?:(?:书名|作者|玄幻魔法|仙侠修真|都市言情|网游动漫|科幻小说|恐怖灵异|历史军事|其他小说|全本小说|临时书架|阅读记录|关灯|字号[\s:：]*[小中大]?|存书签|加入书签|投推荐票)[\s:：]*)+/
  // 论坛把「【书名】第四章 章名 作者：… 繁体」这类模板糊在正文最前面，
  // 先按「繁体/简体」这个开关词切一刀，再把开头的【书名】剥掉。
  let body = String(text ?? '')
  const leadCut = /^[\s\S]{0,220}?(?:繁体|简体)\s*/.exec(body)
  if (leadCut !== null) body = body.slice(leadCut[0].length)
  // alicesw 一类站点把「最近阅读 / 书名 / 分类 / 最新章节 / 继续阅读 / 查看全部」
  // 浮层糊在正文最前面，整段都是导航，从「查看全部」之后才是正文。
  const navCut = /(?:^|\n)\s*最近阅读[\s\S]{0,400}?\n\s*查看全部[^\n]*\n/.exec(body)
  if (navCut !== null && navCut.index <= 40) body = body.slice(navCut.index + navCut[0].length)
  body = body.replace(/^\s*(?:【[^】]{1,40}】|\[[^\]]{1,40}\])\s*/, '')
  const kept = []
  for (const rawLine of body.split('\n')) {
    const trimmed = rawLine.trim().replace(menuPrefix, '').trim()
    if (trimmed.length === 0) {
      kept.push('')
      continue
    }
    if (noise.test(trimmed)) continue
    // 站点分类菜单 / 书架提示：整行都是导航词，不是正文
    if (trimmed.length < 240 && /(玄幻魔法|都市言情|历史军事|网游动漫|科幻小说|恐怖灵异|临时书架|阅读记录|加入书架|投推荐票)/.test(trimmed)) continue
    if (/^书名\s*作者/.test(trimmed)) continue
    if (/^(关灯|字号|背景|存书签|一秒记住|记住本站|手机用户请|本章未完)/.test(trimmed)) continue
    if (trimmed.length < 160 && /(笔趣阁|小说网|禁忌书屋|cool18|\.net|\.com|\.org)/i.test(trimmed)) continue
    if (trimmed.length < 320 && /送交者[:：]|发信人[:：]|于\s*20[0-9]{2}-[0-9]{1,2}-[0-9]{1,2}/.test(trimmed)) continue
    if (trimmed.length < 320 && /已读[0-9]|大字阅读|[0-9]+赞|布衣|★{2,}/.test(trimmed)) continue
    // "书名_第070章 小胡女…_笔趣阁" 这一类导航行会把章名再重复一次
    if (titleWords.length > 0 && trimmed.length < 140 && titleWords.every((word) => trimmed.includes(word))) continue
    if (kept.length < 8 && trimmed.length < 90 && /(笔趣阁|小说网|www\.|\.com|\.net|http)/i.test(trimmed)) continue
    // 正文头部偶尔残留站点的 JS 变量名（aabook_readfile 这类纯标识符）
    if (kept.length < 5 && trimmed.length < 40 && /^[A-Za-z][A-Za-z0-9_]*$/.test(trimmed)) continue
    // ixdzs8 每章正文前都糊一行「《书名》 · 作者 · 分类 · 主角：X」
    if (kept.length < 3 && trimmed.length < 120 && /^《[^》]{1,40}》\s*·/.test(trimmed)) continue
    kept.push(trimmed)
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function novelAuthor(raw, text) {
  const meta =
    metaContent(raw, /<meta[^>]+name=["']author["'][^>]+content=["']([^"']*)["']/i) ??
    metaContent(raw, /<meta[^>]+property=["']og:novel:author["'][^>]+content=["']([^"']*)["']/i) ??
    metaContent(raw, /<meta[^>]+property=["']book:author["'][^>]+content=["']([^"']*)["']/i)
  if (meta !== null && meta.trim().length > 0) return meta.trim()
  // 站名、版块名经常也带"作者"字样，优先取像人名的短串。
  const noisy = /[站网帖子页版块屋吧馆库]/
  for (const match of text.matchAll(/作\s*者[：:]\s*([^\n]{1,20})/g)) {
    const candidate = match[1].replace(/[（(].*?[）)]/g, '').trim()
    if (candidate.length === 0 || candidate.length > 12) continue
    if (noisy.test(candidate)) continue
    return candidate
  }
  return null
}

/* ------------------------------------------------------------------ *
 * 异步正文（章节页只给壳，正文由 ajaxGetContent() 现取）
 * ------------------------------------------------------------------ */

// 页内脚本长这样：$.get("/_getcontent.php?id="+chapid+"&v=<token>", …)
// id 是拼接的，token 是字面量 —— 所以只认 &v= 后面的那串。
const AJAX_BODY_TOKEN_RE = /_getcontent\.php[\s\S]{0,200}?&v=([A-Za-z0-9_-]{8,})/
const AJAX_BODY_ID_RE = /ajaxGetContent\(\s*["']?(\d+)["']?\s*\)/

async function ajaxChapterBody(html, pageUrl) {
  const token = html.match(AJAX_BODY_TOKEN_RE)
  const chapterId = html.match(AJAX_BODY_ID_RE)
  if (token === null || chapterId === null) return null
  let endpoint
  try {
    endpoint = new URL(`/_getcontent.php?id=${chapterId[1]}&v=${token[1]}`, pageUrl).toString()
  } catch {
    return null
  }
  const page = await fetchResource(endpoint)
  return stripHtml(page.bytes.toString('utf8'))
}

/**
 * 章节页 → 正文：先吃正文容器，容器里没东西才吃整页；正文明显偏短时
 * 再走一次站点的异步正文接口（aabook 这类页面只有壳）。
 */
async function chapterText(html, pageUrl, title) {
  let body = stripHtml(mainContentHtml(html) ?? html)
  if (body.length < 200) body = stripHtml(html)
  const titleText = String(title ?? '').trim()
  const withoutTitle = body
    .split('\n')
    .filter((line) => line.trim() !== titleText)
    .join('\n')
    .trim()
  let text = cleanChapterBody(withoutTitle.length > 0 ? withoutTitle : body, title)
  if (text.length < 300) {
    const extra = await ajaxChapterBody(html, pageUrl).catch(() => null)
    if (extra !== null) {
      const second = cleanChapterBody(extra, title)
      if (second.length > text.length) text = second
    }
  }
  return text
}

function novelTitle(raw, fallback) {
  const title = ogTitle(raw)
  if (title === null || title.trim().length === 0) return fallback
  return title.trim()
}

/**
 * 抓一部小说：入口页若是目录页（页面里有一堆"第X章"链接）就逐章抓，
 * 否则把整页当正文按标题切章。全部照抄，不做任何改写。
 *
 * 章节多的书（斗破 1663 章）不可能一次抓完，所以支持只抓一段：
 * `from` / `to` 是全书 1-based 章序号（含端点），返回的 chapter.no 也是
 * 全书序号，这样上层把几次导入的结果拼起来就是完整的书。
 *
 * @param {string} url
 * @param {{ max?: number, from?: number, to?: number, chapterChars?: number }} [options]
 * @returns {Promise<{ title: string | null, author: string | null, chapters: Array<{no:number,title:string,text:string}>, totalChapters: number, from: number, to: number, finalUrl: string, kind: string, chars: number, failedCount: number, failed: Array<{title:string,reason:string}> }>}
 */
/**
 * 只读目录页，问一句「这书现在一共多少章」。
 *
 * 用来做「有没有更新」：书追读到最新章节后，站点又贴了新章，
 * 目录页的总章数就会比本地多。这里不抓任何正文，一次请求就够。
 *
 * @param {string} url
 * @returns {Promise<{ totalChapters: number, lastTitle: string | null, source: string }>}
 */
export async function probeNovelIndex(url) {
  const target = String(url ?? '').trim()
  if (!/^https?:\/\//i.test(target)) throw new Error('请填写 http(s) 链接')
  const first = await fetchResource(target)
  const raw = first.bytes.toString('utf8')
  const text = stripHtml(raw)
  const template = numberedChapterTemplate(raw, first.finalUrl)
  const links = template === null ? await collectChapterLinks(raw, first.finalUrl) : numberedChapterLinks(template)
  if (links.length < 3 && text.length < 30) {
    throw new Error('目录页没读到章节列表（站点可能改版或限流）')
  }
  // 编号规律补全出来的链接条数就是全书章数；否则按目录页列出的条数算
  const totalChapters = template === null ? links.length : Math.max(template.max, links.length)
  return {
    totalChapters,
    lastTitle: links[links.length - 1]?.title ?? null,
    source: first.finalUrl,
  }
}

export async function importNovelFromUrl(url, options = {}) {
  const target = String(url ?? '').trim()
  if (!/^https?:\/\//i.test(target)) throw new Error('请填写 http(s) 链接')
  const wantMax = Number.isInteger(options.max) && options.max > 0 ? Math.min(options.max, 5000) : 5000
  const chapterChars =
    Number.isInteger(options.chapterChars) && options.chapterChars > 2000 ? options.chapterChars : MAX_CHAPTER_CHARS

  const first = await fetchResource(target)
  const firstRaw = first.bytes.toString('utf8')
  const firstText = stripHtml(firstRaw)

  let chapters = []
  const failed = []
  let kind = 'novel-page'
  // 目录页只放出最近一百章时，靠章节地址的编号规律把全书补齐
  const template = numberedChapterTemplate(firstRaw, first.finalUrl)
  let links = template === null ? await collectChapterLinks(firstRaw, first.finalUrl) : numberedChapterLinks(template)
  if (template === null && links.length >= 3) kind = 'novel-index'
  if (template !== null) kind = 'novel-index'
  // 目录页本身可能只有一串章节链接（可见文字很短），所以先认链接再判长度。
  if (links.length < 3 && firstText.length < 30) {
    throw new Error('这个链接里没抓到可用文字（可能需要登录，或者正文是 JS 渲染的）')
  }

  if (links.length >= 3) {
    const numbered = links.map((link) => ({ link, no: chapterNumber(link.title) }))
    const known = numbered.filter((item) => item.no !== null)
    const ordered =
      known.length >= Math.max(2, Math.ceil(numbered.length * 0.7))
        ? numbered.slice().sort((a, b) => {
            if (a.no === null && b.no === null) return 0
            if (a.no === null) return 1
            if (b.no === null) return -1
            return a.no - b.no
          })
        : numbered
    const totalChapters = ordered.length
    // from/to 是全书序号（1-based，含端点），切出这一段来抓
    const from = Number.isInteger(options.from) && options.from > 0 ? Math.min(options.from, totalChapters) : 1
    const rawTo = Number.isInteger(options.to) && options.to > 0 ? Math.min(options.to, totalChapters) : totalChapters
    const to = Math.max(from, Math.min(rawTo, from + wantMax - 1))
    const picked = ordered.slice(from - 1, to).map((item) => ({ ...item.link, no: item.no }))
    // 逐章并发抓（不再串行），某一章彻底抓不到只记账、不炸整次导入 ——
    // 目录页里常有已删章节或需要登录的页，为它丢掉整本书不值得。
    const slots = new Array(picked.length).fill(null)
    let cursor = 0
    const worker = async () => {
      for (;;) {
        const index = cursor
        cursor += 1
        if (index >= picked.length) return
        const link = picked[index]
        // 全书序号：目录页列全了就用目录顺序，构造链接则用它自带的编号
        const no = Number.isInteger(link.no) && link.no !== null ? link.no : from + index
        try {
          const page = await fetchResource(link.url)
          const raw = page.bytes.toString('utf8')
          const title = chapterTitleFromPage(raw, link.title)
          const text = await chapterText(raw, page.finalUrl || link.url, title)
          if (text.length < 10) {
            failed.push({ title, reason: '正文是空的' })
            continue
          }
          slots[index] = { no, title, text: text.slice(0, chapterChars) }
        } catch (error) {
          failed.push({ title: link.title, reason: String(error?.message ?? error) })
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CHAPTER_CONCURRENCY, picked.length) }, worker))
    chapters = slots.filter((slot) => slot !== null)
    if (chapters.length === 0) {
      const sample = failed.length > 0 ? `；首个错误：${failed[0].reason}` : ''
      throw new Error(`目录页里有 ${picked.length} 个章节链接，但每一章都没抓到正文${sample}`)
    }
    let total = 0
    const bounded = []
    for (const chapter of chapters) {
      if (total >= MAX_NOVEL_CHARS) break
      const room = MAX_NOVEL_CHARS - total
      const text = chapter.text.slice(0, room)
      total += text.length
      bounded.push({ ...chapter, text })
    }
    return {
      title: novelTitle(firstRaw, null),
      author: novelAuthor(firstRaw, firstText),
      chapters: bounded,
      totalChapters,
      from,
      to,
      finalUrl: first.finalUrl,
      kind,
      chars: total,
      failedCount: failed.length,
      failed: failed.slice(0, 20),
    }
  }

  const split = splitChapters(firstText)
  if (split.chapters.length >= 2) {
    chapters = split.chapters.map((chapter, index) => ({
      no: index + 1,
      title: chapter.title,
      text: cleanChapterBody(chapter.text, chapter.title).slice(0, chapterChars),
    }))
  } else {
    const title = novelTitle(firstRaw, ogTitle(firstRaw)) ?? null
    chapters = [
      {
        no: 1,
        title: title === null ? '正文' : title,
        text: firstText.slice(0, chapterChars),
      },
    ]
  }

  let total = 0
  const bounded = []
  for (const chapter of chapters) {
    if (total >= MAX_NOVEL_CHARS) break
    const room = MAX_NOVEL_CHARS - total
    const text = chapter.text.slice(0, room)
    total += text.length
    bounded.push({ ...chapter, text })
  }

  return {
    title: novelTitle(firstRaw, null),
    author: novelAuthor(firstRaw, firstText),
    chapters: bounded,
    totalChapters: bounded.length,
    from: 1,
    to: bounded.length,
    finalUrl: first.finalUrl,
    kind,
    chars: total,
    failedCount: failed.length,
    failed: failed.slice(0, 20),
  }
}
