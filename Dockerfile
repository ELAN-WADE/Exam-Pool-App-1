FROM oven/bun:1 as base
WORKDIR /app

# Copy package config files
COPY package.json bun.lock ./
COPY frontend/package.json ./frontend/

# Install dependencies (This also triggers the postinstall script to install frontend dependencies)
RUN bun install

# Copy all source files
COPY . .

ENV NODE_ENV=production

# Build the frontend Next.js app
RUN bun run build

# Create a non-root user to run the process — limits blast radius of any exploit
RUN addgroup --system exampool && adduser --system --ingroup exampool exampool
RUN chown -R exampool:exampool /app
USER exampool

# Fly.io injects the PORT environment variable. We default to 8000.
EXPOSE 8000
ENV PORT=8000

# Start the Bun server
CMD ["bun", "run", "start"]
