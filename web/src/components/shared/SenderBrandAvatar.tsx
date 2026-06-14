import { useEffect, useMemo, useState } from 'react';
import { defaultAvatarURLForIdentity } from '../../lib/avatarAssets';
import { getSenderBrandIdentity, senderDisplayName, senderIdentityKey, senderInitial, type SenderIdentity } from '../../lib/senderBrand';

type SenderBrandAvatarProps = SenderIdentity & {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
};

type BrandIconCacheRecord = {
  domain: string;
  iconUrl: string;
  savedAt: number;
};

type BrandIconNegativeRecord = {
  domain: string;
  savedAt: number;
};

const BRAND_ICON_CACHE_KEY = 'hloolmail.brandIconCache';
const BRAND_ICON_NEGATIVE_CACHE_KEY = 'hloolmail.brandIconNegativeCache';
const ICON_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ITEMS = 240;

const SIZE_PIXELS: Record<NonNullable<SenderBrandAvatarProps['size']>, number> = {
  sm: 32,
  md: 36,
  lg: 42
};

export function SenderBrandAvatar({ fromAddress, fromName, className = '', size = 'md' }: SenderBrandAvatarProps) {
  const identity = useMemo(() => ({ fromAddress, fromName }), [fromAddress, fromName]);
  const brand = useMemo(() => getSenderBrandIdentity(identity), [identity]);
  const label = senderDisplayName(identity);
  const fallbackURL = defaultAvatarURLForIdentity(senderIdentityKey(identity));
  const [iconURL, setIconURL] = useState('');
  const [failedIconDomain, setFailedIconDomain] = useState('');
  const [failedFallbackURL, setFailedFallbackURL] = useState('');
  const showBrandIcon = Boolean(iconURL && brand.domain && failedIconDomain !== brand.domain);
  const showFallbackImage = failedFallbackURL !== fallbackURL;
  const title = brand.domain ? `${brand.displayName} · ${label}` : label;

  useEffect(() => {
    setFailedFallbackURL('');
  }, [fallbackURL]);

  useEffect(() => {
    if (!brand.domain) {
      setIconURL('');
      setFailedIconDomain('');
      return;
    }

    const cached = getCachedIcon(brand.domain);
    if (cached) {
      setIconURL(cached.iconUrl);
      setFailedIconDomain('');
      return;
    }
    if (isNegativeCached(brand.domain)) {
      setIconURL('');
      setFailedIconDomain(brand.domain);
      return;
    }

    setIconURL(brandIconEndpoint(brand.domain, SIZE_PIXELS[size]));
    setFailedIconDomain('');
  }, [brand.domain, size]);

  return (
    <span className={`sender-brand-avatar sender-brand-avatar-${size} ${showBrandIcon ? 'sender-brand-avatar-loaded' : ''} ${className}`.trim()} title={title} aria-label={title}>
      {showBrandIcon ? (
        <img
          alt=""
          className="sender-brand-avatar-icon"
          src={iconURL}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => rememberIcon(brand.domain, iconURL)}
          onError={() => {
            rememberNegative(brand.domain);
            setIconURL('');
            setFailedIconDomain(brand.domain);
          }}
        />
      ) : showFallbackImage ? (
        <img
          alt=""
          className="sender-brand-avatar-image"
          src={fallbackURL}
          loading="lazy"
          decoding="async"
          onError={() => setFailedFallbackURL(fallbackURL)}
        />
      ) : (
        <span className="sender-brand-avatar-fallback">{senderInitial(identity)}</span>
      )}
    </span>
  );
}

function brandIconEndpoint(domain: string, size: number) {
  const safeSize = Math.max(24, Math.min(96, Math.round(size || 36)));
  return `/api/brand-icon?domain=${encodeURIComponent(domain)}&size=${safeSize}`;
}

function getCachedIcon(domain: string) {
  const cache = readCacheMap<BrandIconCacheRecord>(BRAND_ICON_CACHE_KEY);
  const record = cache[domain];
  if (!record || Date.now() - Number(record.savedAt || 0) > ICON_TTL_MS) return null;
  return record;
}

function rememberIcon(domain: string, iconUrl: string) {
  if (!domain || !iconUrl) return;
  const cache = readCacheMap<BrandIconCacheRecord>(BRAND_ICON_CACHE_KEY);
  cache[domain] = { domain, iconUrl, savedAt: Date.now() };
  writeCacheMap(BRAND_ICON_CACHE_KEY, cache);

  const negative = readCacheMap<BrandIconNegativeRecord>(BRAND_ICON_NEGATIVE_CACHE_KEY);
  if (negative[domain]) {
    delete negative[domain];
    writeCacheMap(BRAND_ICON_NEGATIVE_CACHE_KEY, negative);
  }
}

function isNegativeCached(domain: string) {
  const cache = readCacheMap<BrandIconNegativeRecord>(BRAND_ICON_NEGATIVE_CACHE_KEY);
  const record = cache[domain];
  return Boolean(record && Date.now() - Number(record.savedAt || 0) < NEGATIVE_TTL_MS);
}

function rememberNegative(domain: string) {
  if (!domain) return;
  const cache = readCacheMap<BrandIconNegativeRecord>(BRAND_ICON_NEGATIVE_CACHE_KEY);
  cache[domain] = { domain, savedAt: Date.now() };
  writeCacheMap(BRAND_ICON_NEGATIVE_CACHE_KEY, cache);
}

function readCacheMap<T>(key: string): Record<string, T> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed as Record<string, T> : {};
  } catch {
    return {};
  }
}

function writeCacheMap<T extends { savedAt?: number }>(key: string, value: Record<string, T>) {
  if (typeof window === 'undefined') return;
  try {
    const entries = Object.entries(value)
      .sort((left, right) => Number(right[1]?.savedAt || 0) - Number(left[1]?.savedAt || 0))
      .slice(0, MAX_CACHE_ITEMS);
    window.localStorage.setItem(key, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Some browsers disable localStorage in private contexts; the visual fallback is enough.
  }
}
