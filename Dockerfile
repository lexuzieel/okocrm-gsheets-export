FROM node:18

COPY . .

RUN npm install && npm run build

CMD ["node", "dist/index.js"]
