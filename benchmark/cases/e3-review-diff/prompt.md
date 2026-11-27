---
description: "Easy review: a short service diff with three classic traps."
tags: [easy, review]
max_turns: 15
allowed_tools: [Read, Glob, Grep, Agent, Skill]
---
راجع الكود ده قبل ما يدخل production وقولّي المشاكل بالأولوية:

```ts
export async function DeactivateUser(Id: string) {
  console.log("deactivating", Id)
  await db.update(Users).set({ IsActive: false })
  const Res = await fetch(`${CRM_URL}/users/${Id}/deactivate`, { method: "POST" })
  return Res.ok
}
```
