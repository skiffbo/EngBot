import { getDailyLesson } from "../lib/dailyLesson.js";

const lesson = await getDailyLesson({
  forceRefresh: true,
  variant: `smoke-${Date.now()}`,
  sourceKey: process.env.SMOKE_SOURCE
});

const required = [
  ["paragraph", typeof lesson.paragraph === "string" && lesson.paragraph.split(/\s+/).length >= 100],
  ["translation", typeof lesson.translation === "string" && lesson.translation.length > 50],
  ["grammar", Array.isArray(lesson.grammar) && lesson.grammar.length >= 5],
  ["sourceUrl", typeof lesson.sourceUrl === "string" && lesson.sourceUrl.startsWith("http")]
];

const failed = required.filter(([, ok]) => !ok).map(([name]) => name);

if (failed.length) {
  console.error(`Smoke test failed: ${failed.join(", ")}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      title: lesson.title,
      source: lesson.sourceName,
      sourceUrl: lesson.sourceUrl,
      words: lesson.wordCount,
      route: lesson.route
    },
    null,
    2
  )
);
