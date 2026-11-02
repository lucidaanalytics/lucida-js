export type Props = Record<string, unknown>;
export type FlagValue = boolean | string;

export interface ReplayOptions {
  /** Default false. Also needs `replay` consent. */
  enabled?: boolean;
  maskAllText?: boolean;
  maskAllTextInputs?: boolean;
  maskAllImages?: boolean;
  maskSandboxedViews?: boolean;
  /** 0..1, decided once per session. */
  sampleRate?: number;
  throttleMs?: number;
  captureTouches?: boolean;
  minDurationMs?: number;
  maskScreens?: string[];
  maskTextPatterns?: string[];
}

export interface InitOptions {
  apiHost?: string;
  consent?: { mode?: "opt_in" | "opt_out"; queueBeforeConsent?: boolean };
  flushAt?: number;
  flushIntervalMs?: number;
  maxQueueSize?: number;
  debug?: boolean;
  appVersion?: string;
  replay?: ReplayOptions;
}

export interface ConsentUpdate {
  analytics?: boolean;
  replay?: boolean;
  marketing?: boolean;
}

export interface LucidaCordova {
  init(apiKey: string, options?: InitOptions): Promise<void>;
  capture(event: string, props?: Props): Promise<void>;
  screen(name: string, props?: Props): Promise<void>;
  identify(id: string, set?: Props, setOnce?: Props): Promise<void>;
  alias(alias: string): Promise<void>;
  group(type: string, key: string, props?: Props): Promise<void>;
  register(props: Props): Promise<void>;
  registerOnce(props: Props): Promise<void>;
  unregister(key: string): Promise<void>;
  reset(): Promise<void>;
  getDistinctId(): Promise<string>;
  getAnonymousId(): Promise<string>;
  optIn(): Promise<void>;
  optOut(): Promise<void>;
  setConsent(update: ConsentUpdate): Promise<void>;
  isOptedOut(): Promise<boolean>;
  getFlag(key: string): Promise<FlagValue | null>;
  isFeatureEnabled(key: string): Promise<boolean>;
  getFlagPayload(key: string): Promise<unknown>;
  reloadFlags(): Promise<void>;
  onFlags(cb: (flags: Record<string, FlagValue>) => void): Promise<void>;
  startReplay(): Promise<void>;
  stopReplay(): Promise<void>;
  pauseReplay(): Promise<void>;
  resumeReplay(): Promise<void>;
  isReplayActive(): Promise<boolean>;
  flush(): Promise<void>;
  stripReserved(props?: Props): Props;
}

declare const lucida: LucidaCordova;
export default lucida;
