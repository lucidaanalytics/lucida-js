/** Lowercase user-agent markers of crawlers and headless clients; mirrors go/internal/botua (the server classifies precisely). */
const NEEDLES = [
  "bot",
  "crawl",
  "spider",
  "slurp",
  "headlesschrome",
  "phantomjs",
  "puppeteer",
  "playwright",
  "lighthouse",
  "pingdom",
  "uptimerobot",
  "facebookexternalhit",
  "preview",
  "scrapy",
  "python-requests",
  "go-http-client",
];

/** True when the user agent names a known bot (an empty UA is not flagged). */
export function isBotUserAgent(ua: string): boolean {
  const l = ua.toLowerCase();
  // "cubot" is a phone brand whose UA would otherwise match "bot".
  return NEEDLES.some((n) => l.includes(n)) && !/\bcubot\b/.test(l);
}
