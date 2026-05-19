import { api, postJSON } from '../api';

type PasskeyStartResponse = {
  session_id: string;
  options: PublicKeyCredentialCreationOptionsJSON | PublicKeyCredentialRequestOptionsJSON;
};

type PublicKeyCredentialCreationOptionsJSON = {
  publicKey: Omit<PublicKeyCredentialCreationOptions, 'challenge' | 'user' | 'excludeCredentials'> & {
    challenge: string;
    user: Omit<PublicKeyCredentialUserEntity, 'id'> & { id: string };
    excludeCredentials?: Array<Omit<PublicKeyCredentialDescriptor, 'id'> & { id: string }>;
  };
};

type PublicKeyCredentialRequestOptionsJSON = {
  publicKey: Omit<PublicKeyCredentialRequestOptions, 'challenge' | 'allowCredentials'> & {
    challenge: string;
    allowCredentials?: Array<Omit<PublicKeyCredentialDescriptor, 'id'> & { id: string }>;
  };
};

export type PasskeyCredentialSummary = {
  id: number;
  name: string;
  last_used_at?: string;
  created_at: string;
};

export async function registerPasskey() {
  assertPasskeySupported();
  const start = await postJSON<PasskeyStartResponse>('/api/user/passkeys/register/start', {});
  const publicKey = start.options.publicKey as PublicKeyCredentialCreationOptionsJSON['publicKey'];
  const credential = await navigator.credentials.create({
    publicKey: {
      ...publicKey,
      challenge: base64URLToBuffer(publicKey.challenge),
      user: { ...publicKey.user, id: base64URLToBuffer(publicKey.user.id) },
      excludeCredentials: publicKey.excludeCredentials?.map((item) => ({
        ...item,
        id: base64URLToBuffer(item.id)
      }))
    }
  });
  if (!credential) throw new Error('Passkey registration was canceled');
  return api<PasskeyCredentialSummary>(`/api/user/passkeys/register/finish?session_id=${encodeURIComponent(start.session_id)}`, {
    method: 'POST',
    body: JSON.stringify(credentialToJSON(credential as PublicKeyCredential))
  });
}

export async function loginWithPasskey(email: string) {
  assertPasskeySupported();
  const start = await postJSON<PasskeyStartResponse>('/api/auth/passkeys/login/start', { email });
  const publicKey = start.options.publicKey as PublicKeyCredentialRequestOptionsJSON['publicKey'];
  const credential = await navigator.credentials.get({
    publicKey: {
      ...publicKey,
      challenge: base64URLToBuffer(publicKey.challenge),
      allowCredentials: publicKey.allowCredentials?.map((item) => ({
        ...item,
        id: base64URLToBuffer(item.id)
      }))
    }
  });
  if (!credential) throw new Error('Passkey login was canceled');
  return api(`/api/auth/passkeys/login/finish?session_id=${encodeURIComponent(start.session_id)}`, {
    method: 'POST',
    body: JSON.stringify(credentialToJSON(credential as PublicKeyCredential))
  });
}

function assertPasskeySupported() {
  if (!window.PublicKeyCredential || !navigator.credentials) {
    throw new Error('This browser does not support passkeys');
  }
}

function credentialToJSON(credential: PublicKeyCredential) {
  const response = credential.response;
  const payload: Record<string, unknown> = {
    id: credential.id,
    rawId: bufferToBase64URL(credential.rawId),
    type: credential.type,
    response: {}
  };
  if ('getClientExtensionResults' in credential) {
    payload.clientExtensionResults = credential.getClientExtensionResults();
  }
  if (response instanceof AuthenticatorAttestationResponse) {
    payload.response = {
      clientDataJSON: bufferToBase64URL(response.clientDataJSON),
      attestationObject: bufferToBase64URL(response.attestationObject),
      transports: response.getTransports?.()
    };
  } else if (response instanceof AuthenticatorAssertionResponse) {
    payload.response = {
      clientDataJSON: bufferToBase64URL(response.clientDataJSON),
      authenticatorData: bufferToBase64URL(response.authenticatorData),
      signature: bufferToBase64URL(response.signature),
      userHandle: response.userHandle ? bufferToBase64URL(response.userHandle) : null
    };
  }
  return payload;
}

function base64URLToBuffer(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = window.atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function bufferToBase64URL(buffer: BufferSource) {
  const bytes = buffer instanceof ArrayBuffer
    ? new Uint8Array(buffer)
    : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
