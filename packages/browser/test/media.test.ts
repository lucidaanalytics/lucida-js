import { afterEach, describe, expect, it } from "vitest";
import type { Client } from "../src/index.js";
import { start } from "./helpers.js";

let live: Client | undefined;
afterEach(async () => {
  document.body.innerHTML = "";
  await live?.shutdown();
});

function video(html: string, ac: object = {}) {
  document.body.innerHTML = html;
  const s = start({ capturePageview: false, autocapture: ac as never });
  live = s.client;
  const el = document.querySelector("video, audio") as HTMLMediaElement;
  Object.defineProperty(el, "duration", { configurable: true, value: 100 });
  let t = 0;
  Object.defineProperty(el, "currentTime", { configurable: true, get: () => t });
  const at = (sec: number) => ((t = sec), el.dispatchEvent(new Event("timeupdate")));
  const fire = (type: string) => el.dispatchEvent(new Event(type));
  return { ...s, at, fire };
}

const media = (t: { events: () => Array<{ event: string; properties: Record<string, unknown> }> }) =>
  t.events().filter((e) => e.event.startsWith("$media_"));

describe("media engagement", () => {
  it("sends play once, each milestone once and complete, without the query string", async () => {
    const { client, t, at, fire } = video(`<video src="https://cdn.example.com/intro.mp4?token=secret" data-lc-media-title="Intro"></video>`);
    fire("play");
    fire("pause");
    fire("play");
    at(30);
    at(55);
    at(56);
    at(80);
    fire("ended");
    await client.flush();
    const evs = media(t);
    expect(evs.map((e) => [e.event, e.properties.$media_progress])).toEqual([
      ["$media_play", undefined],
      ["$media_progress", 25],
      ["$media_progress", 50],
      ["$media_progress", 75],
      ["$media_complete", undefined],
    ]);
    expect(evs[0]!.properties).toMatchObject({ $media_type: "video", $media_src: "https://cdn.example.com/intro.mp4", $media_title: "Intro", $media_duration: 100 });
    expect(JSON.stringify(evs)).not.toContain("secret");
  });

  it("starts a new playthrough after the end and can be turned off", async () => {
    const a = video(`<audio src="/pod.mp3"></audio>`);
    a.fire("play");
    a.fire("ended");
    a.fire("play");
    await a.client.flush();
    expect(media(a.t).map((e) => e.event)).toEqual(["$media_play", "$media_complete", "$media_play"]);
    expect(media(a.t)[0]!.properties.$media_type).toBe("audio");
    await live?.shutdown();

    const off = video(`<video src="/a.mp4"></video>`, { media: false });
    off.fire("play");
    await off.client.flush();
    expect(media(off.t)).toEqual([]);
  });
});
