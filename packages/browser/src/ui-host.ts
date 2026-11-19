/** Lucida cloud capture hosts and the app host serving each. */
const CLOUD: Record<string, string> = {
  "https://capture.lucidace.com": "https://lucidace.com",
  "https://capture.lucida.15-204-158-166.sslip.io": "https://lucida.15-204-158-166.sslip.io",
};

/** App host for deep links when `uiHost` is unset: the cloud app for a cloud capture host, else `apiHost` itself. */
export const defaultUiHost = (apiHost: string): string => CLOUD[apiHost.replace(/\/+$/, "")] ?? apiHost;
