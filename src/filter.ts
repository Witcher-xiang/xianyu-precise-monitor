/**
 * filter.ts - LLM 筛选模块
 *
 * 用 Anthropic Claude 判断商品是否符合筛选规则。
 * filterListing() 接受 systemPrompt 参数，由调用方决定筛选规则。
 * optimizeRules() 根据用户标记的误判案例自动优化规则。
 */

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

// --- 规则优化 ---

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
  userFeedback: string; // 用户解释为什么判断错误
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
      `商品: ${c.title} ¥${c.price} | 当前判断: ${c.currentResult ? "命中" : "跳过"} | 正确应该: ${c.expected ? "命中" : "跳过"} | 原因: ${c.reason} | 用户反馈: ${c.userFeedback}`
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
