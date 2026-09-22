using Microsoft.EntityFrameworkCore;
using SelfMade.Hrm.Api.Contracts;
using SelfMade.Hrm.Api.Data;
using SelfMade.Hrm.Api.Domain;
using SelfMade.Hrm.Api.Infrastructure;

namespace SelfMade.Hrm.Api.Endpoints;

public record UpcomingEvent(DateOnly Date, string Type, string Name, int EmployeeId, int? Years, string? AvatarUrl);

/// <summary>Role-aware dashboards and the unified calendar (holidays, leave, birthdays, anniversaries).</summary>
public static class DashboardEndpoints
{
    public static void MapDashboard(this RouteGroupBuilder api)
    {
        api.MapGet("/dashboard/me", EmployeeDashboard).WithTags("Dashboard");
        api.MapGet("/dashboard/team", TeamDashboard).RequireAuthorization("Manager").WithTags("Dashboard");
        api.MapGet("/calendar", Calendar).WithTags("Calendar");
    }

    private static DateOnly SafeDate(int year, int month, int day) => new(year, month, Math.Min(day, DateTime.DaysInMonth(year, month)));

    public static async Task<List<UpcomingEvent>> UpcomingEventsAsync(HrmDbContext db, DateOnly from, DateOnly to, CancellationToken ct)
    {
        var people = await db.Employees.AsNoTracking().Where(e => e.IsActive)
            .Select(e => new { e.Id, e.FirstName, e.LastName, e.DateOfBirth, e.JoinDate, e.AvatarFile }).ToListAsync(ct);
        var result = new List<UpcomingEvent>();
        foreach (var p in people)
        {
            var name = (p.FirstName + " " + p.LastName).Trim();
            for (var y = from.Year; y <= to.Year; y++)
            {
                if (p.DateOfBirth is { } dob)
                {
                    var d = SafeDate(y, dob.Month, dob.Day);
                    if (d >= from && d <= to) result.Add(new UpcomingEvent(d, "birthday", name, p.Id, null, Mappers.AvatarUrl(p.AvatarFile)));
                }
                var a = SafeDate(y, p.JoinDate.Month, p.JoinDate.Day);
                var years = y - p.JoinDate.Year;
                if (years >= 1 && a >= from && a <= to)
                    result.Add(new UpcomingEvent(a, "anniversary", name, p.Id, years, Mappers.AvatarUrl(p.AvatarFile)));
            }
        }
        return result.OrderBy(r => r.Date).ThenBy(r => r.Name).ToList();
    }

    private static async Task<List<HolidayDto>> UpcomingHolidaysAsync(HrmDbContext db, DateOnly today, int take, CancellationToken ct) =>
        (await db.Holidays.AsNoTracking().Where(h => h.Date >= today).OrderBy(h => h.Date).Take(take).ToListAsync(ct))
        .Select(h => new HolidayDto(h.Id, h.Name, h.Date, h.Kind.ToString())).ToList();

    // ---------- employee dashboard ----------

    private static async Task<IResult> EmployeeDashboard(HrmDbContext db, ICurrentUser me, LeaveService leaves, OrgClock clock, CancellationToken ct)
    {
        var today = clock.Today;
        var emp = await db.Employees.AsNoTracking().Include(e => e.Department).Include(e => e.Manager).FirstAsync(e => e.Id == me.Id, ct);

        var balances = await leaves.GetBalancesAsync(me.Id, today.Year, ct);
        var pendingCount = await db.LeaveApplications.CountAsync(a => a.EmployeeId == me.Id && a.Status == LeaveStatus.Pending, ct);
        var next = (await LeaveEndpoints.ToRowsAsync(db.LeaveApplications.AsNoTracking()
            .Where(a => a.EmployeeId == me.Id && a.Status == LeaveStatus.Approved && a.EndDate >= today)
            .OrderBy(a => a.StartDate).Take(1), ct)).FirstOrDefault();

        // Today's status: holiday > weekend > approved leave > working day.
        var holidayToday = await db.Holidays.AsNoTracking().FirstOrDefaultAsync(h => h.Date == today, ct);
        var onLeaveToday = await db.LeaveApplications.AsNoTracking()
            .Where(a => a.EmployeeId == me.Id && a.Status == LeaveStatus.Approved && a.StartDate <= today && a.EndDate >= today)
            .Select(a => new { Type = a.LeaveType!.Name, a.IsHalfDay }).FirstOrDefaultAsync(ct);
        string todayStatus, todayDetail;
        if (holidayToday is not null) { todayStatus = "Holiday"; todayDetail = holidayToday.Name; }
        else if (today.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday) { todayStatus = "Weekend"; todayDetail = "Enjoy your weekend"; }
        else if (onLeaveToday is not null) { todayStatus = "OnLeave"; todayDetail = onLeaveToday.Type + (onLeaveToday.IsHalfDay ? " (half day)" : ""); }
        else { todayStatus = "Working"; todayDetail = "Regular working day"; }

        var announcements = (await db.Announcements.AsNoTracking().Where(a => a.IsPublished)
            .OrderByDescending(a => a.IsPinned).ThenByDescending(a => a.PublishedAt).Take(5)
            .Select(a => new { a.Id, a.Title, a.Body, a.IsPinned, a.IsPublished, a.PublishedAt, By = a.CreatedBy != null ? a.CreatedBy.FirstName + " " + a.CreatedBy.LastName : null })
            .ToListAsync(ct)).Select(a => new AnnouncementDto(a.Id, a.Title, a.Body, a.IsPinned, a.IsPublished, a.PublishedAt, a.By)).ToList();

        var unread = await db.Notifications.CountAsync(n => n.EmployeeId == me.Id && !n.IsRead, ct);
        var events = (await UpcomingEventsAsync(db, today, today.AddDays(30), ct)).Take(8).ToList();

        var completenessFields = new[] { emp.Phone, emp.Gender, emp.LocalAddress, emp.PermanentAddress, emp.EmergencyContactName, emp.EmergencyContactPhone, emp.AvatarFile, emp.DateOfBirth?.ToString() };
        var missing = new List<string>();
        if (string.IsNullOrWhiteSpace(emp.AvatarFile)) missing.Add("Add a profile photo");
        if (string.IsNullOrWhiteSpace(emp.Phone)) missing.Add("Add your phone number");
        if (string.IsNullOrWhiteSpace(emp.LocalAddress)) missing.Add("Add your current address");
        if (string.IsNullOrWhiteSpace(emp.EmergencyContactName) || string.IsNullOrWhiteSpace(emp.EmergencyContactPhone)) missing.Add("Add an emergency contact");
        if (string.IsNullOrWhiteSpace(emp.Gender)) missing.Add("Add your gender");
        if (emp.DateOfBirth is null) missing.Add("Add your date of birth");

        return Results.Ok(new
        {
            user = Mappers.ToUser(emp),
            manager = emp.Manager?.FullName,
            joinDate = emp.JoinDate,
            balances,
            pendingCount,
            nextLeave = next,
            today = new { date = today, status = todayStatus, detail = todayDetail },
            holidays = await UpcomingHolidaysAsync(db, today, 5, ct),
            events,
            announcements,
            unreadNotifications = unread,
            profileCompleteness = (int)Math.Round(completenessFields.Count(c => !string.IsNullOrWhiteSpace(c)) * 100.0 / completenessFields.Length),
            profileTodo = missing
        });
    }

    // ---------- manager / HR dashboard ----------

    private static async Task<IResult> TeamDashboard(HrmDbContext db, ICurrentUser me, TeamScope scope, OrgClock clock, CancellationToken ct)
    {
        var today = clock.Today;
        var ids = await scope.VisibleIdsAsync(ct);

        var people = db.Employees.AsNoTracking().AsQueryable();
        if (ids is not null) people = people.Where(e => ids.Contains(e.Id));
        var activePeople = people.Where(e => e.IsActive);

        var headcount = await activePeople.CountAsync(ct);
        var newJoiners = await activePeople.CountAsync(e => e.JoinDate >= today.AddDays(-30), ct);
        var since = DateTime.UtcNow.AddDays(-30);
        var exits = await people.CountAsync(e => !e.IsActive && e.DisabledAt != null && e.DisabledAt >= since, ct);

        var leaveQ = db.LeaveApplications.AsNoTracking().AsQueryable();
        if (ids is not null) leaveQ = leaveQ.Where(a => ids.Contains(a.EmployeeId));

        var onLeaveToday = (await leaveQ
            .Where(a => a.Status == LeaveStatus.Approved && a.StartDate <= today && a.EndDate >= today)
            .Select(a => new { a.EmployeeId, First = a.Employee!.FirstName, Last = a.Employee.LastName, Type = a.LeaveType!.Name, a.IsHalfDay, a.EndDate, Avatar = a.Employee.AvatarFile })
            .ToListAsync(ct))
            .Select(a => new { a.EmployeeId, name = (a.First + " " + a.Last).Trim(), type = a.Type, a.IsHalfDay, until = a.EndDate, avatarUrl = Mappers.AvatarUrl(a.Avatar) }).ToList();

        var pendingQ = leaveQ.Where(a => a.Status == LeaveStatus.Pending && a.EmployeeId != me.Id);
        var pendingCount = await pendingQ.CountAsync(ct);
        var oldestPending = pendingCount == 0 ? (DateTime?)null : await pendingQ.MinAsync(a => (DateTime?)a.AppliedAt, ct);
        var pendingTop = await LeaveEndpoints.ToRowsAsync(pendingQ.OrderBy(a => a.AppliedAt).Take(8), ct);
        var overdue = await pendingQ.CountAsync(a => a.AppliedAt < DateTime.UtcNow.AddDays(-3), ct);

        var from = today.AddMonths(-5);
        var monthStart = new DateOnly(from.Year, from.Month, 1);
        var trendRaw = await leaveQ
            .Where(a => (a.Status == LeaveStatus.Approved) && a.StartDate >= monthStart)
            .GroupBy(a => new { a.StartDate.Year, a.StartDate.Month })
            .Select(g => new { g.Key.Year, g.Key.Month, Days = g.Sum(x => x.Days) })
            .ToListAsync(ct);
        var trend = Enumerable.Range(0, 6).Select(i =>
        {
            var m = monthStart.AddMonths(i);
            var hit = trendRaw.FirstOrDefault(t => t.Year == m.Year && t.Month == m.Month);
            return new { label = m.ToString("MMM yy"), days = hit?.Days ?? 0m };
        }).ToList();

        var exceptions = new List<object>();
        if (overdue > 0) exceptions.Add(new { kind = "warning", text = $"{overdue} approval(s) waiting more than 3 days", link = "/approvals" });
        if (me.IsHr)
        {
            var noManager = await db.Employees.CountAsync(e => e.IsActive && e.ManagerId == null && e.Role != Role.SuperAdmin, ct);
            if (noManager > 0) exceptions.Add(new { kind = "info", text = $"{noManager} active employee(s) have no manager assigned", link = "/people" });
            var noDept = await db.Employees.CountAsync(e => e.IsActive && e.DepartmentId == null, ct);
            if (noDept > 0) exceptions.Add(new { kind = "info", text = $"{noDept} active employee(s) have no department", link = "/people" });
            var failedMail = await db.EmailOutbox.CountAsync(x => x.Status == OutboxStatus.Failed, ct);
            if (failedMail > 0) exceptions.Add(new { kind = "error", text = $"{failedMail} e-mail(s) failed to send after retries", link = "/audit" });
        }

        var events = (await UpcomingEventsAsync(db, today, today.AddDays(30), ct)).Take(8).ToList();

        return Results.Ok(new
        {
            scope = me.IsHr ? "organization" : "team",
            headcount, newJoiners, exits,
            availableToday = Math.Max(0, headcount - onLeaveToday.Count),
            onLeaveToday,
            pending = new { count = pendingCount, overdue, oldestAt = oldestPending, items = pendingTop },
            trend,
            exceptions,
            holidays = await UpcomingHolidaysAsync(db, today, 5, ct),
            events
        });
    }

    // ---------- calendar ----------

    private static async Task<IResult> Calendar(DateOnly from, DateOnly to, HrmDbContext db, ICurrentUser me, TeamScope scope, CancellationToken ct)
    {
        if (to < from) return new Errors().Add("to", "End date must be after start date.").ToResult();
        if (to.DayNumber - from.DayNumber > 92) return new Errors().Add("to", "Choose a range of at most 3 months.").ToResult();

        var events = new List<CalendarEvent>();

        var holidays = await db.Holidays.AsNoTracking().Where(h => h.Date >= from && h.Date <= to).ToListAsync(ct);
        var offDays = holidays.Select(h => h.Date).ToHashSet();
        foreach (var h in holidays)
            events.Add(new CalendarEvent(h.Date, h.Kind == HolidayKind.OfficeOff ? "officeoff" : "holiday", h.Name, null, null, null));

        // Leave visibility: HR = everyone, manager = own reporting line, employee = self (+ "On leave" for department colleagues).
        var ids = await scope.VisibleIdsAsync(ct);
        var mineDeptId = await db.Employees.Where(e => e.Id == me.Id).Select(e => e.DepartmentId).FirstOrDefaultAsync(ct);

        var q = db.LeaveApplications.AsNoTracking()
            .Where(a => a.StartDate <= to && a.EndDate >= from && (a.Status == LeaveStatus.Approved || a.Status == LeaveStatus.Pending));
        var isEmployeeOnly = !me.IsManagerOrAbove;
        if (ids is not null && !isEmployeeOnly) q = q.Where(a => ids.Contains(a.EmployeeId));
        if (isEmployeeOnly)
            q = q.Where(a => a.EmployeeId == me.Id || (a.Status == LeaveStatus.Approved && mineDeptId != null && a.Employee!.DepartmentId == mineDeptId));

        var leaves = await q.Select(a => new
        {
            a.EmployeeId, First = a.Employee!.FirstName, Last = a.Employee.LastName,
            Type = a.LeaveType!.Name, a.LeaveType.Color, a.StartDate, a.EndDate, a.IsHalfDay, a.Status
        }).Take(2000).ToListAsync(ct);

        foreach (var l in leaves)
        {
            var name = (l.First + " " + l.Last).Trim();
            var showType = !isEmployeeOnly || l.EmployeeId == me.Id;
            var title = name + " - " + (showType ? l.Type : "On leave") + (l.IsHalfDay ? " (half)" : "");
            var start = l.StartDate < from ? from : l.StartDate;
            var end = l.EndDate > to ? to : l.EndDate;
            for (var d = start; d <= end; d = d.AddDays(1))
            {
                if (!LeaveService.IsWorkingDay(d, offDays)) continue;
                events.Add(new CalendarEvent(d, "leave", title, l.EmployeeId, l.Status.ToString(), showType ? l.Color : "#64748B"));
            }
        }

        foreach (var e in await UpcomingEventsAsync(db, from, to, ct))
            events.Add(new CalendarEvent(e.Date, e.Type,
                e.Type == "birthday" ? $"{e.Name}'s birthday" : $"{e.Name} - {e.Years} yr{(e.Years == 1 ? "" : "s")} at SelfMade", e.EmployeeId, null, null));

        return Results.Ok(events.OrderBy(e => e.Date).ThenBy(e => e.Type).ToList());
    }
}
