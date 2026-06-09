export type SenderIdentity = {
  fromAddress?: string | null;
  fromName?: string | null;
};

export type SenderBrandIdentity = {
  domain: string;
  senderDomain: string;
  displayName: string;
  known: boolean;
};

const EMAIL_PATTERN = /([A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,}))/i;
const BRACKETED_EMAIL_PATTERN = /<([^>]+)>/;

const BRAND_NAMES: Record<string, string> = {
  'openai.com': 'OpenAI',
  'chatgpt.com': 'ChatGPT',
  'anthropic.com': 'Anthropic',
  'claude.ai': 'Claude',
  'perplexity.ai': 'Perplexity',
  'huggingface.co': 'Hugging Face',
  'github.com': 'GitHub',
  'gitlab.com': 'GitLab',
  'bitbucket.org': 'Bitbucket',
  'gitee.com': 'Gitee',
  'oschina.net': '开源中国',
  'coding.net': 'Coding',
  'csdn.net': 'CSDN',
  'juejin.cn': '掘金',
  'segmentfault.com': 'SegmentFault',
  '51cto.com': '51CTO',
  'stackoverflow.com': 'Stack Overflow',
  'stackexchange.com': 'Stack Exchange',
  'atlassian.com': 'Atlassian',
  'jira.com': 'Jira',
  'trello.com': 'Trello',
  'linear.app': 'Linear',
  'sentry.io': 'Sentry',
  'datadoghq.com': 'Datadog',
  'newrelic.com': 'New Relic',
  'grafana.com': 'Grafana',
  'docker.com': 'Docker',
  'kubernetes.io': 'Kubernetes',
  'npmjs.com': 'npm',
  'pypi.org': 'PyPI',
  'python.org': 'Python',
  'jetbrains.com': 'JetBrains',
  'vercel.com': 'Vercel',
  'netlify.com': 'Netlify',
  'render.com': 'Render',
  'railway.app': 'Railway',
  'fly.io': 'Fly.io',
  'heroku.com': 'Heroku',
  'supabase.com': 'Supabase',
  'firebase.google.com': 'Firebase',
  'cloud.google.com': 'Google Cloud',
  'auth0.com': 'Auth0',
  'okta.com': 'Okta',
  'twilio.com': 'Twilio',
  'sendgrid.com': 'SendGrid',
  'mailgun.com': 'Mailgun',
  'postmarkapp.com': 'Postmark',
  'resend.com': 'Resend',
  'mailchimp.com': 'Mailchimp',
  'brevo.com': 'Brevo',
  'sendinblue.com': 'Brevo',
  'mongodb.com': 'MongoDB',
  'redis.io': 'Redis',
  'redis.com': 'Redis',
  'elastic.co': 'Elastic',
  'neon.tech': 'Neon',
  'planetscale.com': 'PlanetScale',
  'pinecone.io': 'Pinecone',
  'cloudflare.com': 'Cloudflare',
  'digitalocean.com': 'DigitalOcean',
  'google.com': 'Google',
  'gmail.com': 'Gmail',
  'googlemail.com': 'Gmail',
  'youtube.com': 'YouTube',
  'workspace.google.com': 'Google Workspace',
  'accounts.google.com': 'Google',
  'microsoft.com': 'Microsoft',
  'office.com': 'Microsoft 365',
  'outlook.com': 'Outlook',
  'live.com': 'Microsoft',
  'windows.com': 'Microsoft',
  'apple.com': 'Apple',
  'icloud.com': 'Apple',
  'amazon.com': 'Amazon',
  'aws.amazon.com': 'AWS',
  'meta.com': 'Meta',
  'facebook.com': 'Facebook',
  'facebookmail.com': 'Facebook',
  'instagram.com': 'Instagram',
  'whatsapp.com': 'WhatsApp',
  'x.com': 'X',
  'twitter.com': 'X',
  'linkedin.com': 'LinkedIn',
  'reddit.com': 'Reddit',
  'discord.com': 'Discord',
  'discordapp.com': 'Discord',
  'slack.com': 'Slack',
  'telegram.org': 'Telegram',
  'signal.org': 'Signal',
  'zoom.us': 'Zoom',
  'notion.so': 'Notion',
  'notion.com': 'Notion',
  'figma.com': 'Figma',
  'canva.com': 'Canva',
  'dropbox.com': 'Dropbox',
  'box.com': 'Box',
  'wordpress.com': 'WordPress',
  'wordpress.org': 'WordPress',
  'shopify.com': 'Shopify',
  'stripe.com': 'Stripe',
  'paypal.com': 'PayPal',
  'wise.com': 'Wise',
  'airbnb.com': 'Airbnb',
  'booking.com': 'Booking.com',
  'uber.com': 'Uber',
  'spotify.com': 'Spotify',
  'netflix.com': 'Netflix',
  'steampowered.com': 'Steam',
  'steamcommunity.com': 'Steam',
  'epicgames.com': 'Epic Games',
  'playstation.com': 'PlayStation',
  'xbox.com': 'Xbox',
  'tiktok.com': 'TikTok',
  'pinterest.com': 'Pinterest',
  'medium.com': 'Medium',
  'quora.com': 'Quora',
  'proton.me': 'Proton',
  'protonmail.com': 'Proton Mail',
  'fastmail.com': 'Fastmail',
  'zoho.com': 'Zoho',
  'yandex.com': 'Yandex',
  'yandex.ru': 'Yandex',
  'mail.ru': 'Mail.ru',
  'godaddy.com': 'GoDaddy',
  'namecheap.com': 'Namecheap',
  'cloudinary.com': 'Cloudinary',
  'qq.com': 'QQ',
  'mail.qq.com': 'QQ Mail',
  'foxmail.com': 'Foxmail',
  'wechat.com': 'WeChat',
  'weixin.qq.com': 'WeChat',
  'work.weixin.qq.com': '企业微信',
  'tencent.com': 'Tencent',
  'cloud.tencent.com': 'Tencent Cloud',
  'tencentcloud.com': 'Tencent Cloud',
  'qcloud.com': 'Tencent Cloud',
  'aliyun.com': '阿里云',
  'alibabacloud.com': 'Alibaba Cloud',
  'alibaba.com': 'Alibaba',
  'alibabagroup.com': 'Alibaba',
  'alipay.com': 'Alipay',
  'antgroup.com': 'Ant Group',
  'taobao.com': 'Taobao',
  'tmall.com': 'Tmall',
  'dingtalk.com': 'DingTalk',
  'cainiao.com': 'Cainiao',
  '1688.com': '1688',
  'baidu.com': 'Baidu',
  'passport.baidu.com': 'Baidu',
  'cloud.baidu.com': 'Baidu Cloud',
  'baidubce.com': 'Baidu Cloud',
  'huawei.com': 'Huawei',
  'huaweicloud.com': 'Huawei Cloud',
  'vmall.com': 'VMall',
  'xiaomi.com': 'Xiaomi',
  'mi.com': 'Xiaomi',
  'bytedance.com': 'ByteDance',
  'douyin.com': 'Douyin',
  'feishu.cn': 'Feishu',
  'larksuite.com': 'Lark',
  'volcengine.com': 'Volcengine',
  'toutiao.com': 'Toutiao',
  'bilibili.com': 'Bilibili',
  'netease.com': 'NetEase',
  '163.com': 'NetEase Mail',
  '126.com': 'NetEase Mail',
  'yeah.net': 'NetEase Mail',
  'youdao.com': 'Youdao',
  'sina.com': 'Sina',
  'sina.com.cn': 'Sina',
  'weibo.com': 'Weibo',
  'sohu.com': 'Sohu',
  'jd.com': 'JD',
  'jdcloud.com': 'JD Cloud',
  'meituan.com': 'Meituan',
  'dianping.com': 'Dianping',
  'ele.me': 'Ele.me',
  'elemecdn.com': 'Ele.me',
  'pinduoduo.com': 'Pinduoduo',
  'yangkeduo.com': 'Pinduoduo',
  'xiaohongshu.com': 'Xiaohongshu',
  'zhihu.com': 'Zhihu',
  'douban.com': 'Douban',
  'kuaishou.com': 'Kuaishou',
  'iqiyi.com': 'iQIYI',
  'youku.com': 'Youku',
  'v.qq.com': 'Tencent Video',
  'mgtv.com': 'Mango TV',
  'gotokeep.com': 'Keep',
  'keep.com': 'Keep',
  'didiglobal.com': 'DiDi',
  'didichuxing.com': 'DiDi',
  'amap.com': 'Amap',
  'ctrip.com': 'Ctrip',
  'trip.com': 'Trip.com',
  'qunar.com': 'Qunar',
  '12306.cn': '12306',
  'lianjia.com': 'Lianjia',
  'ke.com': 'Beike',
  'unionpay.com': 'UnionPay',
  '95516.com': 'UnionPay',
  '10086.cn': 'China Mobile',
  'chinamobile.com': 'China Mobile',
  '10010.com': 'China Unicom',
  'chinaunicom.com': 'China Unicom',
  '189.cn': 'China Telecom',
  'chinatelecom.com.cn': 'China Telecom',
  'icbc.com.cn': 'ICBC',
  'ccb.com': 'China Construction Bank',
  'abchina.com': 'Agricultural Bank of China',
  'boc.cn': 'Bank of China',
  'cmbchina.com': 'China Merchants Bank',
  'pingan.com': 'Ping An',
  'citicbank.com': 'CITIC Bank',
  'cmbc.com.cn': 'CMBC',
  'spdb.com.cn': 'SPDB',
  'qiniu.com': 'Qiniu Cloud',
  'ucloud.cn': 'UCloud',
  'upyun.com': 'Upyun',
  'qingcloud.com': 'QingCloud',
  'ksyun.com': 'Kingsoft Cloud',
  'leancloud.cn': 'LeanCloud',
  'leancloud.app': 'LeanCloud',
  'rongcloud.cn': 'RongCloud',
  'agora.io': 'Agora',
  'jiguang.cn': 'Jiguang',
  'geetest.com': 'Geetest',
  'pingcap.com': 'PingCAP',
  'taptap.cn': 'TapTap',
  'taptap.io': 'TapTap',
  'smzdm.com': '什么值得买',
  'vip.com': 'Vipshop',
  'suning.com': 'Suning',
  'dangdang.com': 'Dangdang',
  'mihoyo.com': 'miHoYo',
  'hoyoverse.com': 'HoYoverse',
  'wanmei.com': 'Perfect World',
  'perfectworld.com': 'Perfect World',
  'tapdb.com': 'TapDB',
  'linux.do': 'LINUX DO'
};

const KNOWN_BRAND_DOMAINS = Object.keys(BRAND_NAMES).sort((left, right) => right.length - left.length);

const MULTI_PART_SUFFIXES = new Set([
  'ac.cn',
  'com.cn',
  'edu.cn',
  'gov.cn',
  'net.cn',
  'org.cn',
  'com.hk',
  'com.tw',
  'com.sg',
  'com.my',
  'com.ph',
  'co.jp',
  'ne.jp',
  'or.jp',
  'co.kr',
  'com.au',
  'net.au',
  'org.au',
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'com.br',
  'com.mx',
  'com.tr',
  'co.in',
  'firm.in',
  'net.in',
  'org.in',
  'co.nz'
]);

export function getSenderBrandIdentity(identity: SenderIdentity): SenderBrandIdentity {
  const senderHost = senderDomain(identity.fromAddress || '');
  const domain = getRegistrableDomain(senderHost);
  return {
    domain,
    senderDomain: senderHost,
    displayName: domain ? humanizeDomain(domain) : senderDisplayName(identity),
    known: Boolean(domain && BRAND_NAMES[domain])
  };
}

export function getRegistrableDomain(domain: string) {
  const clean = cleanDomain(domain);
  if (!clean) return '';

  const known = KNOWN_BRAND_DOMAINS.find((brandDomain) => clean === brandDomain || clean.endsWith(`.${brandDomain}`));
  if (known) return known;

  const parts = clean.split('.').filter(Boolean);
  if (parts.length <= 2) return clean;

  const suffix2 = parts.slice(-2).join('.');
  if (MULTI_PART_SUFFIXES.has(suffix2) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

export function senderDomain(fromAddress: string) {
  return extractSenderDomain(fromAddress);
}

export function extractSenderDomain(value?: string | null) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const bracketed = raw.match(BRACKETED_EMAIL_PATTERN)?.[1] || raw;
  const emailMatch = bracketed.match(EMAIL_PATTERN) || raw.match(EMAIL_PATTERN);
  if (emailMatch?.[2]) return cleanDomain(emailMatch[2]);

  try {
    const candidate = raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`;
    const url = new URL(candidate);
    if (url.hostname.includes('.')) return cleanDomain(url.hostname);
  } catch {
    // Fall through to the loose domain matcher.
  }

  const domainMatch = raw.match(/([a-z0-9-]+\.)+[a-z]{2,}/i);
  return domainMatch ? cleanDomain(domainMatch[0]) : '';
}

export function senderDisplayName(identity: SenderIdentity) {
  const name = (identity.fromName || '').trim();
  if (name) return name;
  return extractEmailAddress(identity.fromAddress || '').trim() || 'unknown';
}

export function senderInitial(identity: SenderIdentity) {
  const source = senderDisplayName(identity);
  const ascii = source.match(/[A-Za-z0-9]/)?.[0];
  return (ascii || Array.from(source.trim())[0] || '?').toLocaleUpperCase();
}

export function senderIdentityKey(identity: SenderIdentity) {
  return `${senderDisplayName(identity)} ${senderDomain(identity.fromAddress || '')}`.trim();
}

function extractEmailAddress(value: string) {
  const bracketed = value.match(BRACKETED_EMAIL_PATTERN)?.[1];
  const source = bracketed || value;
  return source.match(EMAIL_PATTERN)?.[1] || source;
}

function cleanDomain(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[.@]+|[>\]),.;:\s]+$/g, '')
    .replace(/^www\.(?=.+\.)/, '');
}

function humanizeDomain(domain: string) {
  if (BRAND_NAMES[domain]) return BRAND_NAMES[domain];
  const label = domain.split('.')[0] || 'mail';
  return label
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Mail';
}
