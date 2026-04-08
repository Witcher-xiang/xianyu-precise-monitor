/**
 * fetcher.ts - 闲鱼真实数据抓取
 *
 * 用 Puppeteer 无头浏览器打开闲鱼搜索页，
 * 等页面渲染完后提取商品数据。
 *
 * 登录流程：
 * 1. 首次运行：打开可见浏览器，你手动登录（扫码/账号密码）
 * 2. 登录成功后自动保存 cookies 到 .cache/cookies.json
 * 3. 后续运行：自动加载 cookies，无头模式运行
 *
 * 如果 cookies 过期，删掉 .cache/cookies.json 重新登录即可。
 */

import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { type Browser, type Page } from "puppeteer";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import type { Listing } from "./mock_data.js";

// 启用隐身插件，绕过自动化检测（验证码滑块等）
puppeteer.use(StealthPlugin());

const CACHE_DIR = join(process.cwd(), ".cache");
const COOKIES_FILE = join(CACHE_DIR, "cookies.json");

let browser: Browser | null = null;

/**
 * 保存 cookies 到文件
 */
async function saveCookies(page: Page): Promise<void> {
  const cookies = await page.cookies();
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
  console.log(`  [爬虫] cookies 已保存 (${cookies.length} 条)`);
}

/**
 * 加载已保存的 cookies
 */
async function loadCookies(page: Page): Promise<boolean> {
  if (!existsSync(COOKIES_FILE)) return false;
  try {
    const cookies = JSON.parse(readFileSync(COOKIES_FILE, "utf-8"));
    await page.setCookie(...cookies);
    console.log(`  [爬虫] 已加载 cookies (${cookies.length} 条)`);
    return true;
  } catch {
    return false;
  }
}

/**
 * 首次登录：打开可见浏览器，等用户手动登录
 */
async function loginManually(): Promise<void> {
  console.log("========================================");
  console.log("  首次运行，需要手动登录闲鱼");
  console.log("  浏览器即将打开，请扫码或输入账号登录");
  console.log("  登录成功后 cookies 会自动保存");
  console.log("========================================");

  const b = await puppeteer.launch({
    headless: false,  // 有头模式，能看到浏览器
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await b.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
  );

  await page.goto("https://www.goofish.com/", { waitUntil: "networkidle2" });

  // 等待用户手动登录
  // 不自动检测，让用户登录完后在终端按回车确认
  console.log("");
  console.log("  ✦ 请在浏览器中完成登录（扫码或账号密码）");
  console.log("  ✦ 登录成功后，回到终端按 回车键 继续");
  console.log("");

  // 等待用户按回车
  await new Promise<void>((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => {
      process.stdin.pause();
      resolve();
    });
  });

  await saveCookies(page);
  console.log("  登录完成！cookies 已保存，后续自动登录。");

  await b.close();
}

/**
 * 获取浏览器实例（无头模式，带 cookies）
 */
async function getBrowser(): Promise<Browser> {
  if (browser && browser.connected) return browser;
  browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
  });
  return browser;
}

/**
 * 检查页面是否跳转到了登录页
 */
function isLoginPage(url: string): boolean {
  return url.includes("login") || url.includes("signin");
}

/**
 * 从闲鱼搜索页抓取商品列表
 */
export async function fetchListings(keyword?: string): Promise<Listing[]> {
  // 没有 cookies → 先走手动登录流程
  if (!existsSync(COOKIES_FILE)) {
    await loginManually();
    if (!existsSync(COOKIES_FILE)) return [];  // 登录失败
  }

  const query = keyword || "指尖模室";
  const url = `https://www.goofish.com/search?q=${encodeURIComponent(query)}`;

  const b = await getBrowser();
  const page = await b.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
  );

  // 加载已保存的 cookies
  await loadCookies(page);

  // 拦截 API 响应
  const apiData: Listing[] = [];
  page.on("response", async (response) => {
    const reqUrl = response.url();
    if (
      (reqUrl.includes("/search") || reqUrl.includes("/list") || reqUrl.includes("mtop.taobao")) &&
      response.headers()["content-type"]?.includes("application/json")
    ) {
      try {
        const json = await response.json();
        const items = findItemsInResponse(json);
        if (items && items.length > 0) apiData.push(...items);
      } catch {}
    }
  });

  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

    // 检查是否被踢到登录页（cookies 过期）
    if (isLoginPage(page.url())) {
      console.log("  [爬虫] cookies 已过期，请删除 .cache/cookies.json 重新登录");
      await page.close();
      return [];
    }

    // 等待商品内容渲染
    await page.waitForSelector(
      'a[href*="/item?id="], a[href*="item.htm"], [class*="item"], [class*="card"], [class*="feed"]',
      { timeout: 10000 }
    ).catch(() => {});

    await new Promise((r) => setTimeout(r, 2000));
  } catch (e: any) {
    console.error(`  [爬虫] 页面加载失败: ${e.message}`);
    await page.close();
    return [];
  }

  let listings: Listing[] = [];

  if (apiData.length > 0) {
    console.log(`  [爬虫] 从 API 响应获取到 ${apiData.length} 条数据`);
    listings = apiData;
  } else {
    console.log("  [爬虫] API 拦截未命中，从 DOM 解析...");
    listings = await parseFromDOM(page);
  }

  // 刷新 cookies（延长有效期）
  await saveCookies(page);
  await page.close();
  return listings;
}

/**
 * 在 API 响应的 JSON 中递归查找商品列表
 */
function findItemsInResponse(obj: any, depth = 0): Listing[] | null {
  if (depth > 5 || !obj || typeof obj !== "object") return null;

  if (Array.isArray(obj) && obj.length > 0) {
    const first = obj[0];
    if (first && (first.title || first.name || first.itemName) && (first.price || first.soldPrice)) {
      return obj.map((item, i) => ({
        id: String(item.id || item.itemId || item.item_id || `api_${i}`),
        title: String(item.title || item.name || item.itemName || ""),
        price: parseFloat(item.price || item.soldPrice || item.originalPrice || "0"),
        description: String(item.desc || item.description || item.title || ""),
        seller: String(item.sellerName || item.userName || item.nick || "未知卖家"),
        url: item.detailUrl || item.itemUrl || `https://www.goofish.com/item?id=${item.id || item.itemId || ""}`,
      }));
    }
  }

  for (const key of Object.keys(obj)) {
    const result = findItemsInResponse(obj[key], depth + 1);
    if (result && result.length > 0) return result;
  }

  return null;
}

/**
 * 从页面 DOM 解析商品信息
 */
async function parseFromDOM(page: Page): Promise<Listing[]> {
  const listings = await page.evaluate(() => {
    const results: any[] = [];

    const cards = document.querySelectorAll(
      'a[href*="/item?id="], a[href*="item.htm?id="], [data-spm*="item"], div[class*="feedCard"], div[class*="item-card"], div[class*="search-item"]'
    );

    if (cards.length === 0) {
      const allLinks = document.querySelectorAll("a[href]");
      for (const link of allLinks) {
        const text = link.textContent || "";
        const href = (link as HTMLAnchorElement).href || "";
        if (text.includes("¥") && (href.includes("item") || href.includes("goofish"))) {
          const priceMatch = text.match(/¥\s*([\d,.]+)/);
          results.push({
            id: href.match(/id=(\w+)/)?.[1] || `dom_${results.length}`,
            title: text.replace(/¥[\d,.]+/g, "").trim().slice(0, 100),
            price: priceMatch ? parseFloat(priceMatch[1].replace(",", "")) : 0,
            description: text.trim().slice(0, 200),
            seller: "未知卖家",
            url: href,
          });
        }
      }
      return results;
    }

    for (const card of cards) {
      const el = card as HTMLElement;
      const text = el.textContent || "";
      const href = (el as HTMLAnchorElement).href || el.querySelector("a")?.href || "";

      const priceMatch = text.match(/¥\s*([\d,.]+)/);
      const price = priceMatch ? parseFloat(priceMatch[1].replace(",", "")) : 0;

      const titleEl = el.querySelector('[class*="title"], [class*="name"], h3, h4') as HTMLElement;
      const title = titleEl?.textContent?.trim() || text.replace(/¥[\d,.]+/g, "").trim().slice(0, 100);

      const idMatch = href.match(/id=(\w+)/);
      const id = idMatch?.[1] || `dom_${results.length}`;

      if (title && title.length > 2) {
        results.push({
          id,
          title,
          price,
          description: text.trim().slice(0, 200),
          seller: "未知卖家",
          url: href || `https://www.goofish.com/item?id=${id}`,
        });
      }
    }

    return results;
  });

  console.log(`  [爬虫] 从 DOM 解析到 ${listings.length} 条商品`);
  return listings;
}

/**
 * 关闭浏览器
 */
export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}
