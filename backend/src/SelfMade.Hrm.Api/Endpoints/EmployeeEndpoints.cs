using Microsoft.EntityFrameworkCore;
using SelfMade.Hrm.Api.Contracts;
using SelfMade.Hrm.Api.Data;
using SelfMade.Hrm.Api.Domain;
using SelfMade.Hrm.Api.Infrastructure;

namespace SelfMade.Hrm.Api.Endpoints;

public static class EmployeeEndpoints
{
    public static void MapEmployees(this RouteGroupBuilder api)
    {
        var me = api.MapGroup("/me").WithTags("My profile");
        me.MapGet("", GetMe);
        me.MapPut("", UpdateMe);
        me.MapPost("/avatar", UploadAvatar).DisableAntiforgery();

        api.MapGet("/directory", DirectoryList).WithTags("People");

        var g = api.MapGroup("/employees").WithTags("Employees");
        g.MapGet("", List).RequireAuthorization("Manager");
        g.MapGet("/lookup", Lookup).RequireAuthorization("Hr");
        g.MapGet("/{id:int}", GetOne);
        g.MapPost("", Create).RequireAuthorization("Hr");
        g.MapPut("/{id:int}", Update).RequireAuthorization("Hr");
        g.MapPost("/{id:int}/disable", Disable).RequireAuthorization("Hr");
        g.MapPost("/{id:int}/cancel-disable", CancelScheduledDisable).RequireAuthorization("Hr");
        g.MapPost("/{id:int}/enable", Enable).RequireAuthorization("Hr");
    }

    // ---------- helpers ----------

    private static int Completeness(Employee e)
    {
        var checks = new[]
        {
            e.Phone, e.Gender, e.LocalAddress, e.PermanentAddress, e.EmergencyContactName,
            e.EmergencyContactPhone, e.AvatarFile, e.DateOfBirth?.ToString()
        };
        return (int)Math.Round(checks.Count(c => !string.IsNullOrWhiteSpace(c)) * 100.0 / checks.Length);
    }

    private static EmployeeDetail ToDetail(Employee e, bool sensitive) => new(
        e.Id, e.EmployeeCode, e.FirstName, e.LastName, e.Email, e.Role.ToString(), e.IsActive,
        e.DepartmentId, e.Department?.Name, e.ManagerId, e.Manager?.FullName,
        e.Designation, e.EmploymentType.ToString(), e.Location, e.JoinDate, e.DateOfBirth,
        e.Gender, e.Phone, e.LocalAddress, e.PermanentAddress, e.FatherName,
        e.EmergencyContactName, e.EmergencyContactPhone, e.EmergencyContactRelation,
        sensitive ? e.BankAccountHolder : null, sensitive ? e.BankName : null,
        sensitive ? e.BankAccountNumber : null, sensitive ? e.BankIfsc : null, sensitive ? e.TaxId : null,
        Mappers.AvatarUrl(e.AvatarFile), Completeness(e), sensitive,
        e.ScheduledDisableDate, sensitive ? e.ScheduledDisableReason : null);

    /// <summary>Audit snapshot. Payroll identifiers are masked so the audit log never becomes a leak.</summary>
    private static object Snapshot(Employee e) => new
    {
        e.EmployeeCode, e.FirstName, e.LastName, e.Email, Role = e.Role.ToString(), e.IsActive,
        e.DepartmentId, e.ManagerId, e.Designation, EmploymentType = e.EmploymentType.ToString(), e.Location,
        e.JoinDate, e.DateOfBirth, e.Gender, e.Phone,
        BankDetails = string.IsNullOrEmpty(e.BankAccountNumber) ? null : "***" + e.BankAccountNumber[^Math.Min(4, e.BankAccountNumber.Length)..]
    };

    private static Task<Employee?> LoadAsync(HrmDbContext db, int id, CancellationToken ct) =>
        db.Employees.Include(e => e.Department).Include(e => e.Manager).FirstOrDefaultAsync(e => e.Id == id, ct);

    private static async Task<bool> WouldCreateCycleAsync(HrmDbContext db, int employeeId, int? newManagerId, CancellationToken ct)
    {
        var cur = newManagerId;
        for (var guard = 0; cur is not null && guard < 100; guard++)
        {
            if (cur.Value == employeeId) return true;
            var id = cur.Value;
            cur = await db.Employees.Where(e => e.Id == id).Select(e => e.ManagerId).FirstOrDefaultAsync(ct);
        }
        return false;
    }

    // ---------- self service ----------

    private static async Task<IResult> GetMe(HrmDbContext db, ICurrentUser me, CancellationToken ct)
    {
        var e = await LoadAsync(db, me.Id, ct);
        return e is null ? Problems.NotFound() : Results.Ok(ToDetail(e, true));
    }

    private static async Task<IResult> UpdateMe(UpdateProfileRequest req, HrmDbContext db, ICurrentUser me, AuditService audit, CancellationToken ct)
    {
        var errors = new Errors()
            .Optional(req.Phone, "phone", "Phone", 30)
            .Optional(req.LocalAddress, "localAddress", "Local address", 300)
            .Optional(req.PermanentAddress, "permanentAddress", "Permanent address", 300)
            .Optional(req.EmergencyContactName, "emergencyContactName", "Emergency contact name", 100)
            .Optional(req.EmergencyContactPhone, "emergencyContactPhone", "Emergency contact phone", 30)
            .Optional(req.EmergencyContactRelation, "emergencyContactRelation", "Relation", 50);
        if (errors.Any) return errors.ToResult();

        var e = await LoadAsync(db, me.Id, ct);
        if (e is null) return Problems.NotFound();

        var before = Snapshot(e);
        e.Phone = Mappers.Clean(req.Phone);
        e.LocalAddress = Mappers.Clean(req.LocalAddress);
        e.PermanentAddress = Mappers.Clean(req.PermanentAddress);
        e.EmergencyContactName = Mappers.Clean(req.EmergencyContactName);
        e.EmergencyContactPhone = Mappers.Clean(req.EmergencyContactPhone);
        e.EmergencyContactRelation = Mappers.Clean(req.EmergencyContactRelation);
        audit.Record("profile.self_update", "Employee", e.Id, before, Snapshot(e));
        await db.SaveChangesAsync(ct);
        return Results.Ok(ToDetail(e, true));
    }

    private static bool LooksLikeImage(byte[] h, out string ext)
    {
        ext = "";
        if (h.Length >= 8 && h[0] == 0x89 && h[1] == 0x50 && h[2] == 0x4E && h[3] == 0x47) { ext = ".png"; return true; }
        if (h.Length >= 3 && h[0] == 0xFF && h[1] == 0xD8 && h[2] == 0xFF) { ext = ".jpg"; return true; }
        if (h.Length >= 12 && h[0] == 'R' && h[1] == 'I' && h[2] == 'F' && h[3] == 'F' && h[8] == 'W' && h[9] == 'E' && h[10] == 'B' && h[11] == 'P') { ext = ".webp"; return true; }
        return false;
    }

    private static async Task<IResult> UploadAvatar(IFormFile file, HrmDbContext db, ICurrentUser me, IWebHostEnvironment env, AuditService audit, CancellationToken ct)
    {
        const long maxBytes = 2 * 1024 * 1024;
        if (file is null || file.Length == 0) return new Errors().Add("file", "Choose an image to upload.").ToResult();
        if (file.Length > maxBytes) return new Errors().Add("file", "Image must be 2 MB or smaller.").ToResult();

        var header = new byte[12];
        await using (var s = file.OpenReadStream())
        {
            var read = await s.ReadAsync(header.AsMemory(0, 12), ct);
            if (read < 4) return new Errors().Add("file", "The file is not a valid image.").ToResult();
        }
        // Verify magic bytes rather than trusting the client-supplied content type / extension.
        if (!LooksLikeImage(header, out var ext))
            return new Errors().Add("file", "Only PNG, JPG or WEBP images are allowed.").ToResult();

        var dir = Path.Combine(env.ContentRootPath, "uploads", "avatars");
        Directory.CreateDirectory(dir);
        var name = Guid.NewGuid().ToString("N") + ext;
        await using (var fs = File.Create(Path.Combine(dir, name)))
            await file.CopyToAsync(fs, ct);

        var e = await db.Employees.FirstAsync(x => x.Id == me.Id, ct);
        var old = e.AvatarFile;
        e.AvatarFile = name;
        audit.Record("profile.avatar_changed", "Employee", e.Id);
        await db.SaveChangesAsync(ct);

        if (old is not null)
        {
            try { File.Delete(Path.Combine(dir, Path.GetFileName(old))); } catch { /* best effort */ }
        }
        return Results.Ok(new { avatarUrl = Mappers.AvatarUrl(name) });
    }

    // ---------- directory & management ----------

    private static async Task<IResult> DirectoryList(string? search, int? page, int? pageSize, HrmDbContext db, CancellationToken ct)
    {
        var (p, ps) = Mappers.Paging(page, pageSize);
        var q = db.Employees.AsNoTracking().Where(e => e.IsActive);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim();
            q = q.Where(e => e.FirstName.Contains(s) || e.LastName.Contains(s) || (e.FirstName + " " + e.LastName).Contains(s)
                             || e.EmployeeCode.Contains(s) || (e.Designation != null && e.Designation.Contains(s))
                             || (e.Department != null && e.Department.Name.Contains(s)));
        }
        var total = await q.CountAsync(ct);
        var rows = await q.OrderBy(e => e.FirstName).ThenBy(e => e.LastName).Skip((p - 1) * ps).Take(ps)
            .Select(e => new
            {
                e.Id, e.FirstName, e.LastName, e.Email, e.Phone, e.Designation,
                Department = e.Department != null ? e.Department.Name : null,
                ManagerFirst = e.Manager != null ? e.Manager.FirstName : null,
                ManagerLast = e.Manager != null ? e.Manager.LastName : null,
                e.Location, e.AvatarFile
            }).ToListAsync(ct);

        var items = rows.Select(r => new DirectoryItem(r.Id, (r.FirstName + " " + r.LastName).Trim(), r.Email, r.Phone, r.Designation,
            r.Department, r.ManagerFirst is null ? null : (r.ManagerFirst + " " + r.ManagerLast).Trim(), r.Location, Mappers.AvatarUrl(r.AvatarFile))).ToList();
        return Results.Ok(new PagedResult<DirectoryItem>(items, total, p, ps));
    }

    private static async Task<IResult> List(string? search, int? departmentId, int? managerId, string? status, string? designation,
        int? page, int? pageSize, HrmDbContext db, TeamScope scope, CancellationToken ct)
    {
        var (p, ps) = Mappers.Paging(page, pageSize);
        var ids = await scope.VisibleIdsAsync(ct);
        var q = db.Employees.AsNoTracking().AsQueryable();
        if (ids is not null) q = q.Where(e => ids.Contains(e.Id));
        if (departmentId is not null) q = q.Where(e => e.DepartmentId == departmentId);
        if (managerId is not null) q = q.Where(e => e.ManagerId == managerId);
        if (!string.IsNullOrWhiteSpace(designation)) { var d = designation.Trim(); q = q.Where(e => e.Designation != null && e.Designation.Contains(d)); }
        if (string.Equals(status, "active", StringComparison.OrdinalIgnoreCase)) q = q.Where(e => e.IsActive);
        else if (string.Equals(status, "disabled", StringComparison.OrdinalIgnoreCase)) q = q.Where(e => !e.IsActive);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim();
            q = q.Where(e => e.FirstName.Contains(s) || e.LastName.Contains(s) || e.Email.Contains(s) || e.EmployeeCode.Contains(s)
                             || (e.FirstName + " " + e.LastName).Contains(s));
        }

        var total = await q.CountAsync(ct);
        var rows = await q.OrderBy(e => e.FirstName).ThenBy(e => e.LastName).Skip((p - 1) * ps).Take(ps)
            .Select(e => new
            {
                e.Id, e.EmployeeCode, e.FirstName, e.LastName, e.Email, e.Role, e.Designation,
                e.DepartmentId, Department = e.Department != null ? e.Department.Name : null,
                e.ManagerId, ManagerFirst = e.Manager != null ? e.Manager.FirstName : null, ManagerLast = e.Manager != null ? e.Manager.LastName : null,
                e.EmploymentType, e.Location, e.JoinDate, e.IsActive, e.AvatarFile, e.ScheduledDisableDate
            }).ToListAsync(ct);

        var items = rows.Select(r => new EmployeeListItem(r.Id, r.EmployeeCode, (r.FirstName + " " + r.LastName).Trim(), r.Email,
            r.Role.ToString(), r.Designation, r.DepartmentId, r.Department, r.ManagerId,
            r.ManagerFirst is null ? null : (r.ManagerFirst + " " + r.ManagerLast).Trim(),
            r.EmploymentType.ToString(), r.Location, r.JoinDate, r.IsActive, Mappers.AvatarUrl(r.AvatarFile), r.ScheduledDisableDate)).ToList();
        return Results.Ok(new PagedResult<EmployeeListItem>(items, total, p, ps));
    }

    private static async Task<IResult> Lookup(string? q, HrmDbContext db, CancellationToken ct)
    {
        var query = db.Employees.AsNoTracking().Where(e => e.IsActive);
        if (!string.IsNullOrWhiteSpace(q)) { var s = q.Trim(); query = query.Where(e => (e.FirstName + " " + e.LastName).Contains(s)); }
        var rows = await query.OrderBy(e => e.FirstName).Take(100)
            .Select(e => new { e.Id, e.FirstName, e.LastName, e.Designation }).ToListAsync(ct);
        return Results.Ok(rows.Select(r => new { r.Id, Name = (r.FirstName + " " + r.LastName).Trim(), r.Designation }));
    }

    private static async Task<IResult> GetOne(int id, HrmDbContext db, ICurrentUser me, TeamScope scope, CancellationToken ct)
    {
        if (id != me.Id && !await scope.CanSeeAsync(id, ct)) return Problems.Forbidden();
        var e = await LoadAsync(db, id, ct);
        if (e is null) return Problems.NotFound("Employee not found.");
        return Results.Ok(ToDetail(e, id == me.Id || me.IsHr));
    }

    // ---------- create / update ----------

    private static Errors ValidateUpsert(EmployeeUpsertRequest r, bool isCreate)
    {
        var e = new Errors()
            .Required(r.FirstName, "firstName", "First name", 100)
            .Required(r.LastName, "lastName", "Last name", 100)
            .Required(r.Email, "email", "Email", 200)
            .Optional(r.Designation, "designation", "Designation", 100)
            .Optional(r.Location, "location", "Location", 100)
            .Optional(r.Phone, "phone", "Phone", 30)
            .Optional(r.LocalAddress, "localAddress", "Local address", 300)
            .Optional(r.PermanentAddress, "permanentAddress", "Permanent address", 300)
            .Optional(r.BankAccountNumber, "bankAccountNumber", "Account number", 40)
            .Optional(r.BankIfsc, "bankIfsc", "IFSC", 20)
            .Optional(r.TaxId, "taxId", "Tax ID", 30);

        if (!string.IsNullOrWhiteSpace(r.Email))
        {
            var mail = r.Email.Trim();
            var at = mail.IndexOf('@');
            if (at < 1 || at == mail.Length - 1 || mail.Contains(' ') || !mail[(at + 1)..].Contains('.'))
                e.Add("email", "Enter a valid email address.");
        }
        if (r.JoinDate is null) e.Add("joinDate", "Joining date is required.");
        else if (r.JoinDate > DateOnly.FromDateTime(DateTime.UtcNow.AddYears(1))) e.Add("joinDate", "Joining date is too far in the future.");
        if (r.DateOfBirth is { } dob && (dob > DateOnly.FromDateTime(DateTime.UtcNow.AddYears(-16)) || dob.Year < 1930))
            e.Add("dateOfBirth", "Enter a valid date of birth.");
        if (!string.IsNullOrWhiteSpace(r.Role) && !Enum.TryParse<Role>(r.Role, true, out _)) e.Add("role", "Unknown role.");
        if (!string.IsNullOrWhiteSpace(r.EmploymentType) && !Enum.TryParse<EmploymentType>(r.EmploymentType, true, out _)) e.Add("employmentType", "Unknown employment type.");
        return e;
    }

    private static async Task<Errors> CheckReferencesAsync(HrmDbContext db, EmployeeUpsertRequest r, int? selfId, CancellationToken ct)
    {
        var e = new Errors();
        var email = r.Email!.Trim().ToLowerInvariant();
        if (await db.Employees.AnyAsync(x => x.Email == email && x.Id != selfId, ct)) e.Add("email", "Another employee already uses this email.");
        if (!string.IsNullOrWhiteSpace(r.EmployeeCode))
        {
            var code = r.EmployeeCode.Trim();
            if (await db.Employees.AnyAsync(x => x.EmployeeCode == code && x.Id != selfId, ct)) e.Add("employeeCode", "This employee ID is already in use.");
        }
        if (r.DepartmentId is not null && !await db.Departments.AnyAsync(d => d.Id == r.DepartmentId && d.IsActive, ct))
            e.Add("departmentId", "Choose an active department.");
        if (r.ManagerId is not null)
        {
            if (!await db.Employees.AnyAsync(m => m.Id == r.ManagerId && m.IsActive, ct)) e.Add("managerId", "Choose an active manager.");
            else if (selfId is not null && await WouldCreateCycleAsync(db, selfId.Value, r.ManagerId, ct))
                e.Add("managerId", "That would create a circular reporting line.");
        }
        return e;
    }

    private static void Apply(Employee e, EmployeeUpsertRequest r)
    {
        e.FirstName = r.FirstName!.Trim();
        e.LastName = r.LastName!.Trim();
        e.Email = r.Email!.Trim().ToLowerInvariant();
        e.DepartmentId = r.DepartmentId;
        e.ManagerId = r.ManagerId;
        e.Designation = Mappers.Clean(r.Designation);
        e.EmploymentType = Enum.TryParse<EmploymentType>(r.EmploymentType, true, out var et) ? et : EmploymentType.FullTime;
        e.Location = Mappers.Clean(r.Location);
        e.JoinDate = r.JoinDate!.Value;
        e.DateOfBirth = r.DateOfBirth;
        e.Gender = Mappers.Clean(r.Gender);
        e.Phone = Mappers.Clean(r.Phone);
        e.LocalAddress = Mappers.Clean(r.LocalAddress);
        e.PermanentAddress = Mappers.Clean(r.PermanentAddress);
        e.FatherName = Mappers.Clean(r.FatherName);
        e.EmergencyContactName = Mappers.Clean(r.EmergencyContactName);
        e.EmergencyContactPhone = Mappers.Clean(r.EmergencyContactPhone);
        e.EmergencyContactRelation = Mappers.Clean(r.EmergencyContactRelation);
        e.BankAccountHolder = Mappers.Clean(r.BankAccountHolder);
        e.BankName = Mappers.Clean(r.BankName);
        e.BankAccountNumber = Mappers.Clean(r.BankAccountNumber);
        e.BankIfsc = Mappers.Clean(r.BankIfsc);
        e.TaxId = Mappers.Clean(r.TaxId);
    }

    private static Role ParseRole(string? s) => Enum.TryParse<Role>(s, true, out var r) ? r : Role.Employee;

    private static async Task<IResult> Create(EmployeeUpsertRequest req, HrmDbContext db, ICurrentUser me, AuditService audit, NotificationService notes, CancellationToken ct)
    {
        var errors = ValidateUpsert(req, true);
        if (errors.Any) return errors.ToResult();
        var refs = await CheckReferencesAsync(db, req, null, ct);
        if (refs.Any) return refs.ToResult();

        var role = ParseRole(req.Role);
        if (role >= Role.HrAdmin && me.Role != Role.SuperAdmin) return Problems.Forbidden("Only a Super Admin can create HR or Super Admin accounts.");

        var code = Mappers.Clean(req.EmployeeCode);
        if (code is null)
        {
            var next = (await db.Employees.MaxAsync(x => (int?)x.Id, ct) ?? 0) + 1;
            code = $"EMP{next:D4}";
            while (await db.Employees.AnyAsync(x => x.EmployeeCode == code, ct)) code = $"EMP{++next:D4}";
        }

        var e = new Employee { EmployeeCode = code, Role = role, IsActive = true, CreatedAt = DateTime.UtcNow };
        Apply(e, req);
        // Nobody knows this random password; the employee sets their own through the invitation link.
        e.PasswordHash = Passwords.Hash(Tokens.NewOpaque());
        db.Employees.Add(e);
        await db.SaveChangesAsync(ct); // need the Id for the invitation token

        var link = await AuthEndpoints.CreateResetLinkAsync(db, e, TimeSpan.FromDays(3));
        notes.Email(e.Email, "Welcome to SelfMade HRM",
            $"Hi {e.FirstName}, your SelfMade HRM account has been created. Use the button below to set your password (valid for 3 days).", link);
        audit.Record("employee.create", "Employee", e.Id, null, Snapshot(e));
        await db.SaveChangesAsync(ct);

        var created = await LoadAsync(db, e.Id, ct);
        return Results.Created($"/api/v1/employees/{e.Id}", ToDetail(created!, true));
    }

    private static async Task<IResult> Update(int id, EmployeeUpsertRequest req, HrmDbContext db, ICurrentUser me, AuditService audit, CancellationToken ct)
    {
        var errors = ValidateUpsert(req, false);
        if (errors.Any) return errors.ToResult();
        var refs = await CheckReferencesAsync(db, req, id, ct);
        if (refs.Any) return refs.ToResult();

        var e = await LoadAsync(db, id, ct);
        if (e is null) return Problems.NotFound("Employee not found.");
        if (e.Role == Role.SuperAdmin && me.Role != Role.SuperAdmin) return Problems.Forbidden("Only a Super Admin can edit a Super Admin.");

        var newRole = string.IsNullOrWhiteSpace(req.Role) ? e.Role : ParseRole(req.Role);
        if (newRole != e.Role && (newRole >= Role.HrAdmin || e.Role >= Role.HrAdmin) && me.Role != Role.SuperAdmin)
            return Problems.Forbidden("Only a Super Admin can grant or remove HR / Super Admin access.");
        if (id == me.Id && newRole != e.Role) return Problems.Forbidden("You cannot change your own role.");

        var before = Snapshot(e);
        Apply(e, req);
        e.Role = newRole;
        if (!string.IsNullOrWhiteSpace(req.EmployeeCode)) e.EmployeeCode = req.EmployeeCode.Trim();

        audit.Record("employee.update", "Employee", e.Id, before, Snapshot(e));
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateConcurrencyException) { return Problems.Conflict("This employee was changed by someone else. Reload and try again."); }

        var fresh = await LoadAsync(db, id, ct);
        return Results.Ok(ToDetail(fresh!, true));
    }

    /// <summary>
    /// Disables an employee. If <see cref="DisableRequest.EffectiveDate"/> is a future date (org time zone),
    /// the account stays active and is instead scheduled for the daily job to disable on that date - access
    /// is not blocked immediately. Leaving it empty or today (or earlier) disables right away, as before.
    /// </summary>
    private static async Task<IResult> Disable(int id, DisableRequest req, HrmDbContext db, ICurrentUser me, AuditService audit, OrgClock clock, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Reason)) return new Errors().Add("reason", "A reason is required to disable an employee.").ToResult();
        if (id == me.Id) return Problems.Forbidden("You cannot disable your own account.");
        var e = await LoadAsync(db, id, ct);
        if (e is null) return Problems.NotFound("Employee not found.");
        if (e.Role == Role.SuperAdmin && me.Role != Role.SuperAdmin) return Problems.Forbidden("Only a Super Admin can disable a Super Admin.");
        if (!e.IsActive) return Problems.Conflict("This employee is already disabled.");

        var before = Snapshot(e);
        var reason = req.Reason.Trim();

        if (req.EffectiveDate is { } eff && eff > clock.Today)
        {
            e.ScheduledDisableDate = eff;
            e.ScheduledDisableReason = reason;
            audit.Record("employee.disable.scheduled", "Employee", e.Id, before, new { ScheduledDisableDate = eff, Reason = reason });
            await db.SaveChangesAsync(ct);
            return Results.Ok(ToDetail(e, true));
        }

        e.IsActive = false;
        e.DisabledAt = DateTime.UtcNow;
        e.DisabledReason = reason;
        e.ScheduledDisableDate = null;
        e.ScheduledDisableReason = null;
        var tokens = await db.RefreshTokens.Where(t => t.EmployeeId == id && t.RevokedAt == null).ToListAsync(ct);
        foreach (var t in tokens) t.RevokedAt = DateTime.UtcNow; // access is blocked immediately at next refresh / request
        audit.Record("employee.disable", "Employee", e.Id, before, new { IsActive = false, Reason = e.DisabledReason });
        await db.SaveChangesAsync(ct);
        return Results.Ok(ToDetail(e, true));
    }

    /// <summary>Cancels a pending scheduled disable (set via <see cref="Disable"/> with a future effective date) without touching current access.</summary>
    private static async Task<IResult> CancelScheduledDisable(int id, HrmDbContext db, AuditService audit, CancellationToken ct)
    {
        var e = await LoadAsync(db, id, ct);
        if (e is null) return Problems.NotFound("Employee not found.");
        if (e.ScheduledDisableDate is null) return Problems.Conflict("This employee does not have a scheduled disable.");

        var before = Snapshot(e);
        e.ScheduledDisableDate = null;
        e.ScheduledDisableReason = null;
        audit.Record("employee.disable.cancel_scheduled", "Employee", e.Id, before, Snapshot(e));
        await db.SaveChangesAsync(ct);
        return Results.Ok(ToDetail(e, true));
    }

    private static async Task<IResult> Enable(int id, HrmDbContext db, AuditService audit, CancellationToken ct)
    {
        var e = await LoadAsync(db, id, ct);
        if (e is null) return Problems.NotFound("Employee not found.");
        if (e.IsActive) return Problems.Conflict("This employee is already active.");
        e.IsActive = true;
        e.DisabledAt = null;
        e.DisabledReason = null;
        e.ScheduledDisableDate = null;
        e.ScheduledDisableReason = null;
        audit.Record("employee.enable", "Employee", e.Id);
        await db.SaveChangesAsync(ct);
        return Results.Ok(ToDetail(e, true));
    }
}
