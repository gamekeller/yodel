FROM node:0.12
EXPOSE 5004

RUN npm install -g babel@5.6.14

WORKDIR /app
COPY package.json /app/package.json

RUN npm install

COPY . /app

CMD ["babel-node", "index.js"]