# Go Stack

## Setup

- `go.mod` + `go.sum` — مطلوبان دائماً
- Run: `go run ./cmd/server`
- Build: `go build -o bin/server ./cmd/server`
- Test: `go test ./...`
- Lint: `golangci-lint run`
- Format: `gofmt -w .` (تلقائي قبل commit)

## Project Structure

```tree
cmd/
└── server/
    └── main.go          ← Entry point فقط
internal/
├── config/              ← Configuration + env parsing
├── handlers/            ← HTTP handlers (thin layer)
├── services/            ← Business logic
├── repository/          ← Database queries
├── models/              ← Data structs
├── middleware/          ← Auth, logger, rate limit
└── errors/              ← Custom error types
pkg/                     ← Shared utilities (يمكن استيرادها خارجياً)
```

## Naming Conventions

| النوع | الـ Convention | مثال |
| --- | --- | --- |
| Exported | PascalCase | `GetUserByID`, `UserService` |
| Unexported | camelCase | `parseToken`, `getUserById` |
| Interface | يصف الـ behavior | `UserRepository`, `TokenSigner` |
| Error vars | `Err` prefix | `ErrNotFound`, `ErrUnauthorized` |
| Test files | `_test.go` suffix | `user_service_test.go` |

## Error Handling — CRITICAL

```go
// ✅ صحيح — wrap errors مع context
if err != nil {
    return nil, fmt.Errorf("getUserByID %d: %w", id, err)
}

// ✅ Custom errors
type AppError struct {
    Code    string
    Message string
    Err     error
}

// ❌ ممنوع
_ = someFunc()          // تجاهل error
panic(err)              // في production code
```

## HTTP Framework

- **Gin** أو **Echo** أو **Chi** — اختر واحد واثبت عليه
- Middleware: logger, recover, cors, auth
- Validation: `go-playground/validator`
- Response JSON موحد:

```go
type Response struct {
    Success bool        `json:"Success"`
    Data    interface{} `json:"Data,omitempty"`
    Error   *AppError   `json:"Error,omitempty"`
}
```

## Concurrency

- استخدم `context.Context` في كل function طويلة أو I/O
- لا goroutine leak — أغلق كل goroutine بـ `ctx.Done()`
- Shared state: `sync.Mutex` أو channels
- لا `time.Sleep` في production — استخدم `time.After` + select

## Database

- **sqlx** أو **pgx** لـ PostgreSQL — لا ORM ثقيل
- Prepared statements لكل query متكررة
- Transactions: `tx.Rollback()` في `defer`
- لا SQL concatenation — استخدم `$1, $2` placeholders

## Testing

- Table-driven tests دائماً:

```go
tests := []struct {
    name  string
    input string
    want  string
}{
    {"valid email", "a@b.com", "a@b.com"},
    {"invalid", "notanemail", ""},
}
for _, tt := range tests {
    t.Run(tt.name, func(t *testing.T) { ... })
}
```

- Mock interfaces لا concrete structs
- `testify/assert` للـ assertions

## Common Gotchas

- `defer` يُنفَّذ عند خروج الـ function لا الـ block
- slice append قد يُنشئ نسخة جديدة — احتفظ بـ return value
- `nil` map قابل للقراءة لكن الكتابة فيه panic → `make(map[...]...)` أولاً
- String concatenation في loop: استخدم `strings.Builder`
- JSON marshal لـ unexported fields يُرجع `{}`
