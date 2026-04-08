# 闲鱼精准商品监控 Agent

可配置规则 + LLM 智能筛选的闲鱼商品监控工具。定时爬取闲鱼商品，通过 Claude LLM 筛选符合条件的商品，自动推送飞书 / Telegram 通知。

## 工作流程

```
配置规则 (setup) → 抓取商品(按最新排序) → 上新检测(24h内) → 硬过滤(价格/地区) → LLM 智能筛选 → 飞书/Telegram 通知
                                ↑                                                                          |
                                └──────────────── 定时循环（默认 5 分钟）────────────────────────────────────┘

校准规则 (calibrate) → 抓样本 → LLM 筛选 → 人工纠错(自由描述原因) → LLM 优化规则 → 回归测试 (test)
```

## 快速开始

### 1. 安装

```bash
git clone <repo-url>
cd xianyu-precise-monitor
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`，填入实际配置：

| 变量 | 必填 | 说明 |
|------|------|------|
| `ANTHROPIC_API_KEY` | 是 | Claude API 密钥 |
| `ANTHROPIC_BASE_URL` | 否 | API 地址，默认 `https://api.anthropic.com` |
| `MODEL_ID` | 否 | 模型 ID，默认 `claude-sonnet-4-6` |
| `FEISHU_APP_ID` | 否* | 飞书应用 App ID |
| `FEISHU_APP_SECRET` | 否* | 飞书应用 App Secret |
| `FEISHU_CHAT_ID` | 否* | 飞书目标群聊 ID |
| `FEISHU_BASE_DOMAIN` | 否 | 飞书 API 域名，默认 `https://open.feishu.cn` |
| `TG_BOT_TOKEN` | 否* | Telegram Bot Token |
| `TG_CHAT_ID` | 否* | Telegram 聊天 ID |
| `CHECK_INTERVAL` | 否 | 监控间隔（毫秒），默认 `300000`（5 分钟） |

> *飞书和 Telegram 至少配一个，否则只在终端打印日志。

### 3. 配置筛选规则（可选）

```bash
npx tsx agent.ts setup
```

交互式配置搜索关键词、筛选规则、价格范围、地区过滤等。规则保存到 `.cache/rules.json`。

不运行 setup 则使用内置示例规则模板，首次需要通过 `setup` 配置你自己的搜索关键词和筛选规则。

### 4. 启动监控

```bash
npx tsx agent.ts
```

- 首次运行会弹出浏览器窗口，手动登录闲鱼账号，登录后 cookies 保存在 `.cache/cookies.json`
- 首次运行只记录当前商品作为基线，不发送通知
- 后续运行自动使用无头模式，只通知 24 小时内发布的新商品

## 命令一览

| 命令 | 说明 |
|------|------|
| `npx tsx agent.ts` | 启动监控循环 |
| `npx tsx agent.ts setup` | 交互式配置筛选规则 |
| `npx tsx agent.ts calibrate` | 校准模式：抓样本 → LLM 筛选 → 人工纠错 → 优化规则 |
| `npx tsx agent.ts test` | 回归测试：用已保存的测试用例验证当前规则 |

也可以用 npm scripts：

```bash
npm start   # 等同于 npx tsx agent.ts
npm run dev # 开发模式，文件变更自动重启
```

## 规则校准

通过 `calibrate` 命令迭代优化筛选规则：

1. 抓取一批样本商品
2. LLM 按当前规则筛选，展示结果
3. 人工标注哪些判断错误，说明原因（如 `1 这个是拼装件不是成品`）
4. LLM 根据纠错样本和你的解释自动优化规则
5. 运行 `test` 验证优化后的规则没有引入回归

## 项目结构

```
├── agent.ts              # CLI 入口，子命令分发
├── src/
│   ├── monitor.ts        # 监控主循环
│   ├── fetcher.ts        # 闲鱼爬虫（Puppeteer + Stealth）
│   ├── filter.ts         # LLM 筛选（Claude API）
│   ├── rules.ts          # 规则定义、持久化、硬过滤
│   ├── notify.ts         # 飞书 + Telegram 通知
│   ├── setup.ts          # 交互式规则配置
│   ├── calibrate.ts      # 规则校准
│   ├── test.ts           # 回归测试
│   └── mock_data.ts      # 模拟数据（调试用）
├── .cache/               # 运行时缓存（不提交）
│   ├── cookies.json      # 闲鱼登录 cookies
│   ├── seen_items.json   # 已处理商品 ID + 时间戳（7 天自动过期）
│   └── rules.json        # 筛选规则配置
└── .env                  # 环境变量（不提交）
```

## 支持的 LLM

目前仅支持 Anthropic Claude 系列模型，通过 `MODEL_ID` 环境变量指定：

| 模型 | 说明 |
|------|------|
| `claude-sonnet-4-6` | 默认，性价比高，推荐日常监控使用 |
| `claude-haiku-4-5-20251001` | 更快更便宜，适合高频监控 |
| `claude-opus-4-6` | 最强，筛选更准但成本较高 |

支持通过 `ANTHROPIC_BASE_URL` 配置兼容 API 的第三方代理。

## Roadmap

### 体验优化

- [ ] 多关键词并行监控 — 支持多组关键词 + 规则同时运行
- [ ] Web 管理面板 — 浏览器配置规则、查看监控历史、开关监控
- [ ] 每日摘要推送 — 每天汇总新增商品数、命中数、价格分布

### 能力增强

- [ ] 图片识别 — 利用 Claude 视觉能力分析商品图片（区分成品/板件、判断品相）
- [ ] 价格追踪 — 同一商品降价自动提醒，记录价格曲线
- [ ] 通知带商品首图 — 推送消息附带商品主图，无需点开链接即可判断

## 注意事项

- 闲鱼 cookies 过期后删除 `.cache/cookies.json`，重新运行会弹出浏览器登录
- `.env` 包含 API Key 和 Token，不要提交到 Git
- 监控模式下用 `Ctrl+C` 可安全退出
