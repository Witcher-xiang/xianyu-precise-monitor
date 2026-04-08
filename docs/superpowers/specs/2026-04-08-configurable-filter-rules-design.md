# Configurable Filter Rules Design

## Overview

将现有硬编码的商品筛选规则（FILTER_PROMPT）改为可配置系统。用户通过 CLI 交互式输入规则，用样本数据校准，LLM 辅助优化规则，并自动积累测试用例进行回归验证。

## 方案选择

采用方案 B：agent.ts 内集成子命令。配置、校准、测试、监控共用一个入口。

## 1. 规则数据结构 & 存储

规则存储在 `.cache/rules.json`：

```json
{
  "keyword": "指尖模室",
  "description": "用户只想找"指尖模室"品牌的 1/72 比例成品载具模型",
  "rules": [
    "必须是"指尖模室"品牌出品（不是其他品牌蹭 tag）",
    "必须是 1/72 比例（排除 1/48、1/35 等）",
    "必须是成品模型，排除拼装套件",
    "必须是载具，排除地台、场景、配件"
  ],
  "filters": {
    "minPrice": null,
    "maxPrice": 300,
    "regions": ["广东", "浙江"]
  },
  "testCases": [
    {
      "title": "指尖模室 1/72 T-72B 主战坦克 成品模型",
      "price": "158",
      "description": "免胶免拼",
      "seller": "指尖模室官方店",
      "expectedMatch": true,
      "addedAt": "2026-04-08"
    }
  ]
}
```

- `filters` 所有字段可选：`minPrice`/`maxPrice` 为价格区间（null 表示不限），`regions` 为地区白名单（空数组或不填表示不限）
- 没有 `rules.json` 时，使用现有硬编码规则作为默认值（向后兼容）
- `testCases` 在校准过程中由用户标记自动积累

## 2. 子命令 & 交互流程

### 命令入口

```
npx tsx agent.ts              ← 默认：正常监控（现有行为）
npx tsx agent.ts setup        ← 配置规则（交互式引导）
npx tsx agent.ts test         ← 跑测试用例回归验证
npx tsx agent.ts calibrate    ← 抓样本数据校准规则
```

### setup 流程

```
$ npx tsx agent.ts setup

> 搜索关键词 [指尖模室]:
> 用一句话描述你想找什么商品: 指尖模室 1/72 成品坦克模型
> 输入筛选规则（每行一条，空行结束）:
  1. 必须是"指尖模室"品牌
  2. 必须是 1/72 比例
  3. 必须是成品模型

> 最低价格（留空不限）:
> 最高价格（留空不限）: 300
> 地区过滤（逗号分隔，留空不限）:

✅ 规则已保存到 .cache/rules.json
💡 运行 npx tsx agent.ts calibrate 可以抓取样本数据校准规则
```

### calibrate 流程

```
$ npx tsx agent.ts calibrate

🔍 正在抓取"指尖模室"的商品数据...
获取到 15 条商品，用当前规则筛选中...

  1. ✅ 命中 | 指尖模室 1/72 T-72B 成品  ¥158
  2. ❌ 跳过 | 指尖模室 1/48 豹2A6 拼装  ¥89   → 比例不符+拼装件
  3. ✅ 命中 | 指尖模室 1/72 M1A2 成品    ¥168
  4. ❌ 跳过 | 某品牌 类似指尖模室风格     ¥200  → 非指尖模室品牌
  ...

有判断错误的吗？输入序号修正（如 "1 错" 或 "4 对"），输入 done 结束:
> 1 错
> done

📝 已记录 1 条修正，正在让 LLM 优化规则...

LLM 建议修改：
  规则 1: "必须是"指尖模室"品牌" → "必须是"指尖模室"品牌，且为正品官方出品"

接受优化？(y/n/手动编辑): y
✅ 规则已更新，修正的商品已加入测试用例
```

### test 流程

```
$ npx tsx agent.ts test

🧪 运行 6 条测试用例...
  1. ✅ PASS | 指尖模室 1/72 T-72B → 期望命中，实际命中
  2. ✅ PASS | 1/48 豹2A6 拼装 → 期望跳过，实际跳过
  3. ❌ FAIL | ... → 期望命中，实际跳过

结果: 5/6 通过，1 条失败
```

## 3. 代码架构

从 `agent.ts` 拆分为多个模块：

```
agent.ts          ← 入口：解析子命令，分发到对应模块
├── monitor.ts    ← 现有的监控循环逻辑（从 agent.ts 抽出）
├── setup.ts      ← setup 交互式配置
├── calibrate.ts  ← calibrate 校准流程
├── test.ts       ← test 测试用例运行
├── rules.ts      ← 规则的读取/保存/生成 prompt 等公共逻辑
├── filter.ts     ← LLM 筛选（从 agent.ts 抽出 filterListing）
├── notify.ts     ← 飞书 + Telegram 通知（从 agent.ts 抽出）
├── fetcher.ts    ← 不变
└── mock_data.ts  ← 不变
```

`agent.ts` 变为薄入口：

```typescript
const command = process.argv[2];

switch (command) {
  case "setup":     await runSetup(); break;
  case "calibrate": await runCalibrate(); break;
  case "test":      await runTest(); break;
  default:          await runMonitor(); break;
}
```

`rules.ts` 核心职责：
- `loadRules()` — 读 `.cache/rules.json`，不存在则返回内置默认规则
- `saveRules()` — 写入文件
- `buildFilterPrompt(rules)` — 把规则数据结构转成 LLM system prompt
- `applyHardFilters(listing, filters)` — 价格/地区等硬过滤（在 LLM 筛选之前执行，省 token）

## 4. LLM 规则优化机制

calibrate 时用户标记误判后，LLM 分析并建议优化：

### 输入

```typescript
const optimizePrompt = `你是筛选规则优化助手。以下是当前规则和用户标记的误判案例。
请分析误判原因，给出优化后的规则。

当前规则：
${rules.join('\n')}

误判案例：
${corrections.map(c =>
  `商品: ${c.title} ¥${c.price} | 当前判断: ${c.currentResult} | 正确应该: ${c.expected} | 原因: ${c.reason}`
).join('\n')}

要求：
1. 只修改需要改的规则，不要动没问题的
2. 返回完整的规则列表（JSON 数组）
3. 附上每条修改的理由
`;
```

### 返回格式

```json
{
  "rules": ["优化后的规则1", "规则2不变", "新增的规则3"],
  "changes": [
    {"index": 0, "reason": "原规则太宽泛，加了 xxx 限制"}
  ]
}
```

### 用户确认环节

LLM 输出优化建议后，展示 diff 给用户：
- `y` — 接受全部
- `n` — 放弃，保持原规则
- 手动输入 — 用户自己改

规则的最终决定权始终在用户手里，不会跳过确认直接保存。

## 5. 测试用例自动积累

### 积累来源

- **calibrate 时** — 用户标记对/错的商品自动存入 `testCases`
- **正常监控时不自动积累** — 避免噪音，只有用户主动确认的才算

### 测试运行机制

`npx tsx agent.ts test` 时：
1. 遍历 `testCases`，每条先跑 `applyHardFilters()`（价格/地区），不通过直接算不匹配
2. 通过硬过滤的调一次 LLM `filterListing()`
3. 对比 `expectedMatch` 和实际结果
4. 输出 PASS/FAIL，最终汇总通过率

### 测试用例管理

- 不设硬上限，超过 30 条时提示用户可以清理旧的
- 每条测试都要调 LLM，太多会慢且费 token
