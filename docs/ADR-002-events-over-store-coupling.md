# ADR-002

## Decision
Use domain events instead of direct store dependencies.

## Example

Appointment module publishes:

```text
AppointmentBooked
```

Compliance module reacts through graph invalidation.

## Benefits

- loose coupling
- multi-team ownership
- cleaner boundaries
