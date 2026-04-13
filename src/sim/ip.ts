export function ipToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    throw new Error(`Invalid IPv4 address: ${ip}`);
  }
  return parts.reduce((value, part) => ((value << 8) | part) >>> 0, 0);
}

export function maskToInt(mask: number): number {
  if (!Number.isInteger(mask) || mask < 0 || mask > 32) {
    throw new Error(`Invalid prefix length: ${mask}`);
  }
  return mask === 0 ? 0 : (0xffffffff << (32 - mask)) >>> 0;
}

export function sameSubnet(a: string, b: string, mask: number): boolean {
  const maskInt = maskToInt(mask);
  return (ipToInt(a) & maskInt) === (ipToInt(b) & maskInt);
}

export function containsIp(prefix: string, mask: number, ip: string): boolean {
  const maskInt = maskToInt(mask);
  return (ipToInt(prefix) & maskInt) === (ipToInt(ip) & maskInt);
}
