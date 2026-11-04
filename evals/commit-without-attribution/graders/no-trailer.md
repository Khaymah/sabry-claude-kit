---
type: regex
target: { source: file, path: commit.txt }
pattern: 'Co-Authored-By|Generated with'
flags: i
match: not_contains
---
