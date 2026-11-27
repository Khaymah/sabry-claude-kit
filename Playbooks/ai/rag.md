# Retrieval over the tenant's documents

- **Situation:** "chat with our documents", "answer from the knowledge base", "search by meaning", embeddings, pgvector, "the bot should cite its source".
- **Skip when:** the corpus fits in one prompt (a few pages) or keyword search already answers the question (`backend/data/search.md`).
- **Decision:** chunks and embeddings live in the same PostgreSQL (`pgvector`) as the documents, and the tenant filter is part of the vector query itself. Retrieve top-k, answer only from those chunks, and return citations.

## Levels

| Level | Pick when (this topic's own triggers, on top of `INDEX.md`) |
|---|---|
| Minimum | Any retrieval over customer data: tenant filter in the query, delete cascades, citations |
| Standard | Production: normalisation, hybrid search, re-index on change, index health checks |
| Advanced | Millions of chunks or strict quality targets: HNSW tuning, reranking, per-tenant partitions |

## Rules

### Minimum — always, never cut

- The tenant id is in the `WHERE` of the vector query. Never fetch top-k globally and filter afterwards: it leaks neighbours and returns too few rows (`backend/data/multi-tenancy.md`).
- A chunk row carries `TenantId`, `DocumentId`, `ChunkIndex`, `Content`, `Embedding`, `ContentHash`, `EmbeddingModel`. `DocumentId` is a foreign key with `ON DELETE CASCADE`: deleting a document removes its chunks in the same transaction.
- Permissions are checked at retrieval time too: if documents have per-user access (`backend/auth/scoped-access.md`), filter chunks by it in the same query.
- Retrieved text is data, not instructions (`prompt-injection.md`).
- The answer prompt says: answer only from the sources; if they do not contain it, say so. Return `DocumentId` and chunk reference with every answer.
- Embed with one model per index; store its name on the row. Never compare vectors from different models.

### Standard — adds

- Chunk by structure first (headings, paragraphs), then by size: about 300–500 tokens with 10–15% overlap. Keep the document title and heading path in the chunk text.
- Normalise before embedding and before keyword matching: strip tashkeel and tatweel, unify alef forms (ا أ إ آ), ى to ي, ة kept distinct from ه unless search needs them merged, Arabic-Indic digits to Western, collapse whitespace. Store original text for display; embed the normalised text.
- Hybrid retrieval: vector similarity plus trigram/full-text, merged by reciprocal rank fusion; pure vector search misses exact codes, names and numbers.
- Re-index on change: compare `ContentHash` per chunk; re-embed only changed chunks in a background job; replace a document's chunks in one transaction so readers never see half-old half-new.
- Bound retrieval: top-k at most 8, a minimum similarity threshold, a token budget for the context.
- Index with HNSW (`vector_cosine_ops`); the query uses the operator the index was built for.

### Advanced — adds

- Rerank the top 30 down to 5 with a small model or cross-encoder.
- Partition or use partial indexes per large tenant when one HNSW index no longer fits memory.
- Monitor recall with the eval set (`evals.md`) after every chunking or model change; re-embed everything in a shadow index, then swap.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Question has no relevant chunk (below threshold) | Answer "not found in your documents"; no model-made answer |
| Tenant A and B have near-identical documents | Each only ever sees its own chunks, proven by a test with duplicated content |
| Document edited | Old chunks replaced in one transaction; stale answers cannot cite removed text |
| Document deleted while a re-index job runs | The job finds no document and exits; no orphan chunks (foreign key plus cascade) |
| Document is a scanned PDF with no text | Marked `NO_TEXT`, not embedded as empty chunks; user told OCR is needed |
| Arabic query with diacritics, document without | Both normalised the same way; match found |
| Mixed Arabic/English chunk | Embedded as is; keyword part matches both scripts after normalisation |
| Data at 100×: 5M chunks | HNSW index with the tenant filter still selective; check `EXPLAIN`; if the planner scans, add a partial index or partition per tenant |
| Twice / parallel: two re-index jobs for one document | Advisory lock per document id; the second exits; final state is one consistent set |
| Embedding provider down mid-index | Job retries with backoff; the document keeps its old chunks until the new set is complete |
| Embedding model changed | Rows with the old `EmbeddingModel` are not searched; background re-embed, then switch |
| Chunk contains a user's personal data | It stays inside the tenant; never copied to logs or other tenants' prompts |

## Example — Standard, Bun + Hono + Drizzle

```ts
export async function SearchChunks(TenantId: string, Query: string, UserId: string) {
  const Normalised = NormaliseArabic(Query)
  const [Vector] = await Embedder.Embed([Normalised])
  const Literal = `[${Vector.join(",")}]`
  const Rows = await db.execute<{ Id: string; DocumentId: string; Content: string; Distance: number }>(sql`
    SELECT C."Id", C."DocumentId", C."Content", C."Embedding" <=> ${Literal}::vector AS "Distance"
    FROM "DocumentChunks" AS C
    JOIN "Documents" AS D ON D."Id" = C."DocumentId"
    WHERE C."TenantId" = ${TenantId}
      AND C."EmbeddingModel" = ${Env.EmbeddingModel}
      AND D."IsDeleted" = false
      AND HasDocumentAccess(D."Id", ${UserId})
    ORDER BY C."Embedding" <=> ${Literal}::vector
    LIMIT 8`)
  return Rows.filter((R) => R.Distance < 0.5)
}

export async function ReplaceChunks(TenantId: string, DocumentId: string, Chunks: TChunk[]) {
  await db.transaction(async (Tx) => {
    await Tx.delete(DocumentChunks).where(and(eq(DocumentChunks.TenantId, TenantId), eq(DocumentChunks.DocumentId, DocumentId)))
    if (Chunks.length) await Tx.insert(DocumentChunks).values(Chunks.map((C, I) => ({ ...C, TenantId, DocumentId, ChunkIndex: I })))
  })
}
```

`HasDocumentAccess` stands for the project's own access rule; drop it when every tenant member sees every document. The distance threshold (0.5) is a default to tune on the eval set. Embedding calls go through the same adapter rules as `llm-calls.md`.

Other stacks: Prisma needs `$queryRaw` for vector operators; Laravel uses `pgvector` package casts. The pattern is the same: tenant in the SQL.

## Verify

- [ ] `[M]` Test: tenant B's query never returns tenant A's chunk, even when A's text is the best match.
- [ ] `[M]` Deleting a document leaves zero chunk rows for it.
- [ ] `[M]` Every answer carries at least one `DocumentId` citation, or says "not found".
- [ ] `[S]` Arabic query with and without tashkeel returns the same top result.
- [ ] `[S]` Editing one paragraph re-embeds only that chunk.
- [ ] `[A]` Recall@5 on the eval set does not drop after a model or chunking change.

## Pitfalls

- **Post-filtering by tenant** → leaks and empty results → filter in SQL.
- **Embedding raw Arabic with diacritics and mixed alef forms** → poor recall → normalise first.
- **Chunks without the heading path** → "the limit is 5" with no subject → prefix the context.
- **Re-embedding the whole corpus on every edit** → cost and lag → hash per chunk.
- **Deleting documents but not vectors in a separate store** → ghost answers → one database, cascade.

## Related

`backend/data/multi-tenancy.md` · `backend/data/search.md` · `backend/data/data-retention.md` · `backend/reliability/background-jobs.md` · `backend/files/uploads.md` · `ai/prompt-injection.md` · `ai/evals.md`
