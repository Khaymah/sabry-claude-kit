---
type: regex
target: { source: file, path: src/export.mjs }
pattern: '[=+\-@][\s\S]{0,40}(\x27|"\x27"|`\x27`)|formula|injection'
flags: i
---
