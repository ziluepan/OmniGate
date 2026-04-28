# AI Crawler

一个面向任意网页的智能抓取 CLI。

它不是写死 selector 的普通爬虫，而是结合了隐身浏览器环境、自动化人机验证对抗机制，并在成功突破防御后，由 AI 自动分析网页结构、提炼上下文，甚至直接精准萃取你需要的结构化内容。

## 🎯 核心能力

- **Spider 风格工具层：**
  - 内置 `extract / full_content / links / crawl` 四类工具。
  - 入口会按任务自动路由到最合适的工具，不再默认所有问题都走同一条抽取链路。
  - 支持显式覆盖：`--tool extract|full_content|links|crawl`。
- **内置页面 Skills：**
  - `listing-page`：列表页、搜索结果页、目录页，偏向数组输出。
  - `product-detail`：商品详情页，偏向价格、规格、库存、卖点等结构化字段。
  - `documentation-page`：文档/API 页面，偏向步骤、参数、示例、注意事项。
  - `article-page`：文章、博客、新闻页，偏向标题、作者、发布时间、正文。
  - `discussion-thread`：论坛贴、问答、讨论页，偏向楼主内容和高质量回复。
  - `novel-chapter`：小说章节页，偏向全文原样返回。
  - `generic-page`：兜底通用 skill。
- **智能提炼：** 支持对任意网页的上下文分析，根据你的中文 Prompt 自然语言提问，返回精准的 JSON 结构化抽取结果。
- **浏览器失败自动降级：** 如果 Playwright/Chrome 在当前环境无法启动，会自动退回到本地 HTTP snapshot 抓取，公开博客和文档页不再直接因为浏览器挂掉而失败。
- **Spider 风格站点级 Crawl：**
  - 内置 `frontier` 优先级队列，优先抓取更像正文/商品/文章的 URL。
  - 支持去重、同源限制、深度限制、包含/排除规则、多路由预算控制。
  - 支持多页抓取后的结果汇总，把站点里的多个页面抽取结果再合成为一个回答。
- **验证对抗与隐身 (Stealth)：**
  - 内置 `playwright-extra` 和 `puppeteer-extra-plugin-stealth` 无缝规避基础反爬检测（掩盖 WebDriver 防护）。
  - **全自动穿透墙：** 自动化处理 Cloudflare Turnstile 等 “人机验证” 挑战框，爬虫自带坐标重排与拟真鼠标点击。
- **本地闭环控制器 (`ChallengeAwareController`)：** 为更复杂的验证码场景预留了人工介入或者接入打码平台（例如 2Captcha等）的挂起阻塞接口。
- **灵活降级策略：** 当你不希望耗费大模型的时间时，或希望自己处理文本时，能够一键屏蔽 AI 提炼，输出完整 DOM 的纯文本映射模式 (`--full-content`)。
- **大模型生态兼容：** 完全适配所有的 OpenAI Compatible 的大模型接口代理服务（包括本地部署的 Ollama、vLLM 或云端服务）。

## ⚙️ 安装与依赖

```bash
npm install
```

如果是首次运行 Playwright，还需要安装配套的浏览器依赖：

```bash
npx playwright install chromium
```

## 🛠️ 环境配置 (.env)

在根目录复制 `.env.example` 为 `.env`，按照你的环境填写：

```env
# AI 核心配置
AI_API_URL=https://api.openai.com/v1/chat/completions # 或你当地的 OpenAI 兼容代理地址
AI_MODEL=gpt-4o                                      
AI_API_KEY=your_api_key_here
AI_TIMEOUT_MS=600000                                  # AI 请求超时时间（推荐 10 分钟应对长条小说与极长网页生成）

# 爬虫行为配置
CRAWLER_NAVIGATION_TIMEOUT_MS=30000                   # 页面导航加载的生命周期
CRAWLER_MANUAL_AUTH_TIMEOUT_MS=120000                 # 留给验证码工具或手动应对的超时挂起时间
CRAWLER_STORAGE_STATE_PATH=.crawler-auth.json         # 保存验证通过的 Cookie
CRAWLER_BROWSER_EXECUTABLE_PATH=/usr/bin/google-chrome# 留空则使用内置沙盘版本，或者指向现有机器的 Chrome
```

## 🚀 常用场景与用法

### 1. 结构化 JSON 信息抽取

告诉 AI 你需要什么，由它自动找上下文：

```bash
npm start -- --url https://example.com --query "提取这页出现的商品标题、价格和主要卖点"
```

也可以显式指定走抽取工具：

```bash
npm start -- --url https://example.com --query "提取标题和价格" --tool extract
```

### 2. 半自动 Debug / 手动解封

如果自带的 Stealth 技术无法瞒过更新的反爬墙，你可以显式命令它打开有头模式。这时候如果卡在了盾前，你可以在浏览器视窗里手动点过去：

```bash
npm start -- --url https://example.com --query "分析结构" --headful --manual-auth
```

### 3. 站点级 Spider 风格抓取

让爬虫不只看当前页，而是继续沿链接向下抓：

```bash
npm start -- --url https://example.com --query "汇总站内商品标题和价格" --crawl --max-pages 20 --max-depth 2
```

或者显式走 `crawl` 工具：

```bash
npm start -- --url https://example.com --query "汇总站内商品标题和价格" --tool crawl --max-pages 20 --max-depth 2
```

只保留某些路径，并排除低价值页面：

```bash
npm start -- --url https://example.com --query "整理全部产品信息" --crawl --include "*products*" --exclude "*privacy*" --exclude "*terms*"
```

给不同路径加预算，避免某个目录无限扩散：

```bash
npm start -- --url https://example.com --query "汇总站点文章标题" --crawl --budget "/articles=10" --budget "/products=5" --budget "*=20"
```

如果确实要跨域继续跟链：

```bash
npm start -- --url https://example.com --query "汇总合作站点入口" --crawl --allow-external --round-robin-domains
```

### 4. 只取链接，不做正文抽取

```bash
npm start -- --url https://example.com/docs --query "列出这页所有链接" --tool links
```

如果不显式指定，像“列出这页所有链接”这样的查询也会自动路由到 `links`。

## 🧠 当前架构

现在项目分成三层：

- **任务工具路由层：** 根据用户请求在 `extract / full_content / links / crawl` 之间做选择。
- **单页智能抽取层：** 浏览器打开页面、处理验证、生成结构摘要、调用 AI 抽取。
- **站点级调度层：** `frontier + 去重 + 深度/预算/规则控制 + 结果汇总`，这部分吸收了 `spider` 项目的核心设计思路。

这意味着项目不再只是“打开一个页面问 AI”，而是先判断当前问题该调用哪类工具，再执行对应的抓取链路。

在单页抓取里，还会先经过 skill 匹配层：根据 URL、标题和用户查询挑选最合适的页面 skill，再把该 skill 的选择器、输出形状和提取提示注入给 LLM。

## 💡 开发与扩展（高级测试）

如果你想针对特定网站进一步开发自动化辅助机制，项目中带有 `ChallengeAwareController` 本地 Mock 架构的测试套件。它模拟了“被墙挂起 -> 人工/机器打码平台完成打码 -> 回调通知 -> 模型苏醒”的闭环流程。

执行测试闭环看看：

```bash
node --test test/challenge-controller.test.js
node --test
```

## 📜 边界与免责说明

本项目提供的 Stealth 技术与自动点击机制仅可应用于正当的研究目的或绕过恶意的无差别风控误拦。不可用于未授权站点的大型爬取、资源盗窃或商业对抗。若使用发生被目标站封禁 IP 的风险自行承担。
