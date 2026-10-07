# ---- 构建阶段 ----
FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build   # 产出 dist/（前端静态资源）与 dist/server.cjs

# ---- 运行阶段 ----
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache python3 py3-pip ca-certificates ffmpeg \
    && python3 -m venv /opt/youtube-tools \
    && /opt/youtube-tools/bin/pip install --no-cache-dir 'yt-dlp==2026.8.19' 'yt-dlp-ejs==0.8.0'
ENV YT_DLP_PATH=/opt/youtube-tools/bin/yt-dlp
COPY package.json package-lock.json ./
# 保留生产依赖（express / vite / pdf-parse / mammoth / xlsx / @google/genai 等）
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
# 数据目录：node:sqlite 的 app.db 及运行期文件（务必挂载卷）
VOLUME ["/app/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))" || exit 1
CMD ["node", "dist/server.cjs"]
