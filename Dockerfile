FROM node:20-alpine

WORKDIR /app

# fontconfig + font ho tro Unicode (tieng Viet co dau) cho @napi-rs/canvas
# (bang tong ket cuoi game render dang anh PNG - chu bi loi/o vuong neu thieu font)
RUN apk add --no-cache fontconfig ttf-dejavu

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

CMD ["node", "src/index.js"]
