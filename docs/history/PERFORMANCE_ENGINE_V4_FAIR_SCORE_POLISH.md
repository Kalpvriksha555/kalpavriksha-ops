# Performance Engine V4 – Fair Designer Score + UX Clarity

Implemented from the latest working baseline.

## Fixed
- Designer score no longer depends on Review Time / Avg Checking.
- Review delay is now displayed as operational context only and marked “not in score”.
- Score formula now uses only designer-controlled metrics:
  - Completion speed
  - Work quality / revision control
  - On-time SLA
  - Consistency
- Next improvement tips no longer ask designers to reduce manager review/checking delay.
- Improvement tips are generated from each user's weakest actual metric.
- “What affects the score?” section renamed to “Designer score breakdown”.
- Review labels clarified across the Performance cards.
- Performance description updated to avoid implying manager review delay affects designer score.

## Validation
- Root build passed.
- Frontend build passed.
- Backend syntax check passed.
