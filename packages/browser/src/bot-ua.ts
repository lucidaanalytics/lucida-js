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
  "cypress",
  "lightpanda",
  "hubspot",
  "nessus",
  "prerender",
  "deepscan",
  "screaming frog",
  "sitebulb",
  "turnitin",
  "ia_archiver",
  "chatgpt-user",
  "app.hypefactors.com",
  "google favicon",
  "google web preview",
  "-google", // apis-google, adsbot-google, feedfetcher-google, mediapartners-google, storebot-google ...
  "googleother",
  "googleweblight",
  "google-read-aloud",
  "google-inspectiontool",
  "google-hoteladsverifier",
  "google-cloudvertexbot",
];

/** True when the user agent names a known bot (an empty UA is not flagged). */
export function isBotUserAgent(ua: string, extra: string[] = []): boolean {
  const l = ua.toLowerCase();
  if (extra.some((n) => n && l.includes(n.toLowerCase()))) return true;
  // "cubot" is a phone brand whose UA would otherwise match "bot".
  return NEEDLES.some((n) => l.includes(n)) && !/\bcubot\b/.test(l);
}
