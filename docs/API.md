# HTTP 接口

宿主半通过 DSH 的 `webServer.register({ kind: 'prefix', path: API_PATH })` 注册一个前缀路由，所有端点都在：

```
http://127.0.0.1:<webPort>/api/dsh-role-card
```

`<webPort>` 是 DSH web 服务当前监听的端口（面板自己知道，从页面地址取）。

## 鉴权

每个请求必须带请求头：

```
x-dsh-role-card: <token>
```

`token` 是宿主每次启动用 `randomUUID()` 生成、注入到页面里的：

```html
<script>window.__DSH_ROLE_CARD__={"token":"<uuid>"}</script>
```

浏览器半从 `window.__DSH_ROLE_CARD__.token` 读；读不到时退化用字符串 `ui`（宿主的静态标记，只在同源页面里能拿到）。

**为什么自定义头就够**：自定义请求头会强制浏览器先发 CORS preflight，而这个路由从不回应 `OPTIONS`，所以任意第三方页面都无法发起带头的请求——即使是同源的 `ui` 也拿不到。

缺头或头不对：

```http
HTTP/1.1 403 Forbidden
{"ok":false,"error":"forbidden"}
```

## 通用约定

- 请求体是 JSON，上限 `400KB + 64KB`（超出抛 `body too large` → 500）。
- JSON 解析失败：`400 {"ok":false,"error":"invalid JSON body"}`。
- 未匹配的路径：`404 {"ok":false,"error":"not found"}`。
- **业务错误一律返回 HTTP 200 + `ok:false`**，`error` 是给用户看的中文句子。只有鉴权、JSON 语法、路由不存在、未捕获异常才用非 200 状态码。
- 所有响应带 `cache-control: no-store`。
- `id` 缺省时自动取当前激活的卡；一张卡都没激活则报「还没有选中的角色卡」。

## 端点总览

| 方法 | 路径 | 作用 | 返回 |
|---|---|---|---|
| GET | `/state` | 快照：卡片列表 + 当前角色 + 客户端在线信息 | `{ok, activeId, active, cards, client}` |
| GET | `/card?id=` | 单张卡的完整正文 | `{ok, card}` |
| GET | `/chat?id=` | 对话面板状态（轮询用） | `{ok, cardId, busy, error, messages, live}` |
| GET | `/novel?id=` | 小说元信息 + 章节列表 | `{ok, novel, chapters}` |
| GET | `/lan` | 手机访问状态（含二维码 SVG） | `{ok, lan}` |
| GET | `/route` | 模型路由诊断 | `{ok, route, candidates, live, direct}` |
| GET | `/agents` | 当前 root agents | `{ok, agents}` |
| POST | `/save` | 新建/覆盖角色卡 | `{ok, ...snapshot}` |
| POST | `/activate` | 激活一张卡 | `{ok, ...snapshot}` |
| POST | `/deactivate` | 退出角色 | `{ok, ...snapshot}` |
| POST | `/delete` | 删除一张卡 | `{ok, ...snapshot}` |
| POST | `/hello` | 客户端上线/异常上报 | `{ok, ...snapshot}` |
| POST | `/chat` | 说一句 | 面板状态 + 快照 |
| POST | `/open` | 让角色开场（仅空对话） | 面板状态 + 快照 |
| POST | `/chat/reset` | 归档并清空对话 | `{ok, cardId, busy, error, messages, live}` |
| POST | `/mode` | 内容模式：`adult` / `normal` | `{ok, ...snapshot}` |
| POST | `/tone` | 尺度：`none` / `hint` / `soft` / `explicit` / `hard` | `{ok, ...snapshot}` |
| POST | `/pace` | 节奏：`slow` / `steady` / `direct` | `{ok, ...snapshot}` |
| POST | `/style` | 写法：`rp` / `novel` / `chat` / `script` / `diary` | `{ok, ...snapshot}` |
| POST | `/agemode` | 年龄：`adult` / `original` | `{ok, ...snapshot}` |
| POST | `/model` | 卡片级模型覆盖 | `{ok, ...snapshot}` |
| POST | `/import` | 从链接导入角色卡 | `{ok, imported, card, ...snapshot}` |
| POST | `/expand` | AI 扩写 | `{ok, saved, expanded, source, card?}` |
| POST | `/novel` | 小说导入（`full:true` 先出前 40 章） | `{ok, saved, novel, chapters?, failedCount, failed}` |
| POST | `/novel/next` | 下一章 | `{ok, novel, chapter}` |
| POST | `/novel/extend` | 续导 / 后台补更 / 检查更新 | `{ok, added?, reachedNo?, mode?, hasUpdate?, skipped?, novel, job}` |
| POST | `/lan/start` | 开启手机访问 | `{ok, lan}` |
| POST | `/lan/stop` | 关闭手机访问 | `{ok, lan}` |
| POST | `/lan/rotate` | 换口令 | `{ok, lan}` |
| POST | `/selftest` | 自检（诊断） | `{ok, ...}` |
| POST | `/poke` | 用已有的 root agent 发一条消息（诊断） | `{ok, error, agentId, events, net}` |

---

## 状态对象

`...snapshot` 出现在很多返回里，形状是：

```json
{
  "ok": true,
  "activeId": "b0f1…",
  "active": { "id": "b0f1…", "name": "沈砚", "body": "# 沈砚\n…", "createdAt": 1762900000000, "updatedAt": 1762900000000, "chatSessionId": null },
  "cards": [
    {
      "id": "b0f1…",
      "name": "沈砚",
      "chars": 12480,
      "preview": "# 沈砚\n> 来源：…",
      "createdAt": 1762900000000,
      "updatedAt": 1762900000000,
      "mode": "adult",
      "tone": "explicit",
      "ages": "adult",
      "ageMode": "adult",
      "pace": "direct",
      "style": "novel",
      "tones": ["none", "hint", "soft", "explicit", "hard"],
      "paces": ["slow", "steady", "direct"],
      "styles": ["rp", "novel", "chat", "script", "diary"],
      "modes": ["adult", "normal"],
      "model": null,
      "hasChat": false,
      "novel": null
    }
  ],
  "client": { "at": 1762900000000, "source": "panel", "version": "1.8.0", "href": "http://127.0.0.1:11901/", "ua": "Mozilla/5.0 …" }
}
```

- `active` 是完整卡（含 `body`）；`cards[]` 是精简视图（`body` 只给前 160 字的 `preview`）。
- `client` 只存在内存里，来自浏览器半的 `POST /hello`，从不写盘；面板不在线时为 `null`。
- `novel` 是 `{title, author, source, total, bookTotal, hasMore, current, currentTitle, nextTitle}` 或 `null`；`bookTotal` 是站点声称的章数（`plan.total`），`total` 是本地已抓章数，`hasMore` 表示还能续导。
- `tones` / `paces` / `styles` / `modes` 是**宿主下发的选项表**，客户端据此渲染下拉，不硬编码枚举。
- `mode: 'normal'` 时 `tone` 仍会回显存的值（用户切回成人模式时恢复），但真正注入提示词的是 `effectiveTone()` —— 普通模式下只有 `hint` 保留，其余一律按 `none` 处理。

---

## GET `/state`

```bash
curl -s -H "x-dsh-role-card: ui" http://127.0.0.1:<webPort>/api/dsh-role-card/state
```

返回 `{ok:true, ...snapshot}`。面板启动时拉一次，之后主要靠各写操作的返回值更新。

## GET `/card?id=<cardId>`

返回 `{ok:true, card}`（完整卡），找不到返回 `404 {ok:false, error:'not found'}`。

## GET `/chat?id=<cardId>`

面板的轮询端点，默认 1200ms 一次。

```json
{
  "ok": true,
  "cardId": "b0f1…",
  "busy": true,
  "error": null,
  "messages": [
    { "role": "user", "text": "（开场）", "at": 1762900000000, "opening": true },
    { "role": "assistant", "text": "她把手里的杯子放下……", "at": 1762900001000 }
  ],
  "live": true
}
```

- `busy:true` 表示这一轮还没回来；`error` 是上一轮的错误文案（下一轮开始会清空）。
- 「开场」那条用户消息在返回里被替换成 `（开场）` 并带 `opening:true`——真实 seed 带不可见前缀，不会给用户看。
- `live` 表示走的是直连引擎（`ctx.llm` 存在）。Agent 后备路径下为 `false`。
- 没有激活的卡时返回 `{ok:false, error:'还没有选中的角色卡', busy:false, messages:[]}`（HTTP 200）。

## GET `/novel?id=<cardId>`

```json
{
  "ok": true,
  "novel": { "title": "某书", "author": "某人", "source": "https://…", "total": 120, "current": 3, "currentTitle": "第三章", "nextTitle": "第四章" },
  "chapters": [ { "no": 1, "title": "第一章", "chars": 3200 } ]
}
```

没绑定章节的卡返回 `{ok:true, novel:null, chapters:[]}`。

## GET `/lan`

```json
{
  "ok": true,
  "lan": {
    "running": true,
    "port": 11980,
    "urls": [ { "ip": "192.168.1.20", "url": "http://192.168.1.20:11980/", "unlock": "http://192.168.1.20:11980/__lan/unlock?t=<token>&next=/" } ],
    "qr": "<svg …>",
    "qrError": null,
    "authBridge": true,
    "authNote": null
  }
}
```

- `qr` 是让手机直接扫的口令链接（`urls[0].unlock`）的 SVG；没有 `qrcode` 模块时给 `qrError`，只剩链接可复制。
- `authBridge` 为 `false` 表示宿主没暴露 `connection` 服务，手机能过口令页但进不了界面；`authNote` 会说明原因。

## GET `/route` / GET `/agents`

诊断用。`/route` 返回当前选中的 `route`（`{provider, model}`）、候选 `candidates`、`live`（能否直连）、`direct`。`/agents` 返回进程里 root agents 的 `{id, provider, model}` 视图。

---

## POST `/save`

```bash
curl -s -X POST -H "x-dsh-role-card: ui" -H "content-type: application/json" \
  -d '{"name":"沈砚","body":"# 沈砚\n…"}' \
  http://127.0.0.1:<webPort>/api/dsh-role-card/save
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string? | 有则覆盖，无则新建 |
| `name` | string? | 留空时从正文里取第一个 `# 标题`，再退首行，再退「未命名角色」 |
| `body` | string | 必填，≤ 400KB |
| `mode` | string? | `adult` / `normal`，缺省按新建卡默认 `normal` |
| `tone` | string? | `none` / `hint` / `soft` / `explicit` / `hard`，缺省 `soft` |
| `pace` | string? | `slow` / `steady` / `direct`，缺省 `direct` |
| `style` | string? | `rp` / `novel` / `chat` / `script` / `diary`，缺省 `novel` |
| `ageMode` | string? | `adult` / `original`，缺省 `adult` |

返回 `{ok:true, ...snapshot}`；校验失败返回 `{ok:false, error, ...snapshot}`，`error` 可能是「角色卡正文不能为空」「角色卡正文过大（上限 400KB）」「角色卡数量已达上限（200）」。保存成功后宿主会顺带刷新这张卡的对话契约。覆盖已存在的卡时，只改传入的字段。

## POST `/activate` / `/deactivate` / `/delete`

```json
{"id":"<cardId>"}     // activate / delete 需要；deactivate 不需要 body
```

都返回 `{ok, ...snapshot}`。`delete` 会同时把这张卡的历史归档（等价于对这张卡调用 reset）。

## POST `/hello`

```json
{ "source": "panel", "version": "1.8.0", "href": "http://127.0.0.1:11901/", "ua": "Mozilla/5.0 …", "error": null }
```

浏览器半启动时上报一次；面板内部异常时也走这里（`source:"client-error"` + `error` 文案），宿主会把它写进日志——否则面板里的报错在宿主侧完全不可见。返回 `{ok, ...snapshot}`。

## POST `/chat`

```json
{ "id": "<cardId>", "text": "你回来了。" }
```

- 会隐式 `activate` 这张卡。
- `text` 非空且 ≤ 8KB，否则 `{ok:false, error:'内容不能为空' / '单条消息过长'}`。
- 上一轮还没回来：`{ok:false, error:'角色正在回应上一条，稍等'}`。
- 返回 `{ok:true, cardId, busy, error, messages, live, ...snapshot}`。**注意**：调用返回时模型可能还在生成（`busy:true`），要拿最终结果请继续轮询 `GET /chat`。
- 模型空回复时 `error` 形如：`模型没有返回内容（<finish reason>；chunks=[…]）`，并且这条用户消息会被撤销。

## POST `/open`

```json
{ "id": "<cardId>" }
```

只在对话为空时有效：返回 `{ok:true, opened:true, …}`；已有消息时返回 `{opened:false, reason:"not-empty"}` 并带上当前面板状态，不会覆盖正在进行的戏。

## POST `/chat/reset`

```json
{ "id": "<cardId>" }
```

中止在飞的请求、把 `chat/<cardId>.json` 重命名成 `.deleted-<时间戳>`、返回空面板 `{ok:true, cardId, busy:false, error:null, messages:[], live:false}`。**不是删除**，文件还在，随时可以捞回来。

## POST `/mode` `/tone` `/pace` `/style` `/agemode` `/model`

```json
{"id":"<cardId>","mode":"adult"}        // adult | normal
{"id":"<cardId>","tone":"soft"}         // none | hint | soft | explicit | hard
{"id":"<cardId>","pace":"steady"}       // slow | steady | direct
{"id":"<cardId>","style":"chat"}        // rp | novel | chat | script | diary
{"id":"<cardId>","ageMode":"original"}  // adult | original
{"id":"<cardId>","model":"deepseek-v4-pro"}  // 或 null 跟随自动路由
```

都返回 `{ok, ...snapshot}`，并立刻刷新这张卡的提示词契约（下一轮生效，已经在飞的那一轮不受影响）。

几个边界：

- 非法枚举值不会报错，`toneOf()` / `paceOf()` / `styleOf()` / `modeOf()` 会回落到缺省（`soft` / `direct` / `novel` / `adult`）。
- `mode: 'normal'` 时 `tone` 仍然可以设，但 `effectiveTone()` 只放行 `hint`，其余按 `none` 处理（普通模式不注入任何性内容契约，也不注入节奏段）。
- `ageMode: 'original'` 之外的任何值都按 `'adult'` 处理。

## POST `/import`

```json
{ "url": "https://example.com/character/123", "name": "可选，覆盖识别出的名字" }
```

宿主侧抓取并解析（PNG 酒馆卡 → RSC → Next.js → JSON-LD → OpenGraph），成功后建卡并激活：

```json
{ "ok": true, "imported": { "name": "沈砚", "body": "# 沈砚\n…", "kind": "tavern-png", "source": "https://…", "chars": 9123 }, "card": { … }, "cards": [ … ] }
```

失败返回 `{ok:false, error:"连接被重置（站点反爬或代理线路不稳）"}` 之类的文案 + 当前快照。

## POST `/expand`

```json
{
  "text": "素材文字（与 url 二选一）",
  "url": "https://…（可选，宿主抓取正文当素材）",
  "requirements": "想让她是什么身份、口吻、关系、剧情走向",
  "name": "可选角色名提示",
  "mode": "adult",
  "tone": "explicit",
  "pace": "direct",
  "style": "novel",
  "save": false
}
```

- `save:false`（默认）→ `{ok:true, saved:false, expanded:{name, body, chars, route}, source}`，只出草稿。
- `save:true` → 直接建卡并激活：`{ok:true, saved:true, expanded:{name, chars}, source, card, ...snapshot}`；`mode` / `tone` / `pace` / `style` 一并写入新卡（缺省时用新建卡默认值）。
- 素材上限 24000 字（超出截断）；模型空回复时 `error` = 「模型没有返回内容（换个模型或缩短素材再试）」。

## POST `/novel`

```json
{ "url": "https://…/book/123", "name": "可选书名", "max": 200, "full": false, "save": true }
```

- `max` 是章节数上限（不传则由 `import.js` 默认策略决定）。
- `full:true` 意为「整本」：但**先只抓前 40 章**（`FIRST_BATCH_CHAPTERS`）立刻建卡返回，剩下的交给后台补更任务分批抓（`FILL_BATCH_CHAPTERS=100`，批间停 `FILL_BATCH_PAUSE_MS=400`）。整本一次抓会被宿主的 `requestTimeout` 掐断。
- `save:false` → 只预览：`{ok:true, saved:false, novel, chapters:[{no,title,chars}], failedCount, failed}`。
- `save:true` → 建卡（同一 `source` 已存在则复用那张卡并保留章节进度）+ 激活：

```json
{ "ok": true, "saved": true, "novel": {
    "title": "某书", "author": "某人", "source": "https://…",
    "total": 40, "bookTotal": 120, "hasMore": true,
    "current": 1, "currentTitle": "第一章", "nextTitle": "第二章",
    "plan": { "total": 120, "imported": 40 }
  },
  "failedCount": 2, "failed": [{"no":37,"error":"…"}], "job": { "running": true, "imported": 40, "total": 120, "error": null, "startedAt": 1762900000000, "lastAt": 1762900001000 },
  "card": {…}, "cards": [ … ] }
```

## POST `/novel/next`

```json
{ "id": "<cardId>" }
```

推进一章：`{ok:true, novel, chapter:{no,title,chars}}`。已经是最后一章：`{ok:false, error:'已经是最后一章了', novel}`；没绑定章节：`{ok:false, error:'这张卡没有绑定原著章节'}`。

## POST `/novel/extend`

续导。三种用法，同一个端点：

```json
{"id":"<cardId>"}                  // 默认：从已抓到的最大章号往后抓 40 章（EXTEND_BATCH_CHAPTERS）
{"id":"<cardId>","mode":"fill"}    // 交给后台任务把全书补完（每批 100 章），立即返回
{"id":"<cardId>","mode":"check"}   // 只探测站点当前总章数，不下载
```

- 默认（同步抓一批）：`{ok:true, added, reachedNo, novel, job, failedCount, failed, ...snapshot}`；`added` 是本批新增章数，`reachedNo` 是抓到第几章。卡正文会随之重新生成（`composeNovelBody`），章节指针保留。
- `mode:'fill'`：`{ok:true, mode:'fill', novel, job, message:'后台开始补更，全书 N 章'}`，进度随 `GET /novel` 与任意写接口的 `job` 字段返回；同一张卡同时只跑一个补更任务。
- `mode:'check'`：`{ok:true, mode:'check', hasUpdate, novel, job, message}`，`hasUpdate:true` 表示站点章数比本地多。
- 已经抓完：`{ok:true, skipped:true, message:'已经抓到第 N 章，全书 M 章，没有可续的了', novel, job}`。
- 补更任务在跑时手动续导：`{ok:true, skipped:true, message:'后台正在导入（n/m），等它跑完就行', novel, job}`。
- `job` 形状：`{running, imported, total, error, startedAt, lastAt}`，没有任务时为 `null`。

## POST `/lan/start` / `/lan/stop` / `/lan/rotate`

```json
{"port": 11980}     // start 可省略；省略时用上次的端口
```

- `start`：端口被占用会自动往后试 9 个，再不行交给系统分配（0）。全部失败返回 `{ok:false, error:'端口被占用或无法监听：…', lan}`。
- `stop`：停止监听，已连的手机立刻断开。
- `rotate`：换口令，所有手机需要重新打开 unlock 链接。

三个都返回 `{ok, lan}`，`lan` 形状同 `GET /lan`（`start`/`rotate` 带新二维码）。

## POST `/selftest` / POST `/poke`

开发诊断用，不要在面板里依赖它们。

- `/selftest`：跑一遍引擎自检（路由、直连能力、历史读写），返回结构随版本变化。
- `/poke {agentId?, text?}`：通过一个**已存在的** root agent 发一条消息，用来区分「创建参数问题」和「插件上下文问题」。返回 `{ok, error, agentId, events, net}`，`net` 是这次调用里观察到的网络与错误事件。

---

## 直接用 curl 调试的完整流程

```bash
BASE=http://127.0.0.1:<webPort>/api/dsh-role-card
H="x-dsh-role-card: ui"

# 1. 建卡
curl -s -X POST -H "$H" -H 'content-type: application/json' \
  -d '{"name":"测试","body":"# 测试\n她是图书管理员，话少。"}' $BASE/save

# 2. 拿 id
ID=$(curl -s -H "$H" $BASE/state | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).activeId))')

# 3. 开场
curl -s -X POST -H "$H" -H 'content-type: application/json' -d "{\"id\":\"$ID\"}" $BASE/open

# 4. 说一句，然后轮询到 busy:false
curl -s -X POST -H "$H" -H 'content-type: application/json' -d "{\"id\":\"$ID\",\"text\":\"你好\"}" $BASE/chat
curl -s -H "$H" "$BASE/chat?id=$ID"

# 5. 看路由
curl -s -H "$H" $BASE/route
```
