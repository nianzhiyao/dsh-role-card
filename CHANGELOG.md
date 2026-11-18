# 更新日志

本文件记录 dsh-role-card 的所有重要变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

> 1.0.0 – 1.7.3 的条目根据开发过程中的备份与提交记录整理；1.7.4 起的条目与实际发布一一对应。

## [1.8.4] — 2026-11-18

把「手机控制电脑」写成第一等用途，并补齐面板自检与三处体验问题。

### 新增

- **手机控制电脑（重点）**：局域网反代现在被当作插件的主用途之一来写文档 —— 手机连同一个 WiFi、扫码输一次口令，打开的就是这台电脑的完整 DSH（HTTP + WebSocket 全量转发，同一个进程、同一个工作区）：继续同一个会话、投任务、看工具调用与输出、多设备同时在线。README（中/英）新增独立章节，GitHub 仓库简介与 topics 同步改写。
- **`GET /diag` + 客户端启动信标**：浏览器半在 `apply()` 末尾向宿主 `POST /hello` 上报 `source: 'client-ready'`（版本 / 页面地址 / UA），宿主侧用 `clientReport()` 记住最近一次；`/diag` 一次返回宿主环境、这条上报和三条判读提示。面板不显示时先看它，不用开控制台。
- **面板崩溃兜底**：`PanelHost` 用 try/catch 包住面板组件，出错时渲染「面板渲染出错了：<原因>」并把原文打到 `console.error`，不再整块白屏。

### 改变

- **去掉流式输出**：删掉客户端 SSE 消费与气泡光标（服务端 `/chat/stream` 与 partial 保留，客户端不再连），回到 700ms 轮询；理由是实际用起来「一跳一跳」比直接出整段更难读。
- **导入更耐用**：所有请求带超时（默认 20s，导入 90s、小说 240s、对话/开场 300s），超时给出中文原因并停止等待；导入/扩写/小说导入都显示「正在处理… Ns」；页面隐藏时轮询降到 8s。
- **折叠屏**：移动布局的媒体查询从 `max-width: 600px` 扩到 `max-width: 900px`，并对粗指针设备放宽到 1180px（折叠屏展开后不再错乱）。
- **导入设置记忆**：模式 / 尺度 / 文风记在 `localStorage`，刷新或换设备回来还是上次那档。
- **菜单不再被裁**：下拉改成视口级 `position: fixed` + 边界夹取，打开时滚动/缩放自动收起（此前会被工具条的 `overflow` 裁成一条灰块）。
- **空壳页给可读错误**：`looksLikeScriptShell()` 识别「内容加载中」类脚本渲染页和只剩推荐位的页面，抛「正文是脚本加载的，换一个能直接看到正文的链接」而不是存一张空卡。

### 修复

- 面板整片白屏（`streamLiveRef` 在删改后成了未声明引用，React 直接摘掉整棵子树）。
- 点侧栏「角色卡」仍停在对话：面板未注册进 `main` 槽时 `selectPanel` 会抛错且无反馈；现在点击先广播「要主页」，落地后自动切到卡片列表。
- 补齐 `VERSION`、`client-ready` 上报、`/diag` 三处与 1.8.3 的对齐（`scripts/check.mjs` 全绿）。

## [1.8.3] — 2026-11-18

「装上了但侧边栏没有」的自证能力：客户端启动上报 + 宿主诊断端点。

### 新增

- **客户端启动上报**：浏览器半在 `apply()` 末尾向宿主 `POST /hello` 打一条 `source: 'client-ready'`（带版本、页面地址、UA，失败不抛）。这样宿主不再只能靠猜区分「浏览器半根本没跑」和「跑了但面板没显示」。
- **`GET /diag`**：返回宿主环境（node / 平台 / 架构 / profile / `DSH_HOME` / 数据目录 / 端口 / API 前缀）、最近一次客户端上报，以及三条判读提示。面板不显示时先看这里。
- `package.json` 的 `dsh` 补 `manifestVersion: 1`，与其它客户端插件（`dsh-better-sidebar`、`dsh-whale-widget` 等）的清单声明对齐。
- `scripts/check.mjs` 增加 `manifestVersion`、`/diag` 分支、`client-ready` 上报三组断言（共 59 项）。

### 说明

在无头 Edge 里对 dsh 0.2.0-rc.2 做过回归：桌面宽度与 390×844 移动视口下，`角色卡` 都能出现在侧边栏、`drc-rail` 正常挂载、控制台零报错、`/diag` 回报 `client-ready`。手机上看不到时，按顺序排查：应用完整重启一次 → `GET /diag` 看 `client` 是否为 `null` → 若为 `null` 则是本体没进 boot roster（升级/重装插件），若为 `client-ready` 则是窄屏下侧栏抽屉没展开。

## [1.8.2] — 2026-11-18

装得上、加载不起来的问题：`exports` 缺 `"."` 主入口。

### 修复

- `package.json` 的 `exports` 补齐 `".": "./index.js"`（以及 `"./index.js"`）。宿主要用裸包名 `import('dsh-role-card')` 加载插件，而 Node 的规则是**只要声明了 `exports`、里面又没有 `"."`，裸包名解析就直接失败**——报 `ERR_PACKAGE_PATH_NOT_EXPORTED: No "exports" main defined`。桌面宿主恰好走的是带路径的解析所以没暴露，DSHM（dsh 0.2.0-rc.2）上装完即中止。`main` 字段本身没问题，问题只在 `exports` 的优先级盖过了它。
- `scripts/check.mjs` 增加两条断言堵住这类回归：`exports` 必须定义 `"."` 且指向真实存在的文件；`./client` / `./import` / `./lan` 三个子入口必须在位（共 58 项）。

## [1.8.1] — 2026-11-18

手机端（DSHM / 任意 dsh 宿主）安装支持，以及一处老宿主兼容性修正。

### 新增

- `docs/MOBILE.md`：把它装到安卓的 DSHM（Debian 子系统 + dsh CLI）上的完整流程——三种投递方式（局域网 `npm pack` 出来的 tgz / 私有仓库带凭据的 git URL / 源码目录 `link:`）、装完重启与验证、常见报错对照表。
- README 增加「装到手机」小节。

### 修复

- 宿主没提供 `webServer.tapIndex()` 时（较老的 dsh 或部分移动构建），注册 token 注入不再抛错，面板自动回落到路由本来就接受的 `ui` 令牌。此前该调用无保护，缺这个 API 的宿主会在注册阶段整个失败。

## [1.8.0] — 2026-11-18

首次公开发布（仓库：<https://github.com/yugege123/dsh-role-card>）。

### 新增

- **内容模式**（`mode`）：`adult` / `normal`。`normal` 是硬闸门——不写任何性内容，尺度自动压到「无」（只有手动选「暗示」才保留暗示档）；导入普通小说、普通角色卡时用它。`POST /mode`。
- **尺度扩到五档**（`tone`）：`none` / `hint` / `soft` / `explicit` / `hard`，逐档独立的写作契约与篇幅（300-700 至 700-1200 字）。
- **节奏加一档**（`pace`）：`slow` / `steady` / `direct`；只在成人模式且尺度不为「无」时注入。
- **文风扩到五种**（`style`）：`rp` / `novel` / `chat`（聊天体，多条即时消息）/ `script`（剧本体，场景标题 + 台词块）/ `diary`（日记独白体），各自带格式契约与字数区间。
- **小说续导**：`POST /novel/extend` 三种用法——默认从已抓到的最大章号往后抓 40 章（`EXTEND_BATCH_CHAPTERS`）；`mode: 'fill'` 交给后台任务分批补完（每批 100 章，批间 400ms）；`mode: 'check'` 探测站点当前总章数，告诉用户还差几章。
- **后台补更任务**：`novelJobs` + `jobMeta()`，进度（`running` / `imported` / `total` / `error` / `lastAt`）随 `GET /novel` 与各写接口返回，面板轮询显示；同一张卡同时只跑一个补更任务，手动续导会被跳过。
- **`POST /novel` 的 `full: true`** 改为先抓前 40 章立刻出卡、其余转后台补更（整本一次抓会被宿主 requestTimeout 掐断），novel 数据新增 `plan: { total, imported }`。
- `novelMeta()` 增加 `bookTotal` 与 `hasMore`，面板可以显示「已抓 / 全书」并决定按钮是「继续导入」还是「检查更新」。
- `mergeChapters()`：续导按全书章号对齐合并，站点漏抓的章号留空也不挤位。
- 新增导出：`CONTENT_MODES` / `TONES` / `PACES` / `STYLES` / `modeOf` / `toneOf` / `paceOf` / `styleOf` / `effectiveTone` / `createService`；`import.js` 新增 `probeNovelIndex()`。
- `publicState()` 每张卡下发 `mode` / `tone` / `pace` / `style` / `ages` 与四组选项表（`modes` / `tones` / `paces` / `styles`），由宿主决定下拉内容，客户端不再硬编码。
- `POST /expand` 接受 `mode` / `tone` / `pace` / `style`，`save: true` 时一并写入新卡。
- 开源发布：README（中/英）、LICENSE（MIT）、CONTRIBUTING、SECURITY、CODE_OF_CONDUCT、CHANGELOG、`.editorconfig` / `.gitattributes`。
- `docs/`：架构、HTTP 接口、角色卡格式、提示词契约、局域网访问、开发说明。
- `examples/`：示例角色卡、可直接使用的扩写提示词、`state.json` 结构 schema。
- `scripts/check.mjs`：`node --check` + 动态 import 导出断言 + 版本一致性 + **四组旋钮的行为断言**（五档尺度/五种文风/三档节奏/普通模式硬闸门/年龄模式/原著注入）+ 纯净性扫描，`npm run check` 一条命令跑完（56 项）。
- GitHub Actions CI（Ubuntu/Windows/macOS × Node 20/22/24 跑 `npm run check` + `npm pack --dry-run`）、Issue 模板与 PR 模板。

### 变更

- 缺省值统一由取值函数兜底：`tone` → `soft`、`pace` → `direct`、`style` → `novel`、`mode` → `adult`（老数据没有 `mode` 字段时按 `adult` 处理，行为与 1.7.x 一致）。
- 采样参数改由尺度与文风决定：`temperature` 极致 `1.1` / 露骨 `1.02` / 其余 `0.9`；`maxTokens` 聊天体 2200 / 角色扮演 1600 / 其余 4000（原先按 soft/explicit 与 rp/novel 二分）。
- 提示词结构表驱动化：`TONE_CONTRACT`（五档）、`STYLE_LINES`（五种）、`PACE_LINES`（三档）、`NORMAL_CONTRACT`、`FIDELITY_AUT` / `FIDELITY_ORIGINAL`，`contractLines()` 把成年/原文的保真说明插在契约标题之后。
- 新建卡的默认值改为 `mode: 'normal'`（普通模式），要写成人内容需要显式切「成人」。
- `package.json`：`private` 改为 `false`，补 `repository` / `homepage` / `bugs` / `author` / `engines` / `scripts`，`exports` 增加 `./import`、`./lan`。
- `.gitignore`：排除运行时数据目录、`.bak-*` 开发副本与本地密钥。
- 客户端工具条：新增「模式 / 尺度 / 节奏 / 文风」四个下拉与「继续导入 40 章」「检查更新」按钮；导入区新增「模式 / 尺度 / 文风 / 小说范围」四项建卡参数。

## [1.7.4] — 2026-11-17

### 修复

- 同一张卡两个回合在同一毫秒落盘会互相 `rename` 覆盖，Windows 上抛 `EPERM`：改为按卡串行写队列，`tmp` + `rename`。
- 面板内部异常在宿主侧完全不可见：新增 `POST /hello` 上报，客户端异常落到宿主日志（`source: client-error`）。
- 窄屏下工具条动作挤成一团：收进「⋯」菜单；导航兜底回列表页。

## [1.7.3] — 2026-11-17

### 修复

- 抓取失败时只报「导入失败」：补齐 `NETWORK_ERROR_TEXT` 映射与 `describeFetchFailure()`，反爬、超时、DNS 失败各有明确文案。
- 增加重试（4 次，退避 700ms）与 25s 单请求超时，减少偶发失败。

## [1.7.2] — 2026-11-16

### 新增

- 卡片级模型覆盖：`model` 字段 + `POST /model`，`null` 表示跟随自动路由。

### 变更

- 角色扮演默认优先 `deepseek-v4-pro`；该模型返回空内容或抛错时自动回退基础路由，并记录一条日志。

## [1.7.1] — 2026-11-16

### 变更

- 把原来单旋钮的「尺度」拆成三个独立维度：尺度（`tone`：含蓄/露骨）、节奏（`pace`：慢热/直接）、写法（`style`：单人视角/小说体）。历史卡按默认值补齐。
- 采样参数随档位调整：含蓄 0.85/900，露骨 1.05，`maxTokens` 单人视角 1600、小说体 4000。

## [1.7.0] — 2026-11-15

### 新增

- 年龄模式：`ageMode: 'adult' | 'original'`。默认 `adult` 只在喂给模型的提示词里把偏小的年龄标注成年化（`15 岁`→`24 岁`、`高中生`→`大学生` 等），存档原文不改；`original` 完全照原文演。
- `adultizeForPrompt()` 导出，支持中文数字；面板工具条加「年龄：原文/成年」。

## [1.6.1] — 2026-11-14

### 变更

- 手机端 UI 适配：字号档位（自动/小/中/大）落 `localStorage`，手机上自动降一档；输入框与工具条改为触屏尺寸。

## [1.6.0] — 2026-11-13

### 新增

- 手机访问：面板内一键开启局域网反代（HTTP + WebSocket），口令页 + 30 天 cookie，二维码，换口令踢人，端口占用自动顺延。

## [1.5.0] — 2026-11-12

### 新增

- 小说逐章导入：抓目录 → 并发抓章节 → 生成「原著 · 逐章」卡；每轮只注入当前章（≤ 9000 字）；「下一章」推进指针；同链接重导复用原卡并保留进度。

## [1.4.0] — 2026-11-11

### 新增

- URL 导入：PNG 酒馆卡（`chara` / `ccv3`）、RSC payload、`__NEXT_DATA__`、JSON-LD、OpenGraph。
- AI 扩写：素材 + 要求 → 完整角色卡草稿；提示词支持外置文件（`expand-prompt.md`），每次请求现读，改完不用重启。

## [1.3.0] — 2026-11-10

### 变更

- 对话引擎改为直连 `ctx.llm.stream`：角色卡正文作为唯一 system 消息，历史只存在插件里，不再创建 Agent、不写会话文件。修复 v1.2 在桌面版上第一次模型请求稳定报 `DeepSeek Messages transport failed` 的问题。
- 路由解析改为从已跑通的 root agent 复制 `provider + model`（`*account*` 桌面登录路由优先）。

### 新增

- 「开场」：空对话时让角色先说话；「清空对话」改为归档（重命名为 `.deleted-<时间戳>`）。

## [1.2.0] — 2026-11-09

### 新增

- 卡库与全局提示词解耦：提示词段收敛到 `role-card:chat` 作用域，只在角色对话里生效。

## [1.1.0] — 2026-11-08

### 新增

- 角色切换与退出角色；卡片列表展示字数与预览。

## [1.0.0] — 2026-11-07

### 新增

- 首版：侧边栏面板、角色卡新建/编辑/删除、进入角色后按卡设定对话。
