interface NetworkGeoInfo {
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
  nodeName: string;
  host: string;
  port: number;
  checkedAt: string;
  proxy?: NetworkRouteInfo;
  proxyError?: string;
}

export interface NetworkInfoResult {
  proxy?: NetworkRouteInfo;
  proxyError?: string;
}
