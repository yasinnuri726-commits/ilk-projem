// Yol: klipai/apps/api/src/modules/projects/url-guard.ts
import { lookup } from 'node:dns/promises';
import * as ipaddr from 'ipaddr.js';
import { AppException } from '../../common/app-exception';

/**
 * Sayfa adresinden indirme kabul edilmeyen video platformları. Bu sitelerden
 * içerik indirmek kullanım koşullarına aykırıdır; kullanıcı dosyayı kendisi
 * yüklemelidir.
 */
const PLATFORM_HOSTS = [
  'youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'tiktok.com',
  'instagram.com',
  'facebook.com',
  'fb.watch',
  'twitter.com',
  'x.com',
  'twitch.tv',
  'vimeo.com',
  'dailymotion.com',
  'netflix.com',
  'primevideo.com',
  'disneyplus.com',
  'blutv.com',
  'exxen.com',
  'gain.tv',
  'spotify.com',
];

type Resolver = (host: string) => Promise<string[]>;

const systemResolver: Resolver = async (host) =>
  (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address);

export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  let parsed = ipaddr.parse(address);
  if (parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
    parsed = (parsed as ipaddr.IPv6).toIPv4Address();
  }
  return parsed.range() === 'unicast';
}

/**
 * Bağlantıdan alım için adres denetimi (SSRF koruması):
 * yalnızca HTTPS, kimlik bilgisi içermeyen, varsayılan kapıdaki, genel IP'ye
 * çözülen adresler. Worker indirme sırasında bağlandığı IP'yi yeniden doğrular.
 */
export async function assertIngestableUrl(raw: string, resolve: Resolver = systemResolver): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppException('UNSUPPORTED_SOURCE', 'Adres çözümlenemedi');
  }
  if (url.protocol !== 'https:') throw new AppException('UNSUPPORTED_SOURCE', 'Yalnızca HTTPS adresleri desteklenir');
  if (url.username || url.password || (url.port && url.port !== '443')) {
    throw new AppException('UNSUPPORTED_SOURCE', 'Adres kimlik bilgisi veya özel kapı içeremez');
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (PLATFORM_HOSTS.some((platform) => host === platform || host.endsWith(`.${platform}`))) {
    throw new AppException(
      'UNSUPPORTED_SOURCE',
      'Video platformu sayfa adresleri desteklenmez; dosyayı doğrudan yükleyin veya dosyanın kendi adresini verin',
    );
  }

  let addresses: string[];
  if (ipaddr.isValid(host)) {
    addresses = [host];
  } else {
    try {
      addresses = await resolve(host);
    } catch {
      throw new AppException('UNSUPPORTED_SOURCE', 'Alan adı çözülemedi');
    }
  }
  if (addresses.length === 0 || !addresses.every(isPublicAddress)) {
    throw new AppException('UNSUPPORTED_SOURCE', 'Adres genel ağda değil');
  }
  return url;
}
