#!/usr/bin/env npx tsx
/**
 * agent.ts - 闲鱼指尖模室监控 Agent
 *
 * 每 5 分钟检查一次闲鱼上"指尖模室"的新商品，
 * 用 LLM 筛选出 1/72 比例的成品坦克模型，
 * 通过飞书机器人通知。
 *
 * 用到的 Agent 模式：
 * - s02 工具分发：fetchListings / sendFeishu / readFile / writeFile
 * - s07 持久化：已通知商品 ID 存 .cache/seen_items.json
 * - LLM 筛选：用一次性 API 调用做商品分类判断
 */

import Anthropic from "@anthropic-ai/sdk";
import * as Lark from "@larksuiteoapi/node-sdk";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import "dotenv/config";

import { fetchMockListings, type Listing } from "./mock_data.js";
import { fetchListings as fetchRealListings, closeBrowser } from "./fetcher.js";

// 切换数据源：true = 真实爬虫，false = mock 数据
const USE_REAL_DATA = true;

// === 配置 ===

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: process.env.ANTHROPIC_BASE_URL,
});
const MODEL = process.env.MODEL_ID || "claude-sonnet-4-6";
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL || "300000"); // 默认 5 分钟
const CACHE_DIR = join(process.cwd(), ".cache");
const SEEN_FILE = join(CACHE_DIR, "seen_items.json");

// 飞书 SDK 客户端
const FEISHU_CHAT_ID = process.env.FEISHU_CHAT_ID || "";
const larkClient = new Lark.Client({
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET,
  domain: process.env.FEISHU_BASE_DOMAIN || "https://open.feishu.cn",
});

// Telegram 配置
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN || "";
const TG_CHAT_ID = process.env.TG_CHAT_ID || "";

// === 持久化：已见过的商品 ID（s07 模式）===

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

// === LLM 筛选：判断商品是否匹配 ===

const FILTER_PROMPT = `你是一个军事模型商品筛选助手。用户只想找"指尖模室"品牌的 1/72 比例成品载具模型。

判断规则：
1. 必须是"指尖模室"品牌出品（不是其他品牌蹭 tag、标题提到"类似指尖模室"或"媲美指尖模室"的都不算）
2. 必须是 1/72 比例（排除 1/48、1/35、1/144 等其他比例）
3. 必须是成品模型（免胶免拼、开盒即摆），排除需要自己组装的拼装套件/板件/白模
4. 必须是载具（坦克、装甲车、步兵战车、自行火炮等军事载具），排除地台、场景、人偶、配件、蚀刻片、履带替换件

请严格按规则判断，只返回一行 JSON，不要其他内容：
{"match": true或false, "reason": "简短理由"}`;

interface FilterResult {
  match: boolean;
  reason: string;
}

async function filterListing(listing: Listing): Promise<FilterResult> {
  const userMessage = `请判断这个商品是否符合要求：

标题：${listing.title}
价格：${listing.price}元
描述：${listing.description}
卖家：${listing.seller}`;

  try {
    const response = await client.messages.create({
      model: MODEL,
      system: FILTER_PROMPT,
      messages: [{ role: "user", content: userMessage }],
      max_tokens: 200,
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    // 从回复中提取 JSON
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

// === 飞书通知（使用 SDK）===

async function sendFeishu(listing: Listing, reason: string): Promise<void> {
  if (!FEISHU_CHAT_ID) {
    console.log(`  [飞书] 未配置 FEISHU_CHAT_ID，跳过通知`);
    console.log(`  → 标题: ${listing.title}`);
    console.log(`  → 价格: ¥${listing.price}`);
    console.log(`  → 理由: ${reason}`);
    return;
  }

  // 飞书卡片消息
  const card = {
    header: {
      title: { tag: "plain_text", content: "指尖模室上新提醒" },
      template: "green",
    },
    elements: [
      {
        tag: "div",
        text: {
          tag: "lark_md",
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
        tag: "action",
        actions: [
          {
            tag: "button",
            text: { tag: "plain_text", content: "去闲鱼查看" },
            url: listing.url,
            type: "primary",
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

// === Telegram 通知 ===

async function sendTelegram(listing: Listing, reason: string): Promise<void> {
  if (!TG_BOT_TOKEN || !TG_CHAT_ID) {
    return; // 未配置则跳过
  }

  const text = [
    `*指尖模室上新提醒*`,
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
    const res = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TG_CHAT_ID,
        text,
        parse_mode: "Markdown",
      }),
    });
    if (res.ok) {
      console.log(`  [Telegram] 通知已发送: ${listing.title}`);
    } else {
      console.error(`  [Telegram] 发送失败: ${res.status} ${await res.text()}`);
    }
  } catch (e: any) {
    console.error(`  [Telegram] 请求出错: ${e.message}`);
  }
}

// === 统一通知：飞书 + Telegram 同时推送 ===

async function notify(listing: Listing, reason: string): Promise<void> {
  await Promise.all([
    sendFeishu(listing, reason),
    sendTelegram(listing, reason),
  ]);
}

// === 核心检查流程 ===

async function checkOnce(): Promise<void> {
  const timestamp = new Date().toLocaleString("zh-CN");
  console.log(`\n[${timestamp}] 开始检查...`);

  // 1. 获取商品列表
  const listings = USE_REAL_DATA
    ? await fetchRealListings("指尖模室")
    : fetchMockListings();
  console.log(`  获取到 ${listings.length} 条商品`);

  // 2. 过滤已见过的
  const seenIds = loadSeenIds();
  const newListings = listings.filter((item) => !seenIds.has(item.id));
  console.log(`  其中 ${newListings.length} 条是新的`);

  if (newListings.length === 0) {
    console.log("  没有新商品，跳过");
    return;
  }

  // 3. 逐个用 LLM 筛选
  let matchCount = 0;
  for (const listing of newListings) {
    console.log('listing:',listing)
    // console.log(`  筛选: ${listing.title.slice(0, 40)}...`);
    const result = await filterListing(listing);
    // console.log(`    → ${result.match ? "✅ 命中" : "❌ 跳过"}: ${result.reason}`);

    // 4. 命中的发飞书通知
    if (result.match) {
      matchCount++;
      await notify(listing, result.reason);
    }

    // 5. 标记为已见过（无论是否命中，都不重复处理）
    seenIds.add(listing.id);
  }

  // 6. 保存已见 ID
  saveSeenIds(seenIds);
  console.log(`  本轮完成: ${matchCount} 条命中, ${newListings.length - matchCount} 条跳过`);
}

// === 启动 ===

async function main(): Promise<void> {
  console.log("========================================");
  console.log("  闲鱼指尖模室 1/72 坦克模型监控 Agent");
  console.log("========================================");
  console.log(`  模型: ${MODEL}`);
  console.log(`  间隔: ${CHECK_INTERVAL / 1000}s`);
  console.log(`  飞书: ${FEISHU_CHAT_ID ? "已配置" : "未配置 CHAT_ID（仅打印日志）"}`);
  console.log(`  数据源: ${USE_REAL_DATA ? "闲鱼真实数据（Puppeteer）" : "mock（开发模式）"}`);
  console.log("========================================");

  // Ctrl+C 退出时关闭浏览器
  process.on("SIGINT", async () => {
    console.log("\n正在关闭浏览器...");
    await closeBrowser();
    process.exit(0);
  });

  // 启动时立即执行一次
  await checkOnce();

  // 然后每隔 CHECK_INTERVAL 执行一次
  console.log(`\n定时监控已启动，每 ${CHECK_INTERVAL / 1000} 秒检查一次...`);
  console.log("按 Ctrl+C 退出\n");
  setInterval(checkOnce, CHECK_INTERVAL);
}

main().catch(console.error);
