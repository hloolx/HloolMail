import { useEffect, useState, type CSSProperties } from 'react';
import { defaultAvatarURLForIdentity } from '../../lib/avatarAssets';
import { resolveSenderBrand, senderDisplayName, senderIdentityKey, senderInitial, type SenderIdentity } from '../../lib/senderBrand';

type SenderBrandAvatarProps = SenderIdentity & {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
};

export function SenderBrandAvatar({ fromAddress, fromName, className = '', size = 'md' }: SenderBrandAvatarProps) {
  const identity = { fromAddress, fromName };
  const brand = resolveSenderBrand(identity);
  const label = senderDisplayName(identity);
  const fallbackURL = defaultAvatarURLForIdentity(senderIdentityKey(identity));
  const [failedFallbackURL, setFailedFallbackURL] = useState('');
  const showFallbackImage = !brand && failedFallbackURL !== fallbackURL;
  const title = brand ? `${brand.name} · ${label}` : label;
  const style = brand
    ? ({
        '--sender-avatar-bg': brand.background,
        '--sender-avatar-fg': brand.foreground
      } as CSSProperties)
    : undefined;

  useEffect(() => {
    setFailedFallbackURL('');
  }, [fallbackURL]);

  return (
    <span className={`sender-brand-avatar sender-brand-avatar-${size} ${brand ? 'sender-brand-avatar-known' : ''} ${className}`.trim()} title={title} style={style}>
      {brand ? (
        <span className="sender-brand-avatar-mark">{brand.shortLabel}</span>
      ) : showFallbackImage ? (
        <img
          alt=""
          className="sender-brand-avatar-image"
          src={fallbackURL}
          onError={() => setFailedFallbackURL(fallbackURL)}
        />
      ) : (
        <span className="sender-brand-avatar-fallback">{senderInitial(identity)}</span>
      )}
    </span>
  );
}
