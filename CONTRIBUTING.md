# 参与贡献

先谢谢你有兴趣。这个项目很小，规矩也少，只要别让它变复杂。

## 先聊聊

- **Bug**：直接开 issue，用 `Bug report` 模板。请贴：DSH 版本、Node 版本、操作系统、复现步骤、宿主日志里 `[dsh-role-card]` 开头的相关行。
- **新功能**：先开 issue 说清楚「你想解决什么问题」，别一上来就贴 800 行 diff。角色卡插件的功能面很容易膨胀，先对齐再写。
- **安全问题**：不要开公开 issue，按 [SECURITY.md](SECURITY.md) 私下报告。

## 开发环境

```bash
git clone https://github.com/yugege123/dsh-role-card.git
cd dsh-role-card
npm run check          # 语法 + 导出 + 提示词契约冒烟
```

把本仓库 link 进你的 DSH profile 才能实机验证：

```json
"dsh-role-card": "link:/absolute/path/to/dsh-role-card"
```

`dependencies` 加完、`dsh.profile.bundles` 里加上 `dsh-role-card`、`pnpm install`、重启宿主，侧栏就会出现面板。

## 代码约定

- **零运行时依赖**。宿主半只用 `node:` 内置模块，浏览器半只用宿主注入的 `react`。加依赖前先证明没有它也能写。
- **ESM + 2 空格缩进 + 单引号 + 无分号**（跟 `index.js` 现有风格保持一致，别整文件重排）。
- **注释写「为什么」，不写「做了什么」**。`index.js` 里那些解释历史决策的注释（为什么从 Agent 路线换成直连、为什么写入要串行）是有价值的，改动时不要顺手删。
- **注释与界面文案用中文**，标识符和日志用英文。
- **宿主半只碰 `ctx` 暴露的服务**：`llm`、`agents`、`slots`、`systemPrompt`、API 前缀路由。不要 monkey-patch 宿主内部对象。
- **客户端半是单文件**：`client.js` 通过 `window.__ModuleLoader__.load(...)` 交付，不要引入构建步骤，也不要用 JSX（用 `React.createElement`）。
- **数据格式向后兼容**：`state.json` 加字段必须给默认值，老卡读进来要能正常演。破坏性变更走版本号。
- **不写遥测**、不加外部请求、不在代码里留个人路径或密钥。

## 提交

提交信息用 Conventional Commits 风格，一句说清做了什么：

```
feat(novel): 支持从章节页直接定位目录
fix(chat): 串行化同卡写入，避免 Windows EPERM
docs(readme): 补手机访问的口令说明
```

一个 PR 只做一件事。改到 `index.js` 的行为时，请在 PR 描述里写清「改之前怎样、改之后怎样、怎么验证的」。

## 提交前自检

- [ ] `npm run check` 通过
- [ ] 实机跑过你改到的那条路径（列表 / 编辑 / 对话 / 导入 / 扩写 / 小说 / 手机）
- [ ] 没有提交 `state.json`、`chat/`、`novels/`、`.bak-*` 或任何个人数据
- [ ] 新增的面向用户的文案是中文，且出现在 README 的相关章节里
- [ ] 如果你改了提示词契约，同步更新 `docs/PROMPT-CONTRACT.md`

## 许可

提交 PR 即表示你同意以 [MIT](LICENSE) 许可贡献你的代码。
