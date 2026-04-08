# Configurable Filter Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded FILTER_PROMPT in agent.ts with a configurable rule system that supports CLI setup, LLM-assisted calibration, and auto-accumulated test cases.

**Architecture:** Split agent.ts into focused modules (rules.ts, filter.ts, notify.ts, monitor.ts, setup.ts, calibrate.ts, test.ts). The thin agent.ts entry point parses subcommands and dispatches. Rules persist in `.cache/rules.json` with backward-compatible defaults.

**Tech Stack:** TypeScript + ESM, Node.js readline for CLI interaction, Anthropic SDK for LLM filtering and rule optimization, existing Puppeteer fetcher unchanged.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `rules.ts` | Rule types, load/save `.cache/rules.json`, `buildFilterPrompt()`, `applyHardFilters()`, default rules |
| `filter.ts` | Anthropic client setup, `filterListing()` using dynamic prompt from rules |
| `notify.ts` | `sendFeishu()`, `sendTelegram()`, `notify()` — extracted from agent.ts unchanged |
| `monitor.ts` | `runMonitor()` — the existing check loop + persistence, using rules/filter/notify |
| `setup.ts` | `runSetup()` — interactive CLI to configure rules |
| `calibrate.ts` | `runCalibrate()` — fetch samples, LLM filter, user corrections, LLM optimize |
| `test.ts` | `runTest()` — run test cases against current rules |
| `agent.ts` | Thin entry: parse `process.argv[2]`, dispatch to the right module |
| `fetcher.ts` | Unchanged |
| `mock_data.ts` | Unchanged (but `Listing` type will be imported from here by all modules) |

---

### Task 1: Create `rules.ts` — types, load/save, defaults

**Files:**
- Create: `rules.ts`

- [ ] **Step 1: Define types and default rules**

```typescript
// rules.ts
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

export interface Filters {
  minPrice?: number | null;
  maxPrice?: number | null;
  regions?: string[];
}

export interface TestCase {
  title: string;
  price: string;
  description: string;
  seller: string;
  expectedMatch: boolean;
  addedAt: string;
}

export interface RulesConfig {
  keyword: string;
  description: string;
  rules: string[];
  filters: Filters;
  testCases: TestCase[];
}

const CACHE_DIR = join(process.cwd(), ".cache");
const RULES_FILE = join(CACHE_DIR, "rules.json");

const DEFAULT_RULES: RulesConfig = {
  keyword: "指尖模室",
  description: '用户只想找"指尖模室"品牌的 1/72 比例成品载具模型',
  rules: [
    '必须是"指尖模室"品牌出品（不是其他品牌蹭 tag、标题提到"类似指尖模室"或"媲美指尖模室"的都不算）',
    "必须是 1/72 比例（排除 1/48、1/35、1/144 等其他比例）",
    "必须是成品模型（免胶免拼、开盒即摆），排除需要自己组装的拼装套件/板件/白模",
    "必须是载具（坦克、装甲车、步兵战车、自行火炮等军事载具），排除地台、场景、人偶、配件、蚀刻片、履带替换件",
  ],
  filters: {},
  testCases: [],
};
```

- [ ] **Step 2: Implement `loadRules()` and `saveRules()`**

Add to `rules.ts`:

```typescript
export function loadRules(): RulesConfig {
  try {
    if (existsSync(RULES_FILE)) {
      const data = JSON.parse(readFileSync(RULES_FILE, "utf-8"));
      return { ...DEFAULT_RULES, ...data };
    }
  } catch {}
  return { ...DEFAULT_RULES };
}

export function saveRules(config: RulesConfig): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(RULES_FILE, JSON.stringify(config, null, 2), "utf-8");
}
```

- [ ] **Step 3: Implement `buildFilterPrompt()`**

Add to `rules.ts`:

```typescript
export function buildFilterPrompt(config: RulesConfig): string {
  const rulesText = config.rules
    .map((r, i) => `${i + 1}. ${r}`)
    .join("\n");

  return `你是一个商品筛选助手。${config.description}

判断规则：
${rulesText}

请严格按规则判断，只返回一行 JSON，不要其他内容：
{"match": true或false, "reason": "简短理由"}`;
}
```

- [ ] **Step 4: Implement `applyHardFilters()`**

Add to `rules.ts`:

```typescript
import type { Listing } from "./mock_data.js";

export function applyHardFilters(listing: Listing, filters: Filters): { pass: boolean; reason?: string } {
  if (filters.minPrice != null && listing.price < filters.minPrice) {
    return { pass: false, reason: `价格 ¥${listing.price} 低于最低 ¥${filters.minPrice}` };
  }
  if (filters.maxPrice != null && listing.price > filters.maxPrice) {
    return { pass: false, reason: `价格 ¥${listing.price} 超过最高 ¥${filters.maxPrice}` };
  }
  if (filters.regions && filters.regions.length > 0) {
    const text = `${listing.title} ${listing.description} ${listing.seller}`.toLowerCase();
    const matched = filters.regions.some((r) => text.includes(r.toLowerCase()));
    if (!matched) {
      return { pass: false, reason: `不在目标地区: ${filters.regions.join(", ")}` };
    }
  }
  return { pass: true };
}
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit rules.ts`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add rules.ts
git commit -m "feat: add rules.ts with types, load/save, prompt builder, hard filters"
```

---

### Task 2: Create `filter.ts` — LLM filtering extracted from agent.ts

**Files:**
- Create: `filter.ts`

- [ ] **Step 1: Create filter.ts with Anthropic client and filterListing**

```typescript
// filter.ts
import Anthropic from "@anthropic-ai/sdk";
import "dotenv/config";
import type { Listing } from "./mock_data.js";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: process.env.ANTHROPIC_BASE_URL,
});

export const MODEL = process.env.MODEL_ID || "claude-sonnet-4-6";

export interface FilterResult {
  match: boolean;
  reason: string;
}

export async function filterListing(
  listing: Listing,
  systemPrompt: string
): Promise<FilterResult> {
  const userMessage = `请判断这个商品是否符合要求：

标题：${listing.title}
价格：${listing.price}元
描述：${listing.description}
卖家：${listing.seller}`;

  try {
    const response = await client.messages.create({
      model: MODEL,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      max_tokens: 200,
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return { match: false, reason: "LLM 返回格式异常" };
  } catch (e: any) {
    console.error(`  筛选出错: ${e.message}`);
    return { match: false, reason: `筛选出错: ${e.message}` };
  }
}
```

- [ ] **Step 2: Add `optimizeRules()` for calibration LLM calls**

Add to `filter.ts`:

```typescript
interface OptimizeResult {
  rules: string[];
  changes: { index: number; reason: string }[];
}

export interface Correction {
  title: string;
  price: number;
  currentResult: boolean;
  expected: boolean;
  reason: string;
}

export async function optimizeRules(
  currentRules: string[],
  corrections: Correction[]
): Promise<OptimizeResult> {
  const prompt = `你是筛选规则优化助手。以下是当前规则和用户标记的误判案例。
请分析误判原因，给出优化后的规则。

当前规则：
${currentRules.map((r, i) => `${i + 1}. ${r}`).join("\n")}

误判案例：
${corrections
  .map(
    (c) =>
      `商品: ${c.title} ¥${c.price} | 当前判断: ${c.currentResult ? "命中" : "跳过"} | 正确应该: ${c.expected ? "命中" : "跳过"} | 原因: ${c.reason}`
  )
  .join("\n")}

要求：
1. 只修改需要改的规则，不要动没问题的
2. 返回完整的规则列表（JSON 数组）
3. 附上每条修改的理由

只返回 JSON，不要其他内容：
{"rules": ["规则1", "规则2", ...], "changes": [{"index": 0, "reason": "修改理由"}]}`;

  try {
    const response = await client.messages.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1000,
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e: any) {
    console.error(`  规则优化出错: ${e.message}`);
  }

  return { rules: currentRules, changes: [] };
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit filter.ts`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add filter.ts
git commit -m "feat: add filter.ts with LLM filtering and rule optimization"
```

---

### Task 3: Create `notify.ts` — notification logic extracted from agent.ts

**Files:**
- Create: `notify.ts`

- [ ] **Step 1: Create notify.ts with sendFeishu, sendTelegram, notify**

Extract lines 118-224 from `agent.ts` into `notify.ts`. The code is unchanged except for imports:

```typescript
// notify.ts
import * as Lark from "@larksuiteoapi/node-sdk";
import "dotenv/config";
import type { Listing } from "./mock_data.js";

const FEISHU_CHAT_ID = process.env.FEISHU_CHAT_ID || "";
const larkClient = new Lark.Client({
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET,
  domain: process.env.FEISHU_BASE_DOMAIN || "https://open.feishu.cn",
});

const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN || "";
const TG_CHAT_ID = process.env.TG_CHAT_ID || "";

async function sendFeishu(listing: Listing, reason: string): Promise<void> {
  if (!FEISHU_CHAT_ID) {
    console.log(`  [飞书] 未配置 FEISHU_CHAT_ID，跳过通知`);
    console.log(`  → 标题: ${listing.title}`);
    console.log(`  → 价格: ¥${listing.price}`);
    console.log(`  → 理由: ${reason}`);
    return;
  }

  const card = {
    header: {
      title: { tag: "plain_text" as const, content: "商品上新提醒" },
      template: "green" as const,
    },
    elements: [
      {
        tag: "div" as const,
        text: {
          tag: "lark_md" as const,
          content: [
            `**${listing.title}**`,
            `价格：¥${listing.price}`,
            `卖家：${listing.seller}`,
            `${listing.description.slice(0, 100)}`,
            `命中理由：${reason}`,
          ].join("\n"),
        },
      },
      {
        tag: "action" as const,
        actions: [
          {
            tag: "button" as const,
            text: { tag: "plain_text" as const, content: "去闲鱼查看" },
            url: listing.url,
            type: "primary" as const,
          },
        ],
      },
    ],
  };

  try {
    await larkClient.im.v1.message.create({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: FEISHU_CHAT_ID,
        content: JSON.stringify(card),
        msg_type: "interactive",
      },
    });
    console.log(`  [飞书] 通知已发送: ${listing.title}`);
  } catch (e: any) {
    console.error(`  [飞书] 发送失败: ${e.message}`);
  }
}

async function sendTelegram(listing: Listing, reason: string): Promise<void> {
  if (!TG_BOT_TOKEN || !TG_CHAT_ID) {
    return;
  }

  const text = [
    `*商品上新提醒*`,
    ``,
    `*${listing.title}*`,
    `价格：¥${listing.price}`,
    `卖家：${listing.seller}`,
    `${listing.description.slice(0, 100)}`,
    `命中理由：${reason}`,
    ``,
    `[去闲鱼查看](${listing.url})`,
  ].join("\n");

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TG_CHAT_ID,
          text,
          parse_mode: "Markdown",
        }),
      }
    );
    if (res.ok) {
      console.log(`  [Telegram] 通知已发送: ${listing.title}`);
    } else {
      console.error(
        `  [Telegram] 发送失败: ${res.status} ${await res.text()}`
      );
    }
  } catch (e: any) {
    console.error(`  [Telegram] 请求出错: ${e.message}`);
  }
}

export async function notify(listing: Listing, reason: string): Promise<void> {
  await Promise.all([
    sendFeishu(listing, reason),
    sendTelegram(listing, reason),
  ]);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit notify.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add notify.ts
git commit -m "feat: extract notify.ts from agent.ts (feishu + telegram)"
```

---

### Task 4: Create `monitor.ts` — monitoring loop extracted from agent.ts

**Files:**
- Create: `monitor.ts`

- [ ] **Step 1: Create monitor.ts with runMonitor**

Extract the check loop, seen-IDs persistence, and main startup logic from `agent.ts`:

```typescript
// monitor.ts
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import "dotenv/config";

import { fetchMockListings, type Listing } from "./mock_data.js";
import { fetchListings as fetchRealListings, closeBrowser } from "./fetcher.js";
import { loadRules, buildFilterPrompt, applyHardFilters } from "./rules.js";
import { filterListing, MODEL } from "./filter.js";
import { notify } from "./notify.js";

const USE_REAL_DATA = true;
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL || "300000");
const CACHE_DIR = join(process.cwd(), ".cache");
const SEEN_FILE = join(CACHE_DIR, "seen_items.json");

function loadSeenIds(): Set<string> {
  try {
    if (existsSync(SEEN_FILE)) {
      const data = JSON.parse(readFileSync(SEEN_FILE, "utf-8"));
      return new Set(data);
    }
  } catch {}
  return new Set();
}

function saveSeenIds(ids: Set<string>): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(SEEN_FILE, JSON.stringify([...ids], null, 2));
}

async function checkOnce(): Promise<void> {
  const timestamp = new Date().toLocaleString("zh-CN");
  const config = loadRules();
  const systemPrompt = buildFilterPrompt(config);

  console.log(`\n[${timestamp}] 开始检查...`);

  const listings = USE_REAL_DATA
    ? await fetchRealListings(config.keyword)
    : fetchMockListings();
  console.log(`  获取到 ${listings.length} 条商品`);

  const seenIds = loadSeenIds();
  const newListings = listings.filter((item) => !seenIds.has(item.id));
  console.log(`  其中 ${newListings.length} 条是新的`);

  if (newListings.length === 0) {
    console.log("  没有新商品，跳过");
    return;
  }

  let matchCount = 0;
  for (const listing of newListings) {
    // Hard filters first (price, region)
    const hardResult = applyHardFilters(listing, config.filters);
    if (!hardResult.pass) {
      console.log(`  ⏭️ 硬过滤跳过: ${listing.title.slice(0, 30)}... → ${hardResult.reason}`);
      seenIds.add(listing.id);
      continue;
    }

    const result = await filterListing(listing, systemPrompt);

    if (result.match) {
      matchCount++;
      await notify(listing, result.reason);
    }

    seenIds.add(listing.id);
  }

  saveSeenIds(seenIds);
  console.log(`  本轮完成: ${matchCount} 条命中, ${newListings.length - matchCount} 条跳过`);
}

export async function runMonitor(): Promise<void> {
  const config = loadRules();

  console.log("========================================");
  console.log("  闲鱼商品监控 Agent");
  console.log("========================================");
  console.log(`  关键词: ${config.keyword}`);
  console.log(`  模型: ${MODEL}`);
  console.log(`  间隔: ${CHECK_INTERVAL / 1000}s`);
  console.log(`  规则: ${config.rules.length} 条`);
  console.log(`  数据源: ${USE_REAL_DATA ? "闲鱼真实数据（Puppeteer）" : "mock（开发模式）"}`);
  console.log("========================================");

  process.on("SIGINT", async () => {
    console.log("\n正在关闭浏览器...");
    await closeBrowser();
    process.exit(0);
  });

  await checkOnce();

  console.log(`\n定时监控已启动，每 ${CHECK_INTERVAL / 1000} 秒检查一次...`);
  console.log("按 Ctrl+C 退出\n");
  setInterval(checkOnce, CHECK_INTERVAL);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit monitor.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add monitor.ts
git commit -m "feat: extract monitor.ts from agent.ts with rules integration"
```

---

### Task 5: Create `setup.ts` — interactive rule configuration

**Files:**
- Create: `setup.ts`

- [ ] **Step 1: Create setup.ts with readline-based interactive flow**

```typescript
// setup.ts
import * as readline from "readline";
import { loadRules, saveRules, type RulesConfig } from "./rules.js";

function createRL(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

export async function runSetup(): Promise<void> {
  const rl = createRL();
  const existing = loadRules();

  console.log("\n========================================");
  console.log("  商品监控规则配置");
  console.log("========================================\n");

  // Keyword
  const keyword = await ask(rl, `搜索关键词 [${existing.keyword}]: `);
  const finalKeyword = keyword || existing.keyword;

  // Description
  const desc = await ask(
    rl,
    `用一句话描述你想找什么商品${existing.description ? ` [${existing.description}]` : ""}: `
  );
  const finalDesc = desc || existing.description;

  // Rules
  console.log("\n输入筛选规则（每行一条，空行结束）:");
  if (existing.rules.length > 0) {
    console.log("当前规则:");
    existing.rules.forEach((r, i) => console.log(`  ${i + 1}. ${r}`));
    console.log('（直接按回车保留现有规则，或输入新规则覆盖）\n');
  }

  const newRules: string[] = [];
  while (true) {
    const line = await ask(rl, `  ${newRules.length + 1}. `);
    if (!line) break;
    newRules.push(line);
  }
  const finalRules = newRules.length > 0 ? newRules : existing.rules;

  // Filters
  console.log("\n价格和地区过滤（可选）:");

  const minPriceStr = await ask(
    rl,
    `最低价格（留空不限）${existing.filters.minPrice != null ? ` [${existing.filters.minPrice}]` : ""}: `
  );
  const minPrice = minPriceStr
    ? parseFloat(minPriceStr)
    : minPriceStr === "" && existing.filters.minPrice != null
      ? existing.filters.minPrice
      : null;

  const maxPriceStr = await ask(
    rl,
    `最高价格（留空不限）${existing.filters.maxPrice != null ? ` [${existing.filters.maxPrice}]` : ""}: `
  );
  const maxPrice = maxPriceStr
    ? parseFloat(maxPriceStr)
    : maxPriceStr === "" && existing.filters.maxPrice != null
      ? existing.filters.maxPrice
      : null;

  const regionStr = await ask(
    rl,
    `地区过滤（逗号分隔，留空不限）${existing.filters.regions?.length ? ` [${existing.filters.regions.join(",")}]` : ""}: `
  );
  const regions = regionStr
    ? regionStr.split(",").map((s) => s.trim()).filter(Boolean)
    : regionStr === "" && existing.filters.regions?.length
      ? existing.filters.regions
      : [];

  rl.close();

  const config: RulesConfig = {
    keyword: finalKeyword,
    description: finalDesc,
    rules: finalRules,
    filters: { minPrice, maxPrice, regions },
    testCases: existing.testCases, // preserve existing test cases
  };

  saveRules(config);

  console.log("\n✅ 规则已保存到 .cache/rules.json");
  console.log(`  关键词: ${config.keyword}`);
  console.log(`  描述: ${config.description}`);
  console.log(`  规则: ${config.rules.length} 条`);
  if (minPrice != null) console.log(`  最低价: ¥${minPrice}`);
  if (maxPrice != null) console.log(`  最高价: ¥${maxPrice}`);
  if (regions.length > 0) console.log(`  地区: ${regions.join(", ")}`);
  console.log("\n💡 运行 npx tsx agent.ts calibrate 可以抓取样本数据校准规则");
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit setup.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add setup.ts
git commit -m "feat: add setup.ts for interactive rule configuration"
```

---

### Task 6: Create `calibrate.ts` — sample data calibration with LLM optimization

**Files:**
- Create: `calibrate.ts`

- [ ] **Step 1: Create calibrate.ts with the full calibration flow**

```typescript
// calibrate.ts
import * as readline from "readline";
import "dotenv/config";

import { fetchMockListings, type Listing } from "./mock_data.js";
import { fetchListings as fetchRealListings, closeBrowser } from "./fetcher.js";
import {
  loadRules,
  saveRules,
  buildFilterPrompt,
  applyHardFilters,
  type TestCase,
} from "./rules.js";
import { filterListing, optimizeRules, type Correction } from "./filter.js";

const USE_REAL_DATA = true;

function createRL(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

interface CalibrateItem {
  listing: Listing;
  matched: boolean;
  reason: string;
  hardFiltered: boolean;
  hardReason?: string;
}

export async function runCalibrate(): Promise<void> {
  const config = loadRules();
  const systemPrompt = buildFilterPrompt(config);

  console.log("\n========================================");
  console.log("  规则校准模式");
  console.log("========================================\n");

  // 1. Fetch sample data
  console.log(`🔍 正在抓取"${config.keyword}"的商品数据...`);
  let listings: Listing[];
  try {
    listings = USE_REAL_DATA
      ? await fetchRealListings(config.keyword)
      : fetchMockListings();
  } catch (e: any) {
    console.error(`❌ 抓取失败: ${e.message}`);
    return;
  }

  if (listings.length === 0) {
    console.log("未获取到商品数据，请检查网络或登录状态");
    return;
  }

  console.log(`获取到 ${listings.length} 条商品，用当前规则筛选中...\n`);

  // 2. Filter each listing
  const results: CalibrateItem[] = [];
  for (const listing of listings) {
    const hardResult = applyHardFilters(listing, config.filters);
    if (!hardResult.pass) {
      results.push({
        listing,
        matched: false,
        reason: hardResult.reason!,
        hardFiltered: true,
        hardReason: hardResult.reason,
      });
      continue;
    }

    const filterResult = await filterListing(listing, systemPrompt);
    results.push({
      listing,
      matched: filterResult.match,
      reason: filterResult.reason,
      hardFiltered: false,
    });
  }

  // 3. Display results
  console.log("");
  results.forEach((r, i) => {
    const icon = r.matched ? "✅ 命中" : "❌ 跳过";
    const prefix = r.hardFiltered ? "🔧 硬过滤" : icon;
    const title = r.listing.title.slice(0, 40);
    console.log(
      `  ${i + 1}. ${prefix} | ${title}  ¥${r.listing.price}  → ${r.reason}`
    );
  });

  // 4. User corrections
  const rl = createRL();
  console.log(
    '\n有判断错误的吗？输入序号修正（如 "1 错" 或 "4 对"），输入 done 结束:'
  );

  const corrections: Correction[] = [];
  const correctedIndices: Set<number> = new Set();

  while (true) {
    const input = await ask(rl, "> ");
    if (input.toLowerCase() === "done" || input === "") break;

    const match = input.match(/^(\d+)\s*(错|对)$/);
    if (!match) {
      console.log('  格式：序号 + 错/对，如 "1 错" 或 "3 对"');
      continue;
    }

    const idx = parseInt(match[1]) - 1;
    if (idx < 0 || idx >= results.length) {
      console.log(`  序号超出范围 (1-${results.length})`);
      continue;
    }

    const r = results[idx];
    const isWrong = match[2] === "错";
    if (isWrong) {
      corrections.push({
        title: r.listing.title,
        price: r.listing.price,
        currentResult: r.matched,
        expected: !r.matched,
        reason: r.reason,
      });
      correctedIndices.add(idx);
      console.log(
        `  已记录: "${r.listing.title.slice(0, 30)}..." ${r.matched ? "命中→跳过" : "跳过→命中"}`
      );
    } else {
      console.log(`  已确认: "${r.listing.title.slice(0, 30)}..." 判断正确`);
    }
  }

  // 5. Save corrected items as test cases
  const newTestCases: TestCase[] = [];
  for (const idx of correctedIndices) {
    const r = results[idx];
    newTestCases.push({
      title: r.listing.title,
      price: String(r.listing.price),
      description: r.listing.description,
      seller: r.listing.seller,
      expectedMatch: !r.matched, // flipped since user said it was wrong
      addedAt: new Date().toISOString().split("T")[0],
    });
  }

  if (corrections.length === 0) {
    console.log("\n✅ 所有判断正确，规则无需调整");
    rl.close();
    if (USE_REAL_DATA) await closeBrowser();
    return;
  }

  // 6. LLM optimize rules
  console.log(`\n📝 已记录 ${corrections.length} 条修正，正在让 LLM 优化规则...`);
  const optimized = await optimizeRules(config.rules, corrections);

  if (optimized.changes.length === 0) {
    console.log("  LLM 未建议修改");
  } else {
    console.log("\nLLM 建议修改：");
    for (const change of optimized.changes) {
      console.log(`  规则 ${change.index + 1}: "${config.rules[change.index] || "(新增)"}"`);
      console.log(`    → "${optimized.rules[change.index]}"`);
      console.log(`    理由: ${change.reason}`);
    }

    const answer = await ask(rl, "\n接受优化？(y/n/手动编辑): ");

    if (answer.toLowerCase() === "y") {
      config.rules = optimized.rules;
      console.log("✅ 规则已更新");
    } else if (answer.toLowerCase() === "n") {
      console.log("⏭️ 保持原规则不变");
    } else {
      // Manual edit mode
      console.log("输入新规则（每行一条，空行结束）:");
      const manualRules: string[] = [];
      while (true) {
        const line = await ask(rl, `  ${manualRules.length + 1}. `);
        if (!line) break;
        manualRules.push(line);
      }
      if (manualRules.length > 0) {
        config.rules = manualRules;
        console.log("✅ 规则已手动更新");
      }
    }
  }

  // 7. Save test cases and rules
  config.testCases = [...config.testCases, ...newTestCases];
  saveRules(config);

  console.log(`✅ ${newTestCases.length} 条修正已加入测试用例（共 ${config.testCases.length} 条）`);

  if (config.testCases.length > 30) {
    console.log(`⚠️ 测试用例已有 ${config.testCases.length} 条，建议清理旧的以节省 token`);
  }

  rl.close();
  if (USE_REAL_DATA) await closeBrowser();
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit calibrate.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add calibrate.ts
git commit -m "feat: add calibrate.ts for sample-based rule calibration"
```

---

### Task 7: Create `test.ts` — test case runner

**Files:**
- Create: `test.ts`

- [ ] **Step 1: Create test.ts with runTest**

```typescript
// test.ts
import "dotenv/config";
import {
  loadRules,
  buildFilterPrompt,
  applyHardFilters,
  type TestCase,
} from "./rules.js";
import { filterListing } from "./filter.js";
import type { Listing } from "./mock_data.js";

function testCaseToListing(tc: TestCase): Listing {
  return {
    id: `test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    title: tc.title,
    price: parseFloat(tc.price) || 0,
    description: tc.description,
    seller: tc.seller,
    url: "https://www.goofish.com/item?id=test",
  };
}

export async function runTest(): Promise<void> {
  const config = loadRules();

  console.log("\n========================================");
  console.log("  规则测试模式");
  console.log("========================================\n");

  if (config.testCases.length === 0) {
    console.log("暂无测试用例。运行 npx tsx agent.ts calibrate 可以积累测试用例。");
    return;
  }

  const systemPrompt = buildFilterPrompt(config);
  console.log(`🧪 运行 ${config.testCases.length} 条测试用例...\n`);

  let passCount = 0;
  let failCount = 0;

  for (let i = 0; i < config.testCases.length; i++) {
    const tc = config.testCases[i];
    const listing = testCaseToListing(tc);

    // Hard filters
    const hardResult = applyHardFilters(listing, config.filters);
    let actualMatch: boolean;
    let reason: string;

    if (!hardResult.pass) {
      actualMatch = false;
      reason = hardResult.reason!;
    } else {
      const filterResult = await filterListing(listing, systemPrompt);
      actualMatch = filterResult.match;
      reason = filterResult.reason;
    }

    const pass = actualMatch === tc.expectedMatch;
    if (pass) {
      passCount++;
      const expectText = tc.expectedMatch ? "命中" : "跳过";
      console.log(
        `  ${i + 1}. ✅ PASS | ${tc.title.slice(0, 40)} → 期望${expectText}，实际${expectText}`
      );
    } else {
      failCount++;
      const expectText = tc.expectedMatch ? "命中" : "跳过";
      const actualText = actualMatch ? "命中" : "跳过";
      console.log(
        `  ${i + 1}. ❌ FAIL | ${tc.title.slice(0, 40)} → 期望${expectText}，实际${actualText} (${reason})`
      );
    }
  }

  console.log(`\n结果: ${passCount}/${config.testCases.length} 通过，${failCount} 条失败`);

  if (failCount > 0) {
    console.log("\n💡 运行 npx tsx agent.ts calibrate 可以调整规则");
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit test.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add test.ts
git commit -m "feat: add test.ts for rule regression testing"
```

---

### Task 8: Rewrite `agent.ts` as thin entry point

**Files:**
- Modify: `agent.ts` (full rewrite)

- [ ] **Step 1: Rewrite agent.ts as subcommand dispatcher**

Replace the entire content of `agent.ts`:

```typescript
#!/usr/bin/env npx tsx
/**
 * agent.ts - 闲鱼商品监控 Agent 入口
 *
 * 子命令：
 *   (无参数)    正常监控模式
 *   setup       交互式配置筛选规则
 *   calibrate   抓取样本数据校准规则
 *   test        运行测试用例回归验证
 */

import "dotenv/config";

const command = process.argv[2];

switch (command) {
  case "setup": {
    const { runSetup } = await import("./setup.js");
    await runSetup();
    break;
  }
  case "calibrate": {
    const { runCalibrate } = await import("./calibrate.js");
    await runCalibrate();
    break;
  }
  case "test": {
    const { runTest } = await import("./test.js");
    await runTest();
    break;
  }
  default: {
    const { runMonitor } = await import("./monitor.js");
    await runMonitor();
    break;
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors (all files compile)

- [ ] **Step 3: Manually test each subcommand**

Run each command and verify basic behavior:

```bash
# Test setup (interactive — enter some rules, Ctrl+C to exit)
npx tsx agent.ts setup

# Test that rules.json was created
cat .cache/rules.json

# Test the test runner (should say no test cases yet)
npx tsx agent.ts test

# Test default monitor mode starts up (Ctrl+C to exit)
npx tsx agent.ts
```

- [ ] **Step 4: Commit**

```bash
git add agent.ts
git commit -m "refactor: rewrite agent.ts as thin subcommand dispatcher"
```

---

### Task 9: Update `tsconfig.json` to include new files

**Files:**
- Modify: `tsconfig.json`

- [ ] **Step 1: Verify tsconfig includes all .ts files**

The current `tsconfig.json` has `"include": ["*.ts"]` which already covers all new files in the root directory. No change needed.

Run full type check:

```bash
npx tsc --noEmit
```

Expected: No errors across all files.

- [ ] **Step 2: Fix any type errors found**

If there are type errors, fix them in the relevant files.

- [ ] **Step 3: Commit (only if changes were needed)**

```bash
git add -A
git commit -m "fix: resolve any type errors from module split"
```

---

### Task 10: End-to-end smoke test

**Files:**
- No file changes — verification only

- [ ] **Step 1: Test setup flow**

```bash
npx tsx agent.ts setup
```

Enter: keyword "指尖模室", description "test", one rule "must be 指尖模室", no price/region filters. Verify `.cache/rules.json` is created with correct content.

- [ ] **Step 2: Test monitor with mock data**

Temporarily set `USE_REAL_DATA = false` in `monitor.ts`, then:

```bash
npx tsx agent.ts
```

Verify it starts up, loads rules from `.cache/rules.json`, and runs the check loop. Ctrl+C to exit.

Revert `USE_REAL_DATA` back to `true`.

- [ ] **Step 3: Test calibrate with mock data**

Temporarily set `USE_REAL_DATA = false` in `calibrate.ts`, then:

```bash
npx tsx agent.ts calibrate
```

Verify it fetches mock listings, shows filter results, accepts corrections, and saves test cases. Revert `USE_REAL_DATA` back to `true`.

- [ ] **Step 4: Test regression runner**

```bash
npx tsx agent.ts test
```

Verify it runs the test cases saved from calibration and reports PASS/FAIL.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: configurable filter rules system complete"
```
