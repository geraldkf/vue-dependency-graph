# Architecture

## Core Concepts

### Context Nodes

Mutable application state.

Examples:

- JobSeekerId
- PointPeriodId
- UserId

### Data Nodes

Load asynchronous data.

### Derived Nodes

Calculated from other nodes.

No API calls.

### Event Dependencies

Nodes may be invalidated by business events.

Examples:

- AppointmentBooked
- AppointmentCancelled
- InterviewCompleted

### Transactions

Multiple updates are treated as a single logical change.

### Scheduler

The scheduler performs:

- automatic execution
- execution coalescing
- subscription-driven loading

### Diagnostics

The framework captures:

- execution history
- reload reasons
- event history
- transaction history
- snapshots
