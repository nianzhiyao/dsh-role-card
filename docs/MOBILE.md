# 装到手机（DSHM）

角色卡插件本身是普通的 dsh 插件：宿主半跑在 Node 里，界面半是 web 客户端。所以只要手机上那台 dsh 能装插件，它就能装——DSHM 正是这样一台宿主。

本文以 [DSHM](https://github.com/RochelimitDawn/DSHM)（Deepseek Harness Mobile，安卓 APK，内置 Debian 12 子系统 + dsh CLI，Web UI 在 `127.0.0.1:3080`）为例；其它手机端 dsh 宿主（DSHA、Termux 自建、局域网连电脑）走的是同一套命令。

---

## 0. 先确认三件事

在 DSHM 的 Web UI 里打开终端（工作区目录下的终端就行），跑：

```bash
dsh --version                 # 宿主版本，决定下面的命令写法
dsh plugin --profile web list # 看现有插件与 profile 名
echo $HOME                    # 子系统里的家目录，一般是 /root
```

- **profile 名**：DSHM 的 Web UI 跑的是 `web` profile，所以命令里写 `--profile web`。如果 `list` 报「没有这个 profile」，把 `web` 换成 `list` 里实际存在的名字。
- **宿主版本**：本插件按 dsh `0.2.x` 的插件契约开发。DSHM 的运行时是 `0.2.0-rc.2`，在支持范围内；如果 `dsh --version` 低到 `0.1.x`，先升级 DSHM 运行时再装。
- **网络**：装插件需要能访问 npm / GitHub。DSHM 已内置 USTC + npmmirror + GHProxy 镜像，通常不用额外配置。

---

## 1. 路线 A：本地 tgz（推荐）

私有仓库、没配凭据、手机流量紧张——都走这条。插件没有任何运行时依赖，一个 tgz 就是全部。

### 1.1 电脑上打出 tgz

在插件目录（有 `package.json` 的那层）执行：

```bash
npm pack
# → dsh-role-card-1.8.1.tgz
```

### 1.2 把 tgz 送到手机

任选一种：

**A. 局域网直连（最快，不用数据线）**

电脑上在 tgz 所在目录起一个静态服务：

```powershell
# Windows
python -m http.server 8000
# 或：npx --yes serve -l 8000 .
```

查电脑的局域网地址：`ipconfig`（找 `IPv4 地址`，形如 `192.168.x.x`）。手机与电脑连同一个 WiFi，然后**在 DSHM 的终端里**下载：

```bash
cd ~
curl -O http://PC_IP:8000/dsh-role-card-1.8.1.tgz
ls -l dsh-role-card-1.8.1.tgz
```

> 手机浏览器直接下载也行，但那样文件落在安卓的 `Download` 里，子系统不一定能直接读到；用 `curl` 下到 `~` 最省事。DSHM 的工作区就是手机存储里的 `DSHM` 目录，也可以把 tgz 拷进那个目录再用绝对路径安装。

**B. 数据线 / 微信文件传输助手**：把 tgz 放进手机存储的 `DSHM` 目录，然后在终端里 `find` 一下拿路径：

```bash
find / -name 'dsh-role-card-*.tgz' 2>/dev/null
```

### 1.3 安装并重启

```bash
dsh plugin --profile web add ./dsh-role-card-1.8.1.tgz
```

装完**必须重启 Web 服务**，插件才会装配：DSHM 应用里关掉再打开「Web 服务」，或在终端里结束并重跑 `dsh web`（DSHM 的 3080 常驻，重启用应用内开关最稳）。

打开 `127.0.0.1:3080`，左侧栏面板列表里应出现 **角色卡**。

---

## 2. 路线 B：直接从私有仓库装

仓库是私有的，`github:owner/repo` 这种写法匿名拉不到代码，要带上凭据。

```bash
# 用个人访问令牌（fine-grained token 给 Contents: Read 即可，classic token 给 repo）
# 把 <用户名> 与 <令牌> 换成自己的，尖括号留着会被 shell 当成重定向，记得去掉
dsh plugin --profile web add 'https://<用户名>:<令牌>@github.com/<用户名>/dsh-role-card.git#v1.8.1'
```

带 `#v1.8.1` 是打标签安装，等于锁版本，日后 `main` 变了不会影响手机。

不想每次手打令牌，可以先让子系统记住（**令牌会明文留在配置文件里**，公用设备别这么做）：

```bash
git config --global url."https://<用户名>:<令牌>@github.com/".insteadOf "https://github.com/"
dsh plugin --profile web add 'github:<用户名>/dsh-role-card#v1.8.1'
```

GitHub 来源的插件若带构建脚本，pnpm 会拦一次。本插件**没有** `prepare` 脚本，正常不会碰到 `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`；真碰到了，按 dsh 打印的键名加进该 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds` 再重跑。

---

## 3. 路线 C：源码软链（改代码时用）

适合你想在手机上直接改插件：

```bash
# 把仓库源码（zip 解压或 git clone）放到 ~/dsh-role-card
dsh plugin --profile web add link:/root/dsh-role-card
```

`link:` 是软链：改了源码重启 Web 服务就生效，不用重装。反过来，**别删这个目录**，删了插件就失效。
裸路径（`add ./dsh-role-card`）与 `file:` 前缀是「复制」语义，装完源目录改动不再生效——这是两者的区别。

---

## 4. 装完怎么验证

```bash
dsh plugin --profile web list
# 列表里应有 dsh-role-card 1.8.1

# 路由通不通（'ui' 是面板自己用的令牌，服务端本来就收）
curl -s -H 'x-dsh-role-card: ui' http://127.0.0.1:3080/api/dsh-role-card/state
# 期望：{"ok":true,"activeId":... ,"cards":[...]}
```

然后回到 `127.0.0.1:3080`：

1. 左侧栏面板列表里点 **角色卡**；
2. 点「新建角色卡」，粘一张卡，保存；
3. 点「让角色开场」——能出字就说明宿主半、客户端半、模型路由三者都通了。

---

## 5. 手机上实际会变的地方

| 项 | 手机上的行为 |
|---|---|
| 面板位置 | 左侧栏面板列表进入；窄屏自动变成抽屉，动作收进「⋯」 |
| 字号 | 工具条「字号」四档（自动/小/中/大），自动档在手机上取更小一档 |
| 输入框 | Enter 发送、Shift+Enter 换行；手机软键盘的换行键取决于输入法 |
| 数据目录 | `$HOME/.dsh/dsh-role-card/`：`state.json`、`chat/<cardId>.json`、`novels/<cardId>.json`、`lan.json` |
| 模型路由 | 取手机 dsh 自己的 agent 路由；没有 agent 时回落到 `llm.listProviders()` 的第一个 provider |
| 手机访问区块 | 「手机访问」是给**电脑**把面板开到局域网用的；在手机上它没有意义，忽略即可 |
| 令牌注入 | 宿主提供 `webServer.tapIndex()` 才会注入 `window.__DSH_ROLE_CARD__`；没有就回落到 `ui` 令牌，功能不变 |

---

## 6. 故障对照表

| 现象 | 原因与处理 |
|---|---|
| `add` 报 `ERR_PNPM_...` / 下载超时 | 手机网络访问 npm 或 GitHub 受限。改走路线 A 的本地 tgz |
| 装完左侧栏没有「角色卡」 | 没重启 Web 服务；或 profile 名不对（`dsh plugin --profile web list` 复查） |
| 面板在，但一直转圈 / 空列表 | 路由没注册上。`curl` 测试上面的 `/state`；看宿主日志 `/root/dsh/logs/*` |
| `curl` 返回 `{"ok":false,"error":"forbidden"}` | 少了 `x-dsh-role-card` 请求头（浏览器里由插件自己带，只有手动 `curl` 会漏） |
| 保存卡报「角色卡正文过大（上限 400KB）」 | 单张卡正文硬上限，拆卡或精简设定 |
| 点发送没反应 / 报会话忙 | 上一条还在生成，等它结束（同卡串行） |
| 手机锁屏后回复断掉 | 子系统被系统省电策略冻结。给 DSHM 关掉电池优化，别在生成时锁屏 |
| 提示找不到模型 | 手机 dsh 没配 provider。先在 Web UI 里把 API Key 配好再开卡 |

---

## 7. 升级、卸载、回滚

```bash
# 升级：换一个新的 tgz 再 add 一次，pnpm 会覆盖
dsh plugin --profile web add ./dsh-role-card-1.8.2.tgz

# 卸载（插件数据不动，卡还在）
dsh plugin --profile web remove dsh-role-card

# 彻底清数据（会删掉所有卡与对话历史，先备份 state.json）
rm -rf "$HOME/.dsh/dsh-role-card"
```

装失败想退回去：`git tag` 里每个版本都能装，`add ...#v1.8.0` 即可回退；本地 tgz 同样保留旧包就行。

---

## 8. 一句话总结

```bash
# 电脑
npm pack
python -m http.server 8000
# 手机（DSHM 终端）
cd ~ && curl -O http://PC_IP:8000/dsh-role-card-1.8.1.tgz
dsh plugin --profile web add ./dsh-role-card-1.8.1.tgz
# 重启 Web 服务 → 127.0.0.1:3080 → 左侧栏「角色卡」
```
