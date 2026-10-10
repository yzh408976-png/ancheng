# 安程 AnCheng

> 子女把行程排好，长辈打开就能看懂。

安程是一个面向老年群体的出行行程整理工具：子女把购票短信、行程草稿粘贴进来，系统自动解析成结构化行程；确认无误后生成一条分享链接或二维码发给长辈。长辈打开后看到的是大字号、零动画、说人话的行程卡片，还能收到出发提醒、一键拨打家人电话。

## 功能一览

**子女端（管理行程）**
- 粘贴一段话自动解析：车次/航班号、起讫站、日期（含「明天/后天/周几」）、时刻、席别、酒店与住几晚、打车接送
- 三阶段管线：规则解析 → 人话重写 → 合理性检查，每一段行程都有「翻译后的大白话」预览
- AI 补漏（可选）：没配模型也能用内置演示管线体验完整流程；只填空、不覆盖已确认字段，补完重跑校验，仍需人工确认
- 行前清单、`.ics` 日历导出、行程长图导出
- 本地账号体系（注册/登录，密码哈希存储，无需服务端）
- 分享方式：6 位口令、二维码、分享链接，长辈端三选一

**长辈端（打开就能用）**
- 输码页：6 位大数字口令，无需登录、无需注册
- 今日行程卡片：大字号（正文 ≥28px）、触控目标 ≥88px、零动画、WCAG AAA 对比度
- 语音播报：每段行程读成一句人话
- 出发提醒：临近出发自动弹窗 + 播报
- 家人电话页：一键拨打、微信号复制
- 字大小/主题自主设置（三套主题），长辈自己调过的设置优先于子女预设
- 位置共享（可选开关，只保留最新位置、不留轨迹）

**可选服务端（不部署也能完整使用）**
- 出发提醒通知：阿里云短信 / Twilio / Resend 邮件 / 通用 Webhook
- 跨设备同步：长辈端「走完」标记与位置回传（内存态房间，24h TTL）
- 模型请求代理：绕开浏览器直连模型接口的 CORS 限制

## 快速开始

要求 Node.js ≥ 18。

```bash
npm install        # 安装依赖（运行时仅 vue 一个依赖）
npm run dev        # 本地开发（Vite 热更新）
```

构建与发布：

```bash
npm run build        # 产出 dist/，可直接托管到任意静态服务
npm run serve-dist   # 一键同源发布 dist/ + 可选 API（http://localhost:5180）
```

冒烟测试（解析 → 长辈卡 → 分享编码解码 → 提醒 → 拦截）：

```bash
node smoke.mjs
```

## 常用脚本

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发模式 |
| `npm run build` | 生产构建到 `dist/` |
| `npm run serve-dist` | 同源发布 `dist/` 并启用 `/api/*` |
| `npm run server` | 仅启动服务端（不发静态文件） |
| `npm run mock` | 启动本地假短信服务商，联调通知链路 |
| `node smoke.mjs` | 端到端冒烟测试 |

## 目录结构

```
ancheng-web/
├── index.html
├── vite.config.js          # base './'，支持任意子路径托管
├── smoke.mjs               # 端到端冒烟测试
├── src/
│   ├── core/               # 与 UI 无关的纯逻辑层
│   │   ├── accounts.js     # 本地账号体系（注册/登录/哈希）
│   │   ├── agents.js       # 三阶段管线：解析 → 人话重写 → 合理性检查
│   │   ├── ai.js           # AI 补漏层（只填空不覆盖）
│   │   ├── checklist.js    # 行前清单
│   │   ├── elderState.js   # 长辈端本机状态（走完/折叠/已忽略）
│   │   ├── export.js       # .ics 日历导出、行程长图导出
│   │   ├── model.js        # 模型配置与调用（直连 + 服务端代理 fallback）
│   │   ├── notify.js       # 通知通道探测与发送（回落 sms:/mailto:）
│   │   ├── qr.js           # 自研二维码引擎（Reed-Solomon + 掩码择优）
│   │   ├── router.js       # 自研 hash 路由
│   │   ├── share-codec.js  # 分享链接编解码（FNV-1a 校验 + base64url）
│   │   ├── store.js        # 行程存储与长辈偏好
│   │   ├── sync.js         # 双轨同步（localStorage 镜像 + BroadcastChannel + 服务端轮询）
│   │   └── upcoming.js     # 出发提醒计算
│   ├── pages/              # 子女端 11 个页面
│   ├── elder/              # 长辈端（输码/行程/家人/设置 + 提醒弹窗 + 位置共享）
│   └── styles/global.css   # 设计系统（信号绿纸面 + 适老化硬指标）
└── server/                 # 可选服务端（Node 原生 http，无框架依赖）
    ├── notify-server.mjs   # 启动入口（--serve-dist 同源发布）
    ├── app.mjs             # 路由：/api/notify、/api/model、/api/sync/*
    ├── mock-provider.mjs   # 本地假服务商
    └── providers/          # 阿里云 / Twilio / Resend / Webhook 适配器
```

## 两种交付形态

1. **纯静态**：`npm run build` 后把 `dist/` 扔到任意静态托管（GitHub Pages、对象存储、Nginx）。核心流程（解析、分享、长辈端查看）全部可离线于服务端完成，通知回落到用户手机的短信/邮件 App。
2. **同源 + API**：`npm run serve-dist` 一条命令同时发布静态文件与 `/api/*`，解锁真短信/邮件通知、跨设备同步、模型代理。

## 可选服务端配置

复制 `server/.env.example` 为 `.env`，按需填写（一条不填也能用）：

| 环境变量 | 作用 |
|---|---|
| `NOTIFY_PORT` | 服务端口（默认 5180） |
| `ALIYUN_SMS_*` | 阿里云短信（国内推荐） |
| `TWILIO_*` | Twilio 短信（海外） |
| `RESEND_*` | Resend 邮件 |
| `NOTIFY_WEBHOOK_URL` | 通用 HTTP 网关（短信/邮件均可接） |
| `MODEL_PROXY_TOKEN` | 模型代理的调用令牌 |
| `SYNC_TOKEN` | 同步接口的调用令牌 |

隐私设计：同步房间为内存态（重启清空），位置只保留最新一份、不留轨迹；模型密钥只在单次代理请求中经过服务端、不落盘。

## 适老化设计指标

- 正文 ≥ 28px，触控目标 ≥ 88px
- 对比度满足 WCAG AAA（≥ 7:1）
- 长辈端零动画、零转场
- 全部文案口语化：不说「车次 G7102 检票」，说「你坐 G7102，9点30分从上海虹桥出发」

## 开源协议

[Apache-2.0](./LICENSE)
