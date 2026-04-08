/**
 * mock_data.ts - 模拟闲鱼商品数据
 *
 * 开发阶段用假数据跑通整个流程，后续替换为真实数据源。
 * 覆盖各种场景：正确命中、比例不对、品类不对、蹭 tag、无关商品。
 */

export interface Listing {
  id: string;          // 商品 ID
  title: string;       // 标题
  price: number;       // 价格（元）
  description: string; // 描述
  seller: string;      // 卖家名称
  url: string;         // 商品链接
}

/**
 * 模拟闲鱼搜索"指尖模室"的结果
 * 每次调用随机返回其中几条，模拟"上新"效果
 */
const ALL_LISTINGS: Listing[] = [
  // ✅ 应该命中：指尖模室 1/72 成品坦克
  {
    id: "mock_001",
    title: "指尖模室 1/72 T-72B 主战坦克 成品模型 免胶免拼",
    price: 89,
    description: "指尖模室出品，1/72比例，T-72B主战坦克成品，细节精致，开盒即摆。",
    seller: "模型爱好者小王",
    url: "https://www.goofish.com/item?id=mock_001",
  },
  {
    id: "mock_002",
    title: "指尖模室 1/72 M1A2 艾布拉姆斯 成品 沙漠涂装",
    price: 95,
    description: "全新未拆，指尖模室1/72 M1A2主战坦克，沙漠迷彩涂装，成品免拼。",
    seller: "坦克世界玩家",
    url: "https://www.goofish.com/item?id=mock_002",
  },
  {
    id: "mock_003",
    title: "指尖模室 豹2A7 1/72 成品坦克模型 北约三色迷彩",
    price: 92,
    description: "指尖模室豹2A7，1/72比例成品，北约三色迷彩，底部带磁铁可吸附展示。",
    seller: "军事模型铺",
    url: "https://www.goofish.com/item?id=mock_003",
  },

  // ❌ 比例不对：1/48
  {
    id: "mock_004",
    title: "指尖模室 1/48 虎式坦克 重型坦克 成品模型",
    price: 168,
    description: "指尖模室1/48大比例虎式坦克，细节拉满，成品免拼，送展示盒。",
    seller: "大比例模型店",
    url: "https://www.goofish.com/item?id=mock_004",
  },

  // ❌ 品类不对：地台/场景
  {
    id: "mock_005",
    title: "指尖模室 1/72 诺曼底海滩场景地台 含坦克残骸",
    price: 158,
    description: "指尖模室出品，1/72诺曼底登陆场景地台，含损毁谢尔曼坦克，树木植被。",
    seller: "场景模型达人",
    url: "https://www.goofish.com/item?id=mock_005",
  },

  // ❌ 蹭 tag：其他品牌
  {
    id: "mock_006",
    title: "4D拼装坦克模型 1/72 虎式 类似指尖模室品质",
    price: 35,
    description: "4D品牌拼装坦克，1/72比例，需要自己组装，品质接近指尖模室。非指尖模室。",
    seller: "便宜模型批发",
    url: "https://www.goofish.com/item?id=mock_006",
  },
  {
    id: "mock_007",
    title: "坦克模型 1/72 豹2 媲美指尖模室 白模DIY",
    price: 28,
    description: "国产白模坦克，1/72比例，可自行上色，效果不输指尖模室。注意是白模不是成品。",
    seller: "DIY模型工坊",
    url: "https://www.goofish.com/item?id=mock_007",
  },

  // ❌ 拼装件（非成品）
  {
    id: "mock_008",
    title: "指尖模室 1/72 BMP-2步兵战车 拼装套件 板件全新",
    price: 45,
    description: "指尖模室1/72 BMP-2，未拼装板件套件，需要自己胶水组装和上色。",
    seller: "模型板件店",
    url: "https://www.goofish.com/item?id=mock_008",
  },

  // ❌ 配件
  {
    id: "mock_009",
    title: "指尖模室 1/72 坦克履带替换件 金属蚀刻片",
    price: 15,
    description: "指尖模室1/72坦克通用金属履带蚀刻片，可替换原装塑料履带。",
    seller: "改件专卖",
    url: "https://www.goofish.com/item?id=mock_009",
  },

  // ❌ 完全无关
  {
    id: "mock_010",
    title: "二手iPad Pro 11寸 256G 国行在保",
    price: 4200,
    description: "自用iPad Pro，成色95新，无磕碰，国行带发票。",
    seller: "数码闲置",
    url: "https://www.goofish.com/item?id=mock_010",
  },
];

/**
 * 模拟获取闲鱼搜索结果
 *
 * 第一次调用返回前 6 条（模拟初始数据）
 * 后续调用随机"上新" 1-3 条之前没出现过的
 *
 * 后续替换为真实闲鱼数据源时，只需改这个函数的实现
 */
let callCount = 0;

export function fetchMockListings(): Listing[] {
  callCount++;

  if (callCount === 1) {
    // 第一次：返回前 6 条
    return ALL_LISTINGS.slice(0, 6);
  }

  // 后续：返回前 6 条 + 随机追加 1-3 条新的
  const extra = Math.min(1 + Math.floor(Math.random() * 3), ALL_LISTINGS.length - 6);
  return [...ALL_LISTINGS.slice(0, 6), ...ALL_LISTINGS.slice(6, 6 + extra)];
}
