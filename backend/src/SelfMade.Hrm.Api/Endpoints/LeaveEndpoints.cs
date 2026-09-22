using Microsoft.EntityFrameworkCore;
using SelfMade.Hrm.Api.Contracts;
using SelfMade.Hrm.Api.Data;
using SelfMade.Hrm.Api.Domain;
using SelfMade.Hrm.Api.Infrastructure;

namespace SelfMade.Hrm.Api.Endpoints;

public static class LeaveEndpoints
{
    public static void MapLeaves(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/leaves").WithTags("Leaves");
        g.MapGet("/balances", Balances);
        g.MapPost("/preview", Preview);
        g.MapPost("", Apply);
        g.MapGet("/mine", Mine);
        g.MapGet("", Manage).RequireAuthorization("Manager");
        g.MapGet("/{id:int}", Detail);
        g.MapPost("/{id:int}/cancel", Cancel);
        g.MapPost("/{id:int}/decision", Decide).RequireAuthorization("Manager");
        g.MapPut("/{id:int}", Edit).RequireAuthorization("Hr");
        g.MapPost("/{id:int}/remove", Remove).RequireAuthorization("Hr");
    }

    // ---------- shared helpers ----------

    public static IQueryable<LeaveApplication> Filter(IQueryable<LeaveApplication> q, string? status, int? leaveTypeId, DateOnly? from, DateOnly? to, string? search)
    {
        if (Enum.TryParse<LeaveStatus>(status, true, out var st)) q = q.Where(a => a.Status == st);
        if (leaveTypeId is int lt) q = q.Where(a => a.LeaveTypeId == lt);
        if (from is DateOnly f) q = q.Where(a => a.EndDate >= f);
        if (to is DateOnly t) q = q.Where(a => a.StartDate <= t);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim();
            q = q.Where(a => a.Reason.Contains(s) || a.Employee!.FirstName.Contains(s) || a.Employee.LastName.Contains(s));
        }
        return q;
    }

    public static async Task<List<LeaveRow>> ToRowsAsync(IQueryable<LeaveApplication> q, CancellationToken ct)
    {
        var rows = await q.Select(a => new
        {
            a.Id, a.EmployeeId, First = a.Employee!.FirstName, Last = a.Employee.LastName,
            Department = a.Employee.Department != null ? a.Employee.Department.Name : null,
            a.LeaveTypeId, TypeName = a.LeaveType!.Name, TypeCode = a.LeaveType.Code, a.LeaveType.Color,
            a.StartDate, a.EndDate, a.IsHalfDay, a.Days, a.Reason, a.Status, a.AppliedAt,
            DecFirst = a.DecidedBy != null ? a.DecidedBy.FirstName : null,
            DecLast = a.DecidedBy != null ? a.DecidedBy.LastName : null,
            a.DecidedAt, a.DecisionComment
        }).ToListAsync(ct);

        var now = DateTime.UtcNow;
        return rows.Select(r => new LeaveRow(
            r.Id, r.EmployeeId, (r.First + " " + r.Last).Trim(), r.Department, r.LeaveTypeId, r.TypeName, r.TypeCode, r.Color,
            r.StartDate, r.EndDate, r.IsHalfDay, r.Days, r.Reason, r.Status.ToString(), r.AppliedAt,
            r.DecFirst is null ? null : (r.DecFirst + " " + r.DecLast).Trim(), r.DecidedAt, r.DecisionComment,
            r.Status == LeaveStatus.Pending ? (int)(now - r.AppliedAt).TotalDays : 0)).ToList();
    }

    private static object Snap(LeaveApplication a) => new
    {
        a.LeaveTypeId, a.StartDate, a.EndDate, a.IsHalfDay, a.Days, a.Reason, Status = a.Status.ToString()
    };

    private static string Range(DateOnly s, DateOnly e) => s == e ? $"{s:dd MMM yyyy}" : $"{s:dd MMM} - {e:dd MMM yyyy}";

    private static Task<LeaveApplication?> LoadAsync(HrmDbContext db, int id, CancellationToken ct) =>
        db.LeaveApplications
            .Include(a => a.Employee).ThenInclude(e => e!.Manager)
            .Include(a => a.LeaveType)
            .FirstOrDefaultAsync(a => a.Id == id, ct);

    private static async Task<List<Employee>> ApproversForAsync(HrmDbContext db, Employee applicant, CancellationToken ct)
    {
        if (applicant.ManagerId is int mid)
        {
            var mgr = await db.Employees.FirstOrDefaultAsync(e => e.Id == mid && e.IsActive, ct);
            if (mgr is not null) return [mgr];
        }
        return await db.Employees.Where(e => e.IsActive && e.Id != applicant.Id && (e.Role == Role.HrAdmin || e.Role == Role.SuperAdmin)).ToListAsync(ct);
    }

    // ---------- balances / preview / apply ----------

    private static async Task<IResult> Balances(int? year, int? employeeId, HrmDbContext db, ICurrentUser me, TeamScope scope, LeaveService leaves, OrgClock clock, CancellationToken ct)
    {
        var target = employeeId ?? me.Id;
        if (target != me.Id && !await scope.CanSeeAsync(target, ct)) return Problems.Forbidden();
        return Results.Ok(await leaves.GetBalancesAsync(target, year ?? clock.Today.Year, ct));
    }

    private static Errors ValidateRequest(ApplyLeaveRequest req)
    {
        var e = new Errors();
        if (req.Slots is null || req.Slots.Count == 0) return e.Add("slots", "Add at least one leave date.");
        if (req.Slots.Count > 31) return e.Add("slots", "You can apply for at most 31 rows at a time.");
        for (var i = 0; i < req.Slots.Count; i++)
        {
            var reason = req.Slots[i].Reason ?? req.Reason;
            if (string.IsNullOrWhiteSpace(reason)) e.Add($"slots[{i}]", "A reason is required.");
            else if (reason.Trim().Length > 1000) e.Add($"slots[{i}]", "Reason must be at most 1000 characters.");
        }
        return e;
    }

    private static async Task<IResult> Preview(ApplyLeaveRequest req, ICurrentUser me, LeaveService leaves, CancellationToken ct)
    {
        if (req.Slots is null || req.Slots.Count == 0) return new Errors().Add("slots", "Add at least one leave date.").ToResult();
        if (req.Slots.Count > 31) return new Errors().Add("slots", "You can apply for at most 31 rows at a time.").ToResult();
        return Results.Ok(await leaves.CheckSlotsAsync(me.Id, req.Slots, null, ct));
    }

    private static async Task<IResult> Apply(ApplyLeaveRequest req, HrmDbContext db, ICurrentUser me, LeaveService leaves, NotificationService notes, AuditService audit, CancellationToken ct)
    {
        var shape = ValidateRequest(req);
        if (shape.Any) return shape.ToResult();
        var slots = req.Slots!;

        var checks = await leaves.CheckSlotsAsync(me.Id, slots, null, ct);
        if (checks.Any(c => c.Errors.Count > 0))
        {
            var errors = new Errors();
            foreach (var c in checks) foreach (var m in c.Errors) errors.Add($"slots[{c.Index}]", m);
            return errors.ToResult();
        }

        var emp = await db.Employees.FirstAsync(e => e.Id == me.Id, ct);
        var created = new List<LeaveApplication>();
        foreach (var c in checks)
        {
            var slot = slots[c.Index];
            var reason = (slot.Reason ?? req.Reason)!.Trim();
            var app = new LeaveApplication
            {
                EmployeeId = me.Id, LeaveTypeId = slot.LeaveTypeId, StartDate = c.StartDate, EndDate = c.EndDate,
                IsHalfDay = c.IsHalfDay, Days = c.Days, Reason = reason, Status = LeaveStatus.Pending, AppliedAt = DateTime.UtcNow
            };
            app.Events.Add(new LeaveEvent { Kind = "Submitted", ActorId = me.Id, Comment = reason });
            db.LeaveApplications.Add(app);
            created.Add(app);
        }

        var totalDays = created.Sum(a => a.Days);
        var first = created.Min(a => a.StartDate);
        var last = created.Max(a => a.EndDate);
        foreach (var approver in await ApproversForAsync(db, emp, ct))
        {
            notes.Notify(approver, $"Leave request from {emp.FullName}",
                $"{emp.FullName} applied for {totalDays} day(s) of leave ({Range(first, last)}). Please review it.", "/approvals");
        }

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.SaveChangesAsync(ct); // assigns ids
        foreach (var a in created) audit.Record("leave.apply", "LeaveApplication", a.Id, null, Snap(a));
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);

        var newIds = created.Select(x => x.Id).ToList();
        var rows = await ToRowsAsync(db.LeaveApplications.AsNoTracking().Where(a => newIds.Contains(a.Id)), ct);
        return Results.Created("/api/v1/leaves/mine", rows);
    }

    // ---------- lists ----------

    private static async Task<IResult> Mine(string? status, int? leaveTypeId, DateOnly? from, DateOnly? to, string? search, int? page, int? pageSize,
        HrmDbContext db, ICurrentUser me, CancellationToken ct)
    {
        var (p, ps) = Mappers.Paging(page, pageSize);
        var q = Filter(db.LeaveApplications.AsNoTracking().Where(a => a.EmployeeId == me.Id), status, leaveTypeId, from, to, search);
        var total = await q.CountAsync(ct);
        var rows = await ToRowsAsync(q.OrderByDescending(a => a.StartDate).ThenByDescending(a => a.Id).Skip((p - 1) * ps).Take(ps), ct);
        return Results.Ok(new PagedResult<LeaveRow>(rows, total, p, ps));
    }

    private static async Task<IResult> Manage(string? status, int? leaveTypeId, int? employeeId, int? departmentId, DateOnly? from, DateOnly? to, string? search,
        int? page, int? pageSize, HrmDbContext db, TeamScope scope, CancellationToken ct)
    {
        var (p, ps) = Mappers.Paging(page, pageSize);
        var ids = await scope.VisibleIdsAsync(ct);
        var q = db.LeaveApplications.AsNoTracking().AsQueryable();
        if (ids is not null) q = q.Where(a => ids.Contains(a.EmployeeId));
        if (employeeId is int eid) q = q.Where(a => a.EmployeeId == eid);
        if (departmentId is int did) q = q.Where(a => a.Employee!.DepartmentId == did);
        q = Filter(q, status, leaveTypeId, from, to, search);

        var total = await q.CountAsync(ct);
        var ordered = q.OrderBy(a => a.Status == LeaveStatus.Pending ? 0 : 1).ThenByDescending(a => a.AppliedAt).ThenByDescending(a => a.Id);
        var rows = await ToRowsAsync(ordered.Skip((p - 1) * ps).Take(ps), ct);
        return Results.Ok(new PagedResult<LeaveRow>(rows, total, p, ps));
    }

    private static async Task<IResult> Detail(int id, HrmDbContext db, ICurrentUser me, TeamScope scope, LeaveService leaves, CancellationToken ct)
    {
        var row = (await ToRowsAsync(db.LeaveApplications.AsNoTracking().Where(a => a.Id == id), ct)).FirstOrDefault();
        if (row is null) return Problems.NotFound("Leave request not found.");
        if (row.EmployeeId != me.Id && !await scope.CanSeeAsync(row.EmployeeId, ct)) return Problems.Forbidden();

        var events = (await db.LeaveEvents.AsNoTracking().Where(e => e.LeaveApplicationId == id).OrderBy(e => e.At).ThenBy(e => e.Id)
            .Select(e => new { e.Kind, First = e.Actor != null ? e.Actor.FirstName : null, Last = e.Actor != null ? e.Actor.LastName : null, e.Comment, e.At })
            .ToListAsync(ct))
            .Select(e => new LeaveEventDto(e.Kind, e.First is null ? null : (e.First + " " + e.Last).Trim(), e.Comment, e.At)).ToList();

        var conflicts = new List<LeaveConflictDto>();
        BalanceDto? balance = null;
        if (me.IsManagerOrAbove && row.EmployeeId != me.Id)
        {
            var deptId = await db.Employees.Where(e => e.Id == row.EmployeeId).Select(e => e.DepartmentId).FirstOrDefaultAsync(ct);
            if (deptId is int d)
            {
                var start = row.StartDate; var end = row.EndDate; var empId = row.EmployeeId;
                var raw = await db.LeaveApplications.AsNoTracking()
                    .Where(a => a.EmployeeId != empId && a.Employee!.DepartmentId == d
                                && (a.Status == LeaveStatus.Pending || a.Status == LeaveStatus.Approved)
                                && a.StartDate <= end && a.EndDate >= start)
                    .OrderBy(a => a.StartDate).Take(10)
                    .Select(a => new { a.EmployeeId, First = a.Employee!.FirstName, Last = a.Employee.LastName, a.StartDate, a.EndDate, a.Status })
                    .ToListAsync(ct);
                conflicts = raw.Select(a => new LeaveConflictDto(a.EmployeeId, (a.First + " " + a.Last).Trim(), a.StartDate, a.EndDate, a.Status.ToString())).ToList();
            }
        }
        if (row.EmployeeId == me.Id || me.IsManagerOrAbove)
            balance = (await leaves.GetBalancesAsync(row.EmployeeId, row.StartDate.Year, ct)).FirstOrDefault(b => b.LeaveTypeId == row.LeaveTypeId);

        return Results.Ok(new LeaveDetail(row, events, conflicts, balance));
    }

    // ---------- employee: cancel ----------

    private static async Task<IResult> Cancel(int id, CancelRequest? req, HrmDbContext db, ICurrentUser me, LeaveService leaves, OrgClock clock, NotificationService notes, AuditService audit, CancellationToken ct)
    {
        var app = await LoadAsync(db, id, ct);
        if (app is null) return Problems.NotFound("Leave request not found.");
        if (app.EmployeeId != me.Id) return Problems.Forbidden("You can only cancel your own leave requests.");

        var wasApproved = app.Status == LeaveStatus.Approved;
        if (app.Status == LeaveStatus.Pending) { /* ok */ }
        else if (wasApproved && app.StartDate > clock.Today) { /* ok: cancel before it starts */ }
        else return Problems.Conflict(wasApproved
            ? "Approved leave can only be cancelled before it starts. Contact HR."
            : $"This request is already {app.Status} and cannot be cancelled.");

        var before = Snap(app);
        if (wasApproved && app.LeaveType!.TracksBalance)
        {
            var bal = await leaves.EnsureBalanceAsync(app.EmployeeId, app.LeaveType, app.StartDate.Year, ct);
            bal.Used = Math.Max(0, bal.Used - app.Days);
        }
        app.Status = LeaveStatus.Cancelled;
        var comment = Mappers.Clean(req?.Comment);
        app.Events.Add(new LeaveEvent { Kind = "Cancelled", ActorId = me.Id, Comment = comment });

        foreach (var approver in await ApproversForAsync(db, app.Employee!, ct))
            notes.Notify(approver, "Leave request cancelled",
                $"{app.Employee!.FullName} cancelled {app.LeaveType!.Name} ({Range(app.StartDate, app.EndDate)}).", "/approvals", email: wasApproved);

        audit.Record("leave.cancel", "LeaveApplication", app.Id, before, Snap(app));
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateConcurrencyException) { return Problems.Conflict("This request was just changed by someone else. Refresh and try again."); }
        return Results.Ok(new { id = app.Id, status = app.Status.ToString() });
    }

    // ---------- manager / HR: approve or reject ----------

    private static async Task<IResult> Decide(int id, DecisionRequest req, HrmDbContext db, ICurrentUser me, TeamScope scope, LeaveService leaves,
        NotificationService notes, AuditService audit, CancellationToken ct)
    {
        var app = await LoadAsync(db, id, ct);
        if (app is null) return Problems.NotFound("Leave request not found.");
        if (app.EmployeeId == me.Id) return Problems.Forbidden("You cannot approve or reject your own leave request.");
        if (!await scope.CanSeeAsync(app.EmployeeId, ct)) return Problems.Forbidden("This employee is not in your reporting line.");
        if (app.Status != LeaveStatus.Pending) return Problems.Conflict($"This request is already {app.Status}.");

        var comment = Mappers.Clean(req.Comment);
        if (!req.Approve && comment is null) return new Errors().Add("comment", "Please give a reason when rejecting a request.").ToResult();
        if (comment is { Length: > 1000 }) return new Errors().Add("comment", "Comment must be at most 1000 characters.").ToResult();

        var before = Snap(app);
        if (req.Approve)
        {
            var slot = new LeaveSlotDto(app.LeaveTypeId, app.StartDate, app.EndDate, app.IsHalfDay, app.Reason);
            var check = (await leaves.CheckSlotsAsync(app.EmployeeId, [slot], app.Id, ct, skipBackdateCheck: true))[0];
            if (check.Errors.Count > 0) return Problems.Conflict(string.Join(" ", check.Errors));

            if (app.LeaveType!.TracksBalance)
            {
                var bal = await leaves.EnsureBalanceAsync(app.EmployeeId, app.LeaveType, app.StartDate.Year, ct);
                bal.Used += app.Days;
            }
            app.Status = LeaveStatus.Approved;
        }
        else app.Status = LeaveStatus.Rejected;

        app.DecidedById = me.Id;
        app.DecidedAt = DateTime.UtcNow;
        app.DecisionComment = comment;
        app.Events.Add(new LeaveEvent { Kind = app.Status.ToString(), ActorId = me.Id, Comment = comment });

        var verdict = req.Approve ? "approved" : "rejected";
        notes.Notify(app.Employee!, $"Your leave was {verdict}",
            $"{app.LeaveType!.Name} ({Range(app.StartDate, app.EndDate)}, {app.Days} day(s)) was {verdict}." + (comment is null ? "" : $"\nComment: {comment}"), "/leaves");

        audit.Record(req.Approve ? "leave.approve" : "leave.reject", "LeaveApplication", app.Id, before, Snap(app));
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateConcurrencyException) { return Problems.Conflict("This request was just changed by someone else. Refresh to see the latest state."); }
        return Results.Ok(new { id = app.Id, status = app.Status.ToString() });
    }

    // ---------- HR: edit / remove ----------

    private static async Task<IResult> Edit(int id, EditLeaveRequest req, HrmDbContext db, ICurrentUser me, LeaveService leaves, NotificationService notes, AuditService audit, CancellationToken ct)
    {
        var errors = new Errors().Required(req.ChangeReason, "changeReason", "A reason for the change", 1000).Required(req.Reason, "reason", "Leave reason", 1000);
        if (errors.Any) return errors.ToResult();

        var app = await LoadAsync(db, id, ct);
        if (app is null) return Problems.NotFound("Leave request not found.");
        if (app.Status is LeaveStatus.Rejected or LeaveStatus.Cancelled) return Problems.Conflict($"A {app.Status} request cannot be edited.");

        var newType = await db.LeaveTypes.FirstOrDefaultAsync(t => t.Id == req.LeaveTypeId, ct);
        if (newType is null) return new Errors().Add("leaveTypeId", "Choose a valid leave type.").ToResult();

        var wasApproved = app.Status == LeaveStatus.Approved;
        var slot = new LeaveSlotDto(req.LeaveTypeId, req.StartDate, req.EndDate, req.IsHalfDay, req.Reason);
        var check = (await leaves.CheckSlotsAsync(app.EmployeeId, [slot], app.Id, ct, skipBackdateCheck: true, skipBalanceCheck: wasApproved))[0];
        if (check.Errors.Count > 0)
        {
            var e = new Errors();
            foreach (var m in check.Errors) e.Add("dates", m);
            return e.ToResult();
        }

        var before = Snap(app);

        if (wasApproved)
        {
            // Give back the old usage, then charge the new one against the (possibly different) balance.
            if (app.LeaveType!.TracksBalance)
            {
                var oldBal = await leaves.EnsureBalanceAsync(app.EmployeeId, app.LeaveType, app.StartDate.Year, ct);
                oldBal.Used = Math.Max(0, oldBal.Used - app.Days);
            }
            if (newType.TracksBalance)
            {
                var year = check.StartDate.Year;
                var newBal = await leaves.EnsureBalanceAsync(app.EmployeeId, newType, year, ct);
                var from = new DateOnly(year, 1, 1);
                var to = new DateOnly(year, 12, 31);
                var pending = await db.LeaveApplications
                    .Where(a => a.EmployeeId == app.EmployeeId && a.LeaveTypeId == newType.Id && a.Status == LeaveStatus.Pending && a.StartDate >= from && a.StartDate <= to)
                    .SumAsync(a => a.Days, ct);
                if (newBal.Total - newBal.Used - pending < check.Days)
                    return Problems.Conflict($"Insufficient {newType.Name} balance for this change.");
                newBal.Used += check.Days;
            }
        }

        app.LeaveTypeId = newType.Id;
        app.LeaveType = newType;
        app.StartDate = check.StartDate;
        app.EndDate = check.EndDate;
        app.IsHalfDay = check.IsHalfDay;
        app.Days = check.Days;
        app.Reason = req.Reason!.Trim();
        app.Events.Add(new LeaveEvent { Kind = "Edited", ActorId = me.Id, Comment = req.ChangeReason!.Trim() });

        notes.Notify(app.Employee!, "Your leave was updated by HR",
            $"{newType.Name} is now {Range(app.StartDate, app.EndDate)} ({app.Days} day(s)).\nReason: {req.ChangeReason!.Trim()}", "/leaves");
        audit.Record("leave.edit", "LeaveApplication", app.Id, before, new { Snapshot = Snap(app), ChangeReason = req.ChangeReason!.Trim() });

        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateConcurrencyException) { return Problems.Conflict("This request was just changed by someone else. Refresh and try again."); }

        var row = (await ToRowsAsync(db.LeaveApplications.AsNoTracking().Where(a => a.Id == id), ct)).First();
        return Results.Ok(row);
    }

    /// <summary>Soft-delete: the record stays in the database for reporting and audit, but disappears from all views.</summary>
    private static async Task<IResult> Remove(int id, ReasonRequest req, HrmDbContext db, ICurrentUser me, LeaveService leaves, NotificationService notes, AuditService audit, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Reason)) return new Errors().Add("reason", "A reason is required to delete a leave record.").ToResult();
        var app = await LoadAsync(db, id, ct);
        if (app is null) return Problems.NotFound("Leave request not found.");

        var before = Snap(app);
        if (app.Status == LeaveStatus.Approved && app.LeaveType!.TracksBalance)
        {
            var bal = await leaves.EnsureBalanceAsync(app.EmployeeId, app.LeaveType, app.StartDate.Year, ct);
            bal.Used = Math.Max(0, bal.Used - app.Days);
        }
        app.Events.Add(new LeaveEvent { Kind = "Deleted", ActorId = me.Id, Comment = req.Reason.Trim() });
        app.IsDeleted = true;

        notes.Notify(app.Employee!, "A leave record was removed by HR",
            $"{app.LeaveType!.Name} ({Range(app.StartDate, app.EndDate)}) was removed.\nReason: {req.Reason.Trim()}", "/leaves");
        audit.Record("leave.delete", "LeaveApplication", app.Id, before, new { Reason = req.Reason.Trim() });

        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateConcurrencyException) { return Problems.Conflict("This request was just changed by someone else. Refresh and try again."); }
        return Results.NoContent();
    }
}
