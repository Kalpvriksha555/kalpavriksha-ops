# Active Operations Estimate Object Display Closure — 2026-08-11

## Problem

Active Operations showed `Estimate: [object Object]` on task rows. The persisted task estimate detail is a display value, but the frontend project-shape normalizer incorrectly coerced `estimateDetails` through `asRecord()`. A valid string therefore became `{}`, and the shared display helper later converted that object to the browser string `[object Object]`.

## Closure

- `normalizeProjectArrayShapes()` now canonicalizes `estimateDetails` through the shared display-text helper rather than converting it to an object.
- `getEstimateDetails()` now accepts safe scalar values and a small set of reviewed scalar wrapper fields, ignores arbitrary arrays/objects, and continues through legacy aliases when an earlier field has the wrong shape.
- `getTaskDescription()` uses the same defensive display boundary so the same object-stringification class cannot surface in description metadata.
- Active Operations, archive, task detail, and global search continue using the shared helper, so the correction is centralized rather than screen-specific.
- No database write, migration, finance rule, task lifecycle rule, attendance rule, file-retention rule, or backend API contract is changed.

## Expected UI

Valid estimate details render as their actual text/value. Missing or malformed estimate details render nothing. `[object Object]` is never used as task estimate display text.
