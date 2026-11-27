---
type: regex
target: { source: file, path: src/cart.mjs }
pattern: 'parseFloat|Number\(\s*\w*\.?price|\.toFixed\('
match: not_contains
---
