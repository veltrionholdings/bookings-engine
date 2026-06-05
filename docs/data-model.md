# Data Model

This document describes the database schema for the Bookings Engine. The database is PostgreSQL, and all tenants share a single database with row-level isolation via `tenant_id`.

## Entity Relationship Diagram (Conceptual)

```
Tenant
  ├── ResourceType (e.g., "Stylist", "Table", "Instructor")
  │     └── Resource (e.g., "Jane", "Table 5", "Coach Mike")
  │           ├── ResourceSchedule (recurring availability)
  │           ├── ScheduleOverride (exceptions: days off, extra hours)
  │           └── ResourceServiceLink ──┐
  ├── Service (e.g., "Haircut", "Yoga Class")  ◄──┘
  │     └── Booking
  └── Customer
        └── Booking
```

## Tables

---

### tenants

The top-level entity. Each business on the platform is a tenant.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | VARCHAR(255) | Business name |
| slug | VARCHAR(100) | URL-friendly identifier, unique |
| business_type | VARCHAR(50) | Hint for starter templates: `gym`, `restaurant`, `salon`, `nail_bar`, `spa` |
| timezone | VARCHAR(100) | IANA timezone (e.g., `Africa/Johannesburg`) |
| settings | JSONB | Tenant-level configuration (see Business Rules doc) |
| created_at | TIMESTAMPTZ | Record creation time |
| updated_at | TIMESTAMPTZ | Last update time |

**Indexes**: `slug` (unique)

---

### resource_types

Categories of bookable resources within a tenant. Allows a salon to have "Stylist" and "Wash Basin" as separate types.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| tenant_id | UUID | FK → tenants.id |
| name | VARCHAR(255) | e.g., "Stylist", "Table", "Instructor", "Room" |
| description | TEXT | Optional description |
| created_at | TIMESTAMPTZ | Record creation time |

**Indexes**: `(tenant_id, name)` unique

---

### resources

Individual bookable entities: a specific person, room, or table.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| tenant_id | UUID | FK → tenants.id |
| resource_type_id | UUID | FK → resource_types.id |
| name | VARCHAR(255) | e.g., "Jane", "Table 5", "Studio A" |
| description | TEXT | Optional bio or details |
| is_active | BOOLEAN | Whether currently available for bookings |
| metadata | JSONB | Flexible extra data (photo URL, specialties, etc.) |
| created_at | TIMESTAMPTZ | Record creation time |
| updated_at | TIMESTAMPTZ | Last update time |

**Indexes**: `(tenant_id, resource_type_id)`, `(tenant_id, is_active)`

---

### services

Procedures, activities, or experiences that customers can book. The service defines **what** is being booked and **how long** it takes.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| tenant_id | UUID | FK → tenants.id |
| name | VARCHAR(255) | e.g., "Haircut", "Yoga Class", "Dinner Seating" |
| description | TEXT | Customer-facing description |
| duration_minutes | INTEGER | How long the service takes |
| buffer_minutes | INTEGER | Cleanup/transition time after (default 0) |
| capacity | INTEGER | Max simultaneous bookings (1 for appointments, 20 for classes) |
| resource_type_id | UUID | FK → resource_types.id — which type of resource performs this |
| price_cents | INTEGER | Price in smallest currency unit (optional, informational) |
| currency | VARCHAR(3) | ISO 4217 currency code (e.g., `ZAR`, `USD`) |
| is_active | BOOLEAN | Whether currently bookable |
| metadata | JSONB | Extra data (category, difficulty level, etc.) |
| created_at | TIMESTAMPTZ | Record creation time |
| updated_at | TIMESTAMPTZ | Last update time |

**Indexes**: `(tenant_id, is_active)`, `(tenant_id, resource_type_id)`

---

### resource_service_links

Maps which resources can perform which services. Not every stylist does colour; not every trainer teaches spin.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| resource_id | UUID | FK → resources.id |
| service_id | UUID | FK → services.id |

**Indexes**: `(resource_id, service_id)` unique

---

### resource_schedules

Recurring weekly availability for a resource. Defines when a resource is generally available for bookings.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| resource_id | UUID | FK → resources.id |
| day_of_week | SMALLINT | 0 = Monday, 6 = Sunday |
| start_time | TIME | Start of availability window (local time) |
| end_time | TIME | End of availability window (local time) |
| is_active | BOOLEAN | Whether this schedule entry is currently active |

**Indexes**: `(resource_id, day_of_week)`

**Notes**:
- Times are stored in the **tenant's local timezone** (since they represent recurring patterns, not specific instants).
- A resource can have multiple entries per day (e.g., split shift: 9:00–12:00 and 14:00–18:00).

---

### schedule_overrides

Exceptions to the recurring schedule: days off, holidays, or extra availability.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| resource_id | UUID | FK → resources.id |
| override_date | DATE | The specific date this override applies to |
| is_available | BOOLEAN | `true` = available (define hours below), `false` = unavailable all day |
| start_time | TIME | Start of availability (null if is_available = false) |
| end_time | TIME | End of availability (null if is_available = false) |
| reason | VARCHAR(255) | Optional note ("Public holiday", "Training day") |

**Indexes**: `(resource_id, override_date)` unique

---

### customers

End users who make bookings. A customer belongs to a tenant (a person can be a customer at multiple businesses — they'd have separate records).

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| tenant_id | UUID | FK → tenants.id |
| first_name | VARCHAR(255) | |
| last_name | VARCHAR(255) | |
| email | VARCHAR(255) | |
| phone | VARCHAR(50) | |
| notes | TEXT | Staff-facing notes (preferences, allergies, etc.) |
| metadata | JSONB | Flexible extra data |
| created_at | TIMESTAMPTZ | Record creation time |
| updated_at | TIMESTAMPTZ | Last update time |

**Indexes**: `(tenant_id, email)` unique, `(tenant_id, phone)`

---

### bookings

The core transaction table. A booking reserves a specific resource for a specific service at a specific time.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| tenant_id | UUID | FK → tenants.id |
| customer_id | UUID | FK → customers.id |
| service_id | UUID | FK → services.id |
| resource_id | UUID | FK → resources.id (nullable if "any available" — assigned on confirmation) |
| start_time | TIMESTAMPTZ | Booking start (UTC) |
| end_time | TIMESTAMPTZ | Booking end (UTC) — derived from start + service.duration |
| buffer_end_time | TIMESTAMPTZ | End of buffer period (UTC) — derived from end + service.buffer |
| status | VARCHAR(20) | See lifecycle below |
| party_size | INTEGER | Number of people (relevant for restaurants, classes) |
| notes | TEXT | Customer notes for this booking |
| cancelled_at | TIMESTAMPTZ | When the booking was cancelled (if applicable) |
| cancellation_reason | VARCHAR(255) | Why it was cancelled |
| created_at | TIMESTAMPTZ | Record creation time |
| updated_at | TIMESTAMPTZ | Last update time |

**Indexes**:
- `(tenant_id, resource_id, start_time, buffer_end_time)` — conflict detection
- `(tenant_id, customer_id, start_time)` — customer's bookings
- `(tenant_id, status, start_time)` — listing by status and date

**Booking Status Lifecycle**:
```
pending → confirmed → completed
    ↓         ↓
cancelled  no_show
```

- `pending` — Booking created, awaiting confirmation (optional step, can skip to confirmed)
- `confirmed` — Booking accepted and locked in
- `completed` — Service was delivered
- `cancelled` — Booking was cancelled (by customer or staff)
- `no_show` — Customer didn't show up

---

## Multi-Tenancy

Every table (except `tenants` itself) includes a `tenant_id` column. All queries are scoped by tenant. Row-Level Security (RLS) can be layered on for additional protection, but application-level filtering is the primary mechanism.

## Soft Deletes

Records are not hard-deleted. The `is_active` flag on resources and services acts as a soft delete. Bookings retain their full history for reporting purposes.

## Timestamps

- All `TIMESTAMPTZ` columns store UTC values.
- `TIME` columns in schedules store **local time** (relative to tenant timezone).
- The application layer handles UTC ↔ local conversion using the tenant's configured timezone.
