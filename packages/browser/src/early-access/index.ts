import { enrollmentCapture, enrollmentProp } from "@lucida/sdk-core";
import type { EarlyAccessFeature } from "@lucida/sdk-core";
import type { Host, Module } from "../types.js";

const KEY = "lc_early_access";

/**
 * Early-access module (LC-FLG-12): `client.earlyAccess.list()` reads GET /v1/early-access (public key) and marks
 * what this browser opted in to; `optIn/optOut` emit `$early_access_opt_in` with the `$feature_enrollment/<key>`
 * person property the flag's release condition matches on, then reload flags. Enrolment is remembered in
 * consent-gated storage.
 */
export const earlyAccess: Module = (host: Host) => {
  const { core } = host;
  const read = (): Record<string, boolean> => {
    try {
      return JSON.parse(core.storage.get(KEY) ?? "{}") as Record<string, boolean>;
    } catch {
      return {};
    }
  };
  const set = (flag: string, enrolled: boolean): void => {
    core.storage.set(KEY, JSON.stringify({ ...read(), [flag]: enrolled }));
    const c = enrollmentCapture(flag, enrolled);
    core.capture(c.event, c.props, c.extra);
    void host.flags?.reload();
  };
  // The flag's release condition matches this person property; the gateway only sees what the request sends.
  host.flagPersonProps.push(() => Object.fromEntries(Object.entries(read()).map(([k, v]) => [enrollmentProp(k), v])));
  host.earlyAccess = {
    list: () =>
      new Promise<EarlyAccessFeature[]>((resolve) =>
        host.whenConsented(() => {
          host
            .fetch(`${host.config.apiHost}/v1/early-access?api_key=${encodeURIComponent(host.apiKey)}`, { credentials: "omit" })
            .then((r) => (r.ok ? (r.json() as Promise<{ features?: EarlyAccessFeature[] }>) : Promise.reject(new Error(`status ${r.status}`))))
            .then((j) => {
              const mine = read();
              resolve((j.features ?? []).map((f) => ({ ...f, enrolled: mine[f.flag_key] === true })));
            })
            .catch((e) => {
              host.log("early access fetch failed", e);
              resolve([]);
            });
        }),
      ),
    optIn: (k) => set(k, true),
    optOut: (k) => set(k, false),
  };
};
