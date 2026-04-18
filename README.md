# DesignFoundry Super Admin Console

Platform operations hub for the DesignFoundry SaaS platform. Provides full visibility and management capability across all tenants, users, billing, licensing, system health, and platform-wide activity.

**Spec:** `SPECS/S070-super-admin-console.md`

---

## Tech Stack

- **Next.js 15** — App Router, React 19, TypeScript
- **TailwindCSS** — Utility-first styling
- **Recharts** — Dashboard charts
- **Lucide React** — Icons
- **Radix UI** — Accessible primitives (dialog, dropdown, tabs, etc.)

---

## Getting Started

```bash
# Install dependencies
npm install

# Set environment variables
cp .env.example .env.local

# Run development server
npm run dev

# Build for production
npm run build
```

---

## Environment Variables

```env
# Super Admin Console
NEXT_PUBLIC_API_URL=https://api.designfoundry.ai   # Main platform API base
API_SECRET_TOKEN=your-superadmin-secret             # Backend auth token
NODE_ENV=development

# Optional: Redis cache for dashboard KPIs
REDIS_URL=redis://localhost:6379
```

---

## Project Structure

```
src/
├── app/
│   ├── (dashboard)/              # Auth layout
│   │   └── layout.tsx
│   ├── superadmin/               # All superadmin routes
│   │   ├── page.tsx              # Overview dashboard
│   │   ├── tenants/              # Tenant management
│   │   ├── billing/              # Billing & subscriptions
│   │   ├── licenses/             # On-prem license management
│   │   ├── users/               # Cross-tenant users
│   │   ├── activity/            # Platform activity log
│   │   ├── system/              # System health
│   │   ├── support/             # Support queue
│   │   ├── settings/            # Platform settings
│   │   └── audit/              # Admin audit log
│   └── login/
│       └── page.tsx
├── components/
│   ├── ui/                      # shadcn/ui primitives
│   ├── layout/                  # Sidebar, header, etc.
│   ├── dashboard/               # Dashboard-specific components
│   ├── tenants/                 # Tenant management components
│   ├── billing/                 # Billing components
│   ├── licenses/               # License components
│   ├── activity/               # Activity log components
│   ├── system/                 # System health components
│   └── support/               # Support queue components
├── lib/
│   ├── api.ts                  # API client
│   ├── auth.ts                # Superadmin auth
│   └── utils.ts               # Utilities
├── hooks/
│   └── use-superadmin-api.ts  # API data hooks
└── types/
    ├── tenant.ts
    ├── billing.ts
    ├── license.ts
    └── activity.ts
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│               Super Admin Console (this app)                      │
│                                                                  │
│   Next.js 15 App Router                                           │
│   └── /superadmin/* (superadmin only, role=superadmin JWT)       │
└────────────────────────────┬──────────────────────────────────────┘
                            │ HTTP API
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│                   DesignFoundry Platform API                        │
│   NestJS Backend                                                  │
│   └── /api/v1/superadmin/* (S070 API endpoints)                  │
│       ├── /stats, /tenants, /billing, /licenses, /activity     │
│       └── Stripe API (billing data)                               │
└────────────────────────────┬──────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│               PostgreSQL + Redis + SMTP                            │
└──────────────────────────────────────────────────────────────────┘
```

---

## Sections

| Route | Description |
|---|---|
| `/superadmin` | Overview dashboard — MRR, ARR, tenants, churn, signups |
| `/superadmin/tenants` | Tenant list, suspend/activate, detail view |
| `/superadmin/billing` | Stripe revenue, failed payments, refunds |
| `/superadmin/licenses` | On-premises license management |
| `/superadmin/users` | All users across all tenants |
| `/superadmin/activity` | Platform-wide activity log |
| `/superadmin/system` | Service health, errors, deployments |
| `/superadmin/support` | Support ticket queue |
| `/superadmin/settings` | Platform settings, email templates, feature flags |
| `/superadmin/audit` | Admin action audit log |

---

## Authentication

Super admin access requires a JWT token with `role: 'superadmin'`. Login via the main DesignFoundry platform's admin credentials.

```typescript
// API client with auth header
const api = fetchWithAuth('/api/v1/superadmin/...', {
  headers: { Authorization: `Bearer ${token}` }
});
```

---

## Contributing

1. Read `SPECS/S070-super-admin-console.md` for the full feature spec
2. Implement against the spec
3. Ensure all API calls handle 403 (not superadmin) gracefully
4. All admin actions must be logged via the admin audit log

---

## License

Proprietary — DesignFoundry
