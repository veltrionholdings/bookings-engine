# API Specification

This document describes the REST API contract for the Bookings Engine. The full machine-readable spec is in `openapi.yaml` at the project root.

## Base URL

```
https://api.bookings.{domain}/v1
```

All endpoints are prefixed with `/v1` for versioning.

## Authentication & Multi-Tenancy

- All requests require a valid JWT token (issued by AWS Cognito).
- The token contains the `tenant_id` claim. All queries are automatically scoped to that tenant.
- Two roles exist: `admin` (staff/business owner) and `customer`.
- Admin endpoints require the `admin` role. Customer endpoints work with either role.

## Common Patterns

### Pagination

List endpoints support cursor-based pagination:

```
GET /resources?limit=20&cursor=eyJpZCI6Ii4uLiJ9
```

Response includes:
```json
{
  "data": [...],
  "pagination": {
    "next_cursor": "eyJpZCI6Ii4uLiJ9",
    "has_more": true
  }
}
```

### Error Responses

All errors follow a consistent format:

```json
{
  "error": {
    "code": "CONFLICT",
    "message": "The requested time slot is no longer available.",
    "details": { ... }
  }
}
```

Standard error codes: `VALIDATION_ERROR`, `NOT_FOUND`, `CONFLICT`, `FORBIDDEN`, `UNAUTHORIZED`.

### Timestamps

- Request bodies accept ISO 8601 datetime strings in the **tenant's local timezone** (e.g., `2025-03-15T10:00:00`).
- Response bodies include both `start_time` (UTC) and `start_time_local` for convenience.

---

## Endpoints

### Tenant Management

#### GET /tenant

Get the current tenant's profile (derived from the JWT).

**Response** `200 OK`:
```json
{
  "id": "uuid",
  "name": "Bella Salon",
  "slug": "bella-salon",
  "business_type": "salon",
  "timezone": "Africa/Johannesburg",
  "settings": { ... }
}
```

#### PATCH /tenant

Update tenant settings. **Admin only.**

**Request body** (partial update):
```json
{
  "name": "Bella Hair Studio",
  "settings": {
    "booking": {
      "min_advance_minutes": 120
    }
  }
}
```

---

### Resource Types

#### GET /resource-types

List all resource types for the tenant.

#### POST /resource-types

Create a new resource type. **Admin only.**

```json
{
  "name": "Stylist",
  "description": "Hair stylists available for appointments"
}
```

#### PATCH /resource-types/:id

Update a resource type. **Admin only.**

#### DELETE /resource-types/:id

Deactivate a resource type. **Admin only.**

---

### Resources

#### GET /resources

List all resources. Supports filtering:

```
GET /resources?resource_type_id=uuid&is_active=true
```

#### GET /resources/:id

Get a single resource with its schedule and linked services.

#### POST /resources

Create a new resource. **Admin only.**

```json
{
  "resource_type_id": "uuid",
  "name": "Jane",
  "description": "Senior stylist, 10 years experience",
  "metadata": {
    "photo_url": "https://...",
    "specialties": ["colour", "balayage"]
  }
}
```

#### PATCH /resources/:id

Update a resource. **Admin only.**

#### DELETE /resources/:id

Soft-delete (deactivate) a resource. **Admin only.**

---

### Resource Schedules

#### GET /resources/:id/schedules

Get the recurring weekly schedule for a resource.

**Response** `200 OK`:
```json
{
  "data": [
    { "id": "uuid", "day_of_week": 0, "start_time": "09:00", "end_time": "17:00", "is_active": true },
    { "id": "uuid", "day_of_week": 1, "start_time": "09:00", "end_time": "17:00", "is_active": true },
    { "id": "uuid", "day_of_week": 2, "start_time": "09:00", "end_time": "13:00", "is_active": true }
  ]
}
```

#### PUT /resources/:id/schedules

Replace the entire weekly schedule for a resource. **Admin only.**

```json
{
  "schedules": [
    { "day_of_week": 0, "start_time": "09:00", "end_time": "17:00" },
    { "day_of_week": 1, "start_time": "09:00", "end_time": "17:00" },
    { "day_of_week": 2, "start_time": "09:00", "end_time": "13:00" }
  ]
}
```

---

### Schedule Overrides

#### GET /resources/:id/overrides

List overrides for a resource. Supports date range filtering:

```
GET /resources/:id/overrides?from=2025-03-01&to=2025-03-31
```

#### POST /resources/:id/overrides

Create a schedule override. **Admin only.**

```json
{
  "override_date": "2025-03-25",
  "is_available": false,
  "reason": "Public holiday"
}
```

Or for modified hours:
```json
{
  "override_date": "2025-03-26",
  "is_available": true,
  "start_time": "10:00",
  "end_time": "14:00",
  "reason": "Half day"
}
```

#### DELETE /resources/:id/overrides/:override_id

Remove an override. **Admin only.**

---

### Services

#### GET /services

List all services. Supports filtering:

```
GET /services?resource_type_id=uuid&is_active=true
```

#### GET /services/:id

Get a single service.

#### POST /services

Create a service. **Admin only.**

```json
{
  "name": "Balayage",
  "description": "Hand-painted highlights for a natural, sun-kissed look",
  "duration_minutes": 180,
  "buffer_minutes": 15,
  "capacity": 1,
  "resource_type_id": "uuid",
  "price_cents": 250000,
  "currency": "ZAR"
}
```

#### PATCH /services/:id

Update a service. **Admin only.**

#### DELETE /services/:id

Soft-delete (deactivate) a service. **Admin only.**

---

### Resource–Service Links

#### GET /resources/:id/services

List services a resource can perform.

#### PUT /resources/:id/services

Set the full list of services for a resource. **Admin only.**

```json
{
  "service_ids": ["uuid-1", "uuid-2", "uuid-3"]
}
```

---

### Availability

This is the key customer-facing endpoint for the booking flow.

#### GET /availability

Check available time slots for a service on a given date.

**Query parameters**:

| Param | Required | Description |
|-------|----------|-------------|
| `service_id` | Yes | Which service to book |
| `date` | Yes | Date to check (YYYY-MM-DD, in tenant's local timezone) |
| `resource_id` | No | Specific resource (omit for "any available") |

**Response** `200 OK`:

When a specific resource is requested:
```json
{
  "date": "2025-03-15",
  "service": { "id": "uuid", "name": "Balayage", "duration_minutes": 180 },
  "resource": { "id": "uuid", "name": "Jane" },
  "slots": [
    { "start_time": "09:00", "end_time": "12:00" },
    { "start_time": "13:00", "end_time": "16:00" }
  ]
}
```

When "any available" (no resource_id):
```json
{
  "date": "2025-03-15",
  "service": { "id": "uuid", "name": "Balayage", "duration_minutes": 180 },
  "slots": [
    { "start_time": "09:00", "resources": [{ "id": "uuid", "name": "Jane" }] },
    { "start_time": "09:15", "resources": [{ "id": "uuid", "name": "Jane" }, { "id": "uuid", "name": "Sarah" }] },
    { "start_time": "10:00", "resources": [{ "id": "uuid", "name": "Sarah" }] }
  ]
}
```

---

### Customers

#### GET /customers

List customers. **Admin only.** Supports search:

```
GET /customers?search=jane&limit=20
```

#### GET /customers/:id

Get a customer profile.

#### POST /customers

Create a customer. Works for both admin (registering a walk-in) and self-registration.

```json
{
  "first_name": "Thandi",
  "last_name": "Mokoena",
  "email": "thandi@example.com",
  "phone": "+27821234567"
}
```

#### PATCH /customers/:id

Update a customer profile.

---

### Bookings

#### GET /bookings

List bookings. Supports filtering:

```
GET /bookings?status=confirmed&from=2025-03-15&to=2025-03-22&resource_id=uuid
```

**Admin** sees all tenant bookings. **Customer** sees only their own.

#### GET /bookings/:id

Get a single booking with full details.

#### POST /bookings

Create a new booking.

```json
{
  "service_id": "uuid",
  "resource_id": "uuid-or-null",
  "customer_id": "uuid",
  "start_time": "2025-03-15T10:00:00",
  "party_size": 1,
  "notes": "First time client, please allow extra time for consultation"
}
```

**Behaviour**:
1. If `resource_id` is null, the system assigns a resource based on the tenant's `assignment_strategy`.
2. Validates the slot is still available (conflict check).
3. Returns `409 Conflict` if the slot was taken between availability check and booking creation.
4. Sets status based on `tenant.settings.booking.default_status`.

**Response** `201 Created`:
```json
{
  "id": "uuid",
  "status": "confirmed",
  "service": { "id": "uuid", "name": "Balayage" },
  "resource": { "id": "uuid", "name": "Jane" },
  "customer": { "id": "uuid", "name": "Thandi Mokoena" },
  "start_time": "2025-03-15T08:00:00Z",
  "start_time_local": "2025-03-15T10:00:00",
  "end_time": "2025-03-15T11:00:00Z",
  "end_time_local": "2025-03-15T13:00:00",
  "party_size": 1,
  "notes": "First time client, please allow extra time for consultation",
  "created_at": "2025-03-10T14:30:00Z"
}
```

#### PATCH /bookings/:id

Update a booking (reschedule, change notes). **Admin only** for most fields. Customers can update `notes`.

Rescheduling triggers a new conflict check.

#### POST /bookings/:id/cancel

Cancel a booking.

```json
{
  "reason": "Customer requested cancellation"
}
```

**Behaviour**:
1. Checks cancellation window rules.
2. If within window → returns `403 Forbidden` with explanation.
3. If allowed → sets status to `cancelled`, records reason and timestamp.

#### POST /bookings/:id/complete

Mark a booking as completed. **Admin only.**

#### POST /bookings/:id/no-show

Mark a booking as no-show. **Admin only.**

---

## Webhook Events (Future)

The engine will emit events that PWAs can subscribe to:

- `booking.created`
- `booking.confirmed`
- `booking.cancelled`
- `booking.completed`
- `booking.no_show`
- `booking.reminder` (triggered by scheduled job)

These enable the PWA layer to send push notifications, emails, or SMS without the engine needing to know about specific notification channels.
