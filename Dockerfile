FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY . .
EXPOSE 8787
CMD ["node", "src/server.js"]
