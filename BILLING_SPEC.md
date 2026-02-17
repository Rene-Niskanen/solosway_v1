# VELORA BILLING SPECIFICATION

> **Single source of truth** for all billing logic, tier limits, and pricing.  
> Update this file whenever pricing or tier limits change.  
> **Last updated:** February 2026

---

## 1. PRICING MODEL OVERVIEW

Velora uses **page-based subscription pricing**.

| Principle | Detail |
|-----------|--------|
| Billing | Flat monthly fee per tier |
| Allowance | Each tier includes a monthly page allowance |
| Pages | Total pages processed across all uploaded documents |
| Reset | Limits reset on the **1st of every calendar month** (00:00 UTC) |
| Scope | **No** per-document limits — only total page limits |

---

## 2. COST BASIS

All pricing is built on Reducto API processing costs.

```
Average cost per page: $0.0248
```

**Weighted average** (realistic document mix):

| Mix | Type | Cost/Page |
|-----|------|-----------|
| 30% | Simple digital (no figures) | $0.015 |
| 50% | Digital with figures/tables | $0.0225 |
| 20% | Scanned or handwritten | $0.045 |

```
(0.30 × 0.015) + (0.50 × 0.0225) + (0.20 × 0.045) = $0.0248/page
```

> ⚠️ Update this figure if Reducto changes their pricing.

---

## 3. SUBSCRIPTION TIERS

### 3.1 Personal

| Field | Value |
|-------|--------|
| **Price** | $15/month |
| **Page limit** | 500 pages/month |
| **Target user** | Individuals (receipts, medical, tax, insurance, contracts) |

**Financial breakdown**

| Usage | Pages | Our cost | Our profit | Margin |
|-------|-------|----------|------------|--------|
| Low (10%) | 50 | $1.24 | $13.76 | 92% |
| Typical (40%) | 200 | $4.96 | $10.04 | 67% |
| Max (100%) | 500 | $12.40 | $2.60 | 17% |

**Overage:** $0.05/page

---

### 3.2 Professional

| Field | Value |
|-------|--------|
| **Price** | $49/month |
| **Page limit** | 2,000 pages/month |
| **Target user** | Freelancers, consultants, solo professionals |

**Financial breakdown**

| Usage | Pages | Our cost | Our profit | Margin |
|-------|-------|----------|------------|--------|
| Low (15%) | 300 | $7.44 | $41.56 | 85% |
| Typical (40%) | 800 | $19.84 | $29.16 | 60% |
| Max (100%) | 2,000 | $49.60 | -$0.60 | -1% |

> ⚠️ At max usage, Professional breaks even. Typical usage (40%) is expected.

**Overage:** $0.045/page

---

### 3.3 Business

| Field | Value |
|-------|--------|
| **Price** | $129/month |
| **Page limit** | 5,000 pages/month |
| **Target user** | Small teams (3–10 people) |
| **Seats** | Multiple users; all share the same page pool |

**Financial breakdown**

| Usage | Pages | Our cost | Our profit | Margin |
|-------|-------|----------|------------|--------|
| Low (20%) | 1,000 | $24.80 | $104.20 | 81% |
| Typical (40%) | 2,000 | $49.60 | $79.40 | 62% |
| Max (100%) | 5,000 | $124.00 | $5.00 | 4% |

**Overage:** $0.04/page

---

## 4. SUMMARY TABLE

| Tier | Price | Page limit | Overage/page | Typical margin |
|------|-------|------------|--------------|----------------|
| Personal | $15/mo | 500 | $0.05 | 67% |
| Professional | $49/mo | 2,000 | $0.045 | 60% |
| Business | $129/mo | 5,000 | $0.04 | 62% |

---

## 5. BILLING RULES

### 5.1 Page counting

- Counted at document upload (Reducto API).
- Page count stored on the document record.
- Deducted from monthly allowance on upload.
- Failed uploads **do not** count.

### 5.2 Monthly reset

- Allowance resets **00:00 UTC on the 1st** of each month.
- Unused pages **do not** roll over.
- History retained for records only.

### 5.3 Overage handling

| Threshold | Action |
|-----------|--------|
| 80% | Warning email/notification |
| 90% | Urgent warning + upgrade prompt in app |
| 100% | Block uploads **or** charge overage (per-tier rate) |
| Overage | Billed at end of month on top of subscription |

> ⚠️ Decision: block at limit vs allow overages. Spec assumes overages allowed and billed monthly.

### 5.4 Account types

| Type | Scope | Usage tracked at |
|------|--------|-------------------|
| **Personal** | One user | `userId` |
| **Business** | Shared pool | `businessId` (all users share 5,000 pages); admin can see per-user usage |

---

## 6. S3 STORAGE STRUCTURE

```
velora-documents/
├── personal/
│   └── {userId}/
│       └── {YYYY}/{MM}/
│           └── {documentId}.pdf
└── business/
    └── {businessId}/
        └── {YYYY}/{MM}/
            └── {documentId}.pdf
```

### S3 object metadata

| Key | Type | Description |
|-----|------|-------------|
| `userId` | string | Uploader's user ID |
| `businessId` | string | Business ID (null if personal) |
| `pageCount` | number | Pages in document |
| `uploadedAt` | ISO8601 | Upload timestamp |
| `processingCost` | number | Reducto cost for this document |
| `fileName` | string | Original file name |
| `tier` | string | User's tier at upload |

---

## 7. DATABASE SCHEMA REFERENCE

### MonthlyUsage

| Column | Type | Notes |
|--------|------|------|
| `id` | string | Unique ID |
| `userId` | string | Personal; null for Business |
| `businessId` | string | Business; null for Personal |
| `month` | string | `YYYY-MM` |
| `totalPages` | number | Pages used this month |
| `totalDocuments` | number | Documents uploaded this month |
| `totalCost` | number | Reducto cost this month |
| `overagePages` | number | Pages over limit |
| `overageCharge` | number | Overage $ this month |
| `updatedAt` | datetime | Last updated |

### Document

| Column | Type | Notes |
|--------|------|------|
| `id` | string | Unique ID |
| `userId` | string | Uploader |
| `businessId` | string | Business (if applicable) |
| `s3Key` | string | Full S3 object key |
| `fileName` | string | Original file name |
| `pageCount` | number | Pages |
| `processingCost` | number | Reducto cost |
| `tier` | string | Tier at upload |
| `uploadedAt` | datetime | Timestamp |

---

## 8. USAGE DISPLAY (UI)

### Progress bar thresholds

| Range | Colour | Label |
|-------|--------|--------|
| 0–49% | Green | "Plenty of space" |
| 50–79% | Yellow | "Getting there" |
| 80–89% | Orange | "Almost at your limit" |
| 90–99% | Red | "Nearly full — consider upgrading" |
| 100% | Red | "Limit reached" |

### Copy by usage level

**Under 50%:**  
"Plenty of space left 📁" — `{current} of {limit} pages used this month`

**50–79%:**  
"Your Usage This Month" — `{current} of {limit} pages used`

**80–89%:**  
"⚠️ Approaching Your Limit" — "You've used {current} of {limit} pages. Consider upgrading." + [Upgrade]

**90–99%:**  
"⚠️ Almost at your limit" — "Only {remaining} pages left this month." + [Upgrade Now]

**100%:**  
"🚫 Limit Reached" — "You've used all {limit} pages for this month." / "Upgrade to continue uploading, or wait until {reset_date}." + [Upgrade Now] [See Overage Pricing]

---

## 9. TIER LOGIC IN CODE

Use this as the single source of truth in application code. Update when pricing or limits change.

```typescript
// BILLING_SPEC — source of truth for tier config

export const TIERS = {
  personal: {
    id: 'personal',
    name: 'Personal',
    price: 15,
    pageLimit: 500,
    overageRatePerPage: 0.05,
    seats: 1,
    targetUser: 'Individuals managing personal documents',
  },
  professional: {
    id: 'professional',
    name: 'Professional',
    price: 49,
    pageLimit: 2000,
    overageRatePerPage: 0.045,
    seats: 1,
    targetUser: 'Freelancers, consultants, solo professionals',
  },
  business: {
    id: 'business',
    name: 'Business',
    price: 129,
    pageLimit: 5000,
    overageRatePerPage: 0.04,
    seats: 10,
    targetUser: 'Small teams (3-10 people)',
    sharedPool: true,
  },
} as const;

export const USAGE_THRESHOLDS = {
  warning: 0.80,   // 80% — first warning
  urgent: 0.90,     // 90% — urgent + upgrade prompt
  limit: 1.00,      // 100% — block or charge overage
} as const;

export const COST_PER_PAGE = 0.0248; // Reducto weighted average

export type TierKey = keyof typeof TIERS;
```

---

## 10. UPGRADE / DOWNGRADE / CANCELLATION

| Action | Behaviour |
|--------|-----------|
| **Upgrade mid-month** | New limit applies immediately; pages already used stay; pro-rated charge for remainder (e.g. Personal → Professional on 15th: half of ($49 − $15) = $17 extra). |
| **Downgrade mid-month** | Effective **next** billing month; current tier until end of month; no refund. |
| **Cancellation** | Access until end of current period; no refund for unused pages. |

---

## 11. CHANGELOG

| Date | Change | Updated by |
|------|--------|------------|
| Feb 2026 | Initial spec | Velora team |

> ⚠️ Add a row whenever pricing or limits change.

---

## 12. HOW TO USE IN CURSOR

1. Keep this file at **project root** as `BILLING_SPEC.md`.
2. Reference in Cursor with `@BILLING_SPEC.md`.
3. When building billing logic: *"Use @BILLING_SPEC.md as the source of truth for all tier limits, pricing, and billing rules."*
4. On pricing changes: update this file **first**, then code.
5. The `TIERS` constant in §9 can be copied into the codebase.

---

*Commit this file to version control. Treat as a living document. Do not hardcode billing values in application code — always derive from this spec.*
