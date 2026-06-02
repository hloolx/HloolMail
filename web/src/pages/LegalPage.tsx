import { ArrowLeft } from 'lucide-react';
import { simpleMarkdownToHTML } from '../lib/markdown';

type LegalPageProps = {
  type: 'terms' | 'privacy';
};

const termsContent = `
# HLOOL Mail 服务条款

**最后更新日期：2026年6月2日**

欢迎使用 HLOOL Mail。HLOOL Mail 是一个自托管的邮件收信、域名管理、API 与 Webhook 自动化平台。继续使用即表示你同意遵守这些条款。

---

## 1. 服务概述

- 收信地址创建与邮件接收
- 私有域名邮件接收
- API Key 自动化访问
- Webhook 事件推送
- 邮件分享链接与 Web 控制台

## 2. 账户与凭证

用户应妥善保管账户密码、Passkey、OAuth 账户和 API Key。发现账户或凭证泄露时，应尽快轮换凭证并通知实例管理员。

## 3. 可接受使用

你可以将本服务用于软件开发、测试、自动化流程、团队内部的域名邮件管理和必要的服务通知接收。

不得将本服务用于垃圾邮件、钓鱼、欺诈、攻击、绕过访问控制或安全限制、规避第三方服务规则、批量创建或交易第三方账号、侵犯他人权益或违反适用法律法规的活动。

## 4. 服务限制

本服务按“现状”和“可用”提供。邮件、审计日志、活动日志和 Webhook 投递记录会按实例配置自动清理。自托管用户应自行负责服务器安全、DNS、SSL、备份和升级验证。

## 5. 条款变更

项目维护者或实例管理员可根据安全、合规和功能变化更新这些条款。继续使用服务即表示接受更新后的条款。
`;

const privacyContent = `
# HLOOL Mail 隐私政策

**最后更新日期：2026年6月2日**

本隐私政策说明 HLOOL Mail 如何在自托管邮件收信服务中收集、使用、存储和保护数据。不同实例的实际配置可能不同，请同时参考你所使用实例的管理员说明。

---

## 1. 收集的信息

| 信息类别 | 具体内容 |
| --- | --- |
| 账户信息 | 邮箱地址、密码哈希、头像 URL、角色、配额 |
| 身份凭证 | OAuth 身份标识、Passkey 凭证、API Key 哈希和前缀 |
| 邮件数据 | 发件人、收件人、主题、正文、附件元数据、时间戳 |
| 配置数据 | 域名、Mailbox、分享链接、Webhook 端点和事件类型 |
| 安全日志 | IP 地址、User-Agent、请求路径、操作结果、API 调用记录 |

## 2. 使用目的

这些信息用于账户验证、邮件处理、配置管理、配额控制、权限校验、安全审计、故障排查和防止滥用。

## 3. 存储与保留

自托管实例的数据存储在部署者管理的服务器和数据库中。邮件内容、日志和 Webhook 投递记录按实例配置清理。API Key 明文仅在创建时显示一次，服务端保存哈希、前缀和元数据。

## 4. 信息共享

除用户授权、服务必要、依法依规、安全事件处理或故障排查所需外，HLOOL Mail 不会主动向第三方出售或共享用户个人信息。

## 5. 用户控制

用户可根据实例权限查看和修改账户资料，删除或轮换 API Key，管理 Webhook、邮箱、邮件、分享链接和域名配置，并联系管理员处理账户关闭、数据导出或异常访问问题。
`;

export function LegalPage({ type }: LegalPageProps) {
  const content = type === 'terms' ? termsContent : privacyContent;
  const title = type === 'terms' ? '服务条款' : '隐私政策';

  const handleBack = () => {
    window.history.back();
  };

  return (
    <div className="legal-page">
      <div className="legal-page-header">
        <button className="legal-back-button" onClick={handleBack} type="button">
          <ArrowLeft size={18} />
          <span>返回</span>
        </button>
        <h1>{title}</h1>
      </div>
      <div className="legal-page-content">
        <div dangerouslySetInnerHTML={{ __html: simpleMarkdownToHTML(content) }} />
      </div>
    </div>
  );
}
