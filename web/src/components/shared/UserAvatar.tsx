import { useEffect, useState } from 'react';
import type { User } from '../../api';
import { defaultAvatarURLForUser } from '../../lib/avatarAssets';
import { displayInitial, displayName } from '../../lib/userDisplay';

type UserAvatarProps = {
  user: Pick<User, 'email' | 'nickname' | 'avatar_url'>;
  className?: string;
};

export function UserAvatar({ user, className = '' }: UserAvatarProps) {
  const avatarURL = (user.avatar_url || '').trim();
  const defaultAvatarURL = defaultAvatarURLForUser(user);
  const [failedAvatarURL, setFailedAvatarURL] = useState('');
  const [failedDefaultAvatarURL, setFailedDefaultAvatarURL] = useState('');
  const showRemoteImage = avatarURL !== '' && failedAvatarURL !== avatarURL;
  const showDefaultImage = !showRemoteImage && failedDefaultAvatarURL !== defaultAvatarURL;

  useEffect(() => {
    setFailedAvatarURL('');
  }, [avatarURL]);

  useEffect(() => {
    setFailedDefaultAvatarURL('');
  }, [defaultAvatarURL]);

  return (
    <span className={`user-avatar ${className}`.trim()} title={displayName(user)}>
      {showRemoteImage ? (
        <img
          alt=""
          className="user-avatar-image"
          referrerPolicy="no-referrer"
          src={avatarURL}
          onError={() => setFailedAvatarURL(avatarURL)}
        />
      ) : showDefaultImage ? (
        <img
          alt=""
          className="user-avatar-image user-avatar-default-image"
          src={defaultAvatarURL}
          onError={() => setFailedDefaultAvatarURL(defaultAvatarURL)}
        />
      ) : (
        <span className="user-avatar-fallback">{displayInitial(user)}</span>
      )}
    </span>
  );
}
