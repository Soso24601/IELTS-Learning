# IELTS Vocabulary Builder · 雅思词汇记背伴侣

在线访问：[雅思英语学习网页](http://ielts.grincaq.info/)

多用户 · 云端存档 · 每账号自带大模型的雅思词汇学习应用。

> 由 AI Studio 原型升级而来：新增 **注册/登录**、**数据按账号保存到服务端**、**每个用户自己填 API Key（BYOK，默认 DeepSeek）**、并附带 **Docker + Caddy 一键上云**。

## 功能一览

- 📖 我的词书：预置 + 自建词、收藏、笔记、例句溯源
- 🗂️ 材料文件夹：上传 PDF / Word / 字幕 / 视频链接，AI 提炼生词与词伙
- 🃏 记忆闪卡：Leitner 间隔重复算法
- 🎯 多维自测：选择 / 拼写 / 听写
- ✨ AI 辅导中心：助记卡、写作段落、口语示范、词汇导师对话
- 👥 多账号：数据相互隔离，任意人可注册
- ☁️ 云端存档：学习进度 / 词书 / 材料 / 统计全部随账号走，换设备不丢
- 🤖 每账号自带大模型：设置里填自己的 API Key（DeepSeek 一键预设 / 任意 OpenAI 兼容 / Gemini），费用归各账号自己

## 技术栈与数据

- 前端 React 19 + Vite + Tailwind；后端 Express（单进程同源服务）
- 数据库 = Node 内置 `node:sqlite`，**零额外数据库服务**，备份 = 拷 1 个文件
- 密码 scrypt 加盐哈希；会话 httpOnly Cookie；用户填的 API Key 用 AES-256-GCM 加密落库（密钥 = `APP_SECRET`）

---

## 一、本地运行（先自己试）

环境：Node ≥ 22.13（推荐 24 LTS 或更高），npm。

```bash
npm install

# （可选）首次可只做这一步的拷贝；不填 APP_SECRET 也能跑，开发模式会自动生成
cp .env.example .env

npm run dev
```

打开 http://localhost:3000 ，注册一个账号即用。

> 开发模式服务器读取工作目录下的 **`.env`**（不是 `.env.local`）。

### 快速自测后端接口

```bash
curl http://localhost:3000/api/health
```

---

## 二、部署到云服务器（Docker + Caddy，自动 HTTPS）

服务器要求：装有 Docker（含 compose 插件）、一个解析到该服务器的域名。

```bash
# 1. 在服务器上获取代码（或把整个文件夹上传上去）
# git clone <你的仓库> 或 scp/rsync 上传本目录

cd ielts-vocabulary-builder

# 2. 配置环境变量：生成一个随机密钥并写入
cp .env.example .env
openssl rand -hex 32        # 把输出填到 .env 的 APP_SECRET=""

# 3. 配置域名
cp Caddyfile.example Caddyfile
#    编辑 Caddyfile，把 your-domain.com 换成你的域名
#    到域名商把 A 记录指向服务器公网 IP

# 4. 构建并启动
docker compose up -d --build

# 5. 完成：浏览器打开 https://你的域名
docker compose logs -f app   # 看日志
```

数据会持久化在 Docker 卷 `appdata`（即容器内 `/app/data`，内含 `app.db`）。

### 运维

- **备份**：`docker compose exec app sh -c 'cat /app/data/app.db' > app.db`（或备份整个卷）；恢复时停服后替换。
- **升级**：拉取新代码后 `docker compose up -d --build`。
- **关闭注册**：`.env` 里 `PUBLIC_SIGNUP="false"` 后 `docker compose up -d`。
- **大陆 VPS 提示**：绑域名 + 80/443 通常需 ICP 备案。如不便备案，可改用香港/海外 VPS，或免备案平台（Railway / Render / Zeabur / Sealos 等）——代码通用，只需把环境变量与 `DATA_DIR` 卷挂对。

---

## 三、第一次使用 & 接入 DeepSeek

1. 注册并登录。
2. 右上角 ⚙️ **账号与设置 → AI 大模型**：
   - 选 **DeepSeek（推荐）** → 填你在 [platform.deepseek.com](https://platform.deepseek.com) 申请的 API Key（充几块钱可用很久）→ **测试连接** → **保存配置**。
   - 或用「自定义（OpenAI 兼容）」接入 Kimi / 智谱 / 通义千问 等任何兼容接口。
3. 顶部若出现「AI 功能未配置」提示条，说明还没填 Key；填好即消失。

> Key 只加密保存在你自己的账号下，服务器端不会明文存储；AI 请求以**你的** Key 发出，费用计在你自己账号上。

### 大模型已知差异
- DeepSeek 无联网搜索：视频「AI 兜底字幕」会退化为纯文本生成（Gemini 用户才带搜索）。
- JSON 类任务请用 `deepseek-chat`；`deepseek-reasoner` 不支持 JSON 结构化输出。
- 音频直接转写需要 Gemini 多模态；DeepSeek 用户请改用「导入文本/字幕」来学习音频类材料。

---

## 四、迁移旧数据（重要）

**场景 A：之前在同一浏览器/域名下用旧版（数据在 localStorage）。**
登录新账号（云端为空）时，系统会检测到浏览器残留的 `ielts_*` 旧数据并**自动并入当前账号**（顶部有提示）。也可在 设置 → 数据迁移 里手动「把本浏览器旧数据并入本账号」。

**场景 B：旧数据在别的域名/浏览器（例如曾在 ai.studio 上使用）。**
在**旧站点那个浏览器**按 F12 → Console 执行以下命令，会复制一份 JSON：

```js
copy(JSON.stringify(Object.fromEntries(Object.entries(localStorage).filter(([k]) => k.startsWith('ielts_')))))
```

回到新站登录后：设置 → 数据迁移与备份 → **从备份恢复**，粘贴保存成的 `.json` 即可。

---

## 五、环境变量说明

见 [`.env.example`](.env.example)。核心：

| 变量 | 说明 |
|---|---|
| `APP_SECRET` | 加密用户 API Key 的密钥，**生产必填** |
| `PUBLIC_SIGNUP` | 是否开放注册，默认 `true` |
| `DATA_DIR` | 数据目录（含 sqlite），默认 `./data` |
| `USER_DATA_MAX_MB` | 单账号云端数据上限，默认 25 MB |
| `AI_RATE_PER_MIN` | 单用户每分钟请求上限，默认 120 |
| `COOKIE_SECURE` | 生产默认 true（HTTPS） |

## 六、已知取舍

- 自己**录音的音频**存在浏览器 IndexedDB，属设备本地，暂不跨设备云同步；文本材料 / 字幕 / 笔记 / 进度全部云端同步。
- 同一账号多个标签页同时编辑为“后写覆盖”，不做实时合并；刷新即可取最新。
- 公开注册含登录限速与数据上限，但暂不含验证码 / 邮箱验证。

## 目录结构

```
server.ts             Express 入口（AI/文件/代理端点 + 静态托管）
server/lib/           db(node:sqlite) · auth(会话/密码/限速) · llm(BYOK客户端) · routes · net(SSRF防护)
src/                  React 前端（App / 6 大模块 / AuthPage / AccountModal）
src/lib/              authApi · sync(本地→云端同步) · localData · llmPresets
data/                 （运行时生成，勿提交）app.db 等
```
