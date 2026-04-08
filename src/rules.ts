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
  keyword: "示例关键词",
  description: "用一句话描述你想找什么商品，例如：只想找全新未拆的 iPhone 16 Pro Max 256G 国行",
  rules: [
    "示例规则1：必须是某个品牌/型号（排除仿品、山寨、蹭标签的）",
    "示例规则2：必须是某个规格/版本（如颜色、尺寸、配置等）",
    "示例规则3：必须是某种状态（如全新未拆、成品、非配件等）",
    "示例规则4：排除不想要的类型（如壳膜配件、维修机、拼装件等）",
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
