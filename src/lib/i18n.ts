export type AppLocale = "zh-CN" | "en";

export const LOCALE_STORAGE_KEY = "mindgrow.locale.v1";

export function resolveAppLocale(stored?: string | null, browserLanguage?: string | null): AppLocale {
  if (stored === "zh-CN" || stored === "en") return stored;
  return String(browserLanguage || "").toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}
const messages = {
  "app.connecting": { "zh-CN": "正在安全连接…", en: "Connecting securely…" },
  "auth.subtitle": { "zh-CN": "你的私有 AI 知识工作区", en: "Your private AI knowledge workspace" },
  "auth.signIn": { "zh-CN": "登录", en: "Sign in" },
  "auth.signUp": { "zh-CN": "注册", en: "Create account" },
  "auth.email": { "zh-CN": "邮箱", en: "Email" },
  "auth.password": { "zh-CN": "密码", en: "Password" },
  "auth.passwordHint": { "zh-CN": "至少 8 位", en: "At least 8 characters" },
  "auth.wait": { "zh-CN": "请稍候…", en: "Please wait…" },
  "auth.enter": { "zh-CN": "进入工作区", en: "Enter workspace" },
  "auth.create": { "zh-CN": "创建账号", en: "Create account" },
  "auth.recoveryPrompt": { "zh-CN": "确认链接失效，或没有收到邮件？", en: "Confirmation link expired or email missing?" },
  "auth.resending": { "zh-CN": "正在发送…", en: "Sending…" },
  "auth.resend": { "zh-CN": "重新发送确认邮件", en: "Resend confirmation email" },
  "auth.resendCooldown": { "zh-CN": "{seconds} 秒后可再次发送", en: "Resend in {seconds}s" },
  "auth.deliveryHint": { "zh-CN": "只使用最新邮件中的链接，并检查垃圾邮件箱。", en: "Use only the newest link and check your spam folder." },
  "auth.privacy": { "zh-CN": "无需复制登录令牌或工作区令牌；系统自动续期并隔离每个工作区的数据。浏览器不会接触数据库管理密钥。", en: "No login or workspace token setup is required. Sessions renew automatically, workspace data stays isolated, and database admin credentials never reach your browser." },
  "auth.invalid": { "zh-CN": "邮箱或密码不正确", en: "Incorrect email or password" },
  "auth.unconfirmed": { "zh-CN": "邮箱尚未确认，请点击最新确认邮件，或在下方重新发送。", en: "Email not confirmed. Open the newest confirmation email or resend it below." },
  "auth.rateLimit": { "zh-CN": "发送过于频繁，请等待 60 秒后再试。", en: "Too many attempts. Wait 60 seconds before trying again." },
  "auth.passwordLength": { "zh-CN": "密码至少需要 8 位", en: "Password must be at least 8 characters" },
  "auth.failure": { "zh-CN": "登录失败，请重试", en: "Sign-in failed. Please try again." },
  "auth.timeout": { "zh-CN": "认证服务响应超时，请稍后重试。", en: "The authentication service timed out. Please try again." },
  "auth.emailRequired": { "zh-CN": "请先输入创建账号时使用的邮箱。", en: "Enter the email used to create the account first." },
  "auth.sendFailure": { "zh-CN": "发送失败，请稍后重试", en: "Could not send the email. Please try again later." },
  "header.meeting": { "zh-CN": "会议助手", en: "Meeting" },
  "header.meetingTip": { "zh-CN": "整理会议记录，提取决议和行动项", en: "Turn meeting notes into decisions and action items" },
  "header.knowledge": { "zh-CN": "知识碎片", en: "Knowledge" },
  "header.knowledgeTip": { "zh-CN": "整合零散知识点，构建知识体系", en: "Connect notes into a knowledge system" },
  "header.article": { "zh-CN": "文章解析", en: "Articles" },
  "header.articleTip": { "zh-CN": "解析文章内容，提炼核心观点", en: "Parse sources and extract grounded insights" },
  "header.horizontal": { "zh-CN": "切换为横向布局", en: "Switch to horizontal layout" },
  "header.vertical": { "zh-CN": "切换为纵向布局", en: "Switch to vertical layout" },
  "header.nodes": { "zh-CN": "{count} 节点", en: "{count} nodes" },
  "header.libraryNodes": { "zh-CN": "{library}库 · {count}", en: "{library} · {count}" },
  "header.guide": { "zh-CN": "使用指南", en: "Guide" },
  "header.universe": { "zh-CN": "知识宇宙", en: "Universe" },
  "workspace.switch": { "zh-CN": "切换工作区", en: "Switch workspace" },
  "workspace.current": { "zh-CN": "当前工作区", en: "Current workspace" },
  "workspace.new": { "zh-CN": "新建工作区", en: "New workspace" },
  "workspace.newName": { "zh-CN": "新工作区名称", en: "Workspace name" },
  "workspace.createFailed": { "zh-CN": "创建失败", en: "Could not create workspace" },
  "workspace.signOut": { "zh-CN": "退出登录", en: "Sign out" },
  "locale.label": { "zh-CN": "界面语言", en: "Interface language" },
  "feedback.open": { "zh-CN": "反馈", en: "Feedback" },
  "feedback.title": { "zh-CN": "反馈与版本回访", en: "Feedback & release follow-up" },
  "feedback.subtitle": { "zh-CN": "提交问题、查看处理进度，或申请加入国际用户反馈群。", en: "Report an issue, track progress, or request access to the international feedback group." },
  "feedback.new": { "zh-CN": "提交反馈", en: "Send feedback" },
  "feedback.history": { "zh-CN": "处理进度", en: "Updates" },
  "feedback.category": { "zh-CN": "问题类型", en: "Issue type" },
  "feedback.severity": { "zh-CN": "影响程度", en: "Impact" },
  "feedback.message": { "zh-CN": "请描述发生了什么、期望结果和复现步骤", en: "Describe what happened, the expected result, and how to reproduce it" },
  "feedback.contact": { "zh-CN": "允许团队通过账号邮箱联系我", en: "Allow the team to contact me at my account email" },
  "feedback.privacy": { "zh-CN": "仅附带板块、页面、版本和设备类型；不会上传知识正文、回答内容或令牌。", en: "Only the area, page, version, and device class are attached. Knowledge content, answers, and tokens are never uploaded." },
  "feedback.send": { "zh-CN": "发送反馈", en: "Send feedback" },
  "feedback.sending": { "zh-CN": "正在发送…", en: "Sending…" },
  "feedback.success": { "zh-CN": "已提交，可在“处理进度”查看状态。", en: "Submitted. Track it under Updates." },
  "feedback.failure": { "zh-CN": "反馈提交失败，请稍后重试。", en: "Could not submit feedback. Please try again later." },
  "feedback.empty": { "zh-CN": "还没有提交过反馈。", en: "No feedback submitted yet." },
  "feedback.loading": { "zh-CN": "正在读取进度…", en: "Loading updates…" },
  "feedback.group": { "zh-CN": "申请加入国际反馈群", en: "Request feedback-group access" },
  "feedback.groupNeedsContact": { "zh-CN": "加入反馈群需要勾选邮箱联系授权。", en: "Email contact permission is required for a group invitation." },
  "feedback.groupSent": { "zh-CN": "申请已记录，团队可通过账号邮箱发送邀请。", en: "Request recorded. The team can send an invitation to your account email." },
  "feedback.fixedIn": { "zh-CN": "已在 {version} 修复", en: "Fixed in {version}" },
  "feedback.ack": { "zh-CN": "我已看到", en: "Acknowledge" },
  "feedback.close": { "zh-CN": "关闭反馈中心", en: "Close feedback center" },
} as const;

export type MessageKey = keyof typeof messages;

export function translate(locale: AppLocale, key: MessageKey, values?: Record<string, string | number>): string {
  let output: string = messages[key]?.[locale] || messages[key]?.["zh-CN"] || key;
  Object.entries(values || {}).forEach(([name, value]) => {
    output = output.replaceAll(`{${name}}`, String(value));
  });
  return output;
}
