using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using SelfMade.Hrm.Api.Contracts;
using SelfMade.Hrm.Api.Data;
using SelfMade.Hrm.Api.Domain;
using SelfMade.Hrm.Api.Infrastructure;

namespace SelfMade.Hrm.Api.Endpoints;

/// <summary>Master data: departments, leave types, holidays / office-off days.</summary>
public static partial class OrgEndpoints
{
    [GeneratedRegex("^#[0-9A-Fa-f]{6}$")]
    private static partial Regex HexColor();

    public static void MapOrg(this RouteGroupBuilder api)
    {
        var d = api.MapGroup("/departments").WithTags("Departments");
        d.MapGet("", ListDepartments);
        d.MapPost("", CreateDepartment).RequireAuthorization("Hr");
        d.MapPut("/{id:int}", UpdateDepartment).RequireAuthorization("Hr");
        d.MapDelete("/{id:int}", ArchiveDepartment).RequireAuthorization("Hr");

        var t = api.MapGroup("/leave-types").WithTags("Leave types");
        t.MapGet("", ListLeaveTypes);
        t.MapPost("", CreateLeaveType).RequireAuthorization("Hr");
        t.MapPut("/{id:int}", UpdateLeaveType).RequireAuthorization("Hr");

        var h = api.MapGroup("/holidays").WithTags("Holidays");
        h.MapGet("", ListHolidays);
        h.MapPost("", CreateHoliday).RequireAuthorization("Hr");
        h.MapPut("/{id:int}", UpdateHoliday).RequireAuthorization("Hr");
        h.MapDelete("/{id:int}", DeleteHoliday).RequireAuthorization("Hr");
    }

    // ---------- departments ----------

    private static async Task<IResult> ListDepartments(bool? includeInactive, HrmDbContext db, CancellationToken ct)
    {
        var q = db.Departments.AsNoTracking().AsQueryable();
        if (includeInactive != true) q = q.Where(x => x.IsActive);
        var rows = await q.OrderBy(x => x.Name)
            .Select(x => new DepartmentDto(x.Id, x.Name, x.Description, x.IsActive,
                db.Employees.Count(e => e.DepartmentId == x.Id && e.IsActive)))
            .ToListAsync(ct);
        return Results.Ok(rows);
    }

    private static async Task<IResult> CreateDepartment(DepartmentRequest req, HrmDbContext db, AuditService audit, CancellationToken ct)
    {
        var errors = new Errors().Required(req.Name, "name", "Name", 100).Optional(req.Description, "description", "Description", 500);
        if (errors.Any) return errors.ToResult();
        var name = req.Name!.Trim();
        if (await db.Departments.AnyAsync(x => x.Name == name, ct)) return new Errors().Add("name", "A department with this name already exists.").ToResult();

        var dep = new Department { Name = name, Description = Mappers.Clean(req.Description), IsActive = true };
        db.Departments.Add(dep);
        await db.SaveChangesAsync(ct);
        audit.Record("department.create", "Department", dep.Id, null, new { dep.Name, dep.Description });
        await db.SaveChangesAsync(ct);
        return Results.Created($"/api/v1/departments/{dep.Id}", new DepartmentDto(dep.Id, dep.Name, dep.Description, dep.IsActive, 0));
    }

    private static async Task<IResult> UpdateDepartment(int id, DepartmentRequest req, HrmDbContext db, AuditService audit, CancellationToken ct)
    {
        var errors = new Errors().Required(req.Name, "name", "Name", 100).Optional(req.Description, "description", "Description", 500);
        if (errors.Any) return errors.ToResult();
        var dep = await db.Departments.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (dep is null) return Problems.NotFound("Department not found.");
        var name = req.Name!.Trim();
        if (await db.Departments.AnyAsync(x => x.Name == name && x.Id != id, ct)) return new Errors().Add("name", "A department with this name already exists.").ToResult();

        var before = new { dep.Name, dep.Description, dep.IsActive };
        dep.Name = name;
        dep.Description = Mappers.Clean(req.Description);
        if (req.IsActive is bool active) dep.IsActive = active;
        audit.Record("department.update", "Department", dep.Id, before, new { dep.Name, dep.Description, dep.IsActive });
        await db.SaveChangesAsync(ct);
        var count = await db.Employees.CountAsync(e => e.DepartmentId == id && e.IsActive, ct);
        return Results.Ok(new DepartmentDto(dep.Id, dep.Name, dep.Description, dep.IsActive, count));
    }

    /// <summary>"Remove" archives the department so historical employee and leave data stays intact.</summary>
    private static async Task<IResult> ArchiveDepartment(int id, HrmDbContext db, AuditService audit, CancellationToken ct)
    {
        var dep = await db.Departments.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (dep is null) return Problems.NotFound("Department not found.");
        var count = await db.Employees.CountAsync(e => e.DepartmentId == id && e.IsActive, ct);
        if (count > 0) return Problems.Conflict($"{count} active employee(s) still belong to this department. Move them first.");
        dep.IsActive = false;
        audit.Record("department.archive", "Department", dep.Id);
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    // ---------- leave types ----------

    private static LeaveTypeDto ToDto(LeaveType t) =>
        new(t.Id, t.Name, t.Code, t.Color, t.DefaultAnnualDays, t.TracksBalance, t.AllowHalfDay, t.IsPaid, t.IsActive);

    private static async Task<IResult> ListLeaveTypes(bool? includeInactive, HrmDbContext db, CancellationToken ct)
    {
        var q = db.LeaveTypes.AsNoTracking().AsQueryable();
        if (includeInactive != true) q = q.Where(x => x.IsActive);
        var rows = await q.OrderBy(x => x.Id).ToListAsync(ct);
        return Results.Ok(rows.Select(x => ToDto(x)));
    }

    private static Errors ValidateLeaveType(LeaveTypeRequest r)
    {
        var e = new Errors().Required(r.Name, "name", "Name", 60).Required(r.Code, "code", "Code", 10);
        if (!string.IsNullOrWhiteSpace(r.Color) && !HexColor().IsMatch(r.Color.Trim())) e.Add("color", "Use a hex colour such as #0EA5A4.");
        if (r.DefaultAnnualDays is < 0 or > 365) e.Add("defaultAnnualDays", "Annual days must be between 0 and 365.");
        return e;
    }

    private static async Task<IResult> CreateLeaveType(LeaveTypeRequest req, HrmDbContext db, AuditService audit, CancellationToken ct)
    {
        var errors = ValidateLeaveType(req);
        if (errors.Any) return errors.ToResult();
        var code = req.Code!.Trim().ToUpperInvariant();
        var name = req.Name!.Trim();
        if (await db.LeaveTypes.AnyAsync(x => x.Code == code || x.Name == name, ct)) return new Errors().Add("code", "A leave type with this name or code already exists.").ToResult();

        var t = new LeaveType
        {
            Name = name, Code = code, Color = Mappers.Clean(req.Color) ?? "#0EA5A4",
            DefaultAnnualDays = req.DefaultAnnualDays ?? 0, TracksBalance = req.TracksBalance ?? true,
            AllowHalfDay = req.AllowHalfDay ?? true, IsPaid = req.IsPaid ?? true, IsActive = true
        };
        db.LeaveTypes.Add(t);
        await db.SaveChangesAsync(ct);
        audit.Record("leavetype.create", "LeaveType", t.Id, null, ToDto(t));
        await db.SaveChangesAsync(ct);
        return Results.Created($"/api/v1/leave-types/{t.Id}", ToDto(t));
    }

    private static async Task<IResult> UpdateLeaveType(int id, LeaveTypeRequest req, HrmDbContext db, AuditService audit, CancellationToken ct)
    {
        var errors = ValidateLeaveType(req);
        if (errors.Any) return errors.ToResult();
        var t = await db.LeaveTypes.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (t is null) return Problems.NotFound("Leave type not found.");
        var code = req.Code!.Trim().ToUpperInvariant();
        var name = req.Name!.Trim();
        if (await db.LeaveTypes.AnyAsync(x => (x.Code == code || x.Name == name) && x.Id != id, ct)) return new Errors().Add("code", "A leave type with this name or code already exists.").ToResult();

        var before = ToDto(t);
        t.Name = name; t.Code = code;
        if (!string.IsNullOrWhiteSpace(req.Color)) t.Color = req.Color.Trim();
        if (req.DefaultAnnualDays is decimal d) t.DefaultAnnualDays = d;
        if (req.TracksBalance is bool tb) t.TracksBalance = tb;
        if (req.AllowHalfDay is bool hd) t.AllowHalfDay = hd;
        if (req.IsPaid is bool ip) t.IsPaid = ip;
        if (req.IsActive is bool ia) t.IsActive = ia;
        audit.Record("leavetype.update", "LeaveType", t.Id, before, ToDto(t));
        await db.SaveChangesAsync(ct);
        return Results.Ok(ToDto(t));
    }

    // ---------- holidays / office-off ----------

    private static HolidayDto ToDto(Holiday h) => new(h.Id, h.Name, h.Date, h.Kind.ToString());

    private static async Task<IResult> ListHolidays(int? year, HrmDbContext db, OrgClock clock, CancellationToken ct)
    {
        var y = year ?? clock.Today.Year;
        var from = new DateOnly(y, 1, 1);
        var to = new DateOnly(y, 12, 31);
        var rows = await db.Holidays.AsNoTracking().Where(h => h.Date >= from && h.Date <= to).OrderBy(h => h.Date).ToListAsync(ct);
        return Results.Ok(rows.Select(x => ToDto(x)));
    }

    private static Errors ValidateHoliday(HolidayRequest r)
    {
        var e = new Errors().Required(r.Name, "name", "Name", 150);
        if (r.Date is null) e.Add("date", "Date is required.");
        if (!string.IsNullOrWhiteSpace(r.Kind) && !Enum.TryParse<HolidayKind>(r.Kind, true, out _)) e.Add("kind", "Unknown holiday kind.");
        return e;
    }

    private static async Task<IResult> CreateHoliday(HolidayRequest req, HrmDbContext db, AuditService audit, CancellationToken ct)
    {
        var errors = ValidateHoliday(req);
        if (errors.Any) return errors.ToResult();
        if (await db.Holidays.AnyAsync(h => h.Date == req.Date, ct)) return new Errors().Add("date", "A holiday / office-off day already exists on this date.").ToResult();

        var h = new Holiday { Name = req.Name!.Trim(), Date = req.Date!.Value, Kind = Enum.TryParse<HolidayKind>(req.Kind, true, out var k) ? k : HolidayKind.Holiday };
        db.Holidays.Add(h);
        await db.SaveChangesAsync(ct);
        audit.Record("holiday.create", "Holiday", h.Id, null, ToDto(h));
        await db.SaveChangesAsync(ct);
        return Results.Created($"/api/v1/holidays/{h.Id}", ToDto(h));
    }

    private static async Task<IResult> UpdateHoliday(int id, HolidayRequest req, HrmDbContext db, AuditService audit, CancellationToken ct)
    {
        var errors = ValidateHoliday(req);
        if (errors.Any) return errors.ToResult();
        var h = await db.Holidays.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (h is null) return Problems.NotFound("Holiday not found.");
        if (await db.Holidays.AnyAsync(x => x.Date == req.Date && x.Id != id, ct)) return new Errors().Add("date", "A holiday / office-off day already exists on this date.").ToResult();

        var before = ToDto(h);
        h.Name = req.Name!.Trim();
        h.Date = req.Date!.Value;
        if (Enum.TryParse<HolidayKind>(req.Kind, true, out var k)) h.Kind = k;
        audit.Record("holiday.update", "Holiday", h.Id, before, ToDto(h));
        await db.SaveChangesAsync(ct);
        return Results.Ok(ToDto(h));
    }

    private static async Task<IResult> DeleteHoliday(int id, HrmDbContext db, AuditService audit, CancellationToken ct)
    {
        var h = await db.Holidays.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (h is null) return Problems.NotFound("Holiday not found.");
        audit.Record("holiday.delete", "Holiday", h.Id, ToDto(h));
        db.Holidays.Remove(h);
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }
}
