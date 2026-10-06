# .NET Core Stack (C#)

## Setup

- .NET 8+
- `dotnet new webapi -n AppName`
- Run: `dotnet run`
- Build: `dotnet build`
- Test: `dotnet test`
- Package: `dotnet add package PackageName`

## Project Structure

```tree
src/
├── AppName.API/            ← API layer
│   ├── Controllers/        ← HTTP endpoints
│   ├── Middleware/         ← Custom middleware
│   └── Program.cs          ← Entry point + DI setup
├── AppName.Application/    ← Business logic
│   ├── Services/
│   ├── DTOs/
│   └── Interfaces/
├── AppName.Domain/         ← Domain models + domain logic
│   ├── Entities/
│   └── Enums/
└── AppName.Infrastructure/ ← DB, external services
    ├── Data/               ← EF Core context + migrations
    └── Repositories/
```

## Naming Conventions

| النوع | الـ Convention | مثال |
| --- | --- | --- |
| Classes / Interfaces | PascalCase | `UserService`, `IUserRepository` |
| Methods | PascalCase | `GetUserById`, `CreateOrder` |
| Local variables | camelCase | `userId`, `orderData` |
| Private fields | `_camelCase` | `_userRepository` |
| Constants | PascalCase | `MaxRetries` |
| Interfaces | `I` prefix | `IUserRepository` |
| Async methods | `Async` suffix | `GetUserByIdAsync` |

## Dependency Injection

```csharp
// Program.cs
builder.Services.AddScoped<IUserRepository, UserRepository>();
builder.Services.AddScoped<IUserService, UserService>();
builder.Services.AddDbContext<AppDbContext>(opts =>
    opts.UseSqlServer(connectionString));

// Constructor injection
public class UserService(IUserRepository repo, ILogger<UserService> logger)
{
    private readonly IUserRepository _repo = repo;
    private readonly ILogger<UserService> _logger = logger;
}
```

## Entity Framework Core

```csharp
// لا hard deletes — استخدم soft delete
public class BaseEntity {
    public Guid Id { get; set; } = Guid.NewGuid();
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public bool IsDeleted { get; set; } = false;
}

// Global query filter للـ soft delete
modelBuilder.Entity<User>().HasQueryFilter(u => !u.IsDeleted);

// Migrations
dotnet ef migrations add MigrationName
dotnet ef database update
```

## Async / Await

```csharp
// ✅ async all the way — لا .Result أو .Wait()
public async Task<User?> GetUserByIdAsync(Guid id, CancellationToken ct = default)
{
    return await _context.Users
        .FirstOrDefaultAsync(u => u.Id == id && !u.IsDeleted, ct);
}

// ❌ ممنوع — سيسبب deadlock
var user = _userService.GetUserByIdAsync(id).Result;
```

## Response Format

```csharp
public record ApiResponse<T>(bool Success, T? Data, string? Message = null);
public record ApiError(string Code, string Message, IEnumerable<string>? Details = null);

// في Controller
return Ok(new ApiResponse<UserDto>(true, userDto));
return BadRequest(new ApiError("VALIDATION_FAILED", "Invalid input", errors));
```

## Validation

```csharp
// FluentValidation أو Data Annotations
public class CreateUserValidator : AbstractValidator<CreateUserDto>
{
    public CreateUserValidator()
    {
        RuleFor(x => x.Email).NotEmpty().EmailAddress();
        RuleFor(x => x.Name).NotEmpty().MaximumLength(100);
    }
}
```

## Security

- `[Authorize]` attribute لـ protected endpoints
- JWT: `Microsoft.AspNetCore.Authentication.JwtBearer`
- CORS: `builder.Services.AddCors()`
- Rate limiting: `Microsoft.AspNetCore.RateLimiting`
- لا sensitive data في logs

## Testing (xUnit / NUnit)

```csharp
public class UserServiceTests
{
    [Fact]
    public async Task GetUserById_ReturnsUser_WhenExists()
    {
        // Arrange
        var mockRepo = new Mock<IUserRepository>();
        mockRepo.Setup(r => r.GetByIdAsync(It.IsAny<Guid>()))
                .ReturnsAsync(new User { Id = Guid.NewGuid(), Name = "Test" });

        // Act
        var result = await service.GetUserByIdAsync(userId);

        // Assert
        Assert.NotNull(result);
    }
}
```

## Common Gotchas

- `DateTime.UtcNow` لا `DateTime.Now` — استخدم UTC دائماً
- `string?` يعني nullable — .NET 8 nullable reference types مفعّل بالافتراضي
- `ConfigureAwait(false)` في library code لتجنب context capture
- `IEnumerable` lazy — لا تعدّ عليها أكثر من مرة إذا أردت نفس النتيجة
