#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
git config user.email eval@example.com
git config user.name eval
mkdir -p src
cat > package.json <<'EOF'
{ "name": "api", "type": "module", "dependencies": { "hono": "^4.6.0", "drizzle-orm": "^0.36.0" }, "scripts": { "test": "node --test" } }
EOF
cat > src/index.ts <<'EOF'
import { Hono } from "hono";
const app = new Hono();
app.get("/", (c) => c.json({ ok: true }));
export default app;
EOF
git add -A && git commit -q -m "chore: seed"
