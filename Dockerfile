FROM node:20-alpine

WORKDIR /app

# Copy package files first — better layer caching so rebuilds after source
# changes don't re-run npm install from scratch.
COPY package*.json ./
COPY client/package*.json ./client/
COPY server/package*.json ./server/
COPY shared/package*.json ./shared/

# Install everything (including devDeps — needed for tsc, prisma CLI, tsx seed)
RUN npm install

# Copy all source
COPY . .

# Build in dependency order: shared → client → server
RUN npm run build --workspace=shared
RUN npm run build --workspace=client
RUN npm run build --workspace=server

# Pre-generate the Prisma client so the container starts instantly
RUN cd server && npx prisma generate

WORKDIR /app/server
EXPOSE 3001

# Run the compiled JS — fast startup, no TypeScript overhead at runtime
CMD ["node", "dist/app.js"]
