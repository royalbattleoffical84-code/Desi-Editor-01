FROM node:20-slim

# Install FFmpeg via apt (more reliable than npm binary on some cloud environments)
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

RUN mkdir -p uploads output

EXPOSE 3000
CMD ["node", "server.js"]
