# IELTS Vocabulary Builder

在线访问：[ielts.grincaq.info](https://ielts.grincaq.info/)

雅思词汇与视频字幕学习应用。前端和 API 已拆成两个可以独立构建、独立部署的服务；学习材料由管理员发布到后端共享目录，学习者在前端播放视频、跟随字幕和查询词汇。

## 项目结构

```text
frontend/   React + Vite + Tailwind 网页，构建为静态文件
backend/    Express API、登录、LLM 调用、SQLite 数据和材料管理
extension/  YouTube 文字稿复制扩展原型
tests/      前后端回归测试
```

## 本地运行

需要 Node.js 22.13 或更高版本。

```bash
npm install
npm run dev
```

打开 Vite 显示的本地地址（通常是 `http://localhost:5173`）。前端开发服务器把 `/api` 代理到 `http://127.0.0.1:3000`。如后端需要配置变量，将 `backend/.env.example` 复制为 `backend/.env` 并填写；开发环境可以不设 `APP_SECRET`，后端会生成本地密钥。

分别运行也可以：

```bash
npm run dev:backend
npm run dev:frontend
```

## Zeabur 分开部署

在同一 Zeabur 项目中，从同一个 GitHub 仓库建立两个服务。Zeabur 支持通过 Root Directory 让不同服务构建同一仓库内不同的子目录。

### 后端 API 服务

- **Root Directory：** `backend`
- **Build Command：** `npm run build`（若自动识别即可保留默认）
- **Start Command：** `npm start`
- 绑定 API 域名，例如 `api.grincaq.info`
- 设置下方“后端环境变量”表中的变量
- 挂载持久化 Volume 到 `/app/data`，并设置 `DATA_DIR=/app/data`，确保 SQLite 数据在重新部署后保留

### 前端静态服务

- **Root Directory：** `frontend`
- 使用 Vite 静态站点构建，输出目录为 `dist`
- 设置 `VITE_API_BASE_URL=https://api.grincaq.info`
- 绑定学习者域名 `ielts.grincaq.info`；管理员工作台通过独立页面 `/admin.html` 访问

### 后端环境变量

| 变量 | 用途 |
|---|---|
| `APP_SECRET` | 加密用户模型 API Key 的密钥；生产环境设置随机长密钥 |
| `ADMIN_USERNAME` | 具有材料管理权限的账号用户名；必须先在学习者网站注册同名账号 |
| `FRONTEND_ORIGIN` | 学习者网站完整来源，例如 `https://ielts.grincaq.info`，不带末尾斜杠 |
| `COOKIE_SAME_SITE` | 跨域前后端设为 `none` |
| `COOKIE_SECURE` | HTTPS 生产设为 `true` |
| `PUBLIC_SIGNUP` | 是否开放注册，默认 `true` |
| `DATA_DIR` | SQLite 数据目录，需位于持久化 Volume |

推荐前后端域名都使用 `grincaq.info` 下的 HTTPS 子域。不要把 API Key、`APP_SECRET` 或管理员密码放进 `VITE_*` 变量；`VITE_*` 会进入公开的前端构建文件。

### 推荐上线顺序

1. 后端 Volume 挂载到 `/app/data`，并设置 `DATA_DIR=/app/data`；同时设置 `ADMIN_USERNAME` 和 `FRONTEND_ORIGIN`。
2. 确认 `https://api.grincaq.info/api/health` 正常，再部署前端静态服务。
3. 将 `ielts.grincaq.info` 绑定到前端静态服务，并设置 API 地址。
4. 在学习者网站注册管理员用户名，然后访问 `https://ielts.grincaq.info/admin.html` 登录工作台；验证材料发布后能出现在学习者材料目录。

## 管理学习材料

1. 在后端设置 `ADMIN_USERNAME` 为管理员用户名，并开放注册以创建该账号。
2. 管理员先在学习者网站注册对应用户名，再访问 `https://ielts.grincaq.info/admin.html` 登录材料工作台。
3. 管理员在工作台填写视频链接并导入字幕/文稿；学习者网站只读取已发布内容，不提供上传入口。

视频链接可以是 YouTube 等平台的嵌入链接；视频仍由原平台播放，字幕由后端材料目录提供。较大的视频文件建议放对象存储或视频平台，不要写入 SQLite。

## 验证与测试

```bash
npm test
npm run lint
npm run build
```

## 其他

Chrome 字幕复制扩展见 `extension/youtube-transcript-copier/README.md`。当前网页不负责从无字幕视频生成转写；材料由管理员整理、发布。

### 按类型管理学习材料

学习页统一按“全部材料、视频、音频、文章”筛选，支持标题与主题标签搜索，显示最近学习的材料。旧材料按原有类型与链接自动归类，无需重新导入。

管理员在 `/admin.html` 选择材料类型、填写主题标签并添加原文或字幕。视频可以贴 YouTube/公开视频链接；音频需要直接可播放的音频链接。管理员也可上传最多 30 MB 的音频（MP3/WAV/M4A/OGG）或视频（MP4/WebM），文件保存于 `DATA_DIR/media`，由已登录用户播放。较大的视频使用公开播放链接。上传后须预览并确认发布，字幕仍由管理员提供。

前端和后端服务都需部署最新版本。前端构建时设置 `VITE_API_BASE_URL=https://api.grincaq.info`；后端设置 `FRONTEND_ORIGIN=https://ielts.grincaq.info`、`DATA_DIR=/app/data` 并保持现有硬盘挂载。
