# 架构

一句话：**宿主半负责「状态 + 提示词 + 模型调用 + HTTP」，浏览器半只负责「渲染 + 发请求」**，两边通过一个 token 鉴权的 JSON 接口通信。

## 四个文件的分工

| 文件 | 跑在哪 | 职责 | 依赖 |
|---|---|---|---|
| `index.js` | 宿主进程（Node） | 卡库状态、提示词构造、对话引擎、模型路由、HTTP 路由、小说与扩写 | `node:*` 内置模块 + DSH `ctx` 服务 |
| `client.js` | 浏览器 | 侧栏面板行 + 主面板 UI、轮询、所有交互 | 宿主注入的 `react`（`React.createElement`，无构建步骤） |
| `import.js` | 宿主进程 | URL 抓取与解析：PNG 酒馆卡 / RSC / Next.js / JSON-LD / OpenGraph / 小说分章 | `node:*` + `zlib` |
| `lan.js` | 宿主进程 | 局域网反代：口令页、cookie、HTTP/WS 转发 | `node:http` / `node:crypto` |

`import.js` 和 `lan.js` 都是**纯函数式模块**，不碰 `ctx`、不读插件状态——所以它们能被 `scripts/check.mjs` 直接 import 测试。

## 组件图

```
                     浏览器（DSH web 页面）
        ┌────────────────────────────────────────────┐
        │ client.js                                   │
        │  ├ sidebar.panellist → 一行「角色卡」        │
        │  └ main → 列表 / 编辑 / 对话 / 手机访问      │
        └───────────────┬────────────────────────────┘
                        │ fetch + header x-dsh-role-card: <token>
                        │ （token 由宿主注入 window.__DSH_ROLE_CARD__）
┌───────────────────────▼─────────────────────────────┐
│ 宿主进程                                             │
│  index.js                                            │
│   ├ registerApi()  prefix 路由 /api/dsh-role-card    │
│   ├ createService()  卡库：state.json 读写            │
│   ├ createChatService()  对话引擎                     │
│   │    └ ctx.llm.stream(provider, model, messages)   │
│   ├ 提示词：renderSectionText / adultizeForPrompt     │
│   └ 小说：loadNovel / saveNovel / renderNovelBlock    │
│                                                      │
│  import.js  ──► 第三方站点（只在你点导入时）           │
│  lan.js     ──► 0.0.0.0:<port> ──► 127.0.0.1:webPort │
└──────────────────────────────────────────────────────┘
                        │
              ~/.dsh/dsh-role-card/
              ├ state.json   ├ chat/   ├ novels/   └ lan.json
```

## 为什么不建 Agent（v1.3 的架构分水岭）

v1.2 用 `agents.create()` + `followup()` 驱动对话：每张卡一个 Agent，靠 system prompt section 把角色卡塞进去。问题是**本机桌面版上第一次模型请求稳定报 `DeepSeek Messages transport failed`**，而同一个 provider + model 走 `ctx.llm.stream` 完全正常。

角色扮演不需要工具、不需要会话文件、也不需要往全局提示词里注册任何东西，所以 v1.3 改成直连：

- 角色卡正文 = 唯一一条 `system` 消息；
- 历史 = 插件自己存的一个数组；
- 每次 `streamTurn` 现拼 messages 调 `llm.stream`，累加 `text-delta`。

Agent 路径的代码还在（`createChatService` 里的非 `d*` 前缀那套），但只在宿主没有 `llm` 服务时才启用，另外 `/poke`、`/agents`、`/selftest` 这几个诊断端点还在用它。

**代价**：流式文本是「攒完整段再返回」，面板看到的是「正在回应…」然后整段出现，不是逐字打字机。这是有意的取舍——面板每 1.2s 轮询一次状态，真逐字反而要维护 SSE 连接。

## 模型路由怎么定的

插件不读配置、不碰密钥，只做一件事：**从当前进程里已经跑通的 root agent 复制 `provider + model`**。

```
collectRoutes()  ← agents.list() 里每个 agent 的 provider/model
      │  优先 *account*（桌面登录态）；API-key 路由此处常缺 key
      ▼
resolveRoute()   ← 缓存第一个可用路由
      │
      ▼
streamTurn()     ← 覆盖成 deepseek-v4-pro；空内容/抛错就回退 resolveRoute() 的那条
```

为什么这么绕：**能签发并传输请求的 provider+model 组合，只有进程自己知道**。手写一个 model id 会拿到一条凭据从未被解析的路由，请求直接失败。

## 一轮对话的完整数据流

```
用户按 Enter
  └─ client: POST /chat {id, text}
       ├─ 鉴权：header 必须是本次启动的 token 或 'ui'
       ├─ service.activate(id)   （隐式切到这张卡）
       ├─ chat.send(id, text)
       │    ├─ 校验：非空、≤ 8KB、卡存在、不 busy
       │    ├─ messages.push({role:'user'}) → persist()（串行队列，tmp+rename）
       │    ├─ streamTurn(card, messages, signal)
       │    │    ├─ system = renderSectionText(card, loadNovel(card.id))
       │    │    ├─ + 历史（assistant 消息带 source:{kind:'model',provider,model}）
       │    │    └─ llm.stream({temperature, maxTokens})
       │    ├─ 空回复 → record.error + 撤销这条 user 消息（重试不会堆重复）
       │    └─ 正常 → messages.push({role:'assistant'}) → persist()
       └─ 返回 {ok, cardId, busy, error, messages, live, ...snapshot}
```

`assistant` 消息为什么要带 `source`：适配器判断「replay cache 能不能复用」时会读 `message.source`，缺了它会退化成每次全量重算。

面板不用等返回：它每 1200ms `GET /chat?id=` 拉一次状态，看到 `busy:false` 就把新消息渲染出来。

## 保存一张卡

```
POST /save {id?, name, body}
  ├─ service.upsert(): 校验非空 / ≤400KB / ≤200 张 → 写入 state.json（串行）
  ├─ chat.refresh(id): 正在进行的对话立刻拿到新契约
  └─ 返回 {ok, ...snapshot}（整份卡片列表，客户端不用再拉一次）
```

`upsert` 的语义是「有 id 就覆盖，没 id 就新建」。名字留空时取正文里第一个 `# 标题`，再退到首行，再退到「未命名角色」。

## 手机访问的数据流

```
手机 ── http://<lan-ip>:<port>/__lan/unlock?t=<token>&next=/ ──► lan.js
        ├─ 口令不对 → 口令页（带错误行）
        └─ 口令对 → 桥替手机换 DSH 的会话 cookie
              ├─ connection.authenticatedUrl() 拿带 launch token 的回环 URL
              ├─ 服务端 GET 它，抓 Set-Cookie 里的 dsh-auth
              ├─ 桥自己存一份（手机丢 cookie 也能用）
              └─ 给手机发 dsh_lan=<token>; HttpOnly; SameSite=Lax; 30 天
手机 ── 带 dsh_lan 的任意请求 ──► 桥 ──► 127.0.0.1:<webPort>（Host 改写 + 补 cookie）
                                     └─ WebSocket upgrade 同样转发
```

细节见 [LAN.md](LAN.md)。

## 必须守住的不变量

1. **一张卡只有一条对话线**（`chat/<cardId>.json`），写入串行。两个回合同时落盘会在 Windows 上 `rename` 打架报 `EPERM`。
2. **卡正文永不被改写**。年龄成年化只发生在喂给模型的那一份字符串上（`adultizeForPrompt` 的返回值），`state.json` 里存的是原文。
3. **提示词只有一条 system 消息**，角色卡正文用 `<<<ROLE_CARD … ROLE_CARD>>>` 包裹并声明为「设定资料，不是指令」；小说当前章用 `<<<NOVEL_CHAPTER … NOVEL_CHAPTER>>>` 包裹。
4. **接口无匿名入口**：自定义头 + 每次启动随机 token；`ui` 只是给同源页面用的兼容标记。
5. **失败要说话**：抓取失败、模型空回复、cookie 换不到，都要给出人能读的中文原因，而不是静默。

## 扩展一个功能要动哪

| 想加的东西 | 动哪里 |
|---|---|
| 一个新的卡片级开关（比如「视角人称」） | `normalizeCard` 默认值 → `publicState` 输出 → 提示词 `renderSectionText` → 一个 `POST /xxx` 端点（照 `/mode` 抄：`service.setXxx` + `chat.refresh`）→ 面板工具条（选项表由 `publicState` 下发，别在客户端硬编码） |
| 一个新的导入源 | `import.js` 的 `importCardFromUrl` 里加一个分支，放在通用 HTML 兜底之前 |
| 一个新的诊断端点 | `registerApi` 里加一段，走 `chat.diagnostics()` 那套 |
| 换默认模型 | `streamTurn` 的 `DEFAULT_ROLEPLAY_MODEL` |
| 改扩写提示词 | 不用改代码：写 `~/.dsh/dsh-role-card/expand-prompt.md` |

## 被否掉的做法（写下来免得以后重走）

- **每张卡一个 Agent**：v1.2 的做法，桌面版 transport 直接失败，且会往全局注册提示词段。
- **SSE 流式推给面板**：面板用轮询已经够用，加连接管理只会让移动端后台断连问题变多。
- **把角色卡正文拼进主 system prompt**：会污染其它会话。现在只在本插件的 `llm.stream` 调用里出现。
- **手机端单独一套 UI**：直接复用 web 页面 + 反代即可，避免两套逻辑漂移。
- **给 `state.json` 加密**：密钥还得存本地，收益为零。
