import type { Client, FlagValue } from "@lucida-analytics/browser";
import { computed, onMounted, watch } from "vue";
import type { ComputedRef } from "vue";
import { useLucidaState } from "./plugin.js";

export function useLucida(): Client | null {
  return useLucidaState().client;
}

/** Stable capture function; a no-op while there is no client (SSR). */
export function useCapture(): Client["capture"] {
  const { client } = useLucidaState();
  return (event, props) => client?.capture(event, props);
}

/** Reactive flag value; the exposure is recorded after mount and when the value changes, never during setup. */
export function useFlag(key: string): ComputedRef<FlagValue | undefined> {
  const { client, flags } = useLucidaState();
  const value = computed(() => flags.value[key]);
  const expose = (): void => void (value.value !== undefined && client?.getFlag(key));
  onMounted(() => {
    expose();
    watch(value, expose);
  });
  return value;
}

export function useFlagPayload(key: string): ComputedRef<unknown> {
  const { client, flags } = useLucidaState();
  // reading flags.value makes the payload re-evaluate whenever flags reload
  return computed(() => (flags.value, client?.getFlagPayload(key)));
}

/** Keys of all flags that are on (true or a variant). */
export function useActiveFlags(): ComputedRef<string[]> {
  const { flags } = useLucidaState();
  return computed(() => Object.keys(flags.value).filter((k) => flags.value[k] !== false));
}

/** Consent controls for a cookie banner. Nothing is stored or sent until `grant()` in opt_in mode. */
export function useConsent(): Pick<Client, "setConsent" | "optIn" | "optOut"> & { grant(): void; revoke(): void } {
  const { client } = useLucidaState();
  return {
    setConsent: (u) => client?.setConsent(u),
    optIn: () => client?.optIn(),
    optOut: () => client?.optOut(),
    grant: () => client?.setConsent({ analytics: true, replay: true }),
    revoke: () => client?.setConsent({ analytics: false, replay: false, marketing: false }),
  };
}
