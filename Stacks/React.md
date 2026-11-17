# React Stack (SPA)

## Setup

- Vite: `bun create vite@latest` أو `npm create vite@latest`
- TypeScript strict
- Build: `bun run build`
- Dev: `bun run dev`

## Project Structure

```tree
src/
├── main.tsx           ← Entry point
├── App.tsx            ← Root component
├── pages/             ← Route pages
├── components/
│   ├── ui/            ← Generic UI components (Button, Input, Modal)
│   └── features/      ← Feature-specific components
├── hooks/             ← Custom hooks
├── stores/            ← State management (Zustand)
├── services/          ← API calls
├── types/             ← TypeScript types
└── utils/             ← Helper functions
```

## State Management

```
Local UI state         → useState / useReducer
Shared app state       → Zustand store
Server state (cache)   → TanStack Query / SWR
Form state             → React Hook Form
```

## Hooks Rules

- لا conditionals أو loops حول hooks — يجب استدعاؤها في نفس الترتيب دائماً
- `useEffect` مع cleanup: `return () => cleanup()`
- 3+ useState مترابطة → custom hook أو useReducer
- لا business logic داخل components — استخرجها لـ custom hooks

## Component Patterns

```typescript
// ✅ الكل functional components
const UserCard = ({ user }: { user: TUser }) => {
    return <div>{user.name}</div>;
};

// ✅ مسؤولية واحدة لكل component
// ✅ Props من الـ parent — لا side effects مباشرة في render
// ✅ Early return للـ loading/error states
if (loading) return <Spinner />;
if (error) return <ErrorMessage error={error} />;
```

## Performance

- `React.memo` لـ expensive pure components
- `useMemo` للـ expensive calculations — لا تفرط في استخدامه
- `useCallback` للـ stable references عند تمريرها لـ children
- Code splitting: `React.lazy` + `Suspense`
- لا anonymous functions في JSX render إذا تسبب re-renders

## Routing (React Router v6)

```typescript
// Nested routes
<Routes>
    <Route path="/" element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="users/:id" element={<UserDetail />} />
    </Route>
</Routes>
```

## API Calls

```typescript
// ✅ استخدم TanStack Query للـ server state
const { data, isLoading, error } = useQuery({
    queryKey: ['users', userId],
    queryFn: () => fetchUser(userId),
});

// ✅ Mutations مع Optimistic Updates
const mutation = useMutation({
    mutationFn: updateUser,
    onMutate: async (newData) => {
        // Optimistic update
        queryClient.setQueryData(['users', id], newData);
    },
    onError: (err, newData, context) => {
        // Rollback
        queryClient.setQueryData(['users', id], context.previousData);
    },
});
```

## TypeScript

- Props: interface مع `I` prefix — `interface IUserCardProps`
- Events: `React.ChangeEvent<HTMLInputElement>` etc.
- لا `any` — استخدم `unknown` + type guards
- Typecheck: `npx tsc --noEmit` أو `bun tsc --noEmit`

## Common Gotchas

- `key` prop يجب أن يكون unique ومستقر — لا array index إذا القائمة متغيرة
- `useEffect` بدون dependency array = يُنفَّذ بعد كل render
- `useState` async — لا تقرأ state فور تعديلها
- Event delegation: لا تضع listeners مباشرة على `document` داخل components بدون cleanup

---

## Configuration and settings

- Runtime settings live in the backend's `SystemSettings` table (`Stacks/Database.md` §1). The frontend reads the **public subset** from the backend's settings endpoint and never holds a key, a token or a business rule.
- Build-time variables (`VITE_*` or equivalent) only for what the bundle needs before any request, such as the API base URL; everything else comes from the settings endpoint and is cached with the app's server-state library.
