#!/usr/bin/env node
/**
 * dsh-role-card 发布前自检。
 *
 * 这个项目没有构建步骤也没有浏览器测试框架，所以「不要发出一个坏包」这件事
 * 靠一份结构断言兜住：语法、导出、版本号一致性、模式/尺度/节奏/文风四组旋钮
 * 的实际行为、以及最容易犯的错——把本机路径或密钥写进源码。
 *
 *   node scripts/check.mjs          # 全量
 *   node scripts/check.mjs --quiet  # 只打失败项
 *
 * 任一断言失败退出码 1。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const QUIET = process.argv.includes('--quiet')
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let passed = 0
const failures = []

function ok(name, extra) {
  passed += 1
  if (!QUIET) console.log(`  ok   ${name}${extra ? ` — ${extra}` : ''}`)
}

function fail(name, detail) {
  failures.push({ name, detail })
  console.log(`  FAIL ${name} — ${detail}`)
}

function check(name, fn) {
  try {
    const extra = fn()
    ok(name, typeof extra === 'string' ? extra : undefined)
  } catch (error) {
    fail(name, error?.message ?? String(error))
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function readText(rel) {
  const path = join(ROOT, rel)
  assert(existsSync(path), `缺少文件 ${rel}`)
  return readFileSync(path, 'utf8')
}

function readJson(rel) {
  try {
    return JSON.parse(readText(rel))
  } catch (error) {
    throw new Error(`${rel} 不是合法 JSON：${error.message}`)
  }
}

const ALL_SOURCE = ['index.js', 'import.js', 'lan.js', 'client.js']

console.log(`\ndsh-role-card check — ${ROOT}\n`)

/* ── 1. 语法 ─────────────────────────────────────────────────────────── */
console.log('语法')
for (const file of ALL_SOURCE) {
  check(`node --check ${file}`, () => {
    try {
      execFileSync(process.execPath, ['--check', join(ROOT, file)], { stdio: 'pipe' })
    } catch (error) {
      const stderr = error?.stderr?.toString?.().trim() ?? ''
      throw new Error(stderr || 'syntax error')
    }
  })
}

/* ── 2. 宿主半导出 ───────────────────────────────────────────────────── */
console.log('\n导出')
let host = null
try {
  host = await import(pathToFileURL(join(ROOT, 'index.js')).href)
  ok('动态 import index.js')
} catch (error) {
  fail('动态 import index.js', error?.message ?? String(error))
}

if (host !== null) {
  check('export apply', () => assert(typeof host.apply === 'function', 'apply 不是函数'))
  check('export inject', () => {
    assert(Array.isArray(host.inject), 'inject 不是数组')
    assert(host.inject.includes('systemPrompt'), 'inject 缺少 systemPrompt')
    return host.inject.join(', ')
  })
  for (const name of ['registerApi', 'createService', 'renderSectionText', 'adultizeForPrompt', 'composeNovelBody']) {
    check(`export ${name}`, () => assert(typeof host[name] === 'function', `缺 ${name}`))
  }
  check('export 四组旋钮的选项表', () => {
    assert(Array.isArray(host.CONTENT_MODES), '缺 CONTENT_MODES')
    assert(host.CONTENT_MODES.join(',') === 'normal,adult', `CONTENT_MODES = ${host.CONTENT_MODES.join(',')}`)
    assert(Array.isArray(host.TONES) && host.TONES.join(',') === 'none,hint,soft,explicit,hard', 'TONES 不是五档')
    assert(Array.isArray(host.PACES) && host.PACES.join(',') === 'slow,steady,direct', 'PACES 不是三档')
    assert(Array.isArray(host.STYLES) && host.STYLES.join(',') === 'rp,novel,chat,script,diary', 'STYLES 不是五种')
    return `${host.CONTENT_MODES.length}+${host.TONES.length}+${host.PACES.length}+${host.STYLES.length} 组`
  })
  check('取值函数的缺省与兜底', () => {
    for (const name of ['modeOf', 'toneOf', 'paceOf', 'styleOf', 'effectiveTone']) {
      assert(typeof host[name] === 'function', `缺 ${name}`)
    }
    assert(host.modeOf({}) === 'adult', 'mode 缺省应为 adult')
    assert(host.toneOf({}) === 'soft', 'tone 缺省应为 soft')
    assert(host.paceOf({}) === 'direct', 'pace 缺省应为 direct')
    assert(host.styleOf({}) === 'novel', 'style 缺省应为 novel')
    assert(host.toneOf({ tone: '不存在的档' }) === 'soft', '非法 tone 应回落到 soft')
    return 'adult/soft/direct/novel'
  })
}

const importer = await import(pathToFileURL(join(ROOT, 'import.js')).href).catch((error) => {
  fail('动态 import import.js', error?.message ?? String(error))
  return null
})
if (importer !== null) {
  check('import.js 导出', () => {
    for (const name of ['importCardFromUrl', 'importMaterialFromUrl', 'importNovelFromUrl', 'probeNovelIndex', 'composeBody', 'stripHtml']) {
      assert(typeof importer[name] === 'function', `缺 ${name}`)
    }
  })
}

const lan = await import(pathToFileURL(join(ROOT, 'lan.js')).href).catch((error) => {
  fail('动态 import lan.js', error?.message ?? String(error))
  return null
})
if (lan !== null) {
  check('lan.js 导出', () => {
    for (const name of ['createLanBridge', 'lanAddresses']) {
      assert(typeof lan[name] === 'function', `缺 ${name}`)
    }
  })
}

/* ── 3. 版本号与元数据一致性 ─────────────────────────────────────────── */
console.log('\n元数据')
const pkg = (() => {
  try {
    return readJson('package.json')
  } catch (error) {
    fail('package.json', error.message)
    return null
  }
})()
const clientSource = readText('client.js')
const hostSource = readText('index.js')

if (pkg !== null) {
  check('package.json 必要字段', () => {
    for (const field of ['name', 'version', 'license', 'description', 'repository', 'engines', 'author']) {
      assert(pkg[field] !== undefined && pkg[field] !== '', `缺 ${field}`)
    }
    assert(pkg.private !== true, 'private 仍是 true，发不出去')
    return `${pkg.name}@${pkg.version}`
  })
  check('files 白名单不含私密目录', () => {
    const files = pkg.files ?? []
    const allowed = ['index.js', 'client.js', 'import.js', 'lan.js', 'cordis.patch.yml', 'icon.svg', 'locale', 'docs', 'examples', 'CHANGELOG.md', 'SECURITY.md', 'README.md', 'README.en.md', 'LICENSE']
    for (const entry of files) {
      const normalized = String(entry).replace(/^\.\//, '').replace(/\/.*$/, '')
      assert(allowed.includes(normalized), `files 里的 ${entry} 不在白名单内`)
    }
    return files.join(' ')
  })
  check('version 与 client.js VERSION 一致', () => {
    const match = clientSource.match(/const VERSION\s*=\s*'([^']+)'/)
    assert(match !== null, 'client.js 里找不到 const VERSION')
    assert(match[1] === pkg.version, `client.js 是 ${match[1]}，package.json 是 ${pkg.version}`)
    return pkg.version
  })
  check('cordis.patch.yml 与包名一致', () => {
    const yml = readText('cordis.patch.yml')
    assert(yml.includes(`- id: ${pkg.name}`), `patch 里没有 "- id: ${pkg.name}"`)
    assert(yml.includes(`name: '${pkg.name}'`), `patch 里没有 "name: '${pkg.name}'"`)
  })
  check('dsh.client 声明完整', () => {
    const client = pkg.dsh?.client
    assert(client !== undefined, 'package.json 缺 dsh.client')
    assert(client.platform === 'web', `platform 应为 web，实际 ${client.platform}`)
    assert(Array.isArray(client.inject) && client.inject.length >= 4, 'dsh.client.inject 太短')
    return client.inject.join(', ')
  })
  check('仓库地址已指向真实仓库', () => {
    const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
    assert(typeof repo === 'string' && repo.length > 0, '缺 repository')
    assert(!repo.includes('YOUR_GITHUB'), 'repository 还是占位账号 YOUR_GITHUB')
    assert(repo.includes(pkg.name), `repository 里没有包名 ${pkg.name}：${repo}`)
    return repo
  })
}

check('client.js API 常量与宿主一致', () => {
  const apiMatch = clientSource.match(/const API\s*=\s*'([^']+)'/)
  assert(apiMatch !== null, 'client.js 缺 const API')
  const hostMatch = hostSource.match(/const API_PATH\s*=\s*'([^']+)'/)
  assert(hostMatch !== null, 'index.js 缺 API_PATH')
  assert(apiMatch[1] === hostMatch[1], `client ${apiMatch[1]} ≠ host ${hostMatch[1]}`)
  return apiMatch[1]
})

check('client.js 走 ModuleLoader 且注入 slots', () => {
  assert(clientSource.includes('__ModuleLoader__.load'), '不是 ModuleLoader 模块')
  assert(/inject:\s*\['slots'\]/.test(clientSource), 'apply 没有 inject slots')
  assert(clientSource.includes("require('react')"), '没有 require(\'react\')')
})

check('API 请求带自定义鉴权头', () => {
  assert(hostSource.includes('x-dsh-role-card'), '宿主侧没有校验 x-dsh-role-card')
  assert(clientSource.includes('x-dsh-role-card'), '客户端没有发送 x-dsh-role-card')
})

check('关键端点齐全', () => {
  const shared = ['/state', '/save', '/open', '/chat', '/chat/reset', '/tone', '/mode', '/style', '/pace', '/agemode', '/expand', '/import', '/novel', '/novel/extend', '/novel/next', '/lan', '/lan/start']
  // 只给诊断用的端点：宿主有，客户端不必调。
  const hostOnly = ['/route', '/agents', '/poke', '/selftest', '/hello', '/card']
  for (const suffix of [...shared, ...hostOnly]) {
    assert(hostSource.includes(`suffix === '${suffix}'`), `index.js 里没有 ${suffix} 分支`)
  }
  for (const suffix of shared) {
    assert(clientSource.includes(`'${suffix}'`) || clientSource.includes(`"${suffix}"`), `client.js 没用到 ${suffix}`)
  }
  return `${shared.length} 个共用 + ${hostOnly.length} 个诊断`
})

/* ── 4. locale ──────────────────────────────────────────────────────── */
console.log('\n本地化')
for (const lang of ['zh', 'en', 'ja']) {
  check(`locale/${lang}.json`, () => {
    const data = readJson(`locale/${lang}.json`)
    assert(typeof data?.meta?.title === 'string' && data.meta.title !== '', '缺 meta.title')
    assert(typeof data?.meta?.description === 'string', '缺 meta.description')
    return data.meta.title
  })
}

/* ── 5. 提示词契约的行为断言 ─────────────────────────────────────────── */
console.log('\n提示词契约')
if (host !== null) {
  const sampleCard = {
    id: 'check-sample',
    name: '自检角色',
    body: '# 自检角色\n\n## 角色简介\n她 15 岁，是个高中生，住在城郊。\n',
    createdAt: 0,
    updatedAt: 0,
  }
  const outside = (text) => text.split('ROLE_CARD>>>')[0].split('<<<ROLE_CARD')[0]
  const base = { ...sampleCard, mode: 'adult', style: 'novel' }

  // 五档尺度：每档都要带上自己的标题，且卡外不出现原始小年龄
  const TONE_HEAD = {
    none: '尺度＝无',
    hint: '尺度＝暗示',
    soft: '尺度＝含情',
    explicit: '尺度＝露骨',
    hard: '尺度＝极致',
  }
  for (const [tone, head] of Object.entries(TONE_HEAD)) {
    check(`renderSectionText 尺度 ${tone}`, () => {
      const text = host.renderSectionText({ ...base, tone, pace: 'direct' })
      assert(typeof text === 'string' && text.length > 300, '输出过短')
      assert(text.includes(head), `缺标题「${head}」`)
      assert(text.includes('<<<ROLE_CARD') && text.includes('ROLE_CARD>>>'), '缺 ROLE_CARD 围栏')
      assert(text.includes('自检角色'), '没有带上卡名')
      assert(!/15\s*岁/.test(outside(text)), '卡外出现原始小年龄')
      return `${text.length} 字`
    })
  }

  // 五种文风：各自的格式段落要在，篇幅也要撑得住
  const STYLE_HEAD = {
    rp: '写法（角色扮演',
    novel: '写法（小说体',
    chat: '写法（聊天体',
    script: '写法（剧本体',
    diary: '写法（日记',
  }
  for (const [style, head] of Object.entries(STYLE_HEAD)) {
    check(`renderSectionText 文风 ${style}`, () => {
      const text = host.renderSectionText({ ...base, tone: 'soft', style })
      assert(text.includes(head), `缺标题「${head}」`)
      assert(text.length > 500, '输出过短')
      return `${text.length} 字`
    })
  }

  // 三档节奏：只有「成人模式 + 尺度不为无」才注入
  const PACE_HEAD = { slow: '节奏（慢热模式', steady: '节奏（自然模式', direct: '节奏（直接模式' }
  for (const [pace, head] of Object.entries(PACE_HEAD)) {
    check(`renderSectionText 节奏 ${pace}`, () => {
      const text = host.renderSectionText({ ...base, tone: 'explicit', pace })
      assert(text.includes(head), `缺「${head}」`)
      return head
    })
  }

  check('普通模式是硬闸门（尺度被压到无）', () => {
    assert(host.effectiveTone({ mode: 'normal', tone: 'hard' }) === 'none', 'normal + hard 应压到 none')
    assert(host.effectiveTone({ mode: 'normal', tone: 'explicit' }) === 'none', 'normal + explicit 应压到 none')
    assert(host.effectiveTone({ mode: 'normal', tone: 'hint' }) === 'hint', 'normal + hint 应保留 hint')
    assert(host.effectiveTone({ mode: 'adult', tone: 'hard' }) === 'hard', 'adult + hard 应原样')
  })

  check('普通模式不注入性描写契约与节奏', () => {
    const text = host.renderSectionText({ ...base, mode: 'normal', tone: 'explicit', pace: 'direct' })
    assert(text.includes('写作契约（普通模式'), '没有换成普通模式契约')
    assert(!text.includes('动作层'), '普通模式里混进了四层推进')
    assert(!text.includes('节奏（'), '普通模式不该注入节奏')
    assert(!text.includes('尺度＝'), '普通模式不该出现尺度标题')
    return `${text.length} 字`
  })

  check('尺度为「无」时不注入节奏', () => {
    const text = host.renderSectionText({ ...base, mode: 'adult', tone: 'none', pace: 'direct' })
    assert(!text.includes('节奏（'), '「无」档不该注入节奏')
  })

  check('年龄「原文」时不改小年龄但标注照原文演', () => {
    const text = host.renderSectionText({ ...base, tone: 'soft', ageMode: 'original' })
    assert(/15\s*岁/.test(text), '原文模式不该改年龄')
    assert(text.includes('原样写'), '缺少「照原文写」的保真说明')
  })

  check('adultizeForPrompt 改小年龄', () => {
    const result = host.adultizeForPrompt('她 15 岁，是个高中生，隔壁的初中生也常来。')
    assert(result.changed === true, 'changed 应为 true')
    assert(!/15\s*岁/.test(result.text), '仍含 15 岁')
    assert(result.text.includes('24 岁'), '没有替换成成年年龄')
    assert(!result.text.includes('初中生'), '没有替换初中生')
    return result.text.replace(/\n/g, ' ')
  })

  check('adultizeForPrompt 不动成年人', () => {
    const input = '她 28 岁，是个建筑师。'
    const result = host.adultizeForPrompt(input)
    assert(result.text === input, '成年人文本被改动了')
    assert(result.changed === false, 'changed 应为 false')
  })

  check('原著章节注入当前章', () => {
    const novel = {
      title: '测试书',
      author: '测试作者',
      source: 'https://example.com/book',
      chapters: [
        { no: 1, title: '第一章', text: '第一章正文。' },
        { no: 2, title: '第二章', text: '第二章正文。' },
      ],
      current: 2,
      plan: { total: 9, imported: 2 },
    }
    const text = host.renderSectionText({ ...base, tone: 'soft' }, novel)
    assert(text.includes('NOVEL_CHAPTER'), '缺 NOVEL_CHAPTER 围栏')
    assert(text.includes('第二章正文'), '没有注入当前章的原文')
    assert(!text.includes('第一章正文'), '注入到了别的章')
    assert(text.includes('测试书'), '缺书名')
    return `${text.length} 字`
  })

  check('composeNovelBody 生成章节索引', () => {
    const body = host.composeNovelBody({
      title: '测试书',
      author: '测试作者',
      source: 'https://example.com/book',
      chapters: [
        { no: 1, title: '第一章', text: '第一章正文。' },
        { no: 2, title: '第二章', text: '第二章正文。' },
      ],
      current: 1,
    })
    assert(body.includes('测试书'), '缺书名')
    assert(body.includes('1. 第一章'), '缺章节索引')
    assert(body.includes('第二章'), '缺第二章')
    return `${body.length} 字`
  })
}

/* ── 6. 脏东西扫描 ──────────────────────────────────────────────────── */
console.log('\n纯净性')
const SCAN_TARGETS = [
  'index.js', 'client.js', 'import.js', 'lan.js', 'package.json', 'cordis.patch.yml',
  'README.md', 'README.en.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md',
  'docs/ARCHITECTURE.md', 'docs/API.md', 'docs/CARD-FORMAT.md', 'docs/PROMPT-CONTRACT.md',
  'docs/LAN.md', 'docs/DEVELOPMENT.md', 'examples/card-sample.md', 'examples/expand-prompt.md',
  'examples/state.schema.json', 'scripts/check.mjs',
]

const RULES = [
  // 只抓「带真实用户名」的路径；`C:\Users\<你>\…` 这类占位示例是允许的。
  { name: 'Windows 本机路径', re: /\b[A-Za-z]:\\+Users\\+[A-Za-z0-9._-]+|[A-Za-z]:\\+Documents\\+[A-Za-z0-9._-]+|[A-Za-z]:\\+Desktop\b/ },
  { name: 'home 目录绝对路径', re: /\/Users\/[a-z0-9._-]+\/|\/home\/[a-z0-9._-]+\//i },
  { name: '邮箱地址', re: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i },
  { name: '疑似密钥', re: /\bsk-[A-Za-z0-9]{16,}\b|\bghp_[A-Za-z0-9]{20,}\b|\bAKIA[0-9A-Z]{12,}\b/ },
  { name: '私密数据目录', re: /chat\/[0-9a-f-]{36}\.json|novels\/[0-9a-f-]{36}\.json/ },
  { name: '开发备份文件', re: /\.bak-[a-z0-9-]+/i },
]

for (const rule of RULES) {
  check(`无${rule.name}`, () => {
    const hits = []
    for (const rel of SCAN_TARGETS) {
      if (!existsSync(join(ROOT, rel))) continue
      const text = readFileSync(join(ROOT, rel), 'utf8')
      text.split('\n').forEach((line, index) => {
        if (rule.re.test(line)) hits.push(`${rel}:${index + 1}: ${line.trim().slice(0, 100)}`)
      })
    }
    assert(hits.length === 0, `\n      ${hits.slice(0, 5).join('\n      ')}`)
    return `${SCAN_TARGETS.length} 个文件`
  })
}

/* ── 汇总 ───────────────────────────────────────────────────────────── */
console.log('')
if (failures.length === 0) {
  console.log(`全部通过：${passed} 项\n`)
  process.exit(0)
}
console.log(`${failures.length} 项失败，${passed} 项通过：`)
for (const item of failures) console.log(`  - ${item.name}: ${item.detail}`)
console.log('')
process.exit(1)
