# VIER 正式上线镜像：真人人选池。零依赖，不需要 npm install。
FROM node:20-alpine

WORKDIR /app
COPY package.json ./
COPY server ./server
COPY packages ./packages
COPY web ./web
COPY config ./config
COPY scripts ./scripts

ENV NODE_ENV=production \
    PORT=8787 \
    VIER_CONFIG=/app/config/app.production.json \
    VIER_DATA_DIR=/data

# 用户资料存在 /data，由 docker-compose 挂成数据卷，重建容器也不会丢
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 8787
CMD ["node", "server/server.mjs"]
