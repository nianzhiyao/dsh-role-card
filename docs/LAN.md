# 手机访问（局域网桥）

面板里的「手机访问」开的是一个小反向代理：让同一 WiFi 下的手机浏览器打开桌面宿主，从而在手机上用同一张角色卡、同一份对话。

它不是公网服务，也不走任何第三方中转——**手机 ↔ 你的电脑，局域网内直连**。

## 为什么需要它

DSH 宿主默认只监听 `127.0.0.1`，手机打不开。插件在 `0.0.0.0` 上另起一个端口，把请求转发给本机宿主：

```
手机浏览器 ──HTTP──► 0.0.0.0:<LAN 端口> ──HTTP──► 127.0.0.1:<DSH Web 端口>
                     （口令校验 + 补 DSH 会话 cookie + WebSocket 透传）
```

两件事必须同时成立，手机才进得去：

1. **口令**：局域网桥自己的一道门（`dsh_lan` cookie），防止同网段任何人都能连；
2. **DSH 会话**：宿主本身要求 `/dsh-auth` cookie。桥会用宿主暴露的 `connection.authenticatedUrl()` 在**服务端**换一份会话 cookie，再把它补给手机。

第 2 步是桥最容易失败的地方——如果宿主没暴露 `connection` 服务，或者拿不到带 token 的地址，口令输对了也只会停在口令页，页面上会写明原因。

## 开启

左侧栏「角色卡」→ 面板底部「手机访问」→「开启」。

开启后区块里会出现：

- 二维码（二维码里就是解锁链接）；
- 一条 `http://192.168.x.x:8790/` 形式的地址（有多张网卡时会列出多条，挑你手机能通的那条）;
- 「复制链接」「换口令」「关闭」。

手机扫码 → 页面只有一个输入框（口令自动带在链接里时直接过）→ 解锁成功后会下发 30 天有效的 cookie，**下次打开不用再输**。

## 端口

- 默认从 `8790` 开始，被占用就顺延 10 个（`8790`–`8799`），全被占用则交给系统分配一个空闲端口。
- 实际端口回写到 `~/.dsh/dsh-role-card/lan.json`，所以下次开启还是同一个端口——手机书签不会失效。
- 想指定端口：`POST /api/dsh-role-card/lan/start` 带 `{"port": 8900}`；`{"port": 0}` 表示让系统分配。
- 检查端口是否已开：`curl http://127.0.0.1:<端口>/__lan/ping` → `{"ok":true,"service":"dsh-role-card-lan"}`。

## 口令

- 口令是一次 `randomBytes(18).toString('base64url')` 生成的 24 字符串，`timingSafeEqual` 比较，不做长度/前缀短路。
- 解锁成功后下发 `dsh_lan=<token>; Path=/; Max-Age=<30天>; HttpOnly; SameSite=Lax`。
- 「换口令」会立刻作废旧口令，并把新口令落盘——所以**已经连上的手机会全部掉线**，需要重新扫新二维码。
- 口令与端口存在 `~/.dsh/dsh-role-card/lan.json`（`{ "token": "…", "port": 8790 }`），路径可用 `DSH_ROLE_CARD_LAN_STATE` 覆盖。它**不会**上传到任何地方，但它是本机明文文件：别人能读你的用户目录就能读它，等同于能读 `state.json`。

## 二维码

二维码由 `qrcode` 模块渲染成内联 SVG（240px、margin 1、纠错级别 M）。宿主里没有 `qrcode` 时不会报错，面板只显示链接并提示「没有可用的 qrcode 模块…直接复制链接即可」——功能不受影响。

想装上就装到 profile 里：

```bash
# 在 profile 目录（如 ~/.dsh/profiles/desktop）下
npm install qrcode
```

插件会先用 `createRequire` 从 `DSH_PROFILE_DIR` / `~/.dsh/profiles/<DSH_PROFILE||desktop>/package.json` 解析，再尝试裸 `import('qrcode')`。

## 关闭

「关闭」→ `POST /lan/stop`：销毁所有 TCP socket、关闭监听、**删掉 `dsh_lan` cookie 的效力**（下次开启若沿用同一口令，旧 cookie 还能用；想彻底断掉就点「换口令」）。

宿主退出时桥随 `effect` 一起卸载，端口自动释放。**桥只在面板开启期间监听**，不会在后台常驻。

## 排错

| 现象 | 原因 | 处理 |
|---|---|---|
| 手机打不开链接 | 不在同一 WiFi / 路由器开了 AP 隔离 / 防火墙拦了入站 | 关 AP 隔离；macOS 放行 node 的入站连接；Windows 放行专用网络 |
| 打开是「无法访问此网站」 | 端口没监听（桥已停）或 IP 选错（多网卡/VPN/虚拟网卡） | 面板里换另一条地址试；确认面板显示「已开启」 |
| 口令页一直提示口令不对 | 口令已 rotate，或手机上是旧书签的旧 `?t=` | 重新扫当前二维码 |
| 口令对，但仍在口令页且页面说明「宿主没有暴露 connection 服务」 | 宿主版本没提供 `connection.authenticatedUrl()`，桥换不到 DSH 会话 cookie | 升级宿主；或直接用桌面端 |
| 口令对，页面说明「本站没下发 dsh-auth cookie」 | 宿主 Web 端会话校验方式变了 | 同上，看 `authNote` |
| 页面能开但角色不出字 | 手机侧 SSE/WebSocket 被中间设备拦截（企业代理、部分路由器「上网保护」） | 关掉该功能；确认 `/__lan/ping` 通 |
| 端口全被占用 | 8790–8799 都被占 | 指定其他端口，或 `{"port":0}` 让系统分配 |
| 二维码是空的 | 宿主里没有 `qrcode` | 复制链接；或按上面装 `qrcode` |

面板「手机访问」区块的说明文字会直接显示 `authNote`，多数情况下看那一行就知道卡在哪一步。

## 安全边界

这张表请如实理解，别把它当成「内网所以无所谓」：

| 项 | 实际情况 |
|---|---|
| 监听地址 | `0.0.0.0`，**同网段任何设备都能连到端口** |
| 未认证请求 | 返回 401 + 口令页，看不到任何对话内容 |
| 传输加密 | **没有**。局域网内是明文 HTTP。同网段的抓包者能看到对话内容 |
| 认证强度 | 单一口令，无限速、无锁定；口令 24 字符随机，爆破不现实，但**泄露即通行** |
| cookie | `HttpOnly` + `SameSite=Lax`，30 天有效；没有 `Secure`（因为明文 HTTP） |
| DSH 会话 | 桥在服务端持有宿主会话 cookie 并代填；手机本身不接触宿主 token |
| 口令落盘 | 是，`~/.dsh/dsh-role-card/lan.json` |
| 公网暴露 | 没有内建隧道，也不该自己往外映射。要在外网用，请走你自己的 VPN（WireGuard/Tailscale 之类），别把端口直接映射到公网 |

**在公共 WiFi（咖啡厅、酒店、机场）不要开。** 明文 HTTP 意味着同网段的任何人都能读到你和角色的对话——而这份对话正是你最不想被读到的东西。

## 相关环境变量

| 变量 | 作用 |
|---|---|
| `DSH_ROLE_CARD_LAN_STATE` | 覆盖 `lan.json` 路径（默认 `~/.dsh/dsh-role-card/lan.json`） |
| `DSH_PROFILE` / `DSH_PROFILE_DIR` | 用于定位 profile 目录里的 `qrcode` 模块 |
| `DSH_WEB_URL` | 宿主没暴露端口信息时，用它解析本机 Web 端口（默认 `11901`） |

## 相关端点

```http
GET  /api/dsh-role-card/lan            # 状态：running / port / token / target / startedAt / urls[] / qr / authBridge / authNote
POST /api/dsh-role-card/lan/start      # { port? } 开启（0 = 让系统分配）
POST /api/dsh-role-card/lan/stop       # 关闭
POST /api/dsh-role-card/lan/rotate     # 换口令（踢掉所有手机）

# 桥自身的路径（不带 /api/dsh-role-card 前缀）
GET  /__lan/unlock?t=<口令>&next=/     # 解锁，成功后下发 dsh_lan cookie
GET  /__lan/ping                       # 健康检查，无需口令
```

细节见 [`API.md`](API.md)。
