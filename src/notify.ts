// notify.ts
import * as Lark from "@larksuiteoapi/node-sdk";
import "dotenv/config";
import type { Listing } from "./mock_data.js";

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
