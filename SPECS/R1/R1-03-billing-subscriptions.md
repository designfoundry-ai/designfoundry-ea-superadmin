# R1-03 — Billing & Subscriptions

**Spec ID:** R1-03  
**Title:** Super Admin Console — Billing & Subscriptions  
**Release:** R1  
**Priority:** P1  
**Status:** ⬜ Not Started  
**Created:** 2026-04-25  
**Updated:** 2026-04-25  
**Spec Owner:** TBD  
**Backlog Ref:** P10-superadmin  

---

## 1. Feature Overview

The Billing & Subscriptions module gives super admins full visibility and control over Stripe-based billing across all tenants: subscription status, invoice history, failed payment retry, plan upgrades/downgrades, refunds, and dunning management.

This module is the admin-side counterpart to the Stripe webhook handler in R1-04 (License Management) and the Stripe events that create/update licenses.

---

## 2. Goals

- [ ] **Billing Overview** — cross-tenant MRR breakdown: active MRR, churned MRR, net new MRR, trial conversion rate, ARPU, LTV, MRR movement waterfall
- [ ] **Failed Payments Queue** — tenants with failed charges: amount, retry count, last attempt; retry now, waive, contact actions
- [ ] **Per-Tenant Billing View** — Stripe subscription card, invoice list, payment method, plan change
- [ ] **Plan Upgrade/Downgrade** — change tenant plan via Stripe API
- [ ] **Refund** — partial or full refund for a specific invoice
- [ ] **Cancel Subscription** — cancel and optionally cancel immediately vs end of period
- [ ] **Retry Failed Payment** — manually trigger Stripe retry for a failed invoice

---

## 3. Non-Goals

- Invoice generation (Stripe owns invoice PDFs and emails)
- Payment method editing (tenant does this in their own settings)
- Refund for non-Stripe payment methods
- Real-time billing Webhooks beyond what the Stripe handler processes

---

## 4. User Story

> As a **Platform Operator**,  
> I want to manage billing issues and subscription changes for all tenants from one place,  
> so that I can resolve failed payments, process refunds, and adjust plans without logging into the Stripe dashboard directly.

---

## 5. Acceptance Criteria

| ID | Criterion | Verification | Test Scenario |
|----|-----------|--------------|---------------|
| AC1 | Billing overview shows MRR waterfall | Visual | MRR waterfall chart renders with correct data |
| AC2 | Failed payments list shows all failed invoices | E2E | Failed invoices appear with tenant, amount, date |
| AC3 | Retry payment → Stripe API called → success shown | E2E | Click Retry → Stripe retries → status updates |
| AC4 | Issue refund → amount confirmed → Stripe refund created | E2E | Issue refund → Stripe refund → invoice shows refunded |
| AC5 | Upgrade plan → Stripe subscription updated | E2E | Select new plan → Stripe subscription updated → MRR changes |
| AC6 | Per-tenant billing view shows Stripe data | Visual | Tenant → Billing tab → subscription + invoices |
| AC7 | Payment method masked display | Visual | Visa •••• 4242 shown (no full number) |
| AC8 | Cancel subscription → confirmation required | E2E | Cancel → confirm modal → Stripe cancellation |

---

## 6. Functional Requirements

### FR-1: Billing Overview (`/superadmin/billing`)

KPI row: Active MRR · Churned MRR · Net New MRR · Trial Conversion Rate · ARPU · LTV

MRR Waterfall Chart (bar chart):
- Categories: New Business · Expansion · Churned · Net New
- Monthly, last 6 months

Failed Payments Queue table:
| Tenant | Amount | Currency | Failed At | Retry Count | Status | Actions |
|--------|--------|----------|-----------|-------------|--------|---------|

Actions per row: Retry Now · Waive · Contact Tenant

Filters: status (pending/retrying/failed), date range, amount range

### FR-2: Per-Tenant Billing View

Accessed via: `/superadmin/tenants/:id/billing` or tenant detail → Billing tab.

Subscription card:
- Plan name, status badge
- Current period: start → end date
- Next billing date + amount
- Cancel at period end toggle

Payment method section:
- Card brand + last 4 digits (masked)
- Expiry
- "Update payment method" link → Stripe Customer Portal

Invoice table:
| Date | Invoice # | Amount | Status | PDF |
|------|-----------|--------|--------|-----|
| Apr 1, 2025 | INV-2025-001 | $990 | Paid | [↓] |

Actions: Change Plan · Issue Refund · Cancel Subscription · Retry Failed Payment

### FR-3: Plan Change Flow

1. Admin selects new plan from dropdown
2. Confirmation modal: "Change Acme Corp from Team ($99/mo) to Professional ($299/mo)?"
3. On confirm: `POST /api/v1/superadmin/billing/change-plan` → calls Stripe API
4. Success: toast + subscription card updates
5. Failure: error toast with message

### FR-4: Refund Flow

1. Admin clicks "Issue Refund" on an invoice
2. Modal: pre-filled amount (full refund); admin can adjust
3. Text area: reason for refund (required)
4. Confirm → `POST /api/v1/superadmin/billing/refund`
5. Stripe refund created → invoice status updates to "Refunded"
6. Audit log entry created

### FR-5: Failed Payment Retry

1. Admin clicks "Retry" on a failed payment row
2. Confirmation: "Retry charging Acme Corp $990?"
3. On confirm: `POST /api/v1/superadmin/billing/retry-payment`
4. Stripe retries → payment succeeds or fails → status updates
5. On success: payment removed from failed queue; tenant status updated

---

## 7. API Design

### GET /api/v1/superadmin/billing/overview

**Auth:** Required

#### Response 200 OK
```json
{
  "activeMRR": 28400,
  "churnedMRR": 1200,
  "netNewMRR": 3100,
  "trialConversionRate": 34.5,
  "arpu": 142,
  "ltv": 1704,
  "mrrHistory": [
    {
      "month": "Nov 24",
      "newBusiness": 4200,
      "expansion": 1800,
      "churned": 900,
      "netNew": 5100
    }
  ]
}
```

### GET /api/v1/superadmin/billing/failed-payments

**Auth:** Required

#### Query Params
| Param | Notes |
|-------|-------|
| `status` | `pending\|retrying\|failed` |
| `from` | ISO-8601 |
| `to` | ISO-8601 |

#### Response 200 OK
```json
{
  "failedPayments": [
    {
      "tenantId": "uuid",
      "tenantName": "Acme Corp",
      "invoiceId": "in_xxx",
      "amount": 990,
      "currency": "usd",
      "failedAt": "2025-04-20T14:30:00Z",
      "retryCount": 2,
      "status": "failed"
    }
  ],
  "total": 7
}
```

### POST /api/v1/superadmin/billing/retry-payment

#### Request
```json
{
  "customerId": "cus_xxx",
  "invoiceId": "in_xxx"
}
```

#### Response 200 OK
```json
{ "status": "succeeded" | "failed", "message": "..." }
```

### POST /api/v1/superadmin/billing/refund

#### Request
```json
{
  "invoiceId": "in_xxx",
  "amount": 495,
  "reason": "Customer requested credit for downtime"
}
```

#### Response 200 OK
```json
{ "refundId": "re_xxx", "status": "succeeded" }
```

### POST /api/v1/superadmin/billing/change-plan

#### Request
```json
{
  "tenantId": "uuid",
  "newPlan": "professional",
  "effectiveImmediately": true
}
```

#### Response 200 OK
Updated Stripe subscription object.

### GET /api/v1/superadmin/billing/customers/:customerId

Returns Stripe customer + subscription + recent invoices.

---

## 8. Data Model Changes

No new entities for R1. Billing data is owned by Stripe; superadmin app reads from Stripe API and caches results.

### New Entity: `billing_events` (optional audit log)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | FK |
| stripe_event_id | varchar | Stripe event ID |
| event_type | enum | `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `charge.refunded` |
| payload | jsonb | Raw Stripe event payload |
| processed_at | timestamptz | |

---

## 9. Architecture / Implementation Notes

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Stripe SDK | `stripe` Node.js SDK | Official SDK; all billing ops go through it |
| API key storage | GCP Secret Manager | `STRIPE_SECRET_KEY` never in code or env files |
| Webhook handler | Separate route: `POST /webhooks/stripe` | Receives Stripe events, updates licenses and billing cache |
| Caching | In-memory or Redis TTL 5m for billing overview | Stripe API calls are slow; don't hit Stripe on every page load |

### Stripe Webhook Handler
```
Stripe → POST /webhooks/stripe
  ├─ verify signature (STRIPE_WEBHOOK_SECRET from Secret Manager)
  ├─ switch on event.type
  │   ├─ invoice.paid → update tenant mrr + extend license
  │   ├─ invoice.payment_failed → log to failed_payments + notify tenant
  │   ├─ customer.subscription.updated → sync plan change
  │   └─ charge.refunded → mark invoice refunded
  └─ return 200 immediately (don't block on processing)
```

---

## 10. UI/UX Requirements

### Billing Overview Page (`/superadmin/billing`)
```
┌────────────────────────────────────────────────────────────────┐
│ Billing Overview                                [↺ Refresh]   │
├────────────────────────────────────────────────────────────────┤
│ $28,400  │ $1,200   │ +$3,100 │ 34.5%   │ $142   │ $1,704   │
│ Active   │ Churned  │ Net New │ Trial ↑  │ ARPU   │ LTV       │
├────────────────────────────────────────────────────────────────┤
│ MRR Waterfall (last 6 months)                                   │
├────────────────────────────────────────────────────────────────┤
│ Failed Payments Queue                                           │
│ [Status ▼]  [From]  [To]                                      │
│ Tenant    │ Amount  │ Failed     │ Retries │ Status   │ Actions │
│ Acme Corp │ $990    │ Apr 20    │ 2       │ Failed   │ [Retry]│
└────────────────────────────────────────────────────────────────┘
```

### Key Screens
| Screen | Purpose |
|--------|---------|
| `/superadmin/billing` | Billing overview + failed payments queue |
| `/superadmin/billing/customers/:id` | Per-customer Stripe detail |

### Confirmation Modals
- **Refund**: Shows invoice amount, input for partial amount (pre-filled), required reason textarea
- **Plan change**: Shows old plan → new plan, prorated note, confirm/cancel
- **Cancel subscription**: "Cancel immediately" or "Cancel at period end" radio

---

## 11. Security & Compliance

| Concern | Handling |
|---------|----------|
| Stripe secret key | Stored in GCP Secret Manager; never in code or env |
| Webhook security | Signature verification is the only auth mechanism for `POST /webhooks/stripe` |
| Refund authorization | Only `role=superadmin`; full audit log entry required |
| Refund reason | Stored in audit log; required field |
| PCI compliance | Superadmin never handles raw card numbers; Stripe tokenization only |

---

## 12. Out of Scope

- Invoice generation and email delivery (Stripe owns this)
- Payment method editing (tenant does via Stripe Customer Portal)
- Refund for PayPal or other non-card methods (Stripe-only for R1)
- Tax calculation (Stripe Tax for R2)

---

## 13. Open Questions

| Question | Options | Recommendation |
|----------|---------|----------------|
| Failed payment notification | Auto-email tenant on retry failure? | Manual for R1; auto-notify in R2 |
| Webhook reliability | Queue events for async processing? | Redis queue for failed webhook processing in R2 |
| MRR caching | Cache for how long? | 5-minute TTL in Redis |

---

## 14. Dependencies

| Dependency | Type | Notes |
|------------|------|-------|
| Stripe API | External | `stripe` Node.js SDK |
| GCP Secret Manager | External | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| R1-02 (Tenant Management) | Spec | Billing tab in tenant detail uses these APIs |
| R1-04 (License Management) | Spec | Webhook handler creates/extends licenses |

---

## 15. Linked Specs

- **R1-02** (Tenant Management) — Billing tab in tenant detail
- **R1-04** (License Management) — Stripe webhook handler drives license creation/extension
- **R1-06** (Observability) — Audit log for billing actions

---

## 16. Verification & Testing

### Test Cases
| ID | Description | Expected Result | Test Type |
|----|-------------|-----------------|-----------|
| TC1 | Billing overview loads with correct MRR values | KPI cards match API | E2E |
| TC2 | Failed payments queue shows all failed invoices | All failed invoices listed | E2E |
| TC3 | Retry payment succeeds → removed from queue | Payment succeeds → queue updates | E2E (mock Stripe) |
| TC4 | Issue partial refund → invoice shows refunded | Invoice status = Refunded | E2E (mock Stripe) |
| TC5 | Change plan → Stripe subscription updated | New plan reflected in Stripe | E2E (mock Stripe) |
| TC6 | Cancel subscription (end of period) | Subscription.cancel_at_period_end = true | E2E |
| TC7 | Webhook `invoice.paid` → tenant MRR updated | MRR in dashboard reflects new payment | Integration |
| TC8 | Refund without reason → validation error | 400 with "reason required" | Unit |
