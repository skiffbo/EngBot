import { getDailyLesson } from "../lib/dailyLesson.js";

export default async function handler(request, response) {
  try {
    const url = new URL(request.url, "http://localhost");
    const forceRefresh = url.searchParams.get("force") === "1";
    const variant = url.searchParams.get("variant") || "daily";
    const sourceKey = url.searchParams.get("source") || undefined;
    const lesson = await getDailyLesson({ forceRefresh, variant, sourceKey });

    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    response.status(200).json(lesson);
  } catch (error) {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.status(500).json({
      error: "daily_lesson_failed",
      message: error instanceof Error ? error.message : "Unknown lesson generation error"
    });
  }
}
