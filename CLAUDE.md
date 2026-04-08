# 闲鱼指尖模室监控 Agent

## 项目概述

定时监控闲鱼平台"指尖模室"品牌商品上新，用 LLM 筛选出符合条件的商品，通过飞书和 Telegram 同时推送通知。

## 技术栈

- TypeScript + ESM
- Anthropic SDK（LLM 筛选）
- Puppeteer + Stealth 插件（闲鱼爬虫）
- 飞书 SDK（通知）
- Telegram Bot API（通知）

## 文件结构

- `agent.ts` — 核心入口。定时循环 + LLM 筛选 + 通知分发
- `fetcher.ts` — 闲鱼爬虫。Puppeteer 打开搜索页，拦截 API 或解析 DOM 提取商品
- `mock_data.ts` — 模拟数据。10 条覆盖各种场景的假商品，开发调试用
- `.env` — 环境变量（不提交）。API key、飞书/Telegram 配置
- `.cache/` — 运行时缓存（不提交）。cookies.json + seen_items.json

## 筛选规则

品牌：指尖模室（排除蹭 tag 的其他品牌）
比例：只要 1/72（排除 1/48、1/35 等）
类型：成品载具模型（排除地台、场景、配件、拼装件）

## 运行方式

```
cp .env.example .env   # 填入真实配置
npm install
npx tsx agent.ts       # 首次运行会弹浏览器登录闲鱼
```

## 数据源切换

agent.ts 第 25 行 `USE_REAL_DATA`：
- `true` — 用 Puppeteer 爬闲鱼真实数据
- `false` — 用 mock_data.ts 假数据（调试用）

## 通知渠道

飞书和 Telegram 同时推送，哪个配了就发哪个。都没配只打印终端日志。

## 注意事项

- 闲鱼需要登录，首次运行会弹出浏览器手动登录，cookies 保存在 .cache/cookies.json
- cookies 过期后删掉 .cache/cookies.json 重新登录
- .env 里包含 API key 和 token，不要提交到 git
