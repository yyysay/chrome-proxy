export interface NetworkGeoInfo {
  country?: string;
  countryCode?: string;
  region?: string;
  city?: string;
  isp?: string;
  asn?: number;
}

export interface NetworkRouteInfo extends NetworkGeoInfo {
  ip: string;
  requestMs?: number;
}

export interface NetworkInfoCache {
  host: string;
  port: number;
  checkedAt: string;
  direct?: NetworkRouteInfo;
  proxy?: NetworkRouteInfo;
  directError?: string;
  proxyError?: string;
  sameExitIp: boolean;
}

export interface NetworkInfoResult {
  proxyEndpoint?: string;
  direct?: NetworkRouteInfo;
  proxy?: NetworkRouteInfo;
  directError?: string;
  proxyError?: string;
  sameExitIp: boolean;
}
