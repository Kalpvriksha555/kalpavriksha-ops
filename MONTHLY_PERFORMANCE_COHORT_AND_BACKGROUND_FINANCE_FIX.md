# Monthly Performance Cohort and Background Finance Navigation Fix

- Monthly performance now counts completion records only when the work was assigned/created and completed inside the selected calendar month.
- An Admin score baseline excludes carried-forward work that started before the baseline, even if that older work was completed afterward.
- Reports continue to disclose carried-forward completions separately without adding them to the new-month cohort.
- Team cards no longer use a fixed-height nested scrollbar and no longer display an old offline timestamp as “Current work”.
- The task Back button returns immediately during payment autosave. Any active save finishes in the background, and a newer queued draft is submitted afterward with the same version and mutation safeguards.
- A background finance completion updates the task list but never reopens the closed task detail page.
