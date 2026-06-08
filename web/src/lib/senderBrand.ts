export type SenderBrand = {
  name: string;
  shortLabel: string;
  domains: string[];
  keywords: string[];
  background: string;
  foreground: string;
};

export type SenderIdentity = {
  fromAddress?: string | null;
  fromName?: string | null;
};

type SenderBrandDefinition = [
  name: string,
  shortLabel: string,
  domains: string[],
  keywords: string[],
  background: string,
  foreground?: string
];

const EMAIL_PATTERN = /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i;
const BRACKETED_EMAIL_PATTERN = /<([^>]+)>/;

const brand = ([name, shortLabel, domains, keywords, background, foreground = '#ffffff']: SenderBrandDefinition): SenderBrand => ({
  name,
  shortLabel,
  domains,
  keywords,
  background,
  foreground
});

const SENDER_BRAND_DEFINITIONS: SenderBrandDefinition[] = [
  // Global AI and developer services.
  ['OpenAI', 'AI', ['openai.com', 'chatgpt.com'], ['openai', 'chatgpt'], '#101211'],
  ['Anthropic', 'A', ['anthropic.com', 'claude.ai'], ['anthropic', 'claude'], '#d97757', '#111111'],
  ['Perplexity', 'P', ['perplexity.ai'], ['perplexity'], '#1fb8cd', '#071215'],
  ['Hugging Face', 'HF', ['huggingface.co'], ['hugging face', 'huggingface'], '#ffcc4d', '#111111'],
  ['GitHub', 'GH', ['github.com'], ['github'], '#24292f'],
  ['GitLab', 'GL', ['gitlab.com'], ['gitlab'], '#fc6d26', '#111111'],
  ['Gitee', 'G', ['gitee.com', 'oschina.net'], ['gitee', '码云', '开源中国', 'oschina'], '#c71d23'],
  ['Coding', 'C', ['coding.net'], ['coding'], '#2563eb'],
  ['CSDN', 'C', ['csdn.net'], ['csdn'], '#d92d20'],
  ['Juejin', '掘', ['juejin.cn'], ['juejin', '掘金'], '#1e80ff'],
  ['SegmentFault', 'SF', ['segmentfault.com'], ['segmentfault'], '#00965e'],
  ['51CTO', '51', ['51cto.com'], ['51cto'], '#d71920'],
  ['Stack Overflow', 'SO', ['stackoverflow.com', 'stackexchange.com'], ['stack overflow', 'stackexchange'], '#f48024', '#111111'],
  ['Bitbucket', 'BB', ['bitbucket.org'], ['bitbucket'], '#0052cc'],
  ['Atlassian', 'A', ['atlassian.com', 'jira.com', 'trello.com'], ['atlassian', 'jira', 'trello'], '#0052cc'],
  ['Linear', 'L', ['linear.app'], ['linear'], '#5e6ad2'],
  ['Sentry', 'S', ['sentry.io'], ['sentry'], '#362d59'],
  ['Datadog', 'DD', ['datadoghq.com'], ['datadog'], '#632ca6'],
  ['New Relic', 'NR', ['newrelic.com'], ['new relic'], '#00ac69', '#061b1f'],
  ['Grafana', 'G', ['grafana.com'], ['grafana'], '#f46800', '#111111'],
  ['Docker', 'D', ['docker.com'], ['docker'], '#1d63ed'],
  ['Kubernetes', 'K8', ['kubernetes.io'], ['kubernetes'], '#326ce5'],
  ['npm', 'npm', ['npmjs.com'], ['npm'], '#cb3837'],
  ['PyPI', 'Py', ['pypi.org', 'python.org'], ['pypi', 'python'], '#3776ab'],
  ['JetBrains', 'JB', ['jetbrains.com'], ['jetbrains'], '#000000'],
  ['Vercel', 'V', ['vercel.com'], ['vercel'], '#000000'],
  ['Netlify', 'N', ['netlify.com'], ['netlify'], '#00ad9f', '#061b1f'],
  ['Render', 'R', ['render.com'], ['render'], '#46e3b7', '#061b1f'],
  ['Railway', 'R', ['railway.app'], ['railway'], '#0b0d0e'],
  ['Fly.io', 'Fly', ['fly.io'], ['fly.io'], '#7c3aed'],
  ['Heroku', 'H', ['heroku.com'], ['heroku'], '#430098'],
  ['Supabase', 'S', ['supabase.com'], ['supabase'], '#3ecf8e', '#061b1f'],
  ['Firebase', 'FB', ['firebase.google.com'], ['firebase'], '#ffca28', '#111111'],
  ['Auth0', 'A0', ['auth0.com'], ['auth0'], '#eb5424', '#111111'],
  ['Okta', 'O', ['okta.com', 'oktacdn.com'], ['okta'], '#00297a'],
  ['Twilio', 'T', ['twilio.com'], ['twilio'], '#f22f46'],
  ['SendGrid', 'SG', ['sendgrid.com'], ['sendgrid'], '#1a82e2'],
  ['Mailgun', 'MG', ['mailgun.com'], ['mailgun'], '#f06b66', '#111111'],
  ['Postmark', 'PM', ['postmarkapp.com'], ['postmark'], '#ffde00', '#111111'],
  ['Resend', 'R', ['resend.com'], ['resend'], '#000000'],
  ['Mailchimp', 'MC', ['mailchimp.com'], ['mailchimp'], '#ffe01b', '#111111'],
  ['Brevo', 'B', ['brevo.com', 'sendinblue.com'], ['brevo', 'sendinblue'], '#0b996e'],
  ['MongoDB', 'M', ['mongodb.com'], ['mongodb'], '#00ed64', '#062315'],
  ['Redis', 'R', ['redis.io', 'redis.com'], ['redis'], '#dc382d'],
  ['Elastic', 'E', ['elastic.co'], ['elastic'], '#005571'],
  ['Neon', 'N', ['neon.tech'], ['neon'], '#00e599', '#062315'],
  ['PlanetScale', 'PS', ['planetscale.com'], ['planetscale'], '#111111'],
  ['Pinecone', 'P', ['pinecone.io'], ['pinecone'], '#111827'],
  ['Cloudflare', 'CF', ['cloudflare.com'], ['cloudflare'], '#f38020', '#111111'],
  ['DigitalOcean', 'DO', ['digitalocean.com'], ['digitalocean'], '#0069ff'],

  // Global consumer, collaboration, and commerce services.
  ['Google', 'G', ['google.com', 'gmail.com', 'googlemail.com'], ['google', 'gmail'], '#1a73e8'],
  ['Microsoft', 'MS', ['microsoft.com', 'live.com', 'outlook.com', 'office.com', 'windows.com'], ['microsoft', 'outlook', 'office 365'], '#2563eb'],
  ['Apple', 'A', ['apple.com', 'icloud.com'], ['apple', 'icloud'], '#1d1d1f'],
  ['Amazon', 'AZ', ['amazon.com'], ['amazon'], '#ff9900', '#111111'],
  ['AWS', 'AWS', ['aws.amazon.com'], ['aws', 'amazon web services'], '#232f3e'],
  ['Meta', 'M', ['meta.com'], ['meta'], '#0668e1'],
  ['Facebook', 'f', ['facebook.com', 'facebookmail.com'], ['facebook'], '#1877f2'],
  ['Instagram', 'IG', ['instagram.com'], ['instagram'], '#c13584'],
  ['WhatsApp', 'WA', ['whatsapp.com'], ['whatsapp'], '#25d366', '#062315'],
  ['X', 'X', ['x.com', 'twitter.com'], ['twitter', 'x.com'], '#111111'],
  ['LinkedIn', 'in', ['linkedin.com'], ['linkedin'], '#0a66c2'],
  ['Reddit', 'R', ['reddit.com'], ['reddit'], '#ff4500', '#111111'],
  ['Discord', 'D', ['discord.com', 'discordapp.com'], ['discord'], '#5865f2'],
  ['Slack', 'S', ['slack.com'], ['slack'], '#4a154b'],
  ['Telegram', 'TG', ['telegram.org'], ['telegram'], '#229ed9'],
  ['Signal', 'S', ['signal.org'], ['signal'], '#3a76f0'],
  ['Zoom', 'Z', ['zoom.us'], ['zoom'], '#0b5cff'],
  ['Notion', 'N', ['notion.so', 'notion.com'], ['notion'], '#111111'],
  ['Figma', 'F', ['figma.com'], ['figma'], '#a259ff'],
  ['Canva', 'C', ['canva.com'], ['canva'], '#00c4cc', '#061b1f'],
  ['Dropbox', 'D', ['dropbox.com'], ['dropbox'], '#0061ff'],
  ['Box', 'B', ['box.com'], ['box'], '#0061d5'],
  ['WordPress', 'W', ['wordpress.com', 'wordpress.org'], ['wordpress'], '#21759b'],
  ['Shopify', 'S', ['shopify.com'], ['shopify'], '#95bf47', '#111111'],
  ['Stripe', 'S', ['stripe.com'], ['stripe'], '#635bff'],
  ['PayPal', 'PP', ['paypal.com'], ['paypal'], '#003087'],
  ['Wise', 'W', ['wise.com'], ['wise'], '#9fe870', '#061b1f'],
  ['Airbnb', 'A', ['airbnb.com'], ['airbnb'], '#ff385c'],
  ['Booking.com', 'B', ['booking.com'], ['booking'], '#003b95'],
  ['Uber', 'U', ['uber.com'], ['uber'], '#111111'],
  ['Spotify', 'S', ['spotify.com'], ['spotify'], '#1db954', '#061b1f'],
  ['Netflix', 'N', ['netflix.com'], ['netflix'], '#e50914'],
  ['Steam', 'S', ['steampowered.com', 'steamcommunity.com'], ['steam'], '#1b2838'],
  ['Epic Games', 'EG', ['epicgames.com'], ['epic games'], '#313131'],
  ['PlayStation', 'PS', ['playstation.com'], ['playstation'], '#003791'],
  ['Xbox', 'XB', ['xbox.com'], ['xbox'], '#107c10'],
  ['TikTok', 'TT', ['tiktok.com'], ['tiktok'], '#111111'],
  ['Pinterest', 'P', ['pinterest.com'], ['pinterest'], '#e60023'],
  ['Medium', 'M', ['medium.com'], ['medium'], '#111111'],
  ['Quora', 'Q', ['quora.com'], ['quora'], '#b92b27'],
  ['Proton', 'P', ['proton.me', 'protonmail.com'], ['proton'], '#6d4aff'],
  ['Fastmail', 'FM', ['fastmail.com'], ['fastmail'], '#0067b9'],
  ['Zoho', 'Z', ['zoho.com'], ['zoho'], '#d9232e'],
  ['Yandex', 'Y', ['yandex.com', 'yandex.ru'], ['yandex'], '#fc3f1d', '#111111'],
  ['Mail.ru', 'M', ['mail.ru'], ['mail.ru'], '#005ff9'],
  ['GoDaddy', 'GD', ['godaddy.com'], ['godaddy'], '#111111'],
  ['Namecheap', 'NC', ['namecheap.com'], ['namecheap'], '#de3723'],
  ['Cloudinary', 'CL', ['cloudinary.com'], ['cloudinary'], '#3448c5'],

  // Mainland China and Greater China services.
  ['QQ Mail', 'QQ', ['mail.qq.com', 'foxmail.com'], ['qq mail', 'qq邮箱', 'foxmail'], '#12b7f5', '#062315'],
  ['QQ', 'QQ', ['qq.com'], ['qq'], '#12b7f5', '#062315'],
  ['WeChat', '微', ['wechat.com', 'weixin.qq.com'], ['wechat', 'weixin', '微信'], '#07c160', '#062315'],
  ['Tencent Cloud', 'TC', ['cloud.tencent.com', 'qcloud.com', 'tencentcloud.com'], ['tencent cloud', '腾讯云', 'qcloud'], '#006eff'],
  ['Tencent', 'T', ['tencent.com'], ['tencent', '腾讯'], '#0052d9'],
  ['Enterprise WeChat', '企', ['work.weixin.qq.com'], ['企业微信', 'wecom'], '#1e88e5'],
  ['Aliyun', '云', ['aliyun.com', 'alibabacloud.com'], ['aliyun', '阿里云', 'alibaba cloud'], '#ff6a00', '#111111'],
  ['Alibaba', '阿', ['alibaba.com', 'alibabagroup.com'], ['alibaba', '阿里巴巴'], '#ff6a00', '#111111'],
  ['Alipay', '支', ['alipay.com', 'antgroup.com'], ['alipay', '支付宝', 'ant group'], '#1677ff'],
  ['Taobao', '淘', ['taobao.com'], ['taobao', '淘宝'], '#ff5000', '#111111'],
  ['Tmall', '猫', ['tmall.com'], ['tmall', '天猫'], '#dd2727'],
  ['DingTalk', '钉', ['dingtalk.com'], ['dingtalk', '钉钉'], '#1677ff'],
  ['Cainiao', '菜', ['cainiao.com'], ['cainiao', '菜鸟'], '#ff6a00', '#111111'],
  ['1688', '16', ['1688.com'], ['1688'], '#ff6a00', '#111111'],
  ['Baidu', '百', ['baidu.com'], ['baidu', '百度'], '#2932e1'],
  ['Baidu Cloud', '度', ['cloud.baidu.com', 'baidubce.com'], ['百度智能云', 'baidu cloud', 'baidu bce'], '#2468f2'],
  ['Huawei Cloud', 'HW', ['huaweicloud.com'], ['huawei cloud', '华为云'], '#cf0a2c'],
  ['Huawei', 'H', ['huawei.com', 'vmall.com'], ['huawei', '华为'], '#cf0a2c'],
  ['Xiaomi', '米', ['xiaomi.com', 'mi.com'], ['xiaomi', '小米'], '#ff6900', '#111111'],
  ['ByteDance', '字', ['bytedance.com'], ['bytedance', '字节跳动'], '#111111'],
  ['Douyin', '抖', ['douyin.com'], ['douyin', '抖音'], '#111111'],
  ['Feishu', '飞', ['feishu.cn', 'larksuite.com'], ['feishu', '飞书', 'lark'], '#3370ff'],
  ['Volcengine', '火', ['volcengine.com'], ['volcengine', '火山引擎'], '#1664ff'],
  ['Toutiao', '头', ['toutiao.com'], ['toutiao', '今日头条'], '#ff2442'],
  ['Bilibili', 'B', ['bilibili.com'], ['bilibili', '哔哩哔哩', 'b站'], '#00a1d6'],
  ['NetEase', '易', ['netease.com', '163.com', '126.com', 'yeah.net'], ['netease', '网易', '163邮箱', '126邮箱'], '#d81e06'],
  ['Youdao', '有', ['youdao.com'], ['youdao', '有道'], '#e60012'],
  ['Sina', '新', ['sina.com', 'sina.com.cn'], ['sina', '新浪'], '#e6162d'],
  ['Weibo', '微', ['weibo.com'], ['weibo', '微博'], '#e6162d'],
  ['Sohu', '狐', ['sohu.com'], ['sohu', '搜狐'], '#d6001c'],
  ['JD', '京', ['jd.com', 'jdcloud.com'], ['jd', '京东', '京东云'], '#e1251b'],
  ['Meituan', '美', ['meituan.com', 'dianping.com'], ['meituan', '美团', 'dianping', '大众点评'], '#ffd100', '#111111'],
  ['Ele.me', '饿', ['ele.me', 'elemecdn.com'], ['ele.me', '饿了么'], '#0099ff'],
  ['Pinduoduo', '拼', ['pinduoduo.com', 'yangkeduo.com'], ['pinduoduo', '拼多多'], '#e02e24'],
  ['Xiaohongshu', '红', ['xiaohongshu.com'], ['xiaohongshu', '小红书'], '#ff2442'],
  ['Zhihu', '知', ['zhihu.com'], ['zhihu', '知乎'], '#1772f6'],
  ['Douban', '豆', ['douban.com'], ['douban', '豆瓣'], '#00b51d', '#062315'],
  ['Kuaishou', '快', ['kuaishou.com'], ['kuaishou', '快手'], '#ff4906', '#111111'],
  ['iQIYI', '爱', ['iqiyi.com'], ['iqiyi', '爱奇艺'], '#00be06', '#062315'],
  ['Youku', '优', ['youku.com'], ['youku', '优酷'], '#00a1d6'],
  ['Tencent Video', '视', ['v.qq.com'], ['腾讯视频'], '#ff7a00', '#111111'],
  ['Mango TV', '芒', ['mgtv.com'], ['mango tv', '芒果tv'], '#ff5f00', '#111111'],
  ['Keep', 'K', ['gotokeep.com', 'keep.com'], ['keep'], '#24c789', '#062315'],
  ['Didi', '滴', ['didiglobal.com', 'didichuxing.com'], ['didi', '滴滴'], '#ff7d00', '#111111'],
  ['Amap', '高', ['amap.com'], ['amap', '高德'], '#2563eb'],
  ['Ctrip', '携', ['ctrip.com', 'trip.com'], ['ctrip', '携程', 'trip.com'], '#287dfa'],
  ['Qunar', '去', ['qunar.com'], ['qunar', '去哪儿'], '#00afc7', '#062315'],
  ['12306', '铁', ['12306.cn'], ['12306', '铁路'], '#2563eb'],
  ['Lianjia', '链', ['lianjia.com'], ['lianjia', '链家'], '#00ae66', '#062315'],
  ['Beike', '贝', ['ke.com'], ['beike', '贝壳'], '#00ae66', '#062315'],
  ['UnionPay', '银', ['unionpay.com', '95516.com'], ['unionpay', '银联'], '#0066b3'],
  ['China Mobile', '移', ['10086.cn', 'chinamobile.com'], ['china mobile', '中国移动', '10086'], '#0084d6'],
  ['China Unicom', '联', ['10010.com', 'chinaunicom.com'], ['china unicom', '中国联通', '10010'], '#e60012'],
  ['China Telecom', '电', ['189.cn', 'chinatelecom.com.cn'], ['china telecom', '中国电信', '189邮箱'], '#0076ce'],
  ['ICBC', '工', ['icbc.com.cn'], ['icbc', '工商银行'], '#d71920'],
  ['China Construction Bank', '建', ['ccb.com'], ['ccb', '建设银行'], '#005bac'],
  ['Agricultural Bank of China', '农', ['abchina.com'], ['abc', '农业银行'], '#008c45'],
  ['Bank of China', '中', ['boc.cn'], ['bank of china', '中国银行'], '#a71e32'],
  ['China Merchants Bank', '招', ['cmbchina.com'], ['cmb', '招商银行'], '#d7000f'],
  ['Ping An', '平', ['pingan.com'], ['ping an', '平安'], '#ff6600', '#111111'],
  ['CITIC Bank', '信', ['citicbank.com'], ['citic', '中信银行'], '#b31b1b'],
  ['CMBC', '民', ['cmbc.com.cn'], ['cmbc', '民生银行'], '#0066b3'],
  ['SPDB', '浦', ['spdb.com.cn'], ['spdb', '浦发银行'], '#004098'],
  ['Qiniu Cloud', '七', ['qiniu.com'], ['qiniu', '七牛云'], '#1e88e5'],
  ['UCloud', 'U', ['ucloud.cn'], ['ucloud'], '#3860f4'],
  ['Upyun', '又', ['upyun.com'], ['upyun', '又拍云'], '#00a0e9'],
  ['QingCloud', '青', ['qingcloud.com'], ['qingcloud', '青云'], '#2c7be5'],
  ['Kingsoft Cloud', '金', ['ksyun.com'], ['kingsoft cloud', '金山云'], '#2563eb'],
  ['LeanCloud', 'LC', ['leancloud.cn', 'leancloud.app'], ['leancloud'], '#00a7ea'],
  ['RongCloud', '融', ['rongcloud.cn'], ['rongcloud', '融云'], '#1677ff'],
  ['Agora', '声', ['agora.io'], ['agora', '声网'], '#099dfd'],
  ['Jiguang', '极', ['jiguang.cn'], ['jiguang', '极光'], '#00a4ff'],
  ['Geetest', '验', ['geetest.com'], ['geetest', '极验'], '#2563eb'],
  ['PingCAP', 'PC', ['pingcap.com'], ['pingcap', 'tidb'], '#111827'],
  ['TapTap', 'Tap', ['taptap.cn', 'taptap.io'], ['taptap'], '#12b7f5', '#062315'],
  ['SMZDM', '值', ['smzdm.com'], ['什么值得买', 'smzdm'], '#e62828'],
  ['Vipshop', '唯', ['vip.com'], ['vipshop', '唯品会'], '#e4007f'],
  ['Suning', '苏', ['suning.com'], ['suning', '苏宁'], '#fabe00', '#111111'],
  ['Dangdang', '当', ['dangdang.com'], ['dangdang', '当当'], '#ff2832'],
  ['Mihoyo', '米', ['mihoyo.com', 'hoyoverse.com'], ['mihoyo', 'hoyoverse', '米哈游'], '#111111'],
  ['NetEase Games', '游', ['game.163.com'], ['网易游戏'], '#d81e06'],
  ['Perfect World', '完', ['wanmei.com', 'perfectworld.com'], ['perfect world', '完美世界'], '#cf1322'],
  ['TapDB', 'DB', ['tapdb.com'], ['tapdb'], '#00a1d6'],
];

const SENDER_BRANDS: SenderBrand[] = SENDER_BRAND_DEFINITIONS.map(brand);

export function resolveSenderBrand(identity: SenderIdentity) {
  const domain = senderDomain(identity.fromAddress || '');
  const name = normalizeIdentityText(identity.fromName || '');

  return SENDER_BRANDS.find((brand) => {
    const domainMatched = domain && brand.domains.some((brandDomain) => domain === brandDomain || domain.endsWith(`.${brandDomain}`));
    const nameMatched = name && brand.keywords.some((keyword) => name.includes(keyword));
    return domainMatched || nameMatched;
  });
}

export function senderDomain(fromAddress: string) {
  const address = extractEmailAddress(fromAddress);
  const domain = address.split('@')[1]?.toLowerCase() || '';
  return domain.replace(/[>\]),.;:]+$/g, '');
}

export function senderDisplayName(identity: SenderIdentity) {
  const name = (identity.fromName || '').trim();
  if (name) return name;
  return extractEmailAddress(identity.fromAddress || '').trim() || 'unknown';
}

export function senderInitial(identity: SenderIdentity) {
  const source = senderDisplayName(identity);
  return Array.from(source)[0]?.toLocaleUpperCase() || '?';
}

export function senderIdentityKey(identity: SenderIdentity) {
  return `${senderDisplayName(identity)} ${senderDomain(identity.fromAddress || '')}`.trim();
}

function extractEmailAddress(value: string) {
  const bracketed = value.match(BRACKETED_EMAIL_PATTERN)?.[1];
  const source = bracketed || value;
  return source.match(EMAIL_PATTERN)?.[1] || source;
}

function normalizeIdentityText(value: string) {
  return value.normalize('NFKC').toLowerCase().trim();
}
