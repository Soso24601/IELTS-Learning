/**
 * 网络层出站安全：防止服务端被诱导访问内网/本机/云元数据（SSRF）。
 * 适用于：LLM baseUrl（用户可配置）、crawl-video 的任意 URL。
 */

import dns from 'node:dns/promises';
import net from 'node:net';

const PRIVATE_IPV4_RE = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;

function isPrivateLiteralHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (net.isIPv4(h)) return PRIVATE_IPV4_RE.test(h);
  if (net.isIPv6(h)) {
    const v6 = h.toLowerCase();
    if (v6 === '::1' || v6 === '::' || v6.startsWith('fe80') || v6.startsWith('fc') || v6.startsWith('fd')) {
      return true;
    }
    return false;
  }
  return false;
}

export function parseHttpUrl(urlStr: string): URL {
  let u: URL;
  try {
    u = new URL(urlStr);
  } catch {
    throw new Error('INVALID_URL: 不是合法的 URL');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new Error('INVALID_URL: 仅支持 http/https');
  }
  return u;
}

/**
 * 校验一个出站 http(s) URL 安全：
 * - dev 允许 localhost/127.0.0.1 的 http；
 * - 生产强制 https；
 * - 拒绝字面量私网 / 链路本地 / 云元数据 IP；
 * - 非字面量主机名做一次 DNS 解析，任一结果落在私网段则拒绝。
 */
export async function assertSafeHttpUrl(urlStr: string): Promise<void> {
  const u = parseHttpUrl(urlStr);
  const host = u.hostname;
  const isDev = process.env.NODE_ENV !== 'production';

  if (u.protocol === 'http:' && !(isDev && isPrivateLiteralHost(host))) {
    throw new Error('UNSAFE_URL: 生产环境出站请求必须使用 https');
  }
  if (isPrivateLiteralHost(host)) {
    if (!(isDev && (host === 'localhost' || host === '127.0.0.1' || host === '::1'))) {
      throw new Error('UNSAFE_URL: 不允许访问本机或内网地址');
    }
    return; // dev localhost 直接放行
  }
  // 域名主机：解析并检查 IP
  try {
    const records = await dns.lookup(host, { all: true });
    for (const r of records) {
      if (isPrivateLiteralHost(r.address)) {
        throw new Error('UNSAFE_URL: 目标域名解析到内网地址，已阻止');
      }
    }
  } catch (e: any) {
    // 解析失败（无 DNS）视为不安全的抓取目标；但允许某些环境无 DNS 时跳过
    if (e && (e.message || '').includes('内网地址')) throw e;
    // 无法解析 → 拒绝，避免 DNS rebinding / 无 DNS 探测
    throw new Error('UNSAFE_URL: 无法解析目标主机，已阻止');
  }
}

export function assertSafeHttpUrlSync(urlStr: string): void {
  const u = parseHttpUrl(urlStr);
  const host = u.hostname;
  const isDev = process.env.NODE_ENV !== 'production';
  if (u.protocol === 'http:' && !(isDev && isPrivateLiteralHost(host))) {
    throw new Error('UNSAFE_URL: 生产环境出站请求必须使用 https');
  }
  if (isPrivateLiteralHost(host) && !(isDev && (host === 'localhost' || host === '127.0.0.1' || host === '::1'))) {
    throw new Error('UNSAFE_URL: 不允许访问本机或内网地址');
  }
}
