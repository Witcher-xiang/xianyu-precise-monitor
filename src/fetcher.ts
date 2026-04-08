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
      reqUrl.includes("mtop.taobao.idlemtopsearch.pc.search") &&
      response.headers()["content-type"]?.includes("application/json")
    ) {
      try {
        const json = await response.json();
        

        // 检查 API 是否返回失败
        if (json.ret && JSON.stringify(json.ret).includes("FAIL")) {
          console.log(`  [爬虫] API 返回失败: ${JSON.stringify(json.ret)}`);
          return;
        }

        const resultList = json?.data?.resultList;
        if (Array.isArray(resultList) && resultList.length > 0) {
          const items = parseResultList(resultList);
          console.log(`  [爬虫] 从 API 解析到 ${items.length} 条商品`);
          for (const item of items) {
            const pt = item.publishTime ? new Date(item.publishTime).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "无";
            console.log(`  [爬虫] ${item.title.slice(0, 30)}  ¥${item.price}  发布时间=${pt}`);
          }
          if (items.length > 0) apiData.push(...items);
        }
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

    // 点击"最新"排序，再点击"1天内"筛选
    try {
      // 先点"最新"
      const clickedSort = await page.evaluate(() => {
        const items = document.querySelectorAll('div[class*="search-select-item"]');
        for (const el of items) {
          if (el.textContent?.trim() === "最新") {
            (el as HTMLElement).click();
            return true;
          }
        }
        return false;
      });
      if (clickedSort) {
        console.log('  [爬虫] 已点击"最新"排序');
        await new Promise((r) => setTimeout(r, 2000));
      }

      // // 再点"1天内"
      // const clickedDay = await page.evaluate(() => {
      //   const items = document.querySelectorAll('div[class*="search-select-item"]');
      //   for (const el of items) {
      //     if (el.textContent?.trim() === "1天内") {
      //       (el as HTMLElement).click();
      //       return true;
      //     }
      //   }
      //   return false;
      // });
      // if (clickedDay) {
      //   console.log('  [爬虫] 已点击"1天内"筛选，等待新数据...');
      //   apiData.length = 0;
      //   await new Promise((r) => setTimeout(r, 3000));
      // } else {
      //   console.log('  [爬虫] 未找到"1天内"筛选按钮');
      // }
    } catch {}

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
 * 解析闲鱼 API 的 resultList 结构
 * 数据路径参考: data.item.main.exContent / data.item.main.clickParam.args
 */
function parseResultList(resultList: any[]): Listing[] {
  const results: Listing[] = [];

  for (let i = 0; i < resultList.length; i++) {
    try {
      const itemData = resultList[i]?.data?.item?.main;
      if (!itemData) continue;

      const exContent = itemData.exContent || {};
      const clickArgs = itemData.clickParam?.args || {};

      const title = exContent.title || "";
      if (!title) continue;

      const itemId = exContent.itemId || clickArgs.itemId || `api_${i}`;

      // price 可能是数组 [{text:"¥"},{text:"450"}] 或字符串
      let price = 0;
      const rawPrice = exContent.price;
      if (Array.isArray(rawPrice)) {
        const priceText = rawPrice.map((p: any) => String(p?.text || "")).join("");
        const nums = priceText.match(/[\d.]+/);
        if (nums) price = parseFloat(nums[0]);
      } else if (rawPrice != null) {
        price = parseFloat(String(rawPrice)) || 0;
      }

      const seller = exContent.userNickName || exContent.userName || "未知卖家";

      // URL: targetUrl 可能带 fleamarket:// 前缀
      let url = itemData.targetUrl || "";
      url = url.replace("fleamarket://", "https://www.goofish.com/");
      if (!url) url = `https://www.goofish.com/item?id=${itemId}`;

      // publishTime: 毫秒时间戳，在 clickParam.args 中
      let publishTime: number | undefined;
      const pubTimeRaw = clickArgs.publishTime;
      if (pubTimeRaw && /^\d+$/.test(String(pubTimeRaw))) {
        publishTime = parseInt(String(pubTimeRaw));
      }

      // 兜底：从 fishTags 提取相对时间文本
      if (!publishTime) {
        const fishTags = resultList[i]?.data?.item?.fishTags;
        const timeText = extractTimeFromFishTags(fishTags);
        if (timeText) publishTime = parseRelativeTime(timeText);
      }

      results.push({
        id: String(itemId),
        title: String(title),
        price,
        description: String(exContent.desc || title),
        seller: String(seller),
        url: String(url),
        publishTime,
      });
    } catch {}
  }

  return results;
}

/**
 * 从 fishTags 中提取时间文本（如 "2天内上新"、"7小时前发布"）
 */
function extractTimeFromFishTags(fishTags: any): string {
  if (!fishTags || typeof fishTags !== "object") return "";
  for (const rKey of Object.keys(fishTags)) {
    const tag = fishTags[rKey];
    const tagList = tag?.tagList || tag?.config?.tagList;
    if (!Array.isArray(tagList)) continue;
    for (const t of tagList) {
      const content = t?.data?.content || t?.content || "";
      if (typeof content === "string" && /(小时前|天内|天前|分钟前|刚刚)/.test(content)) {
        return content;
      }
    }
  }
  return "";
}

/**
 * 解析页面上的相对时间文本为时间戳
 * 如 "7小时前发布"、"21小时前发布"、"1天内上新"、"3天前发布"
 */
function parseRelativeTime(text: string): number | undefined {
  const now = Date.now();

  // "X分钟前" / "X分钟前发布"
  const minMatch = text.match(/(\d+)\s*分钟前/);
  if (minMatch) return now - parseInt(minMatch[1]) * 60 * 1000;

  // "X小时前" / "X小时前发布"
  const hourMatch = text.match(/(\d+)\s*小时前/);
  if (hourMatch) return now - parseInt(hourMatch[1]) * 60 * 60 * 1000;

  // "X天内上新" / "X天前发布" / "X天前"
  const dayMatch = text.match(/(\d+)\s*天[内前]/);
  if (dayMatch) return now - parseInt(dayMatch[1]) * 24 * 60 * 60 * 1000;

  // "刚刚发布" / "刚刚上新"
  if (text.includes("刚刚")) return now;

  return undefined;
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
          // 提取时间文本
          const timeMatch = text.match(/(\d+\s*(?:分钟|小时|天)[前内](?:发布|上新)?|刚刚(?:发布|上新))/);
          results.push({
            id: href.match(/id=(\w+)/)?.[1] || `dom_${results.length}`,
            title: text.replace(/¥[\d,.]+/g, "").trim().slice(0, 100),
            price: priceMatch ? parseFloat(priceMatch[1].replace(",", "")) : 0,
            description: text.trim().slice(0, 200),
            seller: "未知卖家",
            url: href,
            timeText: timeMatch?.[1] || "",
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

      // 提取时间文本：从 class 含 service/time 的元素或整个卡片文本中匹配
      const timeEl = el.querySelector('[class*="service"], [class*="time"], [class*="row2"]') as HTMLElement;
      const timeSource = timeEl?.textContent || text;
      const timeMatch = timeSource.match(/(\d+\s*(?:分钟|小时|天)[前内](?:发布|上新)?|刚刚(?:发布|上新))/);

      if (title && title.length > 2) {
        results.push({
          id,
          title,
          price,
          description: text.trim().slice(0, 200),
          seller: "未知卖家",
          url: href || `https://www.goofish.com/item?id=${id}`,
          timeText: timeMatch?.[1] || "",
        });
      }
    }

    return results;
  });

  // 将相对时间文本转为时间戳
  const parsed = listings.map((item) => ({
    ...item,
    publishTime: item.timeText ? parseRelativeTime(item.timeText) : undefined,
  }));

  console.log(`  [爬虫] 从 DOM 解析到 ${parsed.length} 条商品`);
  if (parsed.length > 0) {
    console.log(`  [爬虫] 首条时间文本: "${parsed[0].timeText || "无"}"`);
  }
  return parsed;
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
