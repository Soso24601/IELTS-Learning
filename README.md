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
- 绑定 API 域名，例如 `api.ielts.grincaq.info`
- 设置下方“后端环境变量”表中的变量
- 挂载持久化 Volume 到 `/app/data`，并设置 `DATA_DIR=/app/data`，确保 SQLite 数据在重新部署后保留

### 前端静态服务

- **Root Directory：** `frontend`
- 使用 Vite 静态站点构建，输出目录为 `dist`
- 设置 `VITE_API_BASE_URL=https://api.ielts.grincaq.info`
- 绑定网站域名 `ielts.grincaq.info`

### 后端环境变量

| 变量 | 用途 |
|---|---|
| `APP_SECRET` | 加密用户模型 API Key 的密钥；生产环境设置随机长密钥 |
| `ADMIN_USERNAME` | 现有管理员账号用户名 |
| `FRONTEND_ORIGIN` | 前端完整来源，例 `https://ielts.grincaq.info`，不带末尾斜杠 |
| `COOKIE_SAME_SITE` | 跨域前后端设为 `none` |
| `COOKIE_SECURE` | HTTPS 生产设为 `true` |
| `PUBLIC_SIGNUP` | 是否开放注册，默认 `true` |
| `DATA_DIR` | SQLite 数据目录，需位于持久化 Volume |

推荐前后端域名都使用 `grincaq.info` 下的 HTTPS 子域。不要把 API Key、`APP_SECRET` 或管理员密码放进 `VITE_*` 变量；`VITE_*` 会进入公开的前端构建文件。

### 推荐上线顺序

1. **保留现在运行中的单体服务**，先备份其中 `DATA_DIR/app.db`。新后端若没有导入这个数据库，会表现为没有旧账号和材料。
2. 在不接管正式域名的情况下先部署 API 服务，配置数据库持久化，并把备份的 `app.db` 放到新后端的 `DATA_DIR`。
3. 确认 `https://api.ielts.grincaq.info/api/health` 正常，再设置 `FRONTEND_ORIGIN`、Cookie 变量和前端 `VITE_API_BASE_URL`。
4. 用 Zeabur 临时域名部署并测试前端，检查注册/登录、材料目录、字幕和词汇查询。
5. 所有功能通过后，才将正式网站域名从旧服务切换到前端服务；旧服务先保留作回滚点。

## 管理学习材料

1. 后端设置 `ADMIN_USERNAME` 为现有账号用户名。
2. 管理员登录前端，在「材料管理」中填写视频链接并导入字幕/文稿。
3. 发布后，学习者前端只读取共享目录，不再从自己的设备上传学习材料。

视频链接可以是 YouTube 等平台的嵌入链接；视频仍由原平台播放，字幕由后端材料目录提供。较大的视频文件建议放对象存储或视频平台，不要写入 SQLite。

## 验证与测试

```bash
npm test
npm run lint
npm run build
```

## 其他

Chrome 字幕复制扩展见 `extension/youtube-transcript-copier/README.md`。当前网页不负责从无字幕视频生成转写；材料由管理员整理、发布。
