# 开发

## 目录结构

```
dsh-role-card/
├── index.js              # 宿主半：服务、状态、提示词、对话引擎、HTTP API、LAN 桥装配（约 2100 行）
├── client.js             # 浏览器半：侧边栏面板 + 主区对话面板（React，无打包步骤）
├── import.js             # 链接导入：PNG 卡 / RSC payload / __NEXT_DATA__ / JSON-LD / OG，小说拆章
├── lan.js                # 局域网反向代理：口令门 + cookie 换发 + HTTP/WS 转发
├── cordis.patch.yml      # bundle 插入声明
├── icon.svg              # 侧边栏图标
├── locale/{zh,en,ja}.json
├── examples/             # 示例卡、可替换的扩写提示词、state.json schema
├── docs/                 # 架构 / API / 卡格式 / 提示词契约 / 手机访问 / 本文件
└── scripts/check.mjs     # 语法 + 结构自检（CI 也跑这个）
```

没有构建步骤：客户端脚本由宿主按 `dsh.client` 声明直接下发，`client.js` 自身是一个 `window.__ModuleLoader__.load({...})` 调用，`require('react')` 由宿主注入。

## 环境

- Node.js **>= 20.11**（用到 `node:test` 之外的现代 API：`crypto.randomUUID`、`fs/promises.rename`、`fetch`、`AbortSignal.timeout`）
- 一个可用的 DSH 桌面宿主（`dsh web`）
- 可选：`qrcode`（手机访问二维码）

## 把本地目录挂进宿主

插件通过 profile 的 `dependencies` 以 `link:` 方式安装，改源码立即生效（不需要 `npm pack`）：

```bash
cd ~/.dsh/profiles/desktop          # 你的 profile 目录
npm install /path/to/dsh-role-card  # 或者手改 package.json 加 "dsh-role-card": "link:/path/to/dsh-role-card"
```

profile 的 `package.json` 需要两处：

```json
{
  "dependencies": {
    "dsh-role-card": "link:/path/to/dsh-role-card"
  },
  "dsh": {
    "profile": {
      "bundles": ["dsh-role-card"]
    }
  }
}
```

`bundles` 里列了它，宿主启动时才会读插件的 `cordis.patch.yml` 并 insert 这个 bundle。装好后 `~/.dsh/profiles/desktop/node_modules/dsh-role-card` 是一个指向源码目录的 symlink/junction（Windows 上是 junction）。

改完源码 **重启宿主**（`dsh web` 停掉再起），客户端脚本是启动时下发并缓存的，热替换不可靠。

## 自检

```bash
npm run check
# 等价于 node scripts/check.mjs
```

它会做这些事，任一失败退出码非 0（当前共 56 项断言）：

1. 对四个源文件跑 `node --check`（ESM 语法）；
2. 动态 `import()` 宿主半，断言导出：`apply`、`inject`、`registerApi`、`createService`、`renderSectionText`、`adultizeForPrompt`、`composeNovelBody`，以及四组枚举常量与取值函数 `modeOf` / `toneOf` / `paceOf` / `styleOf` 的缺省回落；
3. 断言 `import.js` 导出 `importCardFromUrl` / `importMaterialFromUrl` / `importNovelFromUrl` / `composeBody` / `stripHtml` / `probeNovelIndex`，`lan.js` 导出 `createLanBridge` / `lanAddresses`；
4. 断言 `package.json` 的 `version` 与 `client.js` 里的 `const VERSION` 一致；
5. 断言 `package.json` 的 `name` 与 `cordis.patch.yml` 里的 `id`/`name` 一致，`private` 不为 `true`，`files` 白名单齐全，仓库地址已指向真实地址；
6. 断言 `client.js` 里 `API` 常量与 `index.js` 的 `API_PATH` 一致、走 `__ModuleLoader__.load`、`inject:['slots']`；并核对端点覆盖（客户端共用端点 + 只应由宿主调用的诊断端点）；
7. 断言 `locale/*.json` 都能 parse 且有 `meta.title` / `meta.description`；
8. 用一份内置示例卡调 `renderSectionText()`，断言五档尺度标题、五种文风标题、三档节奏标题都在、`effectiveTone()` 的四条映射（普通模式只留 `hint`）、普通模式不注入性契约与节奏、`tone: none` 不注入节奏、`ageMode: 'original'` 保留「15 岁」并出现「原样写」、`adultizeForPrompt()` 真的把「15 岁」改成成年人写法、原著注入只含当前章、`composeNovelBody()` 能拼出章节索引；
9. 断言源码里没有把绝对路径、邮箱、`sk-` 开头的密钥、`.bak-*` 备份文件带进来（发布前最容易犯的错）。

## 手动验证一张卡

宿主起来后，面板里点「新建角色卡」粘一段正文保存，然后：

```bash
# 面板在注入时会带 token；本地调试可以直接用 'ui'（同一台机器）
curl -s -H 'x-dsh-role-card: ui' http://127.0.0.1:11901/api/dsh-role-card/state | head -c 400
```

## 调试手段

| 手段 | 用途 |
|---|---|
| `GET /api/dsh-role-card/route` | 看当前解析到的 provider/model、候选列表、是否走直连 `live`、是否回退 |
| `GET /api/dsh-role-card/agents` | 列出宿主里现存的 root agent（路由就是从它们身上抄来的） |
| `POST /api/dsh-role-card/selftest` | 让插件自己跑一遍路由自检并回报 |
| `POST /api/dsh-role-card/poke` | 向某个已有 agent 发一条消息（诊断宿主链路是否通） |
| 宿主终端日志 | 前缀 `[dsh-role-card]`；API 异常打 `[dsh-role-card] api error:` 后返回 500 |
| 面板错误上报 | 客户端异常会 `POST /hello`，带 `source:'client-error'`、`version`、`href`、`ua`，直接进宿主日志 |
| `state.json` / `chat/*.json` | 全部状态都在磁盘上，改坏了删掉即可（损坏文件会被改名成 `.corrupt-<ts>` 而不是让插件崩） |

想验证「提示词到底长什么样」，最快的方式是临时在 `streamTurn` 里 `console.log(system)`，或直接用一份卡调：

```bash
node -e "
import('./index.js').then(async (m) => {
  // renderSectionText 未导出时，用 /state + 面板实测；导出后可直连
  console.log(Object.keys(m));
});
"
```

`renderSectionText` 当前不对外导出（它是内部实现）。它的输出在 `docs/PROMPT-CONTRACT.md` 里有完整逐段还原。

## 改代码时的几条约定

- **不要引入构建链**。客户端脚本必须保持「一个文件、直接可执行」。
- **客户端所有网络请求都要带 `x-dsh-role-card` 头**。这个自定义头强制 CORS preflight，是防跨站调用本地 API 的第一道墙；去掉它等于把接口开放给任意网页。
- **写盘一律 tmp + rename**。Windows 上直接写会被杀软/索引器抢占句柄，出现 `EPERM`；同一张卡的写入要串行（`writeQueues`）。
- **`state.json` 里的正文永远不要被程序改写**。年龄成年化只作用于喂给模型的那一份字符串。
- **新增配置项优先用环境变量 + 落盘默认值**，别再往 `state.json` 里加一层嵌套。
- **UI 文案用中文，走 `locale/*.json` 的 `meta`**（面板标题/描述）。面板内部按钮文案目前直接写在 `client.js` 里。
- **别加 "AI 助手" 语气的东西**：不写免责声明、不加「以下内容仅供参考」。

## 提交

- 一个 PR 只做一件事；`npm run check` 必须通过。
- 改了提示词契约（`renderSectionText`）请在 PR 描述里贴「改前/改后」两段 system 输出——这是这个项目里最容易悄悄退化的部分。
- `CHANGELOG.md` 的「未发布」段落按 `新增 / 变更 / 修复` 归类。

## 发布

```bash
# 1. 同步版本号：package.json 的 version 与 client.js 的 VERSION 必须一致
#    （check.mjs 会拦，但别等 CI 提醒）
# 2. 更新 CHANGELOG：把「未发布」改成新版本号 + 日期
npm run check
git add -A && git commit -m "chore: release v1.7.5"
git tag v1.7.5 && git push --tags
```

要发到 npm 的话（可选，插件本身只需要 git 安装）：

```bash
npm publish    # package.json 里 private 必须为 false，files 已经限定发布内容
```

`files` 白名单只包含 `index.js`、`client.js`、`import.js`、`lan.js`、`cordis.patch.yml`、`icon.svg`、`locale/`、`docs/`、`examples/`、`CHANGELOG.md`、`SECURITY.md`——`state.json`、`chat/`、`novels/`、`lan.json` 永远不在发布内容里。

## 已知限制

- 客户端没有测试框架，靠 `scripts/check.mjs` 的结构断言 + 手动冒烟。
- 直连 `ctx.llm.stream` 依赖宿主内部插件协议，宿主大版本升级时可能失效；失效后自动回退到 Agent 路线。
- 小说导入依赖目标站点结构，站点改版就需要同步改 `import.js` 的识别顺序。
- 单进程单用户：没有多用户隔离，没有并发锁（同一张卡的写入串行，但不同卡之间是并发的）。
