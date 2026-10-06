# GraphQL Stack — Modular Monolith

## متى تُستخدم بدل REST

| REST | GraphQL |
| --- | --- |
| CRUD بسيطة، endpoints محددة | بيانات متشعبة أو relations معقدة |
| Public API لأطراف خارجية | Client يحتاج data shaping مرن |
| File upload primary flow | Real-time subscriptions |
| Simple microservices | Single API يخدم Web + Mobile |

---

## Architecture — Modular Monolith

كل module يمتلك **GraphQL layer خاص به** — Schema يُجمَّع منهم في النهاية.

```tree
Src/
├── App.ts                           ← Hono app (mount GraphQL endpoint)
├── Server.ts                        ← Bootstrap
│
├── GraphQL/                         ← الـ core layer فقط
│   ├── Schema.ts                    ← buildSchema() — يجمع كل الـ modules
│   ├── Builder.ts                   ← SchemaBuilder instance (shared)
│   └── Context.ts                   ← TGraphQLContext type + CreateContext()
│
└── Modules/
    └── [ModuleName]/
        ├── Test/
        │   ├── E2E/
        │   ├── Integration/
        │   ├── Unit/
        │   └── Edge/
        ├── [Module].Routes.ts        ← REST routes (إن وجدت)
        ├── [Module].Controller.ts
        ├── [Module].Service.ts       ← Business logic (يستخدمه الـ resolver)
        ├── [Module].Schema.ts        ← Zod validation schemas
        ├── [Module].Events.ts
        ├── Models/
        │   └── [Entity].Model.ts     ← Drizzle schema
        └── GraphQL/                  ← GraphQL layer الخاص بالـ module
            ├── [Module].Types.ts     ← objectType + inputType definitions
            ├── [Module].Queries.ts   ← Query fields
            ├── [Module].Mutations.ts ← Mutation fields
            ├── [Module].Subscriptions.ts ← Subscription fields (إن وجدت)
            └── [Module].Loaders.ts   ← DataLoaders (per-request)
```

### مثال — Module Auth

```tree
Modules/
└── Auth/
    ├── Auth.Service.ts
    ├── Auth.Schema.ts
    ├── Models/
    │   ├── Users.Model.ts
    │   └── RefreshTokens.Model.ts
    └── GraphQL/
        ├── Auth.Types.ts         ← User type, AuthPayload type
        ├── Auth.Queries.ts       ← Me query
        ├── Auth.Mutations.ts     ← SignIn, SignUp, SignOut, RefreshToken
        └── Auth.Loaders.ts       ← UserByIdLoader
```

```tree
Modules/
└── Products/
    ├── Products.Service.ts
    ├── Products.Schema.ts
    ├── Models/
    │   ├── Products.Model.ts
    │   └── ProductTranslations.Model.ts
    └── GraphQL/
        ├── Products.Types.ts     ← Product type, ProductConnection type
        ├── Products.Queries.ts   ← GetProduct, ListProducts, SearchProducts
        ├── Products.Mutations.ts ← CreateProduct, UpdateProduct, DeleteProduct
        └── Products.Loaders.ts   ← ProductByIdLoader, ProductsByCategoryLoader
```

---

## Schema Assembly — GraphQL/Schema.ts

```typescript
/**
 * Schema.ts
 * Assembles the full GraphQL schema from all module GraphQL layers.
 * Import order does not matter — Pothos handles type resolution.
 */
import { Builder } from './Builder';

// كل module يُسجَّل نفسه عند الاستيراد
import '../Modules/Auth/GraphQL/Auth.Types';
import '../Modules/Auth/GraphQL/Auth.Queries';
import '../Modules/Auth/GraphQL/Auth.Mutations';

import '../Modules/Products/GraphQL/Products.Types';
import '../Modules/Products/GraphQL/Products.Queries';
import '../Modules/Products/GraphQL/Products.Mutations';

import '../Modules/Orders/GraphQL/Orders.Types';
import '../Modules/Orders/GraphQL/Orders.Queries';
import '../Modules/Orders/GraphQL/Orders.Mutations';
import '../Modules/Orders/GraphQL/Orders.Subscriptions';

export const Schema = Builder.toSchema();
```

---

## Builder — GraphQL/Builder.ts

```typescript
/**
 * Builder.ts
 * Single SchemaBuilder instance shared across all modules.
 * Context type is defined here — all resolvers inherit it.
 */
import SchemaBuilder from '@pothos/core';
import type { TGraphQLContext } from './Context';

export const Builder = new SchemaBuilder<{
  Context: TGraphQLContext;
}>({});

Builder.queryType({});
Builder.mutationType({});
Builder.subscriptionType({});
```

---

## Context — GraphQL/Context.ts

```typescript
/**
 * Context.ts
 * Per-request GraphQL context — created fresh for every request.
 * DataLoaders are instantiated here (never shared between requests).
 */
export type TGraphQLContext = {
  UserId:   string | null;
  UserRole: EUserRole | null;
  Locale:   string;
  DB:       TDrizzleClient;
  Loaders:  TDataLoaders;       // ← DataLoaders per-request
};

export async function CreateContext(req: Request): Promise<TGraphQLContext> {
  const Token   = req.headers.get('Authorization')?.replace('Bearer ', '');
  const Payload = Token ? await VerifyAccessToken(Token) : null;

  return {
    UserId:   Payload?.UserId ?? null,
    UserRole: Payload?.Role   ?? null,
    Locale:   req.headers.get('Accept-Language') ?? 'en',
    DB:       Database,
    Loaders:  CreateLoaders(),   // ← fresh DataLoaders per-request
  };
}
```

---

## Module Types — [Module].Types.ts

```typescript
/**
 * Auth.Types.ts
 * Pothos type definitions for the Auth module.
 * Imported by Schema.ts — registers types on the Builder automatically.
 */
import { Builder } from '@/Src/GraphQL/Builder';

Builder.objectType('User', {
  fields: (t) => ({
    Id:        t.exposeString('Id'),
    Name:      t.exposeString('Name'),
    Email:     t.exposeString('Email'),
    Role:      t.exposeString('Role'),
    CreatedAt: t.exposeString('CreatedAt'),
  }),
});

Builder.objectType('AuthPayload', {
  fields: (t) => ({
    AccessToken: t.exposeString('AccessToken'),
    User:        t.expose('User', { type: 'User' }),
  }),
});

// Input types في نفس الملف لأنها مرتبطة بالـ type
Builder.inputType('SignInInput', {
  fields: (t) => ({
    Email:    t.string({ required: true }),
    Password: t.string({ required: true }),
  }),
});
```

---

## Module Queries — [Module].Queries.ts

```typescript
/**
 * Auth.Queries.ts
 * Query field definitions for the Auth module.
 */
import { Builder } from '@/Src/GraphQL/Builder';
import { AuthService } from '../Auth.Service';

Builder.queryField('Me', (t) =>
  t.field({
    type:        'User',
    nullable:    true,
    description: 'Returns the authenticated user or null',
    resolve: (_, __, ctx) => {
      if (!ctx.UserId) return null;
      return AuthService.GetById(ctx.UserId);
    },
  })
);
```

---

## Module Mutations — [Module].Mutations.ts

```typescript
/**
 * Auth.Mutations.ts
 * Mutation field definitions for the Auth module.
 */
import { Builder } from '@/Src/GraphQL/Builder';
import { AuthService } from '../Auth.Service';

Builder.mutationField('SignIn', (t) =>
  t.field({
    type:  'AuthPayload',
    args:  { Input: t.arg({ type: 'SignInInput', required: true }) },
    resolve: async (_, { Input }, ctx) => {
      return AuthService.SignIn(Input, ctx.Locale);
    },
  })
);

Builder.mutationField('SignUp', (t) =>
  t.field({
    type:  'AuthPayload',
    args:  { Input: t.arg({ type: 'SignUpInput', required: true }) },
    resolve: async (_, { Input }, ctx) => {
      return AuthService.SignUp(Input, ctx.Locale);
    },
  })
);
```

---

## DataLoaders — [Module].Loaders.ts

```typescript
/**
 * Products.Loaders.ts
 * DataLoaders for the Products module — prevent N+1 queries.
 * Instantiated per-request in Context.ts — never share between requests.
 */
import DataLoader from 'dataloader';
import { inArray } from 'drizzle-orm';

export function CreateProductLoaders(DB: TDrizzleClient) {
  return {
    // Load products by ID (batch)
    ById: new DataLoader(async (Ids: readonly string[]) => {
      const Products = await DB.query.Products.findMany({
        where: inArray(ProductsTable.Id, [...Ids]),
      });
      return Ids.map(Id => Products.find(P => P.Id === Id) ?? null);
    }),

    // Load products by category (batch)
    ByCategoryId: new DataLoader(async (CategoryIds: readonly string[]) => {
      const Products = await DB.query.Products.findMany({
        where: inArray(ProductsTable.CategoryId, [...CategoryIds]),
      });
      return CategoryIds.map(Id => Products.filter(P => P.CategoryId === Id));
    }),
  };
}
```

```typescript
// استخدام في resolver
Builder.objectField('Category', 'Products', (t) =>
  t.field({
    type:    ['Product'],
    resolve: (Category, _, ctx) =>
      ctx.Loaders.Products.ByCategoryId.load(Category.Id),  // ← DataLoader
  })
);
```

---

## Subscriptions — [Module].Subscriptions.ts

```typescript
/**
 * Orders.Subscriptions.ts
 * Real-time subscription fields for the Orders module.
 */
import { Builder } from '@/Src/GraphQL/Builder';
import { pubsub } from '@/Src/Core/EventBus/PubSub';

Builder.subscriptionField('OnOrderStatusChanged', (t) =>
  t.field({
    type:    'Order',
    args:    { OrderId: t.arg.string({ required: true }) },
    subscribe: (_, { OrderId }, ctx) => {
      if (!ctx.UserId) throw new GraphQLError('Unauthorized', {
        extensions: { code: 'UNAUTHENTICATED' }
      });
      return pubsub.subscribe(`order:${OrderId}`);
    },
    resolve: (Payload) => Payload,
  })
);
```

---

## Error Handling

```typescript
// كل error له code موحد
throw new GraphQLError('Resource not found', {
  extensions: {
    code:    'NOT_FOUND',     // machine-readable
    field:   'productId',    // إذا validation error
    locale:  ctx.Locale,
  },
});

// Codes موحدة
// UNAUTHENTICATED  → لا يوجد token
// FORBIDDEN        → token موجود لكن لا صلاحية
// NOT_FOUND        → resource غير موجود
// VALIDATION_ERROR → input غير صالح
// INTERNAL_ERROR   → server error (لا تُكشف تفاصيله للـ client)
```

---

## Naming في GraphQL Schema

| النوع | الـ Convention | مثال |
| --- | --- | --- |
| Object Types | PascalCase | `User`, `OrderItem` |
| Fields | PascalCase | `CreatedAt`, `UserId` |
| Queries | PascalCase | `GetProduct`, `ListOrders` |
| Mutations | PascalCase verb | `CreateOrder`, `UpdateUser` |
| Subscriptions | `On` + PascalCase | `OnNewMessage`, `OnOrderStatusChanged` |
| Input types | PascalCase + `Input` | `CreateOrderInput` |
| Enums | `E` + PascalCase | `EOrderStatus` |
| Connections | PascalCase + `Connection` | `ProductConnection` |

---

## Client Side — Apollo Client (Next.js)

### Codegen — MANDATORY

```bash
# بعد أي تعديل على .graphql files
NEXT_PUBLIC_GRAPHQL_URL="" bun run codegen
```

```typescript
// ✅ Generated types دائماً
import { useGetProductQuery } from '@/Lib/GraphQL/Generated';

// ❌ ممنوع — manual types لـ GraphQL responses
type ProductResponse = { data: { Product: { Id: string } } };
```

### .graphql Files — Operation per File

```graphql
# Queries/GetProduct.graphql
query GetProduct($Id: String!) {
  Product(Id: $Id) {
    Id
    Slug
    Translations { Locale Title Description }
    Category { Id Name }
  }
}

# Mutations/AddToCart.graphql
mutation AddToCart($Input: AddToCartInput!) {
  AddToCart(Input: $Input) {
    Id
    Items { ProductId Quantity Price }
  }
}
```

### Cache Updates بعد Mutation

```typescript
const [CreateProduct] = useCreateProductMutation({
  update(cache, { data }) {
    cache.modify({
      fields: {
        Products(Existing = []) {
          const NewRef = cache.writeFragment({
            data: data?.CreateProduct,
            fragment: ProductFragment,
          });
          return [...Existing, NewRef];
        },
      },
    });
  },
});
```

---

## Code Quality — Checklist

```txt
[ ] كل module له مجلد GraphQL/ خاص به
[ ] Schema.ts يستورد من كل الـ modules — لا type definitions فيه
[ ] Builder.ts instance واحد shared — لا تُنشئ builder في كل module
[ ] Context ينشئ DataLoaders fresh لكل request
[ ] DataLoader لكل relation field (منع N+1)
[ ] DataLoaders في Loaders.ts — لا في الـ resolver مباشرة
[ ] GraphQLError مع extensions.code موحد لكل error
[ ] لا internal errors تظهر للـ client في production
[ ] Auth في resolver — لا manual check في Service
[ ] Cursor-based pagination لا offset-based
[ ] Subscriptions عبر WebSocket (graphql-ws)
[ ] Codegen بعد كل تعديل على .graphql files
[ ] Generated.ts types فقط — لا manual GraphQL types
[ ] كل operation في .graphql file مستقل
[ ] Naming: Queries (Get/List), Mutations (verb), Subscriptions (On)
```
