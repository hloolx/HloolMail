export type { APIKey, MailboxStats, User } from '../../api';

import type { APIKey } from '../../api';

export type CreateApiKeyPayload = {
  name: string;
  daily_limit: number;
  total_limit: number;
  expires_at?: string;
};

export type CreateApiKeyResponse = {
  api_key: APIKey;
  plain_key: string;
};

export type RevealApiKeyResponse = {
  plain_key: string;
};
