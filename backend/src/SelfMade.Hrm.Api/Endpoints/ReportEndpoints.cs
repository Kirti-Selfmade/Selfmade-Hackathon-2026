using System.Text;
using Microsoft.EntityFrameworkCore;
using SelfMade.Hrm.Api.Contracts;
using SelfMade.Hrm.Api.Data;
using SelfMade.Hrm.Api.Domain;
using SelfMade.Hrm.Api.Infrastructure;

namespace SelfMade.Hrm.Api.Endpoints;

/// <summary>Leave reporting (server-side aggregation + CSV export) and the privileged audit log.</summary>
public static class ReportEndpoints
{
    public static void MapReports(this RouteGroupBuilder api)
    {
        var r = api.MapGroup("/reports").WithTags("Reports").RequireAuthorization("Manager");
        r.MapGet("/leaves", LeaveReport);
        r.MapGet("/leaves/export", LeaveExport);

        api.MapGet("/audit", AuditLog).RequireAuthorization("SuperAdmin").WithTags("Audit");
    }

    private static async Task<IQueryable<LeaveApplication>> ScopedFilteredAsync(HrmDbContext db, TeamScope scope, OrgClock clock,
        string? status, int? leaveTypeId, int? employeeId, int? departmentId, DateOnly? from, DateOnly? to, CancellationToken ct)
    {
        var ids = await scope.VisibleIdsAsync(ct);
        var q = db.LeaveApplications.AsNoTracking().AsQueryable();
        if (ids is not null) q = q.Where(a => ids.Contains(a.EmployeeId));
        if (employeeId is int eid) q = q.Where(a => a.EmployeeId == eid);
        if (departmentId is int did) q = q.Where(a => a.Employee!.DepartmentId == did);
        if (from is null && to is null)
        {
            from = new DateOnly(clock.Today.Year, 1, 1);
            to = new DateOnly(clock.Today.Year, 12, 31);
        }
        return LeaveEndpoints.Filter(q, status, leaveTypeId, from, to, null);
    }

    private static async Task<IResult> LeaveReport(string? status, int? leaveTypeId, int? employeeId, int? departmentId, DateOnly? from, DateOnly? to,
        int? page, int? pageSize, HrmDbContext db, TeamScope scope, OrgClock clock, CancellationToken ct)
    {
        var (p, ps) = Mappers.Paging(page, pageSize);
        var q = await ScopedFilteredAsync(db, scope, clock, status, leaveTypeId, employeeId, departmentId, from, to, ct);

        // Consumption metrics ignore rejected / cancelled requests so numbers match what HR actually charges.
        var counted = q.Where(a => a.Status == LeaveStatus.Approved || a.Status == LeaveStatus.Pending);

        var totalApps = await q.CountAsync(ct);
        var totalDays = await counted.SumAsync(a => (decimal?)a.Days, ct) ?? 0m;

        var byType = await counted.GroupBy(a => a.LeaveType!.Name)
            .Select(g => new { name = g.Key, count = g.Count(), days = g.Sum(x => x.Days) })
            .OrderByDescending(x => x.days).ToListAsync(ct);

        var byDepartment = await counted
            .GroupBy(a => a.Employee!.Department != null ? a.Employee.Department.Name : "No department")
            .Select(g => new { name = g.Key, count = g.Count(), days = g.Sum(x => x.Days) })
            .OrderByDescending(x => x.days).ToListAsync(ct);

        var monthRaw = await counted.GroupBy(a => new { a.StartDate.Year, a.StartDate.Month })
            .Select(g => new { g.Key.Year, g.Key.Month, days = g.Sum(x => x.Days), count = g.Count() })
            .ToListAsync(ct);
        var byMonth = monthRaw.OrderBy(m => m.Year).ThenBy(m => m.Month)
            .Select(m => new { label = new DateOnly(m.Year, m.Month, 1).ToString("MMM yyyy"), m.days, m.count }).ToList();

        var statusRaw = await q.GroupBy(a => a.Status).Select(g => new { status = g.Key, count = g.Count() }).ToListAsync(ct);
        var byStatus = statusRaw.Select(s => new { status = s.status.ToString(), s.count }).ToList();

        var topRaw = await counted.GroupBy(a => new { a.EmployeeId, a.Employee!.FirstName, a.Employee.LastName })
            .Select(g => new { g.Key.FirstName, g.Key.LastName, days = g.Sum(x => x.Days) })
            .OrderByDescending(x => x.days).Take(10).ToListAsync(ct);
        var top = topRaw.Select(t => new { name = (t.FirstName + " " + t.LastName).Trim(), t.days }).ToList();

        var rows = await LeaveEndpoints.ToRowsAsync(q.OrderByDescending(a => a.StartDate).ThenByDescending(a => a.Id).Skip((p - 1) * ps).Take(ps), ct);

        return Results.Ok(new
        {
            summary = new { totalApplications = totalApps, totalDays, byType, byDepartment, byMonth, byStatus, topEmployees = top },
            rows = new PagedResult<LeaveRow>(rows, totalApps, p, ps)
        });
    }

    private static string Csv(object? value)
    {
        var s = value?.ToString() ?? "";
        // Neutralise spreadsheet formula injection (=, +, -, @) coming from free-text fields.
        if (s.Length > 0 && (s[0] is '=' or '+' or '-' or '@' or '\t' or '\r')) s = "'" + s;
        return "\"" + s.Replace("\"", "\"\"") + "\"";
    }

    private static async Task<IResult> LeaveExport(string? status, int? leaveTypeId, int? employeeId, int? departmentId, DateOnly? from, DateOnly? to,
        HrmDbContext db, TeamScope scope, OrgClock clock, AuditService audit, CancellationToken ct)
    {
        var q = await ScopedFilteredAsync(db, scope, clock, status, leaveTypeId, employeeId, departmentId, from, to, ct);
        var rows = await LeaveEndpoints.ToRowsAsync(q.OrderBy(a => a.StartDate).ThenBy(a => a.Id).Take(50_000), ct);

        var sb = new StringBuilder();
        sb.AppendLine("Employee,Department,Leave type,Start,End,Half day,Days,Status,Applied on,Decided by,Reason,Decision comment");
        foreach (var r in rows)
        {
            sb.AppendLine(string.Join(",", new[]
            {
                Csv(r.EmployeeName), Csv(r.Department), Csv(r.LeaveType), Csv(r.StartDate.ToString("yyyy-MM-dd")), Csv(r.EndDate.ToString("yyyy-MM-dd")),
                Csv(r.IsHalfDay ? "Yes" : "No"), Csv(r.Days), Csv(r.Status), Csv(r.AppliedAt.ToString("yyyy-MM-dd HH:mm")),
                Csv(r.DecidedBy), Csv(r.Reason), Csv(r.DecisionComment)
            }));
        }

        audit.Record("report.export", "LeaveReport", null, null, new { status, leaveTypeId, employeeId, departmentId, from, to, rows = rows.Count });
        await db.SaveChangesAsync(ct);

        var bytes = Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(sb.ToString())).ToArray();
        return Results.File(bytes, "text/csv; charset=utf-8", $"leave-report-{clock.Today:yyyyMMdd}.csv");
    }

    private static async Task<IResult> AuditLog(string? action, string? entityType, int? actorId, DateOnly? from, DateOnly? to, int? page, int? pageSize,
        HrmDbContext db, CancellationToken ct)
    {
        var (p, ps) = Mappers.Paging(page, pageSize);
        var q = db.AuditEvents.AsNoTracking().Where(a => a.Action != "job.daily");
        if (!string.IsNullOrWhiteSpace(action)) { var s = action.Trim(); q = q.Where(a => a.Action.Contains(s)); }
        if (!string.IsNullOrWhiteSpace(entityType)) { var s = entityType.Trim(); q = q.Where(a => a.EntityType == s); }
        if (actorId is int aid) q = q.Where(a => a.ActorId == aid);
        if (from is DateOnly f) { var dt = f.ToDateTime(TimeOnly.MinValue); q = q.Where(a => a.At >= dt); }
        if (to is DateOnly t) { var dt = t.AddDays(1).ToDateTime(TimeOnly.MinValue); q = q.Where(a => a.At < dt); }

        var total = await q.CountAsync(ct);
        var raw = await q.OrderByDescending(a => a.At).ThenByDescending(a => a.Id).Skip((p - 1) * ps).Take(ps)
            .Select(a => new { a.Id, First = a.Actor != null ? a.Actor.FirstName : null, Last = a.Actor != null ? a.Actor.LastName : null,
                a.Action, a.EntityType, a.EntityId, a.BeforeJson, a.AfterJson, a.IpAddress, a.At }).ToListAsync(ct);
        var items = raw.Select(a => new AuditDto(a.Id, a.First is null ? null : (a.First + " " + a.Last).Trim(), a.Action, a.EntityType, a.EntityId,
            a.BeforeJson, a.AfterJson, a.IpAddress, a.At)).ToList();
        return Results.Ok(new PagedResult<AuditDto>(items, total, p, ps));
    }
}
