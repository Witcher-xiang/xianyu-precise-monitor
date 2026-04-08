/**
 * rules.ts - 筛选规则管理
 *
 * 定义商品筛选规则的类型、默认值、持久化（load/save）、
 * LLM prompt 构建、以及价格/地区等硬过滤逻辑。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import type { Listing } from "./mock_data.js";

// ─── Types ───────────────────────────────────────────────────────────

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

// ─── Constants ───────────────────────────────────────────────────────

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

// ─── Load / Save ─────────────────────────────────────────────────────

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

// ─── Prompt Builder ──────────────────────────────────────────────────

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

// ─── Hard Filters ────────────────────────────────────────────────────

export function applyHardFilters(
  listing: Listing,
  filters: Filters,
): { pass: boolean; reason?: string } {
  if (filters.minPrice != null && listing.price < filters.minPrice) {
    return {
      pass: false,
      reason: `价格 ¥${listing.price} 低于最低 ¥${filters.minPrice}`,
    };
  }
  if (filters.maxPrice != null && listing.price > filters.maxPrice) {
    return {
      pass: false,
      reason: `价格 ¥${listing.price} 超过最高 ¥${filters.maxPrice}`,
    };
  }
  if (filters.regions && filters.regions.length > 0) {
    const text =
      `${listing.title} ${listing.description} ${listing.seller}`.toLowerCase();
    const matched = filters.regions.some((r) =>
      text.includes(r.toLowerCase()),
    );
    if (!matched) {
      return {
        pass: false,
        reason: `不在目标地区: ${filters.regions.join(", ")}`,
      };
    }
  }
  return { pass: true };
}
