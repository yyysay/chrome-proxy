export interface IpCidr {
  family: 4 | 6;
  address: string;
  prefix: number;
  normalized: string;
  network: bigint;
}

function parseIpv4Address(value: string): bigint | undefined {
  const parts = value.split(".");
  if (parts.length !== 4) return undefined;
  const octets = parts.map(Number);
  if (octets.some((part, index) => !Number.isInteger(part) || part < 0 || part > 255 ||
      String(part) !== parts[index])) return undefined;
  return octets.reduce((result, part) => result << 8n | BigInt(part), 0n);
}

function formatIpv4(value: bigint): string {
  return [24n, 16n, 8n, 0n].map((shift) => Number(value >> shift & 255n)).join(".");
}

function parseIpv6Address(rawValue: string): bigint | undefined {
  let value = rawValue.toLowerCase();
  if (value.startsWith("[") && value.endsWith("]")) value = value.slice(1, -1);
  if (!value || value.includes("%") || (value.match(/::/g)?.length ?? 0) > 1) return undefined;

  if (value.includes(".")) {
    const lastColon = value.lastIndexOf(":");
    if (lastColon < 0) return undefined;
    const ipv4 = parseIpv4Address(value.slice(lastColon + 1));
    if (ipv4 === undefined) return undefined;
    value = `${value.slice(0, lastColon)}:${(ipv4 >> 16n).toString(16)}:${(ipv4 & 0xffffn).toString(16)}`;
  }

  const compressed = value.includes("::");
  const [leftText, rightText = ""] = value.split("::");
  const left = leftText ? leftText.split(":") : [];
  const right = rightText ? rightText.split(":") : [];
  if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return undefined;
  const missing = 8 - left.length - right.length;
  if ((!compressed && missing !== 0) || (compressed && missing < 1)) return undefined;
  const groups = [...left, ...Array(compressed ? missing : 0).fill("0"), ...right];
  if (groups.length !== 8) return undefined;
  return groups.reduce((result, group) => result << 16n | BigInt(`0x${group}`), 0n);
}

function formatIpv6(value: bigint): string {
  const groups = Array.from({ length: 8 }, (_, index) => Number(value >> BigInt((7 - index) * 16) & 0xffffn));
  let bestStart = -1;
  let bestLength = 0;
  for (let index = 0; index < groups.length;) {
    if (groups[index] !== 0) { index += 1; continue; }
    let end = index;
    while (end < groups.length && groups[end] === 0) end += 1;
    if (end - index > bestLength && end - index >= 2) {
      bestStart = index;
      bestLength = end - index;
    }
    index = end;
  }
  const hex = groups.map((group) => group.toString(16));
  if (bestStart < 0) return hex.join(":");
  return `${hex.slice(0, bestStart).join(":")}::${hex.slice(bestStart + bestLength).join(":")}`;
}

export function parseIpCidr(value: string): IpCidr | undefined {
  const [rawAddress, rawPrefix, ...extra] = value.trim().split("/");
  if (extra.length > 0 || rawPrefix === undefined) return undefined;
  const family = rawAddress.includes(":") ? 6 : 4;
  const address = family === 6 ? parseIpv6Address(rawAddress) : parseIpv4Address(rawAddress);
  const prefix = Number(rawPrefix);
  const bits = family === 6 ? 128 : 32;
  if (address === undefined || !Number.isInteger(prefix) || prefix < 0 || prefix > bits) return undefined;
  const bitCount = BigInt(bits);
  const prefixCount = BigInt(prefix);
  const mask = prefix === 0 ? 0n : ((1n << prefixCount) - 1n) << (bitCount - prefixCount);
  const network = address & mask;
  const normalizedAddress = family === 6 ? formatIpv6(network) : formatIpv4(network);
  return {
    family,
    address: normalizedAddress,
    prefix,
    normalized: `${normalizedAddress}/${prefix}`,
    network,
  };
}

export function normalizeIpCidr(value: string): string | undefined {
  return parseIpCidr(value)?.normalized;
}

export function normalizeIPv4Cidr(value: string): string | undefined {
  const parsed = parseIpCidr(value);
  return parsed?.family === 4 ? parsed.normalized : undefined;
}

export function ipMatchesCidr(address: string, cidr: string): boolean {
  const parsed = parseIpCidr(cidr);
  if (!parsed) return false;
  const rawAddress = address.startsWith("[") && address.endsWith("]") ? address.slice(1, -1) : address;
  const addressValue = parsed.family === 6 ? parseIpv6Address(rawAddress) : parseIpv4Address(rawAddress);
  if (addressValue === undefined) return false;
  const bits = BigInt(parsed.family === 6 ? 128 : 32);
  const prefix = BigInt(parsed.prefix);
  const mask = parsed.prefix === 0 ? 0n : ((1n << prefix) - 1n) << (bits - prefix);
  return (addressValue & mask) === parsed.network;
}
