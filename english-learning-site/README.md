# Daily English Studio

一个适合初二学生的英语阅读学习网站。前端负责学习流程与手机端展示，后端负责联网抓取、解析、缓存并生成 `/daily-lesson.json`。

## 本地运行

```bash
npm install
npm run dev
```

打开：

```text
http://127.0.0.1:3000
```

API：

```text
http://127.0.0.1:3000/daily-lesson.json
```

## 每日选文规则

- 周一、周三、周五：抓取 BBC RSS，并用 Readability/Cheerio 解析来源页面。
- 周二、周四、周六：优先用 Tavily 搜索上海中考英语阅读真题；没有 `TAVILY_API_KEY` 时抓取上海市教育考试院官网作为官方联网来源，并生成中考风格阅读材料。
- 周日：默认走 BBC 复习材料。

## 可选环境变量

```bash
TAVILY_API_KEY=你的 Tavily API Key
```

设置后，中考路径会使用 Tavily 搜索更精确的真题或 PDF 页面。

## Vercel 部署

1. 将本项目推送到 GitHub。
2. 登录 Vercel。
3. 选择 `Add New Project`。
4. 导入 GitHub 仓库。
5. Framework Preset 选择 `Other`。
6. 不需要 Build Command。
7. Output Directory 留空。
8. 如需 Tavily 搜索，在 Environment Variables 里添加 `TAVILY_API_KEY`。
9. Deploy。

Vercel 会通过 `vercel.json` 把 `/daily-lesson.json` 转发到 `api/daily-lesson.js`。
