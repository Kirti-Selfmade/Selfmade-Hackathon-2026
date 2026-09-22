using Microsoft.EntityFrameworkCore;
using SelfMade.Hrm.Api.Contracts;
using SelfMade.Hrm.Api.Data;
using SelfMade.Hrm.Api.Domain;

namespace SelfMade.Hrm.Api.Infrastructure;

/// <summary>Leave policy engine: day counting, overlap / holiday / balance validation.</summary>
public class LeaveService(HrmDbContext db, OrgClock clock, IConfiguration cfg)
{
    public static bool IsWorkingDay(DateOnly d, ISet<DateOnly> offDays) =>
        d.DayOfWeek is not (DayOfWeek.Saturday or DayOfWeek.Sunday) && !offDays.Contains(d);

    /// <summary>Counts chargeable days: weekends and company holidays / office-off days are excluded.</summary>
    public static decimal CountDays(DateOnly start, DateOnly end, bool halfDay, ISet<DateOnly> offDays)
    {
        if (end < start) return 0;
        if (halfDay)
            return start == end && IsWorkingDay(start, offDays) ? 0.5m : 0m;

        decimal n = 0;
        for (var d = start; d <= end; d = d.AddDays(1))
            if (IsWorkingDay(d, offDays)) n++;
        return n;
    }

    public async Task<HashSet<DateOnly>> OffDaysAsync(DateOnly from, DateOnly to, CancellationToken ct) =>
        (await db.Holidays.AsNoTracking().Where(h => h.Date >= from && h.Date <= to).Select(h => h.Date).ToListAsync(ct)).ToHashSet();

    /// <summary>Gets (or lazily creates, tracked) the balance row. Caller saves.</summary>
    public async Task<LeaveBalance> EnsureBalanceAsync(int employeeId, LeaveType type, int year, CancellationToken ct)
    {
        // Check the change tracker first so two calls in one unit of work never create duplicate rows.
        var bal = db.LeaveBalances.Local.FirstOrDefault(b => b.EmployeeId == employeeId && b.LeaveTypeId == type.Id && b.Year == year)
                  ?? await db.LeaveBalances.FirstOrDefaultAsync(b => b.EmployeeId == employeeId && b.LeaveTypeId == type.Id && b.Year == year, ct);
        if (bal is null)
        {
            bal = new LeaveBalance { EmployeeId = employeeId, LeaveTypeId = type.Id, Year = year, Total = type.DefaultAnnualDays, Used = 0 };
            db.LeaveBalances.Add(bal);
        }
        return bal;
    }

    public async Task<List<BalanceDto>> GetBalancesAsync(int employeeId, int year, CancellationToken ct)
    {
        var types = await db.LeaveTypes.AsNoTracking().Where(t => t.IsActive).OrderBy(t => t.Id).ToListAsync(ct);
        var rows = await db.LeaveBalances.AsNoTracking().Where(b => b.EmployeeId == employeeId && b.Year == year).ToListAsync(ct);
        var from = new DateOnly(year, 1, 1);
        var to = new DateOnly(year, 12, 31);
        var pending = await db.LeaveApplications.AsNoTracking()
            .Where(a => a.EmployeeId == employeeId && a.Status == LeaveStatus.Pending && a.StartDate >= from && a.StartDate <= to)
            .Select(a => new { a.LeaveTypeId, a.Days }).ToListAsync(ct);

        return types.Select(t =>
        {
            var row = rows.FirstOrDefault(r => r.LeaveTypeId == t.Id);
            var total = row?.Total ?? t.DefaultAnnualDays;
            var used = row?.Used ?? 0;
            var pend = pending.Where(p => p.LeaveTypeId == t.Id).Sum(p => p.Days);
            return new BalanceDto(t.Id, t.Name, t.Code, t.Color, t.TracksBalance, total, used, pend, total - used - pend);
        }).ToList();
    }

    /// <summary>Validates every requested slot. Never mutates the database.</summary>
    public async Task<List<SlotCheckDto>> CheckSlotsAsync(int employeeId, IReadOnlyList<LeaveSlotDto> slots, int? ignoreApplicationId, CancellationToken ct,
        bool skipBackdateCheck = false, bool skipBalanceCheck = false)
    {
        var results = new List<SlotCheckDto>();
        if (slots.Count == 0) return results;

        var today = clock.Today;
        var maxBack = cfg.GetValue("Org:MaxBackdateDays", 30);
        var typeIds = slots.Select(s => s.LeaveTypeId).Distinct().ToList();
        var types = await db.LeaveTypes.AsNoTracking().Where(t => typeIds.Contains(t.Id)).ToDictionaryAsync(t => t.Id, ct);

        var norm = slots.Select(s => (Slot: s, End: s.EndDate ?? s.StartDate)).ToList();
        var min = norm.Min(x => x.Slot.StartDate);
        var max = norm.Max(x => x.End);
        var hi = max.DayNumber - min.DayNumber > 400 ? min.AddDays(400) : max;

        var offDays = await OffDaysAsync(min, hi, ct);

        var existing = await db.LeaveApplications.AsNoTracking()
            .Where(a => a.EmployeeId == employeeId
                        && (a.Status == LeaveStatus.Pending || a.Status == LeaveStatus.Approved)
                        && a.StartDate <= max && a.EndDate >= min
                        && (ignoreApplicationId == null || a.Id != ignoreApplicationId))
            .Select(a => new { a.StartDate, a.EndDate })
            .ToListAsync(ct);

        var years = norm.Select(x => x.Slot.StartDate.Year).Distinct().ToList();
        var balances = await db.LeaveBalances.AsNoTracking()
            .Where(b => b.EmployeeId == employeeId && typeIds.Contains(b.LeaveTypeId) && years.Contains(b.Year))
            .ToListAsync(ct);
        var pendingApps = await db.LeaveApplications.AsNoTracking()
            .Where(a => a.EmployeeId == employeeId && a.Status == LeaveStatus.Pending
                        && typeIds.Contains(a.LeaveTypeId)
                        && (ignoreApplicationId == null || a.Id != ignoreApplicationId))
            .Select(a => new { a.LeaveTypeId, a.StartDate, a.Days })
            .ToListAsync(ct);

        var consumed = new Dictionary<(int TypeId, int Year), decimal>();

        for (var i = 0; i < norm.Count; i++)
        {
            var (s, end) = norm[i];
            var errs = new List<string>();
            var warns = new List<string>();
            types.TryGetValue(s.LeaveTypeId, out var type);

            if (type is null || !type.IsActive) errs.Add("Choose a valid leave type.");
            if (end < s.StartDate) errs.Add("End date cannot be before start date.");
            else if (end.DayNumber - s.StartDate.DayNumber > 90) errs.Add("A single leave request cannot span more than 90 days.");
            else if (s.StartDate.Year != end.Year) errs.Add("A leave request cannot span two calendar years; split it into two.");
            if (!skipBackdateCheck && s.StartDate < today.AddDays(-maxBack)) errs.Add($"Leave cannot be applied for dates more than {maxBack} days in the past.");

            decimal days = 0;
            decimal? before = null, after = null;

            if (errs.Count == 0)
            {
                if (s.IsHalfDay)
                {
                    if (s.StartDate != end) errs.Add("Half day applies to a single date only.");
                    else if (!type!.AllowHalfDay) errs.Add($"{type.Name} does not allow half days.");
                }
                if (errs.Count == 0)
                {
                    days = CountDays(s.StartDate, end, s.IsHalfDay, offDays);
                    if (days == 0) errs.Add("The selected date(s) fall on weekends or company holidays, so there is nothing to apply for.");
                }
            }

            if (errs.Count == 0)
            {
                if (existing.Any(e => e.StartDate <= end && e.EndDate >= s.StartDate))
                    errs.Add("You already have a pending or approved leave overlapping these dates.");
                if (norm.Take(i).Any(p => p.Slot.StartDate <= end && p.End >= s.StartDate))
                    errs.Add("These dates overlap another row in this request.");

                var calendarDays = end.DayNumber - s.StartDate.DayNumber + 1;
                if (!s.IsHalfDay && days < calendarDays)
                    warns.Add("Weekends and company holidays in this range are not counted.");

                if (errs.Count == 0 && !skipBalanceCheck && type!.TracksBalance)
                {
                    var year = s.StartDate.Year;
                    var bal = balances.FirstOrDefault(b => b.LeaveTypeId == type.Id && b.Year == year);
                    var total = bal?.Total ?? type.DefaultAnnualDays;
                    var used = bal?.Used ?? 0;
                    var pend = pendingApps.Where(p => p.LeaveTypeId == type.Id && p.StartDate.Year == year).Sum(p => p.Days);
                    consumed.TryGetValue((type.Id, year), out var c);
                    before = total - used - pend - c;
                    after = before - days;
                    if (after < 0)
                        errs.Add($"Insufficient {type.Name} balance: {before} day(s) available, {days} requested.");
                    else
                        consumed[(type.Id, year)] = c + days;
                }
            }

            results.Add(new SlotCheckDto(i, s.LeaveTypeId, s.StartDate, end, s.IsHalfDay, days, before, after, errs, warns));
        }

        return results;
    }

    /// <summary>
    /// Re-counts chargeable days for every pending / approved leave application that overlaps any of the given
    /// dates, because a holiday or office-off day was added, moved or removed after those requests were made.
    /// Approved leave has its balance usage adjusted by the delta; the employee is notified either way.
    /// Caller must already have committed the holiday change (so the recount sees the new calendar) and
    /// must SaveChanges afterwards.
    /// </summary>
    public async Task<int> RecalculateForDatesAsync(IReadOnlyCollection<DateOnly> affectedDates, NotificationService notify, AuditService audit, CancellationToken ct)
    {
        if (affectedDates.Count == 0) return 0;
        var min = affectedDates.Min();
        var max = affectedDates.Max();

        var candidates = await db.LeaveApplications
            .Include(a => a.Employee)
            .Include(a => a.LeaveType)
            .Where(a => !a.IsDeleted && (a.Status == LeaveStatus.Pending || a.Status == LeaveStatus.Approved)
                        && a.StartDate <= max && a.EndDate >= min)
            .ToListAsync(ct);
        var apps = candidates.Where(a => affectedDates.Any(d => d >= a.StartDate && d <= a.EndDate)).ToList();
        if (apps.Count == 0) return 0;

        var touched = 0;
        foreach (var app in apps)
        {
            var offDays = await OffDaysAsync(app.StartDate, app.EndDate, ct);
            var newDays = CountDays(app.StartDate, app.EndDate, app.IsHalfDay, offDays);
            if (newDays == app.Days) continue;

            var oldDays = app.Days;
            app.Days = newDays;
            touched++;

            if (app.Status == LeaveStatus.Approved && app.LeaveType is { TracksBalance: true } type)
            {
                var bal = await EnsureBalanceAsync(app.EmployeeId, type, app.StartDate.Year, ct);
                bal.Used = Math.Max(0, bal.Used + (newDays - oldDays));
            }

            db.LeaveEvents.Add(new LeaveEvent
            {
                LeaveApplicationId = app.Id, Kind = "Recalculated",
                Comment = $"Day count updated from {oldDays} to {newDays} after a change to the holiday calendar."
            });
            audit.Record("leave.recalculate", "LeaveApplication", app.Id, new { Days = oldDays }, new { Days = newDays });

            if (app.Employee is not null)
            {
                notify.Notify(app.Employee, "Leave request recalculated",
                    $"Your {app.LeaveType?.Name ?? "leave"} request for {app.StartDate:dd MMM} - {app.EndDate:dd MMM} now counts as {newDays} day(s) (was {oldDays}) after a change to the holiday calendar.",
                    "/leaves");
            }
        }

        return touched;
    }
}
