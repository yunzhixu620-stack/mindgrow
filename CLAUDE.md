# MindGrow — Claude Code Review Handoff

This file is the default context for Claude Code when reviewing this repository. It is intentionally written as a concise, review-oriented snapshot rather than a product proposal.

## 1. Review mode

Start with a read-only audit. Do not modify files, deploy, change Supabase/Aliyun settings, or expose environment-variable values until the owner approves a patch plan.

Review rules:

- Treat authentication, workspace isolation, citation integrity, and cross-tenant access as release blockers.
- Report only reproducible findings. Every finding must include `file:line`, evidence, user impact, and a concrete validation method.
- Distinguish confirmed defects from risks, design debt, and future roadmap items.
- Do not print secrets, Supabase service-role keys, DashScope keys, access tokens, or complete authorization headers.
- Ignore generated/build output during source review: `.next/`, `out/`, `artifacts/*.log`, `node_modules/`, and temporary work directories.
- Preserve the current local/anonymous mode and cloud/authenticated mode unless a proposed change explicitly covers both.
- Do not refactor the monolithic backend before pinning behavior with tests.

## 2. Product definition

MindGrow is an evidence-first AI knowledge assistant. The intended loop is:

```text
web page / URL / PDF / pasted text / meeting transcript
  -> structured parsing + verifiable citations
  -> editable knowledge map + entity graph
  -> scoped hybrid retrieval + GraphRAG
  -> grounded answer or explicit refusal
  -> user feedback and reusable knowledge
```

The three main product modules are:

1. **Knowledge Fragments**: short text expands directly; long text is organized into a progressively disclosed map; URLs must be fetched before expansion and must be rejected when unreadable.
2. **Article Parser**: URL/PDF/text parsing, citations, article Q&A, entity graph, and Audio Overview.
3. **Meeting Assistant**: transcript structuring, decisions, action items, risks, citations, and an entity graph. Meeting content should enter the long-term knowledge base only after confirmation.

The long-term positioning is Heptabase-style visual organization plus Mem-style context surfacing, with citation-grounded GraphRAG and dedicated meeting/article workflows.

## 3. Current source and deployment snapshot

Snapshot date: 2026-07-21 (Asia/Shanghai).

| Item | Current state |
|---|---|
| Source repository | `https://github.com/yunzhixu620-stack/mindgrow` |
| Source branch | `main` |
| Source commit | `b43d0da82af827d0615bef5638f72cd71d40f104` |
| Production branch | `gh-pages` |
| Production commit | `b99d1ec590ee9d28b071d03546398c51f38e9329` |
| Production web | `https://yunzhixu620-stack.github.io/mindgrow/` |
| Backend | Aliyun Function Compute `mindgrow-api`, region `cn-hangzhou` |
| Backend URL | `https://mindgrow-api-eyippxdkkh.cn-hangzhou.fcapp.run` |
| Backend API version | `10.5.2` |
| Runtime | Aliyun custom runtime, Debian 9 compatibility target |
| Deployment slot | Editable `LATEST` |
| Minimum elastic instances | `0` — no paid always-on instance enabled |
| Data/auth | Supabase Auth + PostgreSQL/REST |
| Model services | DashScope Qwen, embeddings, rerank, CosyVoice with browser speech fallback |

The deployed backend source is `fc-proxy/index.js`. Local snapshot: about 4,005 lines, SHA-256 `A7BC899B173C5D76B51F026CC959F3EB43493F7CB65569F6417ADC3E0D679AF4`.

Do not assume the editable Aliyun `LATEST` slot is cryptographically tied to the Git commit. The production health endpoint reports version `10.5.2`, and the deployed WebIDE content was manually matched to the local source, but CI-based backend deployment is not yet in place.

## 4. Architecture and key files

```text
GitHub Pages / Browser
  Next.js 15 + React 18 + TypeScript
  Tailwind CSS + React Flow + Zustand + PDF.js
        |
        | Supabase bearer token + workspace scope
        v
Aliyun Function Compute
  CORS + auth + workspace membership + API orchestration
  URL safety + parsing + citations + hybrid retrieval + GraphRAG
        |                         |
        v                         v
Supabase Auth/PostgreSQL       DashScope AI services
```

Key review targets:

| Area | File |
|---|---|
| Main application orchestration, board navigation, graph cache/prefetch | `src/app/page.tsx` |
| Article workflow | `src/components/modes/article-parser.tsx` |
| Meeting workflow | `src/components/modes/meeting-assistant.tsx` |
| Knowledge map rendering and progressive disclosure | `src/components/mindmap/mind-map-panel.tsx` |
| Knowledge Universe aggregation and graph view | `src/components/universe/universe-view.tsx` |
| Authentication/session state | `src/components/auth/auth-provider.tsx` |
| Login, registration, expired-link recovery | `src/components/auth/auth-screen.tsx` |
| Frontend API and local-mode adapter | `src/lib/client-api.ts` |
| API/Supabase public configuration | `src/lib/config.ts` |
| Entity graph shaping | `src/lib/entity-graph.ts` |
| Shared application state | `src/store/mindgrow-store.ts` |
| Entire production backend | `fc-proxy/index.js` |
| Backend smoke test | `scripts/backend-smoke.js` |
| Local E2E | `scripts/e2e-local.js` |
| Public production E2E | `scripts/e2e-public.js` |
| RAG regression suite | `scripts/rag-quality-test.js` |

Product and operational references:

- `docs/product-spec.md`
- `docs/product-and-technology-overview.md`
- `docs/graphrag-architecture.md`
- `docs/evaluation-suite-2026-07-20.md`
- `docs/operations-runbook.md`
- `docs/seo-plan.md`

## 5. Recent navigation-performance change

Commit `b43d0da` introduced:

- Per-workspace/per-map graph caching.
- Immediate cached restoration on knowledge-base switching.
- AbortController cancellation of stale map requests.
- First-map prefetch per board.
- Background revalidation after cache hits.
- One aggregate Knowledge Universe API request.
- A 60-second Universe cache and local scope filtering without refetching.

Measured local navigation results:

- Board/map switches: `203 ms`, `175 ms`, `129 ms`.
- Knowledge Universe scope switch: `41 ms`.

Review this change specifically for stale-cache writes, workspace-key collisions, abort races, optimistic-update loss, unmounted state updates, and mismatches between local and cloud adapters.

## 6. Backend contracts and security boundaries

The browser may contain only public Supabase configuration and the user's short-lived session. Secret/service-role credentials remain in Aliyun environment variables.

Expected backend environment-variable names; never output their values:

```text
ALLOWED_ORIGINS
AUTH_REQUIRED
DASHSCOPE_AUDIO_ENDPOINT
FC_SERVER_PORT
MEETING_AI_ENHANCEMENT
MINDGROW_API_KEY
SUPABASE_KEY
SUPABASE_URL
UPSTREAM_TIMEOUT_MS
```

Frontend build-time names:

```text
NEXT_PUBLIC_API_BASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
NEXT_PUBLIC_SUPABASE_URL
```

Critical invariants:

- Every cloud data request validates the Supabase user and workspace membership.
- Resource ownership is checked again for maps, nodes, documents, citations, and graph relations.
- Anonymous calls to knowledge, workspaces, and Audio Overview must return `401`.
- URL ingestion must reject private/internal network targets and unreadable sources.
- A citation quote must exist verbatim in its source text; otherwise it is discarded or the answer is downgraded.
- GraphRAG may retrieve candidates, but factual output must resolve back to `graph_evidence` or `document_chunks`.
- Evidence shortage produces a refusal, not model-memory completion.
- Article, meeting, and fragment libraries must not silently write into one another.

## 7. Verification commands and last known results

Run from the repository root:

```powershell
npm run lint
npm run build
npm run test:rag
npm run test:e2e:local
npm run test:backend
npm run test:e2e:public
```

Last known results:

| Check | Result |
|---|---|
| ESLint | Pass |
| Next.js production build | Pass |
| RAG regression/unit suite | 46/46 pass |
| Local E2E | 25/25 pass |
| Backend smoke | 5/5 pass |
| Public production E2E | 7/7 pass |
| GitHub Pages deployment | Success |

Notes:

- `npm run build` rewrites tracked `out/` files. Do not commit generated changes during a review; restore `out/` after verification unless intentionally publishing.
- The default backend smoke test is non-destructive and anonymous. Authenticated tenant CRUD is skipped unless `MINDGROW_ACCESS_TOKEN` is explicitly supplied.
- Never extract a browser session token merely to make the authenticated test run.
- Public tests require network access and should not mutate production data.

## 8. Known boundaries and unresolved checks

These are not all confirmed bugs:

1. **Cold start remains**: first backend health call after deployment was about 5.6 seconds; subsequent calls were about 1.9–2.9 seconds. Minimum instances remain `0`. Enabling one always-on/shallow-sleep instance has ongoing cost and requires explicit owner confirmation.
2. **Authenticated production CRUD not rerun in automation**: it needs an explicitly provided short-lived `MINDGROW_ACCESS_TOKEN` and a disposable test workspace/map.
3. **Email delivery needs a real inbox check**: the UI recovery flow is covered, but actual Supabase SMTP delivery and mobile confirmation-link completion require manual verification.
4. **Backend deployment drift risk**: Aliyun `LATEST` is updated manually; source-to-production hashing and CI/CD are not implemented.
5. **GraphRAG roadmap**: entity/relation retrieval is implemented, but full L3 community Wiki generation and the L4 human gold-path evaluation set remain future work.
6. **PDF citation UX**: page locators exist, but click-to-open-and-highlight in an embedded PDF viewer is not complete.
7. **Runbook version drift**: check `docs/operations-runbook.md` for any older hard-coded health-version expectation before relying on it operationally.

## 9. Required review priority

Use this order:

### P0 — release blockers

- Cross-workspace or cross-user data access.
- Secret leakage to the browser, repository, logs, or error messages.
- SSRF/private-network access through URL parsing.
- Citations that cannot be traced to the source.
- Anonymous access that returns protected data.
- Destructive migration or write path without ownership checks.

### P1 — correctness and reliability

- Stale requests overwriting the last selected board/module.
- Cache keys or aggregate Universe data crossing workspaces.
- Article/meeting/fragment mode leakage.
- GraphRAG selecting the wrong same-name entity, version, paper, metric, or time range.
- Long-text/PDF parsing losing important numbers, table structure, or citation positions.
- Meeting confirmation semantics not matching persistence behavior.
- API timeouts producing ungrounded fallback answers.

### P2 — performance and maintainability

- Avoidable sequential Supabase/model calls.
- Excessive full-graph rendering or refetching.
- Missing indexes or unbounded result sets.
- Backend monolith boundaries that can be extracted safely after behavior is covered.
- Static bundle size and unnecessary client-side dependencies.

### P3 — UX and documentation

- Dense graph readability and progressive disclosure.
- Answer hierarchy: conclusion first, sections/tables where useful, evidence separated from AI extension.
- Mobile overflow, empty/loading/error/retry states.
- Documentation or deployment metadata drift.

## 10. Expected audit output

Return the review in Chinese using this exact structure:

1. **Executive verdict**: whether the current version is safe to continue testing, with one sentence of evidence.
2. **Findings table**: severity, confidence, `file:line`, reproduction/evidence, impact, proposed fix, regression test.
3. **Retrieval-quality review**: query routing, entity disambiguation, graph expansion, reranking, citation precision, and refusal behavior.
4. **Product-flow review**: Knowledge Fragments, Article Parser, Meeting Assistant, Knowledge Universe, login/recovery, desktop/mobile.
5. **Test results**: commands actually run and exact outcomes; do not claim unrun tests.
6. **External/manual checks**: Aliyun, Supabase email, authenticated production CRUD, and any operation requiring owner approval.
7. **Minimal patch plan**: smallest ordered set of fixes, without implementing until approved.

## Copy-paste review request

```text
请先完整读取仓库根目录 CLAUDE.md，并严格进行只读审查。不要立即改代码、部署或修改云配置。先检查 main 当前提交、git status 和关键架构文件，再按 CLAUDE.md 第 9 节的 P0→P3 顺序检查。运行不破坏数据的 lint、build、RAG、E2E 和 backend smoke；明确区分“已运行”“未运行”和“需要人工权限”。最终严格按第 10 节输出，所有问题必须包含 file:line、证据、影响、建议修复和回归测试，不能只给泛化建议，也不要输出任何密钥或令牌。
```
