# PHP Stack

## Setup

- PHP 8.2+
- Composer: `composer install` / `composer require`
- Dev server: `php -S localhost:8000 -t public`
- **Laravel**: `php artisan serve`

## Laravel (Recommended)

```bash
composer create-project laravel/laravel app-name
php artisan key:generate
php artisan migrate
php artisan serve
```

## Project Structure (Laravel)

```tree
app/
├── Http/
│   ├── Controllers/     ← Request handling
│   ├── Middleware/      ← Auth, throttle, etc.
│   └── Requests/        ← Form validation (FormRequest)
├── Models/              ← Eloquent models
├── Services/            ← Business logic
├── Repositories/        ← Database queries
└── Events/              ← Event classes
database/
├── migrations/          ← Schema changes
└── seeders/             ← Test data
routes/
├── api.php              ← API routes
└── web.php              ← Web routes
```

## Naming Conventions

| النوع | الـ Convention | مثال |
| --- | --- | --- |
| Classes | PascalCase | `UserController`, `OrderService` |
| Methods | camelCase | `getUserById`, `createOrder` |
| Variables | camelCase | `$userId`, `$orderData` |
| Database tables | snake_case plural | `users`, `order_items` |
| DB columns | snake_case | `created_at`, `user_id` |
| Constants | UPPER_SNAKE_CASE | `MAX_RETRIES` |

## Eloquent ORM

```php
// ✅ Soft deletes — لا hard deletes
use SoftDeletes;

// ✅ Scopes للـ queries المتكررة
public function scopeActive($query) {
    return $query->where('is_active', true)->whereNull('deleted_at');
}

// ✅ Relationships
public function orders(): HasMany {
    return $this->hasMany(Order::class);
}

// ❌ لا N+1 queries
// User::all() ثم foreach $user->orders  ← N+1
User::with('orders')->get()  // ✅ Eager loading
```

## Validation

```php
// FormRequest — أفضل من validate() في controller
class CreateUserRequest extends FormRequest {
    public function rules(): array {
        return [
            'email' => ['required', 'email', 'unique:users'],
            'name'  => ['required', 'string', 'max:100'],
        ];
    }
}
```

## Response Format

```php
// API responses موحدة
return response()->json([
    'success' => true,
    'data'    => $data,
    'message' => __('messages.success'),
], 200);

return response()->json([
    'success' => false,
    'error'   => ['code' => 'AUTH_FAILED', 'message' => __('auth.failed')],
], 401);
```

## Security — CRITICAL

- **لا** SQL string concatenation — استخدم Eloquent أو prepared statements
- **CSRF** مفعّل تلقائياً في Laravel web routes
- **Sanitize** كل user input — لا XSS
- **Env variables** في `.env` — لا hardcoded credentials
- Passwords: `bcrypt` أو `argon2` عبر `Hash::make()`
- JWT: `tymon/jwt-auth` أو Laravel Sanctum / Passport

## Testing

```bash
php artisan test
# أو
./vendor/bin/phpunit
```

- Feature tests في `tests/Feature/`
- Unit tests في `tests/Unit/`
- Factory + Faker للـ test data

## Common Gotchas

- `==` vs `===`: استخدم `===` دائماً في PHP (loose comparison خطير)
- `null` coalescing: `$val = $data['key'] ?? 'default'`
- Array functions: `array_map`, `array_filter`, `array_reduce` — prefer Laravel Collections
- `dd()` و `dump()` للـ debugging — لا تتركها في production
