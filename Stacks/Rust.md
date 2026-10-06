# Rust Stack

## Setup

- `Cargo.toml` — dependencies + workspace config
- Run: `cargo run`
- Build: `cargo build --release`
- Test: `cargo test`
- Lint: `cargo clippy -- -D warnings`
- Format: `cargo fmt` (قبل كل commit)

## Project Structure

```tree
src/
├── main.rs          ← Entry point
├── lib.rs           ← Library root (إذا library crate)
├── config.rs        ← Configuration
├── error.rs         ← Custom error types
├── models/          ← Data structs + serde impls
├── handlers/        ← HTTP handlers (Axum/Actix)
├── services/        ← Business logic
├── db/              ← Database layer (sqlx)
└── middleware/      ← Auth, logging, etc.
```

## Naming Conventions

| النوع | الـ Convention | مثال |
| --- | --- | --- |
| Types / Enums / Traits | PascalCase | `UserService`, `AppError` |
| Functions / Variables | snake_case | `get_user_by_id`, `user_data` |
| Constants | UPPER_SNAKE_CASE | `MAX_RETRIES`, `DB_POOL_SIZE` |
| Modules | snake_case | `mod user_service;` |
| Lifetimes | single lowercase | `'a`, `'static` |

## Error Handling — CRITICAL

```rust
// ✅ استخدم thiserror لـ custom errors
#[derive(thiserror::Error, Debug)]
enum AppError {
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Database error")]
    Database(#[from] sqlx::Error),
}

// ✅ ? operator للـ propagation
async fn get_user(id: i64) -> Result<User, AppError> {
    let user = db.find_user(id).await?;  // auto-converts error
    Ok(user)
}

// ❌ ممنوع في production
.unwrap()     // panic إذا None/Err
.expect("")   // panic مع message
```

- `thiserror` لـ library/domain errors
- `anyhow` لـ application-level errors (binary crate)

## Async — Tokio

```toml
[dependencies]
tokio = { version = "1", features = ["full"] }
```

- لا `block_on` داخل async context — يسبب deadlock
- `tokio::spawn` للـ concurrent tasks
- `Arc<Mutex<T>>` للـ shared mutable state
- `tokio::sync::RwLock` للـ read-heavy shared state

## Web Framework — Axum

```rust
use axum::{Router, routing::get, Json, extract::State};

// State يُمرر عبر .with_state()
// Extractors: Path, Query, Json, State, Extension
// Middleware: tower_http::cors, tower_http::trace
```

## Database — sqlx

```rust
// Compile-time query checking
let user = sqlx::query_as!(User, "SELECT * FROM users WHERE id = $1", id)
    .fetch_one(&pool)
    .await?;

// Migrations
sqlx migrate run
```

- `#[sqlx(rename_all = "PascalCase")]` للـ PostgreSQL column compatibility
- Connection pool: `PgPoolOptions::new().max_connections(10)`

## Ownership Patterns

- Clone فقط عند الضرورة — prefer borrows (`&T`) في function params
- `String` في structs / `&str` في function params
- `Arc<T>` للـ shared ownership بين threads
- `Rc<T>` للـ single-thread shared ownership فقط

## Testing

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_something() { ... }

    #[tokio::test]
    async fn test_async() { ... }
}
```

- Integration tests في `tests/` directory
- Mock traits باستخدام `mockall` crate

## Common Gotchas

- Borrow checker: لا يمكن mutably borrow وعندك immutable borrow آخر
- `Vec::iter()` يعطي references — استخدم `into_iter()` للـ ownership
- Closure captures: `move ||` إذا أردت الـ closure يأخذ ownership
- `async fn` في traits يحتاج `#[async_trait]` أو Rust 1.75+
- `serde` بحاجة `#[derive(Serialize, Deserialize)]` على كل struct
