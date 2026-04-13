// notify.ts
import * as Lark from "@larksuiteoapi/node-sdk";
import "dotenv/config";
import type { Listing } from "./mock_data.js";
import type { DailyStats } from "./monitor.js";

const FEISHU_CHAT_ID = process.env.FEISHU_CHAT_ID || "";
const larkClient = new Lark.Client({
  appId: process.env.FEISHU_APP_ID || "",
  appSecret: process.env.FEISHU_APP_SECRET || "",
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

  const pubTime = listing.publishTime
    ? new Date(listing.publishTime).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "未知";

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
            `上新时间：${pubTime}`,
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

  const pubTime = listing.publishTime
    ? new Date(listing.publishTime).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "未知";

  const text = [
    `*商品上新提醒*`,
    ``,
    `*${listing.title}*`,
    `价格：¥${listing.price}`,
    `卖家：${listing.seller}`,
    `上新时间：${pubTime}`,
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

// ─── 每日日报推送 ─────────────────────────────────────────────────────

async function sendFeishuDailyReport(stats: DailyStats): Promise<void> {
  if (!FEISHU_CHAT_ID) {
    console.log(`  [飞书] 未配置 FEISHU_CHAT_ID，跳过日报推送`);
    printDailyReportToConsole(stats);
    return;
  }

  const skipTotal =
    stats.skipReasons.noPublishTime +
    stats.skipReasons.notFresh +
    stats.skipReasons.hardFilter +
    stats.skipReasons.llmReject;

  // 概览统计
  const overviewLines = [
    `**监控次数:** ${stats.checkCount} 次`,
    `**抓取商品总数:** ${stats.totalFetched} 条`,
    `**新商品:** ${stats.newCount} 条`,
    `**命中商品:** ${stats.matchCount} 条`,
    `**跳过商品:** ${skipTotal} 条`,
  ];

  // 跳过原因分布
  const skipLines = [
    `无发布时间: ${stats.skipReasons.noPublishTime} 条`,
    `非近期上新: ${stats.skipReasons.notFresh} 条`,
    `价格/地区过滤: ${stats.skipReasons.hardFilter} 条`,
    `LLM 未命中: ${stats.skipReasons.llmReject} 条`,
  ];

  // 命中商品列表
  const matchLines = stats.matchedItems.length > 0
    ? stats.matchedItems.map(
        (item, i) => `${i + 1}. [${item.title}](${item.url})\n    ¥${item.price} — ${item.reason}`
      )
    : ["今日暂无命中商品"];

  // 价格区间
  const priceText = stats.priceRange
    ? `命中商品价格区间: ¥${stats.priceRange.min} ~ ¥${stats.priceRange.max}`
    : "";

  const elements: any[] = [
    {
      tag: "div" as const,
      text: {
        tag: "lark_md" as const,
        content: overviewLines.join("\n"),
      },
    },
    { tag: "hr" as const },
    {
      tag: "div" as const,
      text: {
        tag: "lark_md" as const,
        content: `**跳过原因分布**\n${skipLines.join("\n")}`,
      },
    },
    { tag: "hr" as const },
    {
      tag: "div" as const,
      text: {
        tag: "lark_md" as const,
        content: `**命中商品列表**\n${matchLines.join("\n")}`,
      },
    },
  ];

  if (priceText) {
    elements.push({ tag: "hr" as const });
    elements.push({
      tag: "div" as const,
      text: { tag: "lark_md" as const, content: priceText },
    });
  }

  const card = {
    header: {
      title: { tag: "plain_text" as const, content: `每日监控日报 - ${stats.date}` },
      template: "blue" as const,
    },
    elements,
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
    console.log(`  [飞书] 日报已发送`);
  } catch (e: any) {
    console.error(`  [飞书] 日报发送失败: ${e.message}`);
  }
}

async function sendTelegramDailyReport(stats: DailyStats): Promise<void> {
  if (!TG_BOT_TOKEN || !TG_CHAT_ID) {
    return;
  }

  const skipTotal =
    stats.skipReasons.noPublishTime +
    stats.skipReasons.notFresh +
    stats.skipReasons.hardFilter +
    stats.skipReasons.llmReject;

  const matchLines = stats.matchedItems.length > 0
    ? stats.matchedItems.map(
        (item, i) => `${i + 1}\\. [${item.title}](${item.url})\n    ¥${item.price} — ${item.reason}`
      )
    : ["今日暂无命中商品"];

  const priceText = stats.priceRange
    ? `\n*价格区间:* ¥${stats.priceRange.min} ~ ¥${stats.priceRange.max}`
    : "";

  const text = [
    `*每日监控日报 \\- ${stats.date}*`,
    ``,
    `*概览*`,
    `监控次数: ${stats.checkCount} 次`,
    `抓取商品总数: ${stats.totalFetched} 条`,
    `新商品: ${stats.newCount} 条`,
    `命中商品: ${stats.matchCount} 条`,
    `跳过商品: ${skipTotal} 条`,
    ``,
    `*跳过原因*`,
    `无发布时间: ${stats.skipReasons.noPublishTime} 条`,
    `非近期上新: ${stats.skipReasons.notFresh} 条`,
    `价格/地区过滤: ${stats.skipReasons.hardFilter} 条`,
    `LLM 未命中: ${stats.skipReasons.llmReject} 条`,
    ``,
    `*命中商品*`,
    ...matchLines,
    priceText,
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
          parse_mode: "MarkdownV2",
        }),
      }
    );
    if (res.ok) {
      console.log(`  [Telegram] 日报已发送`);
    } else {
      console.error(
        `  [Telegram] 日报发送失败: ${res.status} ${await res.text()}`
      );
    }
  } catch (e: any) {
    console.error(`  [Telegram] 日报请求出错: ${e.message}`);
  }
}

function printDailyReportToConsole(stats: DailyStats): void {
  const skipTotal =
    stats.skipReasons.noPublishTime +
    stats.skipReasons.notFresh +
    stats.skipReasons.hardFilter +
    stats.skipReasons.llmReject;

  console.log(`\n========== 每日监控日报 - ${stats.date} ==========`);
  console.log(`  监控次数: ${stats.checkCount} 次`);
  console.log(`  抓取商品总数: ${stats.totalFetched} 条`);
  console.log(`  新商品: ${stats.newCount} 条`);
  console.log(`  命中商品: ${stats.matchCount} 条`);
  console.log(`  跳过商品: ${skipTotal} 条`);
  console.log(`    无发布时间: ${stats.skipReasons.noPublishTime}`);
  console.log(`    非近期上新: ${stats.skipReasons.notFresh}`);
  console.log(`    价格/地区过滤: ${stats.skipReasons.hardFilter}`);
  console.log(`    LLM 未命中: ${stats.skipReasons.llmReject}`);
  if (stats.matchedItems.length > 0) {
    console.log(`  命中列表:`);
    for (const item of stats.matchedItems) {
      console.log(`    - ${item.title} ¥${item.price}`);
    }
  }
  if (stats.priceRange) {
    console.log(`  价格区间: ¥${stats.priceRange.min} ~ ¥${stats.priceRange.max}`);
  }
  console.log(`================================================\n`);
}

export async function notifyDailyReport(stats: DailyStats): Promise<void> {
  await Promise.all([
    sendFeishuDailyReport(stats),
    sendTelegramDailyReport(stats),
  ]);
}
