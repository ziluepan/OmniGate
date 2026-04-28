import {
  EXTRACTION_MODES,
  OUTPUT_SHAPES,
  PRE_ACTIONS,
  WAIT_TYPES
} from "../types.js";

const PRODUCT_URL_PATTERNS = [
  /\/product\//iu,
  /\/products\//iu,
  /\/item\//iu,
  /\/goods\//iu,
  /\/sku\//iu,
  /\/detail\//iu,
  /\/dp\//iu
];

const PRODUCT_QUERY_KEYWORDS = [
  "商品",
  "价格",
  "规格",
  "参数",
  "卖点",
  "库存",
  "品牌",
  "型号",
  "购买",
  "product",
  "price",
  "spec"
];

export const productDetailSkill = {
  name: "product-detail",
  description:
    "商品详情页提取，适合商品标题、价格、规格、卖点、库存和购买信息",
  priority: 85,
  tags: ["content", "ecommerce", "product"],

  matchIntent(userQuery, snapshot) {
    const url = snapshot?.url ?? "";
    const title = snapshot?.title ?? "";
    const query = userQuery.toLowerCase();
    const urlMatch = PRODUCT_URL_PATTERNS.some((pattern) => pattern.test(url));
    const titleMatch = /价格|￥|¥|加入购物车|立即购买|product|sku|型号/iu.test(title);
    const queryMatch = PRODUCT_QUERY_KEYWORDS.some((keyword) =>
      query.includes(keyword.toLowerCase())
    );
    const listingLikeQuery = /列表|全部|所有商品|目录|搜索结果/iu.test(userQuery);

    return {
      match: (urlMatch || titleMatch || queryMatch) && !listingLikeQuery
    };
  },

  waitStrategy: {
    type: WAIT_TYPES.SELECTOR,
    selector:
      "h1, .product-title, .sku-title, [itemprop='name'], .price, [itemprop='price']",
    timeout: 15000
  },

  preActions: [
    PRE_ACTIONS.DISMISS_OVERLAYS,
    PRE_ACTIONS.WAIT_FOR_LAZY_LOAD
  ],

  extractStrategy: {
    selectors: [
      "main",
      ".product-detail",
      ".product-main",
      ".pdp-main",
      ".goods-detail",
      ".sku-wrap",
      "[itemtype*='Product']"
    ],
    mode: EXTRACTION_MODES.SECTIONS,
    outputShape: OUTPUT_SHAPES.OBJECT
  },

  extractionPrompt: [
    "这是一个商品详情页。",
    "请优先提取：商品标题、当前价格、原价、货币、品牌、型号、规格参数、核心卖点、库存/可售状态、配送或购买入口。",
    "忽略推荐商品、用户评论摘要和页脚营销模块，除非用户明确要求。"
  ].join("\n"),

  postProcess(rawText) {
    return rawText.trim();
  }
};
