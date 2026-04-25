# R1-12 — AI Models Registry (Admin)

**Spec ID:** R1-12  
**Title:** AI Models Registry (Admin — Subscription)  
**Release:** R1  
**Priority:** P1  
**Status:** ⬜ Not Started  
**Created:** 2026-04-25  
**Updated:** 2026-04-25  
**Spec Owner:** TBD  
**Backlog Ref:** P10-superadmin  

---

## 1. Feature Overview

The AI Models Registry gives platform administrators a centralized control panel for managing which AI models are available to tenants who subscribe to DesignFoundry's managed AI service. This spec covers **subscription-based AI models only** — models that DesignFoundry provisions and bills for directly. It does NOT cover BYOAI (Bring Your Own AI), where tenants connect their own API keys, which is handled in the main app's AI settings.

The super admin configures:
- Which models are available on the platform (from the supported provider list)
- Per-model pricing (output tokens, input tokens)
- Default model selection per page context (object detail, diagram canvas, reports)
- Tenant-level AI subscription management (enable/disable, tier, spending limits)
- Usage reporting and billing (token counts per tenant per model)

This spec extends the AI Assistant architecture from S083 (AI Assistant) by adding the admin-side management layer.

---

## 2. Goals

- [ ] **Global Model Catalog** — list all available subscription models with provider, context limits, pricing
- [ ] **Add / Remove Models** — add new model configurations; soft-remove deprecated models
- [ ] **Per-Model Settings** — default/enabled flag, context window size, output token limit, price per 1K tokens
- [ ] **Tenant AI Subscriptions** — enable/disable AI for a specific tenant; set tier (Basic / Pro / Enterprise)
- [ ] **Spending Limits** — per-tenant monthly AI spending cap; alert when approaching limit
- [ ] **Usage Dashboard** — token usage per tenant per model; monthly totals; cost estimates
- [ ] **Default Model Configuration** — set default model per page context (object, diagram, report)
- [ ] **Model Availability by Instance** — control which models are available on which deployments

---

## 3. Non-Goals

- BYOAI management (tenant configures their own API key; separate spec S083)
- Direct integration with LLM providers (providers managed by DesignFoundry ops; not tenant-facing)
- Real-time token billing (billing is monthly aggregation; not per-request)
- AI-generated content moderation (Phase 2)

---

## 4. User Story

> As a **Platform Operator**,  
> I want to manage which AI models are available on the platform, configure pricing, and control which tenants have access to managed AI,  
> so that I can offer AI-assisted architecture as a subscription product, enforce spending limits, and manage the AI feature across all deployments.

---

## 5. Acceptance Criteria

| ID | Criterion | Verification | Test Scenario |
|----|-----------|--------------|---------------|
| AC1 | Model catalog lists all subscription models | E2E | All models shown with provider, context window, pricing |
| AC2 | Add new model → appears in catalog | E2E | Fill form → model in list with correct config |
| AC3 | Disable model → not available to tenants | E2E | Disable Anthropic Claude → tenants cannot select it |
| AC4 | Enable AI for tenant → tenant sees AI button | E2E | Toggle tenant AI on → AI panel appears in their UI |
| AC5 | Spending limit set → enforced at API level | Integration | Set $100 limit → usage tracked → blocked at $100 |s
| AC6 | Usage dashboard shows per-tenant token counts | Visual | Token usage per model for tenant |s
| AC7 | Default model per context configured | E2E | Set default "claude-sonnet" for object detail → new chats use it |
| AC8 | Model pricing configured → used in billing | Unit | Price per 1K tokens stored → used in usage cost calculation |

---

## 6. Functional Requirements

### FR-1: Global Model Catalog (`/superadmin/ai-models`)

Table columns: Model ID · Display Name · Provider · Context Window · Output Limit · Price (per 1K tokens) · Enabled · Instances · Actions

Providers supported (DesignFoundry-managed):
| Provider | Models |
|-----------|---------|
| Anthropic | Claude Opus 4, Claude Sonnet 4, Claude Haiku |
| OpenAI | GPT-4o, GPT-4o-mini, o3-mini |
| Google | Gemini 2.0 Flash, Gemini 1.5 Pro |
| Mistral | Mistral Large, Mistral Small |

Actions per row: Edit · Enable/Disable · Remove

### FR-2: Add / Configure Model

Form fields:
| Field | Type | Notes |
|-------|------|-------|
| Provider | Select | Anthropic / OpenAI / Google / Mistral |
| Model ID | Text | Internal ID (e.g. `claude-opus-4-6`) |
| Display Name | Text | Shown to tenants (e.g. "Claude Opus 4") |
| Context Window | Number | Max tokens (e.g. 200000) |
| Output Token Limit | Number | Max output per response |
| Input Price | Number | Price per 1K input tokens ($) |
| Output Price | Number | Price per 1K output tokens ($) |
| Enabled | Toggle | |
| Available Instances | Multi-select | Which instances this model is available on |

### FR-3: Tenant AI Subscription Management

Per-tenant AI settings (`/superadmin/tenants/:id/ai`):

| Field | Type | Notes |
|-------|------|-------|
| AI Enabled | Toggle | Master switch for managed AI |
| AI Tier | Select | None / Basic / Pro / Enterprise |
| Monthly Spending Limit | Number | $0 = unlimited |
| Spending Alert Threshold | Number | % of limit to trigger alert (e.g. 80%) |
| Selected Models | Multi-select | Which models this tenant can use |

AI Tiers:
| Tier | Included Models | Monthly Base | Token Budget |
|------|-----------------|--------------|--------------|
| Basic | Small/fast models only (Haiku, GPT-4o-mini) | $0 (included) | 10K tokens/mo |
| Pro | All models, 100K token budget | $49/mo | 100K tokens/mo |
| Enterprise | All models, unlimited budget | $299/mo | Unlimited |

### FR-4: Spending Limit Enforcement

When a tenant's AI usage reaches their spending limit:
1. `ai_spending_current` counter tracked per tenant per month
2. At 80% threshold: internal alert to platform ops
3. At 100%: `POST /ai/execute` returns `403 FeatureLimitExceeded` with message
4. Tenant sees in-app message: "AI spending limit reached. Contact your administrator."
5. Admin can reset the counter or raise the limit from the superadmin UI

### FR-5: Usage Dashboard (`/superadmin/ai-usage`)

Aggregate view: total platform AI spend this month · total tokens used · active AI tenants

Per-tenant breakdown table:
| Tenant | AI Tier | Models Used | Input Tokens | Output Tokens | Est. Cost | Spending vs Limit |
|--------|---------|-------------|--------------|---------------|-----------|-------------------|
| Acme Corp | Pro | Claude Sonnet 4 | 1.2M | 340K | $47.82 | 47.8% |

Filters: month, tier, instance

### FR-6: Default Model Configuration

Set defaults per page context (used when tenant has AI enabled and no explicit model selected):

| Context | Default Model |
|---------|--------------|
| Object Detail | `claude-sonnet-4-6` |
| Diagram Canvas | `claude-opus-4-6` |
| Reports | `gpt-4o` |
| Global Fallback | `claude-sonnet-4-6` |

Admin configures via `PATCH /api/v1/superadmin/ai-models/defaults`.

---

## 7. API Design

### GET /api/v1/superadmin/ai-models

#### Response 200 OK
```json
{
  "models": [
    {
      "id": "claude-opus-4-6",
      "provider": "anthropic",
      "displayName": "Claude Opus 4",
      "contextWindow": 200000,
      "outputTokenLimit": 8192,
      "inputPricePer1k": 0.015,
      "outputPricePer1k": 0.075,
      "enabled": true,
      "instanceIds": ["uuid", "uuid"],
      "createdAt": "2025-01-01T00:00:00Z"
    }
  ]
}
```

### POST /api/v1/superadmin/ai-models

#### Request
```json
{
  "id": "claude-opus-4-6",
  "provider": "anthropic",
  "displayName": "Claude Opus 4",
  "contextWindow": 200000,
  "outputTokenLimit": 8192,
  "inputPricePer1k": 0.015,
  "outputPricePer1k": 0.075,
  "enabled": true,
  "instanceIds": ["uuid"]
}
```

### PATCH /api/v1/superadmin/ai-models/:modelId

### PATCH /api/v1/superadmin/ai-models/defaults

#### Request
```json
{
  "objectDetail": "claude-sonnet-4-6",
  "diagramCanvas": "claude-opus-4-6",
  "reports": "gpt-4o",
  "global": "claude-sonnet-4-6"
}
```

### GET /api/v1/superadmin/ai-usage

#### Query Params: `month` (YYYY-MM), `instanceId`, `page`, `limit`

#### Response 200 OK
```json
{
  "platformTotals": {
    "totalInputTokens": 12400000,
    "totalOutputTokens": 3400000,
    "estimatedCost": 4821.50,
    "activeTenants": 47
  },
  "tenants": [
    {
      "tenantId": "uuid",
      "tenantName": "Acme Corp",
      "aiTier": "pro",
      "modelsUsed": ["claude-opus-4-6", "gpt-4o"],
      "inputTokens": 1200000,
      "outputTokens": 340000,
      "estimatedCost": 47.82,
      "spendingLimit": 100,
      "spendingUsed": 47.82
    }
  ],
  "total": 142
}
```

### GET /api/v1/superadmin/tenants/:tenantId/ai

### PATCH /api/v1/superadmin/tenants/:tenantId/ai

#### Request
```json
{
  "enabled": true,
  "tier": "pro",
  "spendingLimit": 100,
  "spendingAlertThreshold": 80,
  "modelIds": ["claude-opus-4-6", "claude-sonnet-4-6", "gpt-4o"]
}
```

---

## 8. Data Model Changes

### New Entity: `ai_models`
| Column | Type | Notes |
|--------|------|-------|
| id | varchar | PK (provider/model-id) |
| provider | varchar | anthropic / openai / google / mistral |
| display_name | varchar | |
| context_window | int | Max tokens |
| output_token_limit | int | |
| input_price_per_1k | decimal | $ per 1K input tokens |
| output_price_per_1k | decimal | $ per 1K output tokens |
| enabled | boolean | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### New Entity: `ai_model_defaults`
| Column | Type | Notes |
|--------|------|-------|
| context | varchar | PK (object_detail / diagram_canvas / reports / global) |
| model_id | varchar | FK to `ai_models.id` |
| updated_at | timestamptz | |

### New Entity: `tenant_ai_subscriptions`
| Column | Type | Notes |
|--------|------|-------|
| tenant_id | uuid | PK |
| enabled | boolean | |
| tier | varchar | none / basic / pro / enterprise |
| spending_limit | decimal | Monthly $ limit |
| spending_alert_threshold | int | % (e.g. 80) |
| current_spending | decimal | Accumulated this month |
| reset_at | timestamptz | Month boundary for counter reset |

### New Entity: `tenant_ai_model_access`
| Column | Type | Notes |
|--------|------|-------|
| tenant_id | uuid | PK + FK |
| model_id | varchar | PK + FK |
| enabled | boolean | |

### New Entity: `ai_usage_logs`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | FK |
| model_id | varchar | |
| input_tokens | int | |
| output_tokens | int | |
| cost_usd | decimal | |
| recorded_at | timestamptz | Indexed; retention 90 days |

---

## 9. Architecture / Implementation Notes

| Decision | Choice | Rationale |
|----------|--------|-----------|
| AI cost tracking | Per-request token counts logged; cost calculated from per-model price | Transparent billing |
| Spending counter | Reset monthly at `reset_at` timestamp | Aligns with subscription billing |
| Limit enforcement | Checked at API gateway layer | Centralized; not per-service |
| Model availability | Per-instance toggle in `ai_model_instance_availability` | Different instances may have different model availability |

### Spending Limit Enforcement Flow
```
Tenant calls POST /api/v1/ai/execute
        ↓
API gateway: check tenant_ai_subscriptions.spending_limit
        ↓
If current_spending >= limit → return 403 FeatureLimitExceeded
        ↓
Else: proceed to AI execution
        ↓
After execution: log tokens + cost to ai_usage_logs
        ↓
Increment tenant_ai_subscriptions.current_spending
```

---

## 10. UI/UX Requirements

### AI Models Catalog
```
┌────────────────────────────────────────────────────────────────────────┐
│ AI Models (Subscription)                         [+ Add Model]        │
├────────────────────────────────────────────────────────────────────────┤
│ Model ID         │ Provider   │ Context │ Price       │ Enabled │ ··· │
│ ────────────────────────────────────────────────────────────────────  │
│ claude-opus-4-6  │ Anthropic  │ 200K    │ $0.015/$0.075│  [●]   │ ··· │
│ claude-sonnet-4-6│ Anthropic  │ 200K    │ $0.003/$0.015│  [●]   │ ··· │
│ gpt-4o           │ OpenAI     │ 128K    │ $0.005/$0.015│  [○]   │ ··· │
├────────────────────────────────────────────────────────────────────────┤
│ Default Model Settings                                               │
│ Object Detail: [Claude Sonnet 4 ▼]                                 │
│ Diagram Canvas: [Claude Opus 4     ▼]                               │
│ Reports:       [GPT-4o            ▼]                               │
└────────────────────────────────────────────────────────────────────────┘
```

### AI Usage Dashboard
```
┌────────────────────────────────────────────────────────────────────────┐
│ AI Usage — April 2025                        [↺ Refresh]            │
├────────────────────────────────────────────────────────────────────────┤
│ $4,821.50 Platform Spend  │  12.4M Input Tokens  │  3.4M Output Tokens│
│ 47 Active AI Tenants      │                      │                    │
├────────────────────────────────────────────────────────────────────────┤
│ Tenant      │ Tier │ Input Tokens │ Output Tokens │ Est. Cost │ Limit  │
│ Acme Corp   │ Pro  │ 1.2M         │ 340K         │ $47.82    │ $100   │
│ Beta Corp  │ Entr │ 4.1M         │ 1.2M         │ $189.40   │ $500   │
│ Gamma Inc  │ Basic│ 80K          │ 22K          │ $3.20     │ —      │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 11. Security & Compliance

| Concern | Handling |
|---------|----------|
| Spending limits | Enforced at API gateway; cannot be bypassed by UI |
| Model access | Tenant can only use models they've been granted access to |
| AI audit | Every AI execution logged with tenant, model, token counts, cost |
| Token logging | Usage logs retained 90 days; not tied to PII beyond tenant ID |

---

## 12. Out of Scope

- BYOAI (tenant-provided API keys) — S083 scope
- Real-time per-request billing alerts — monthly aggregation only
- AI content filtering/moderation
- Multi-modal AI (vision, audio)

---

## 13. Open Questions

| Question | Options | Recommendation |
|----------|---------|----------------|
| Token count accuracy | Exact from provider vs estimated | Use exact from provider response; store raw |
| Spending reset | Calendar month vs rolling 30 days | Calendar month; aligns with subscription billing |
| Alert channel | Email to ops / PagerDuty / Slack | Email for R1 |

---

## 14. Dependencies

| Dependency | Type | Notes |
|------------|------|-------|
| S083 (AI Assistant) | Required | Defines AI architecture + BYOAI; this spec is admin-side |
| R1-02 (Tenant Management) | Required | AI settings tab in tenant detail |
| R1-07 (Instance Registry) | Required | Model availability per instance |

---

## 15. Linked Specs

- **S083** (AI Assistant) — Defines AI assistant architecture; BYOAI vs subscription distinction
- **R1-02** (Tenant Management) — AI settings tab in tenant detail
- **R1-07** (Instance Registry) — Per-instance model availability

---

## 16. Verification & Testing

| ID | Description | Expected Result | Test Type |
|----|-------------|-----------------|-----------|
| TC1 | Model catalog shows all models | All subscription models listed | E2E |
| TC2 | Disable model → tenant cannot select it | Toggle → model not in tenant model picker | E2E |
| TC3 | Enable AI for tenant → AI button appears | Toggle → tenant UI shows AI | E2E |
| TC4 | Set spending limit → enforced at limit | Usage reaches limit → 403 returned | Integration |
| TC5 | 80% threshold → alert triggered | Usage 80% → alert fired | Integration |
| TC6 | Usage dashboard shows correct token counts | Token counts match logs | Unit |
| TC7 | Default model per context → used in new chat | Configure → new chat → correct model used | E2E |
