import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readability } from "@mozilla/readability";
import * as cheerio from "cheerio";
import { XMLParser } from "fast-xml-parser";
import { JSDOM } from "jsdom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const cacheRoot = process.env.VERCEL ? tmpdir() : path.join(projectRoot, "cache");

const TIME_ZONE = "Asia/Shanghai";
const BBC_FEEDS = [
  "https://feeds.bbci.co.uk/news/rss.xml",
  "https://feeds.bbci.co.uk/news/world/rss.xml",
  "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml"
];

const stopWords = new Set([
  "about",
  "after",
  "again",
  "also",
  "because",
  "before",
  "between",
  "could",
  "every",
  "first",
  "from",
  "have",
  "into",
  "more",
  "most",
  "other",
  "people",
  "said",
  "school",
  "some",
  "that",
  "their",
  "there",
  "these",
  "they",
  "this",
  "through",
  "under",
  "when",
  "where",
  "which",
  "while",
  "with",
  "would"
]);

export async function getDailyLesson(options = {}) {
  const now = new Date();
  const dateInfo = getShanghaiDateInfo(now);
  const route = options.sourceKey ? getRouteForSource(options.sourceKey) : getRoute(dateInfo.weekdayShort);
  const variant = options.variant || "daily";
  const cacheKey = `${dateInfo.isoDate}-${route.sourceKey}-${variant}`;
  const cachePath = path.join(cacheRoot, `daily-lesson-${cacheKey}.json`);
  const latestPath = path.join(cacheRoot, "daily-lesson.json");

  if (!options.forceRefresh) {
    const cached = await readJson(cachePath);
    if (cached) return cached;
  }

  const lesson =
    route.sourceKey === "bbc"
      ? await buildBbcLesson(dateInfo, variant)
      : await buildZhongkaoLesson(dateInfo, variant);

  const payload = {
    ...lesson,
    generatedAt: now.toISOString(),
    cacheDate: dateInfo.isoDate,
    weekday: dateInfo.weekdayLabel,
    route
  };

  await writeJson(cachePath, payload);
  if (!process.env.VERCEL) await writeJson(latestPath, payload);

  return payload;
}

export function getRoute(weekdayShort) {
  if (["Mon", "Wed", "Fri"].includes(weekdayShort)) {
    return {
      sourceKey: "bbc",
      sourceLabel: "BBC 新闻实时联网材料",
      note: "今天按规则从 BBC RSS 抓取并解析新闻材料。"
    };
  }

  if (["Tue", "Thu", "Sat"].includes(weekdayShort)) {
    return {
      sourceKey: "zhongkao",
      sourceLabel: "上海中考真题联网材料",
      note: "今天按规则搜索并解析上海中考英语阅读题材料。"
    };
  }

  return {
    sourceKey: "bbc",
    sourceLabel: "周日混合复习联网材料",
    note: "周日原规则未指定来源，本版默认抓取 BBC 作为复习阅读。"
  };
}

export function getRouteForSource(sourceKey) {
  if (sourceKey === "bbc") {
    return {
      sourceKey: "bbc",
      sourceLabel: "BBC 新闻实时联网材料",
      note: "已按调试参数指定从 BBC RSS 抓取并解析新闻材料。"
    };
  }

  if (sourceKey === "zhongkao") {
    return {
      sourceKey: "zhongkao",
      sourceLabel: "上海中考真题联网材料",
      note: "已按调试参数指定搜索并解析上海中考英语阅读题材料。"
    };
  }

  return getRoute("Mon");
}

async function buildBbcLesson(dateInfo, variant) {
  let item;
  let article;

  try {
    const items = await fetchBbcItems();
    item = chooseBySeed(items, `${dateInfo.isoDate}-bbc-${variant}`);
    const html = await fetchText(item.link);
    article = extractArticle(html, item.link);
  } catch (error) {
    const topic = "BBC News source temporarily unavailable";
    return composeLesson({
      sourceKey: "bbc",
      sourceLabel: "BBC 新闻实时联网材料",
      sourceName: "BBC News RSS",
      sourceUrl: BBC_FEEDS[0],
      provider: "bbc-rss-network-fallback",
      title: topic,
      topic,
      sourceSummary:
        "The backend attempted to fetch BBC RSS, but the current network could not reach BBC. The same code will retry on the deployed server.",
      keywords: ["source", "network", "report", "reader", "context", "information"],
      style: "news",
      sourceDiagnostics: {
        fetchError: error instanceof Error ? error.message : "Unknown BBC fetch error",
        copyrightNote:
          "The displayed passage is a generated study adaptation, not a verbatim BBC article excerpt."
      }
    });
  }

  const keywords = extractKeywords(`${item.title} ${item.description} ${article.text}`, 10);
  const topic = cleanTitle(article.title || item.title);

  return composeLesson({
    sourceKey: "bbc",
    sourceLabel: "BBC 新闻实时联网材料",
    sourceName: "BBC News RSS",
    sourceUrl: item.link,
    provider: "bbc-rss-readability",
    title: topic,
    topic,
    sourceSummary: item.description,
    keywords,
    style: "news",
    sourceDiagnostics: {
      feedTitle: item.feedTitle,
      fetchedArticleWords: countWords(article.text),
      copyrightNote:
        "The displayed passage is a generated study adaptation based on parsed source metadata, not a verbatim BBC article excerpt."
    }
  });
}

async function buildZhongkaoLesson(dateInfo, variant) {
  const result = process.env.TAVILY_API_KEY
    ? await searchWithTavily(dateInfo, variant)
    : await fetchOfficialShanghaiFallback();
  const sourceText = await loadSourceText(result.url);
  const keywords = extractKeywords(`${result.title} ${result.snippet} ${sourceText}`, 10);
  const topic = cleanTitle(result.title || "Shanghai English Reading Practice");

  return composeLesson({
    sourceKey: "zhongkao",
    sourceLabel: process.env.TAVILY_API_KEY
      ? "上海中考真题联网材料"
      : "上海中考真题联网材料",
    sourceName: result.provider,
    sourceUrl: result.url,
    provider: result.provider,
    title: topic,
    topic,
    sourceSummary: result.snippet,
    keywords,
    style: "exam",
    sourceDiagnostics: {
      searchQuery: result.query,
      fetchedSourceWords: countWords(sourceText),
      tavilyEnabled: Boolean(process.env.TAVILY_API_KEY),
      note: process.env.TAVILY_API_KEY
        ? "Tavily search was used to locate a Shanghai entrance-exam reading source."
        : "Set TAVILY_API_KEY for real search over exam PDFs/pages; without it the service fetches the official Shanghai exam site as a live source and creates an exam-style passage."
    }
  });
}

async function fetchBbcItems() {
  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true
  });
  const allItems = [];
  const errors = [];

  const feedResults = await Promise.allSettled(
    BBC_FEEDS.map(async (feedUrl) => ({
      feedUrl,
      xml: await fetchText(feedUrl)
    }))
  );

  for (const result of feedResults) {
    if (result.status === "rejected") {
      errors.push(result.reason instanceof Error ? result.reason.message : "unknown feed error");
      continue;
    }

    try {
      const { feedUrl, xml } = result.value;
      const parsed = parser.parse(xml);
      const channel = parsed?.rss?.channel;
      const feedItems = Array.isArray(channel?.item)
        ? channel.item
        : [channel?.item].filter(Boolean);

      feedItems.forEach((item) => {
        if (!item?.link || !item?.title) return;
        allItems.push({
          title: stripTags(item.title),
          link: String(item.link),
          description: stripTags(item.description || ""),
          pubDate: item.pubDate || "",
          feedTitle: channel?.title || feedUrl
        });
      });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "unknown parse error");
    }
  }

  const seen = new Set();
  const uniqueItems = allItems.filter((item) => {
    if (seen.has(item.link)) return false;
    seen.add(item.link);
    return item.link.includes("bbc.");
  });

  if (!uniqueItems.length) {
    throw new Error(`No BBC RSS items available. ${errors.join(" | ")}`);
  }

  return uniqueItems;
}

async function searchWithTavily(dateInfo, variant) {
  const query =
    variant === "daily"
      ? "上海中考英语 阅读理解 真题 PDF"
      : `上海中考英语 阅读理解 真题 PDF ${dateInfo.isoDate}`;
  const response = await fetchWithTimeout("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.TAVILY_API_KEY}`
    },
    body: JSON.stringify({
      query,
      search_depth: "advanced",
      max_results: 8,
      include_answer: false,
      include_raw_content: false
    })
  });

  if (!response.ok) {
    throw new Error(`Tavily search failed: ${response.status}`);
  }

  const data = await response.json();
  const results = Array.isArray(data.results) ? data.results : [];
  const best =
    results.find((item) => /上海|中考|英语|试卷|真题|阅读/.test(`${item.title} ${item.content}`)) ||
    results[0];

  if (!best?.url) {
    throw new Error("Tavily returned no usable Shanghai exam result.");
  }

  return {
    provider: "Tavily Search",
    query,
    title: best.title || "Shanghai English Exam Reading",
    url: best.url,
    snippet: best.content || ""
  };
}

async function fetchOfficialShanghaiFallback() {
  const url = "https://www.shmeea.edu.cn/";
  const html = await fetchText(url);
  const $ = cheerio.load(html);
  const title = $("title").first().text().trim() || "Shanghai Municipal Education Examinations Authority";
  const links = $("a")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean)
    .slice(0, 8)
    .join("; ");

  return {
    provider: "Shanghai Municipal Education Examinations Authority",
    query: "official-homepage-fallback",
    title,
    url,
    snippet: links || "Official Shanghai examination information source."
  };
}

async function loadSourceText(url) {
  if (!url) return "";
  const response = await fetchWithTimeout(url);
  if (!response.ok) return "";
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("pdf") || /\.pdf($|\?)/i.test(url)) {
    const buffer = Buffer.from(await response.arrayBuffer());
    const pdfParse = (await import("pdf-parse")).default;
    const parsed = await pdfParse(buffer);
    return parsed.text || "";
  }

  const html = await response.text();
  return extractArticle(html, url).text;
}

function composeLesson(input) {
  const keywordPhrase = formatKeywords(input.keywords);
  const sourcePhrase = safePhrase(input.sourceSummary);
  const isNews = input.style === "news";
  const title = isNews
    ? `BBC Reading: ${input.topic}`
    : `Shanghai Exam Reading: ${input.topic}`;
  const sentences = isNews
    ? [
        `A live source from BBC News focuses on ${input.topic}, and it connects the story with ${keywordPhrase}.`,
        `The original report gives readers a real event to follow, but this classroom passage rewrites the topic in simpler language for English learners.`,
        `A student should notice how the report explains what happened, who was affected, and why the situation matters beyond one place.`,
        `The passage also offers useful words for describing causes, responses, risks and public information.`,
        `When you read it aloud, try to pause after each clause, mark the subject and verb, and use the context to guess unfamiliar words before checking a dictionary.`
      ]
    : [
        `A live education source connected with Shanghai exam materials points to reading practice about ${input.topic}.`,
        `The topic is useful for Grade Eight students because it feels close to school life, public information and practical reading tasks.`,
        `In a middle-school reading test, students often need to find details, guess meanings from context and understand why a writer includes examples.`,
        `This practice passage keeps the language clear while still using exam-style sentence patterns and vocabulary.`,
        `As you read, underline the subject and verb in each sentence, then decide whether the sentence is describing a fact, giving a reason or explaining a result.`
      ];
  const paragraph = ensureMinimumWords(sentences.join(" "), input.style, input.topic, keywordPhrase);
  const translated = isNews
    ? [
        `BBC 新聞的即時來源聚焦於「${input.topic}」，並且把這則故事與 ${keywordPhrase} 等關鍵概念連結起來。`,
        "原始報導提供了一個真實事件讓讀者理解，但這段課堂閱讀已用較簡單的語言重新改寫，方便英語學習者閱讀。",
        "學生應注意報導如何說明發生了什麼、誰受到影響，以及為什麼這件事不只與單一地點有關。",
        "這段文章也提供了描述原因、回應、風險與公共資訊的實用詞彙。",
        "朗讀時，請試著在每個從句後停頓，標出主詞和動詞，並先利用上下文猜測生詞，再查字典。"
      ]
    : [
        `與上海考試材料相關的即時教育來源，指向了關於「${input.topic}」的閱讀練習。`,
        "這個主題適合初二學生，因為它接近校園生活、公共資訊與實用閱讀任務。",
        "在中學閱讀題中，學生常需要尋找細節、根據上下文猜測意思，並理解作者為什麼加入例子。",
        "這段練習文章保持語言清楚，同時使用接近考試風格的句型與詞彙。",
        "閱讀時，請在每句中畫出主詞和動詞，再判斷句子是在描述事實、給出原因，還是在解釋結果。"
      ];
  const sentenceTranslations = translated;
  const grammar = buildGrammar(sentences);

  return {
    sourceKey: input.sourceKey,
    sourceLabel: input.sourceLabel,
    sourceName: input.sourceName,
    sourceUrl: input.sourceUrl,
    provider: input.provider,
    title,
    paragraph,
    translation: sentenceTranslations.join(""),
    sentenceTranslations,
    grammar,
    wordCount: countWords(paragraph),
    vocabSuggestions: input.keywords.slice(0, 8),
    sourceDiagnostics: {
      ...input.sourceDiagnostics,
      sourceSummary: sourcePhrase
    }
  };
}

function buildGrammar(sentences) {
  return sentences.map((sentence) => {
    const lower = sentence.toLowerCase();
    let formula = "S + Vt + O / Adv";
    let tense = "一般现在时用于说明事实、习惯或阅读策略。";

    if (lower.startsWith("when ") || lower.includes(" before ")) {
      formula = "Adv-Clause + S + Vt + O";
    } else if (lower.includes(" because ")) {
      formula = "S + Vt + O + Adv-Clause";
    } else if (/\b(can|should|must|need to|try to)\b/i.test(sentence)) {
      formula = "S + Modal / Verb Phrase + V + O";
    } else if (lower.includes(" and ")) {
      formula = "S + V + O, and S + V + O";
    }

    return {
      sentence,
      formula,
      explanation: `句中可先找 S(主词) 与 V(谓词)，再看 O(宾词)、C(补语) 或 Adv(状语)。${tense} 如果有 because、when、before 等连接词，后面的部分通常是状语从句，用来说明原因、时间或条件。`
    };
  });
}

function ensureMinimumWords(paragraph, style, topic, keywordPhrase) {
  if (countWords(paragraph) >= 100) return paragraph;
  const extra =
    style === "news"
      ? ` This longer study version asks the reader to compare facts with opinions, notice reporting verbs, and think about how reliable information helps a community respond calmly. The topic of ${topic} also gives practice with words such as ${keywordPhrase}, which may appear in school reading passages about health, science, weather or society.`
      : ` This longer study version asks the reader to scan for names, times and reasons, then read again for the writer's purpose. The topic of ${topic} also gives practice with words such as ${keywordPhrase}, which may appear in school reading passages about projects, notices, libraries, communities or daily problem solving.`;
  return `${paragraph}${extra}`;
}

function extractArticle(html, url) {
  const dom = new JSDOM(html, { url });
  const readable = new Readability(dom.window.document).parse();
  const readableText = normalizeText(readable?.textContent || "");
  if (readableText) {
    return {
      title: readable?.title || "",
      text: readableText
    };
  }

  const $ = cheerio.load(html);
  $("script, style, noscript, svg").remove();
  return {
    title: $("title").first().text().trim(),
    text: normalizeText($("body").text())
  };
}

function extractKeywords(text, limit = 10) {
  const counts = new Map();
  const words = normalizeText(text)
    .toLowerCase()
    .match(/\b[a-z][a-z-]{4,}\b/g);

  if (!words) return ["reading", "context", "details", "practice"];

  words.forEach((word) => {
    if (stopWords.has(word)) return;
    counts.set(word, (counts.get(word) || 0) + 1);
  });

  const keywords = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([word]) => word)
    .filter((word, index, arr) => arr.indexOf(word) === index)
    .slice(0, limit);

  return keywords.length ? keywords : ["reading", "context", "details", "practice"];
}

async function fetchText(url, init = {}) {
  const response = await fetchWithTimeout(url, init);
  if (!response.ok) {
    throw new Error(`Fetch failed for ${url}: ${response.status}`);
  }
  return response.text();
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "User-Agent":
          "DailyEnglishStudio/1.0 (+https://vercel.app; educational reading practice)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.5",
        ...(init.headers || {})
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

function chooseBySeed(items, seed) {
  if (!items.length) throw new Error("No source items available.");
  const digest = createHash("sha256").update(seed).digest("hex");
  const index = Number.parseInt(digest.slice(0, 8), 16) % items.length;
  return items[index];
}

function getShanghaiDateInfo(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  const isoDate = `${get("year")}-${get("month")}-${get("day")}`;
  const weekdayShort = get("weekday");
  const weekdayLabel = new Intl.DateTimeFormat("zh-CN", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long"
  }).format(date);

  return { isoDate, weekdayShort, weekdayLabel };
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function writeJson(filePath, data) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function countWords(text) {
  return normalizeText(text).split(/\s+/).filter(Boolean).length;
}

function cleanTitle(title) {
  return normalizeText(stripTags(title)).replace(/\s+-\s+BBC News$/i, "") || "Today's Reading";
}

function formatKeywords(keywords) {
  return keywords.slice(0, 4).join(", ") || "context, reading, details and practice";
}

function normalizeText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function stripTags(value) {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function safePhrase(value) {
  const phrase = normalizeText(stripTags(value));
  return phrase.length > 220 ? `${phrase.slice(0, 220)}...` : phrase;
}
