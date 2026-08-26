# Monthly QA Score card — Agent Dashboard

Adds a 7th stat card beside Rework / Pending / In Progress / On Hold / Urgent /
Completed Today, showing the agent's average QA score for the **current month**
on the **selected process**.

Builds on the daily QA score already in place. No migration, no new entity, no
change to the QA application.

---

## 1. Backend — `DashboardService.cs`

Add beside `GetQaScoreAsync`. Same query, month range instead of a day.

```csharp
    /// <summary>
    /// Average QA score for one agent across a whole month, for one process.
    ///
    /// Same source and semantics as GetQaScoreAsync — see that method for why
    /// this reads dbo.audits rather than dbo.AuditDetails, and why the date
    /// filter is created_at rather than completed_at.
    ///
    /// `date` is any day in the target month; the range is derived from it, so
    /// the caller never has to work out month boundaries.
    /// </summary>
    public async Task<QaScoreDto> GetQaScoreMonthlyAsync(int userId, int processId, DateTime date)
    {
        var result = new QaScoreDto();

        var monthStart = new DateTime(date.Year, date.Month, 1);
        var monthEnd = monthStart.AddMonths(1);

        const string sql = @"
            SELECT  COUNT(*)                                              AS AuditedCount,
                    SUM(CASE WHEN a.Score IS NOT NULL THEN 1 ELSE 0 END)  AS ScoredCount,
                    AVG(CAST(a.Score AS float))                           AS AvgScore,
                    SUM(CASE WHEN a.[Action] = 1 THEN 1 ELSE 0 END)       AS ErrorCount,
                    SUM(CASE WHEN a.[Action] = 2 THEN 1 ELSE 0 END)       AS FyiCount
            FROM    dbo.audits        a WITH (NOLOCK)
            JOIN    dbo.QA_Processes  p WITH (NOLOCK) ON p.Id = a.process_id
            WHERE   a.employee_id = @employeeId
              AND   TRY_CAST(p.task_process_id AS int) = @processId
              AND   a.[Status] = 'completed'
              AND   a.created_at >= @monthStart
              AND   a.created_at <  @monthEnd;";

        try
        {
            var connection = _dbContext.Database.GetDbConnection();
            if (connection.State != ConnectionState.Open)
                await connection.OpenAsync();

            using var command = connection.CreateCommand();
            command.CommandText = sql;
            command.Parameters.Add(new SqlParameter("@employeeId", userId.ToString()));
            command.Parameters.Add(new SqlParameter("@processId", processId));
            command.Parameters.Add(new SqlParameter("@monthStart", monthStart));
            command.Parameters.Add(new SqlParameter("@monthEnd", monthEnd));

            using var reader = await command.ExecuteReaderAsync();
            if (await reader.ReadAsync())
            {
                result.AuditedCount = reader.IsDBNull(0) ? 0 : Convert.ToInt32(reader.GetValue(0));
                result.ScoredCount  = reader.IsDBNull(1) ? 0 : Convert.ToInt32(reader.GetValue(1));
                result.Score        = reader.IsDBNull(2) ? null : Convert.ToDouble(reader.GetValue(2));
                result.ErrorCount   = reader.IsDBNull(3) ? 0 : Convert.ToInt32(reader.GetValue(3));
                result.FyiCount     = reader.IsDBNull(4) ? 0 : Convert.ToInt32(reader.GetValue(4));
            }

            if (result.ScoredCount == 0) result.Score = null;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex,
                "Monthly QA score lookup failed for user {UserId}, process {ProcessId}, month {Month}.",
                userId, processId, monthStart);
            return new QaScoreDto();
        }

        return result;
    }
```

## 2. `IDashboardService.cs`

```csharp
    Task<QaScoreDto> GetQaScoreMonthlyAsync(int userId, int processId, DateTime date);
```

## 3. `DashboardController.cs`

```csharp
    /// <summary>Monthly QA score for the signed-in agent. `date` is any day in the target month.</summary>
    [HttpGet("qa-score/monthly")]
    public async Task<ActionResult<QaScoreDto>> GetQaScoreMonthly(
        [FromQuery] int processId,
        [FromQuery] string date)
    {
        try
        {
            if (processId <= 0)
                return BadRequest(new { error = new { code = "INVALID_PROCESS", message = "processId is required" } });

            if (!DateTime.TryParse(date, out var parsedDate))
                return BadRequest(new { error = new { code = "INVALID_DATE", message = "date is required (yyyy-MM-dd)" } });

            // Signed-in agent only — never a userId from the query string.
            var userId = GetCurrentUserId();

            return Ok(await _dashboardService.GetQaScoreMonthlyAsync(userId, processId, parsedDate));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving monthly QA score");
            return StatusCode(500, new { error = new { message = "An error occurred while retrieving the monthly QA score" } });
        }
    }
```

---

## 4. `config/api.ts`

Under `dashboard`, beside the `qaScore` entry:

```ts
    qaScoreMonthly: '/api/dashboard/qa-score/monthly',
```

## 5. `services/dashboardService.ts`

```ts
  async getQaScoreMonthly(processId: number, date: string): Promise<QaScoreDto> {
    return apiClient.get<QaScoreDto>(
      `${API_ENDPOINTS.dashboard.qaScoreMonthly}?processId=${processId}&date=${date}`
    );
  }
```

Reuses the existing `QaScoreDto` — same shape.

---

## 6. `Dashboard.tsx` — three edits

### 6a. State

Add beside the existing `qaScore` state:

```tsx
  const [monthlyQaScore, setMonthlyQaScore] = useState<QaScoreDto | null>(null);
```

### 6b. Fetch

Add after the existing daily QA score effect. Deliberately keyed on `processId`
only — the stats row shows current totals and is not tied to the day the agent
has selected in the activity strip, the same way Pending and On Hold are not.

```tsx
  // Current month, for the stats row. Independent of selectedDay.
  useEffect(() => {
    const pid = Number(processId);
    if (!pid) {
      setMonthlyQaScore(null);
      return;
    }

    let cancelled = false;
    const today = format(new Date(), 'yyyy-MM-dd');

    dashboardService
      .getQaScoreMonthly(pid, today)
      .then((data) => { if (!cancelled) setMonthlyQaScore(data); })
      .catch(() => { if (!cancelled) setMonthlyQaScore(null); });

    return () => { cancelled = true; };
  }, [processId]);
```

### 6c. The card

The `stats` array items render `{stat.count}`, which is a number. A score needs
a `%` and an em dash when there is nothing to show, so add an optional `display`
field rather than forcing a number into that slot.

FIND the last entry of the `stats` array:
```tsx
  {
    label: 'Completed Today',
    count: completedTodayCount,
    icon: CheckCircle2,
    color: 'bg-green-100 text-green-600'
  }
];
```

REPLACE WITH:
```tsx
  {
    label: 'Completed Today',
    count: completedTodayCount,
    icon: CheckCircle2,
    color: 'bg-green-100 text-green-600'
  },
  {
    label: 'Monthly QA Score',
    count: 0,
    // Colour bands match RiskLabel in the QA app (<50 critical, <70 high,
    // <85 medium, else low) so the same number never means two different things
    // across the two applications.
    display:
      monthlyQaScore?.score == null
        ? '—'
        : `${monthlyQaScore.score.toFixed(0)}%`,
    icon: Target,
    color:
      monthlyQaScore?.score == null
        ? 'bg-gray-100 text-gray-400'
        : monthlyQaScore.score < 50 ? 'bg-red-100 text-red-600'
        : monthlyQaScore.score < 70 ? 'bg-orange-100 text-orange-600'
        : monthlyQaScore.score < 85 ? 'bg-amber-100 text-amber-600'
        : 'bg-emerald-100 text-emerald-600',
    title:
      monthlyQaScore == null || monthlyQaScore.auditedCount === 0
        ? 'No audits this month'
        : `${monthlyQaScore.auditedCount} audited this month · ${monthlyQaScore.errorCount} error(s) · ${monthlyQaScore.fyiCount} FYI`,
  }
];
```

Then in the card render, FIND:
```tsx
                <div className="text-center">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{stat.label}</p>
                  <p className="text-xl font-bold text-gray-900">{stat.count}</p>
                </div>
```

REPLACE WITH:
```tsx
                <div className="text-center" title={(stat as any).title}>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{stat.label}</p>
                  <p className="text-xl font-bold text-gray-900">
                    {(stat as any).display ?? stat.count}
                  </p>
                </div>
```

`Target` is already imported in Dashboard.tsx.

---

## Layout warning — check this on a 1366px screen

The stats row is `flex gap-4` with `w-28` cards. Seven cards is
`7 × 112 + 6 × 16 = 880px`, plus the welcome banner on `flex-1`. On a narrow
laptop that will squeeze the banner badly or overflow.

If it looks cramped, the smallest fix is to let the row wrap:

FIND:
```tsx
          <div className="flex gap-4">
            {stats.map((stat, i) => (
```

REPLACE WITH:
```tsx
          <div className="flex flex-wrap gap-4 justify-end">
            {stats.map((stat, i) => (
```

Worth checking before your agents see it — most of them are on smaller screens
than yours.

---

## Verify

```sql
-- Should match the card exactly
DECLARE @uid nvarchar(64) = N'<Users.UserId>';
DECLARE @pid int = <agent ProcessId>;
DECLARE @m  date = '2026-08-01';

SELECT  COUNT(*) AS Audited,
        AVG(CAST(a.Score AS float)) AS AvgScore,
        SUM(CASE WHEN a.[Action] = 1 THEN 1 ELSE 0 END) AS Errors,
        SUM(CASE WHEN a.[Action] = 2 THEN 1 ELSE 0 END) AS Fyi
FROM    dbo.audits a
JOIN    dbo.QA_Processes p ON p.Id = a.process_id
WHERE   a.employee_id = @uid
  AND   TRY_CAST(p.task_process_id AS int) = @pid
  AND   a.[Status] = 'completed'
  AND   a.created_at >= @m
  AND   a.created_at <  DATEADD(month, 1, @m);
```

## Notes

**Em dash, not 0%.** Same reasoning as the daily card — no audits this month
means "not sampled", not "failed everything", and a manager scanning a wall of
0% escalates before checking which it was.

**Current month, not the selected day's month.** The stats row shows live totals
(Pending, On Hold, Urgent), so a figure that moved when the agent clicked a day
in the activity strip would be inconsistent with everything beside it. If you do
want it to follow the strip, change the effect's date to
`format(selectedDay.fullDate, 'yyyy-MM-dd')` and add `selectedDay` to the deps —
but then relabel the card, or agents will read a historical number as current.

**Per process.** Switching process in the Task Console dropdown refetches, the
same as the daily score. An agent working several processes has a score per
process, not one combined figure.
