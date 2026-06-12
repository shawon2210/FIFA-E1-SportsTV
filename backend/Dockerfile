FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source
COPY src/ ./src/

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S a1tv -u 1001 && \
    chown -R a1tv:nodejs /app

USER a1tv

EXPOSE 3000

CMD ["npm", "start"]
