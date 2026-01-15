FROM node:18-alpine

RUN apk add --no-cache docker-cli docker-cli-compose

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

CMD ["npm", "start"]
