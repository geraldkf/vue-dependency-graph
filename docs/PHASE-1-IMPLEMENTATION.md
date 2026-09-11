# Phase 1 - Graph Foundation

## Objectives

1. Remove node ordering requirements.
2. Separate graph structure from node creation sequence.
3. Build comprehensive test coverage.

## Deliverables

### Graph Registry

Maintain:

- node index
- parent index
- child index

### Validation

Detect:

- cycles
- missing nodes
- duplicates

### Tests

- parent before child
- child before parent
- circular dependency
- missing dependency

## Exit Criteria

The graph behaves identically regardless of node registration order.
