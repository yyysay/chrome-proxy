import type { ProxyProviderState } from "../proxy/proxy-provider.ts";

let providerState: ProxyProviderState | undefined;

export function getProviderState(): ProxyProviderState | undefined {
  return providerState;
}

export function setProviderState(state: ProxyProviderState): void {
  providerState = state;
}
