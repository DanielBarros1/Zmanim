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

# Build in dependency order: shared → prisma → client → server
RUN npm run build --workspace=shared

# Generate Prisma client BEFORE tsc — the server's TypeScript compilation
# depends on the generated @prisma/client types (enums, model shapes, etc).
# Without this, tsc fails with "has no exported member 'Day'" and a cascade
# of implicit-any errors in every Prisma query callback.
RUN cd server && npx prisma generate

RUN npm run build --workspace=client
RUN npm run build --workspace=server

WORKDIR /app/server
EXPOSE 3001

# Run the compiled JS — fast startup, no TypeScript overhead at runtime
CMD ["node", "dist/app.js"]
