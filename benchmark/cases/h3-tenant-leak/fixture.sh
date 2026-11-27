#!/usr/bin/env bash
set -euo pipefail
mkdir -p src test
echo '{ "name": "saas", "type": "module", "scripts": { "test": "node --test" } }' > package.json
cat > src/db.mjs <<'J'
const projects = new Map()
const delay = () => new Promise((r) => setTimeout(r, 1))
const matches = (row, where) => Object.entries(where).every(([k, v]) => row[k] === v)
export async function findOne(where) { await delay(); return [...projects.values()].find((p) => matches(p, where)) ?? null }
export async function findMany(where) { await delay(); return [...projects.values()].filter((p) => matches(p, where)) }
export async function update(where, changes) { await delay(); let n = 0; for (const p of projects.values()) if (matches(p, where)) { Object.assign(p, changes); n++ } return n }
export async function remove(where) { await delay(); let n = 0; for (const [id, p] of projects) if (matches(p, where)) { projects.delete(id); n++ } return n }
export function seed(rows) { projects.clear(); for (const r of rows) projects.set(r.id, { ...r }) }
J
cat > src/projects.mjs <<'J'
import { findOne, findMany, update, remove } from "./db.mjs"

export class NotFound extends Error {}

export async function listProjects(user) {
  return findMany({ tenantId: user.tenantId })
}

export async function getProject(user, id) {
  const project = await findOne({ id })
  if (!project) throw new NotFound("project")
  return project
}

export async function renameProject(user, id, name) {
  const n = await update({ id }, { name })
  if (!n) throw new NotFound("project")
  return getProject(user, id)
}

export async function deleteProject(user, id) {
  const n = await remove({ id })
  if (!n) throw new NotFound("project")
}
J
