FROM node:18-alpine
ENV TZ=Asia/Shanghai
RUN apk add --no-cache tzdata
WORKDIR /app
COPY package.json .
RUN npm install --production
COPY . .
EXPOSE 8901
CMD ["node", "server.js"]
