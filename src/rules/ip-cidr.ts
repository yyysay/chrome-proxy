export interface IPv4Cidr {
  address: string;
  prefix: number;
  mask: string;
  network: number;
}

function ipv4ToNumber(value: string): number | undefined {
  const parts = value.split(".");
  if (parts.length !== 4) return undefined;
  const octets = parts.map(Number);
  if (octets.some((part, index) => !Number.isInteger(part) || part < 0 || part > 255 ||
      String(part) !== parts[index])) return undefined;
  return (((octets[0] * 256 + octets[1]) * 256 + octets[2]) * 256 + octets[3]) >>> 0;
}

function numberToIpv4(value: number): string {
  return [value >>> 24, value >>> 16 & 255, value >>> 8 & 255, value & 255].join(".");
}

export function parseIPv4Cidr(value: string): IPv4Cidr | undefined {
  const [rawAddress, rawPrefix, ...extra] = value.trim().split("/");
  if (extra.length > 0 || rawPrefix === undefined) return undefined;
  const addressNumber = ipv4ToNumber(rawAddress);
  const prefix = Number(rawPrefix);
  if (addressNumber === undefined || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return undefined;
  const maskNumber = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return {
    address: numberToIpv4(addressNumber & maskNumber),
    prefix,
    mask: numberToIpv4(maskNumber),
    network: addressNumber & maskNumber,
  };
}

export function normalizeIPv4Cidr(value: string): string | undefined {
  const parsed = parseIPv4Cidr(value);
  return parsed ? `${parsed.address}/${parsed.prefix}` : undefined;
}

export function ipv4MatchesCidr(address: string, cidr: string): boolean {
  const addressNumber = ipv4ToNumber(address);
  const parsed = parseIPv4Cidr(cidr);
  if (addressNumber === undefined || !parsed) return false;
  const maskNumber = parsed.prefix === 0 ? 0 : (0xffffffff << (32 - parsed.prefix)) >>> 0;
  return (addressNumber & maskNumber) === parsed.network;
}
