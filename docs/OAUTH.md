# Third-party OAuth Login

The admin console includes **Third-party Login** for GitHub and Linux.do. Configure each provider there when possible so changes take effect without restarting the service.

Environment variables can also seed the default configuration:

```env
GITHUB_OAUTH_CLIENT_ID=
GITHUB_OAUTH_CLIENT_SECRET=
GITHUB_OAUTH_REDIRECT_URL=https://your-domain.com/api/oauth/github/callback
GITHUB_OAUTH_ENABLED=false

LINUXDO_OAUTH_CLIENT_ID=
LINUXDO_OAUTH_CLIENT_SECRET=
LINUXDO_OAUTH_REDIRECT_URL=https://your-domain.com/api/oauth/linuxdo/callback
LINUXDO_OAUTH_ENABLED=false
```

## GitHub OAuth App

1. Open https://github.com/settings/developers.
2. Choose **New OAuth App**.
3. Set **Application name** to your app name.
4. Set **Homepage URL** to your site home page.
5. Set **Authorization callback URL** to `https://your-domain.com/api/oauth/github/callback`.
6. Copy the Client ID and Client Secret into the admin console.

## Linux.do OAuth App

Linux.do Connect currently uses OAuth2 endpoints under `https://connect.linux.do`.

1. Confirm you have the required Linux.do administrator access.
2. Create an OAuth2 application in the Linux.do administrator area.
3. Set the redirect URI to `https://your-domain.com/api/oauth/linuxdo/callback`.
4. Copy the Client ID and Client Secret into the admin console.

If your Linux.do deployment requires DiscourseConnect instead of the OAuth2 flow, confirm the integration details with the Linux.do administrator and use the DiscourseConnect HMAC SSO protocol instead.
