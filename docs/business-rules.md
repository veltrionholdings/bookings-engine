# Business Rules

This document describes the configurable business rules, scheduling logic, and conflict detection that power the Bookings Engine.

## Tenant Configuration

Each tenant has a `settings` JSONB column that controls behaviour. These settings are applied at the API level when processing bookings and availability queries.

### Default Settings Structure

```json
{
  "booking": {
    "default_status": "confirmed",
    "allow_past_bookings": false,
    "min_advance_minutes": 60,
    "max_advance_days": 90,
    "cancellation_window_minutes": 1440,
    "allow_customer_cancellation": true,
    "overbooking_allowed": false
  },
  "availability": {
    "slot_interval_minutes": 15,
    "assignment_strategy": "first_available"
  },
  "notifications": {
    "send_confirmation": true,
    "send_reminder": true,
    "reminder_hours_before": 24
  }
}
```

### Settings Explained

| Setting | Description |
|---------|-------------|
| `default_status` | Status assigned to new bookings. `confirmed` skips the pending step. `pending` requires staff confirmation. |
| `allow_past_bookings` | Whether bookings can be made for times in the past (useful for walk-in logging). |
| `min_advance_minutes` | Minimum time before a booking can start (prevents last-second bookings). |
| `max_advance_days` | How far into the future customers can book. |
| `cancellation_window_minutes` | How close to start time a customer can still cancel (e.g., 1440 = 24 hours). |
| `allow_customer_cancellation` | Whether customers can cancel their own bookings. |
| `overbooking_allowed` | If true, allows bookings beyond resource capacity (with warnings). |
| `slot_interval_minutes` | Start times snap to this interval (e.g., 15 = bookings start at :00, :15, :30, :45). |
| `assignment_strategy` | How to pick a resource when customer selects "any available": `first_available`, `round_robin`, `least_busy`. |

---

## Availability Calculation

When a customer asks "What times are available for Service X on Date Y?", the system performs the following steps:

### Step 1: Identify Qualified Resources

Find all **active** resources linked to the requested service:

```sql
SELECT r.id
FROM resources r
JOIN resource_service_links rsl ON rsl.resource_id = r.id
WHERE rsl.service_id = :service_id
  AND r.tenant_id = :tenant_id
  AND r.is_active = true
```

If the customer requested a **specific resource**, filter to just that one.

### Step 2: Get Schedule for the Date

For each resource, determine their working hours on the requested date:

1. Check `schedule_overrides` for an entry on that date:
   - If `is_available = false` → resource is OFF that day, skip.
   - If `is_available = true` → use the override's start/end times.
2. If no override exists, check `resource_schedules` for the day of week.
3. If no schedule entry exists → resource is not available that day.

### Step 3: Generate Candidate Slots

Given the resource's working window(s) and the service duration + buffer:

```
slot_start = window_start
while slot_start + duration + buffer <= window_end:
    candidate_slots.append(slot_start)
    slot_start += slot_interval_minutes
```

This produces all **theoretically possible** start times.

### Step 4: Remove Conflicting Slots

For each candidate slot, check if it conflicts with existing bookings:

```sql
SELECT COUNT(*)
FROM bookings
WHERE resource_id = :resource_id
  AND status IN ('pending', 'confirmed')
  AND start_time < :proposed_buffer_end
  AND buffer_end_time > :proposed_start
```

For services with `capacity > 1` (e.g., classes), the check becomes:

```sql
SELECT COUNT(*)
FROM bookings
WHERE resource_id = :resource_id
  AND service_id = :service_id
  AND start_time = :proposed_start
  AND status IN ('pending', 'confirmed')
```

If count < service.capacity → slot is still available.

### Step 5: Apply Business Rules

- Remove slots that violate `min_advance_minutes` (too soon).
- Remove slots beyond `max_advance_days` (too far out).
- Snap start times to `slot_interval_minutes`.

### Step 6: Return Results

Return available slots grouped by resource (if "any available") or as a flat list (if specific resource).

---

## Conflict Detection

A booking conflicts with an existing booking when their time ranges overlap. The engine uses **buffer-inclusive** conflict detection:

```
Conflict exists when:
  existing.start_time < proposed.buffer_end_time
  AND existing.buffer_end_time > proposed.start_time
```

This ensures the buffer/cleanup period is respected — you can't book a stylist at 11:00 if their previous client's buffer runs until 11:15.

### Capacity-Based Resources

For resources that serve multiple customers simultaneously (gym classes, group sessions):

- Conflict is only triggered when `booking_count >= service.capacity` for that slot.
- All bookings for a capacity-based service share the same start/end time (they're the same class/session).

---

## Resource Assignment (Any Available)

When a customer doesn't select a specific resource:

### first_available (default)
Pick the resource whose earliest available slot matches the customer's requested time. Deterministic and simple.

### round_robin
Among all resources that are available at the requested time, pick the one with the fewest bookings in the current week. Distributes load evenly.

### least_busy
Among available resources, pick the one with the fewest bookings on that specific day. Balances daily workload.

---

## Recurring Schedules

### Weekly Pattern

A resource's standard schedule is defined as recurring weekly entries:

```
Jane's schedule:
  Monday:    09:00 – 17:00
  Tuesday:   09:00 – 17:00
  Wednesday: 09:00 – 13:00  (half day)
  Thursday:  09:00 – 17:00
  Friday:    09:00 – 17:00
  Saturday:  (not scheduled)
  Sunday:    (not scheduled)
```

### Split Shifts

Multiple entries per day are supported:

```
Mike's Tuesday:
  Entry 1: 07:00 – 12:00
  Entry 2: 15:00 – 20:00
```

### Overrides

Overrides take **absolute precedence** over the recurring schedule for a specific date:

- **Day off**: `is_available = false` → no bookings possible regardless of recurring schedule.
- **Modified hours**: `is_available = true, start_time = 10:00, end_time = 14:00` → only available 10–14 that day.
- **Extra day**: A resource not normally scheduled on Saturday can have an override adding Saturday availability.

---

## Cancellation Rules

1. Check `allow_customer_cancellation` — if false, only staff can cancel.
2. Check `cancellation_window_minutes` — if the booking starts within this window, cancellation is denied (or flagged as late cancellation).
3. Set booking status to `cancelled`, record `cancelled_at` and `cancellation_reason`.
4. The freed time slot immediately becomes available for new bookings.

---

## Timezone Handling

1. Tenant's timezone is stored as an IANA identifier (e.g., `Africa/Johannesburg`).
2. All API inputs for dates/times are expected in the **tenant's local timezone** (for convenience of the PWA and end users).
3. The API layer converts local → UTC for storage.
4. All internal calculations (conflict detection, availability) operate on UTC.
5. API responses include both UTC and local representations where useful.

This avoids DST-related bugs and keeps the database consistent regardless of where the server runs.

---

## Starter Templates

When a new tenant is created with a `business_type`, the system can auto-generate sensible defaults:

### Gym
- Resource types: Instructor, Studio
- Sample services: HIIT (45min, capacity 20), Yoga (60min, capacity 15), Spin (45min, capacity 25)
- Slot interval: 15 minutes
- Default status: confirmed

### Restaurant
- Resource types: Table
- Sample services: Standard seating (90min, buffer 30min), Tasting menu (180min, buffer 30min)
- Slot interval: 30 minutes
- Default status: confirmed

### Salon
- Resource types: Stylist
- Sample services: Cut (30min, buffer 10min), Cut + Colour (90min, buffer 15min), Balayage (180min, buffer 15min)
- Slot interval: 15 minutes
- Default status: confirmed

### Nail Bar
- Resource types: Technician
- Sample services: Manicure (30min, buffer 5min), Pedicure (45min, buffer 5min), Gel set (60min, buffer 10min)
- Slot interval: 15 minutes
- Default status: confirmed

### Spa
- Resource types: Therapist, Room
- Sample services: Swedish massage (60min, buffer 15min), Deep tissue (90min, buffer 15min), Facial (45min, buffer 10min)
- Slot interval: 15 minutes
- Default status: pending (requires staff confirmation)
