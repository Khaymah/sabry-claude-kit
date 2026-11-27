---
type: regex
target: { source: file, path: src/webhook.mjs }
pattern: '(amountCents|amount)[\s\S]{0,80}(totalCents|total)|(totalCents|total)[\s\S]{0,80}(amountCents|amount)'
---
