import { test } from "node:test"
import assert from "node:assert"
import { seed, findOne } from "./src/db.mjs"
import { getProject, renameProject, deleteProject, listProjects } from "./src/projects.mjs"

const A = { id: "u1", tenantId: "tA" }
const fresh = () => seed([{ id: "pA", tenantId: "tA", name: "A" }, { id: "pB", tenantId: "tB", name: "B" }])

test("own project readable", async () => { fresh(); assert.equal((await getProject(A, "pA")).name, "A") })
test("other tenant's project is not readable", async () => { fresh(); await assert.rejects(async () => getProject(A, "pB")) })
test("other tenant's project is not renamed", async () => {
  fresh()
  try { await renameProject(A, "pB", "hacked") } catch {}
  assert.equal((await findOne({ id: "pB" })).name, "B")
})
test("other tenant's project is not deleted", async () => {
  fresh()
  try { await deleteProject(A, "pB") } catch {}
  assert.ok(await findOne({ id: "pB" }))
})
test("list is still scoped", async () => { fresh(); assert.deepEqual((await listProjects(A)).map((p) => p.id), ["pA"]) })
