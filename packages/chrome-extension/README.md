# @lucida-analytics/chrome-extension

Lucida analytics and feature flags for browser extensions (Manifest V3): Chrome, Edge, Brave, Opera and Firefox.

- **Lifecycle events:** `$extension_installed`, `$extension_updated` (with `$previous_version`), `$extension_started` (browser start), and `$extension_uninstalled`.
- **One identity across the extension:** the background worker owns the client; popups, options pages, side panels and content scripts talk to it with messages. They all share one distinct id, one queue and one set of flags.
- **Works with the worker lifecycle:** listeners are registered in the worker's first turn, state lives in `chrome.storage.local`, batches go out within 3 seconds, and failed batches are kept and retried after a restart.
- **Private by default:** content-script events say nothing about the page the user is on unless you ask (`tabUrl`).
- **Web Store compliant:** the SDK is bundled into your extension. Nothing loads from a CDN.

## Install

```sh
npm i @lucida-analytics/chrome-extension
```

`manifest.json` needs the `storage` permission, and `host_permissions` for the capture host if your extension has a strict CSP:

```json
{ "permissions": ["storage"], "background": { "service_worker": "background.js", "type": "module" } }
```

## Background worker

Call `createClient` at the top level of the worker, not inside an event handler:

```ts
import { createClient } from "@lucida-analytics/chrome-extension";

const lucida = createClient("lc_pk_...");
// later: (await lucida).capture("summary_generated", { words: 120 });
```

## Popup, options page, side panel, content script

```ts
import { connect } from "@lucida-analytics/chrome-extension/page";

const lucida = connect(); // on an extension page this sends a $screen for the page (popup.html)
lucida.capture("highlight_saved");
if (await lucida.isFeatureEnabled("new-toolbar")) showToolbar();
```

Events carry `$extension_context` (`popup`, `options`, `side_panel`, `content_script`...). Flag reads are async here because they ask the worker.

## Uninstalls

By default, removing the extension opens a Lucida page that records `$extension_uninstalled` for that person and says the extension was removed. To show your own page instead (a survey, say), pass `uninstall: "https://example.com/bye"`. It opens with `lucida_distinct_id` and `lucida_extension_version` appended, and Lucida records nothing, so put the Lucida web snippet on that page if you want the event. Pass `uninstall: false` to turn it off. After an opt-out the URL is cleared.

## Options

| Option | Default | |
| --- | --- | --- |
| `apiHost` | `https://capture.lucidace.com` | |
| `consent.mode` | `opt_out` | `opt_in` captures nothing before `optIn()` |
| `uninstall` | `true` | `true`, your page URL, or `false` |
| `tabUrl` | `"none"` | content-script events: `"host"` adds `$host`, `"url"` adds `$current_url` too |
| `flushAt` / `flushIntervalMs` | `20` / `3000` | |
| `preloadFlags` / `sendFeatureFlags` | `true` / `true` | |

Every event carries `$extension_id`, `$extension_version` (also `$app_version`), `$os`, `$browser` and `$browser_version`.
