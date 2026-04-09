FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY bin ./bin
COPY src ./src
COPY public ./public
COPY README.md ./README.md

EXPOSE 8787

ENTRYPOINT ["node", "./bin/xterm-mcp.js", "serve", "--host", "0.0.0.0", "--cwd", "/workspace"]

