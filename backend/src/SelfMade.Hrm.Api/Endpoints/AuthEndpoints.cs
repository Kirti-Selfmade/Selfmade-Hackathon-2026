using Microsoft.EntityFrameworkCore;
using SelfMade.Hrm.Api.Contracts;
using SelfMade.Hrm.Api.Data;
using SelfMade.Hrm.Api.Domain;
using SelfMade.Hrm.Api.Infrastructure;

namespace SelfMade.Hrm.Api.Endpoints;

public static class AuthEndpoints
{
    private const int MaxFailedLogins = 5;
    private static readonly TimeSpan LockoutFor = TimeSpan.FromMinutes(15);

    public static void MapAuth(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/auth").WithTags("Auth");
        g.MapPost("/login", Login).AllowAnonymous().RequireRateLimiting("auth");
        g.MapPost("/refresh", Refresh).AllowAnonymous().RequireRateLimiting("auth");
        g.MapPost("/logout", Logout).AllowAnonymous();
        g.MapPost("/logout-all", LogoutAll);
        g.MapPost("/forgot-password", Forgot).AllowAnonymous().RequireRateLimiting("auth");
        g.MapPost("/reset-password", Reset).AllowAnonymous().RequireRateLimiting("auth");
        g.MapPost("/change-password", ChangePassword);
    }

    private static IResult Unauthorized(string detail = "Invalid email or password.") =>
        Results.Problem(title: "Unauthorized", detail: detail, statusCode: 401);

    private static async Task<IResult> Login(LoginRequest req, HrmDbContext db, TokenService tokens, AuditService audit, CancellationToken ct)
    {
        var email = (req.Email ?? "").Trim().ToLowerInvariant();
        if (email.Length == 0 || string.IsNullOrEmpty(req.Password))
            return new Errors().Add("email", "Email and password are required.").ToResult();

        var emp = await db.Employees.Include(e => e.Department).FirstOrDefaultAsync(e => e.Email == email, ct);

        if (emp is null || !emp.IsActive)
        {
            Passwords.Verify(req.Password, null); // equalise timing
            audit.Record("auth.login.failed", "Auth", email);
            await db.SaveChangesAsync(ct);
            return Unauthorized();
        }

        if (emp.LockoutUntil is { } until && until > DateTime.UtcNow)
            return Results.Problem(title: "Account locked", statusCode: 429,
                detail: "Too many failed sign-in attempts. Please try again in a few minutes.");

        if (!Passwords.Verify(req.Password, emp.PasswordHash))
        {
            emp.FailedLoginCount++;
            if (emp.FailedLoginCount >= MaxFailedLogins)
            {
                emp.LockoutUntil = DateTime.UtcNow.Add(LockoutFor);
                emp.FailedLoginCount = 0;
                audit.Record("auth.lockout", "Employee", emp.Id, actorId: emp.Id);
            }
            audit.Record("auth.login.failed", "Employee", emp.Id, actorId: emp.Id);
            await db.SaveChangesAsync(ct);
            return Unauthorized();
        }

        emp.FailedLoginCount = 0;
        emp.LockoutUntil = null;
        var pair = tokens.Issue(emp);
        audit.Record("auth.login", "Employee", emp.Id, actorId: emp.Id);
        await db.SaveChangesAsync(ct);
        return Results.Ok(new AuthResponse(pair.AccessToken, pair.RefreshToken, pair.ExpiresInSeconds, Mappers.ToUser(emp)));
    }

    private static async Task<IResult> Refresh(RefreshRequest req, HrmDbContext db, TokenService tokens, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(req.RefreshToken)) return Unauthorized("Session expired. Please sign in again.");
        var hash = Tokens.Hash(req.RefreshToken);
        var rt = await db.RefreshTokens
            .Include(r => r.Employee).ThenInclude(e => e!.Department)
            .FirstOrDefaultAsync(r => r.TokenHash == hash, ct);

        if (rt is null || rt.RevokedAt is not null || rt.ExpiresAt < DateTime.UtcNow || rt.Employee is null || !rt.Employee.IsActive)
            return Unauthorized("Session expired. Please sign in again.");

        rt.RevokedAt = DateTime.UtcNow; // rotate
        var pair = tokens.Issue(rt.Employee);
        await db.SaveChangesAsync(ct);
        return Results.Ok(new AuthResponse(pair.AccessToken, pair.RefreshToken, pair.ExpiresInSeconds, Mappers.ToUser(rt.Employee)));
    }

    private static async Task<IResult> Logout(RefreshRequest req, HrmDbContext db, CancellationToken ct)
    {
        if (!string.IsNullOrEmpty(req.RefreshToken))
        {
            var hash = Tokens.Hash(req.RefreshToken);
            var rt = await db.RefreshTokens.FirstOrDefaultAsync(r => r.TokenHash == hash && r.RevokedAt == null, ct);
            if (rt is not null)
            {
                rt.RevokedAt = DateTime.UtcNow;
                await db.SaveChangesAsync(ct);
            }
        }
        return Results.NoContent();
    }

    private static async Task<IResult> LogoutAll(HrmDbContext db, ICurrentUser me, AuditService audit, CancellationToken ct)
    {
        await RevokeAllAsync(db, me.Id, ct);
        audit.Record("auth.logout_all", "Employee", me.Id);
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    private static async Task RevokeAllAsync(HrmDbContext db, int employeeId, CancellationToken ct)
    {
        var active = await db.RefreshTokens.Where(r => r.EmployeeId == employeeId && r.RevokedAt == null).ToListAsync(ct);
        foreach (var t in active) t.RevokedAt = DateTime.UtcNow;
    }

    private static async Task<IResult> Forgot(ForgotPasswordRequest req, HrmDbContext db, NotificationService notes, AuditService audit, IConfiguration cfg, CancellationToken ct)
    {
        var email = (req.Email ?? "").Trim().ToLowerInvariant();
        var emp = email.Length == 0 ? null : await db.Employees.FirstOrDefaultAsync(e => e.Email == email && e.IsActive, ct);
        if (emp is not null)
        {
            var link = await CreateResetLinkAsync(db, emp, TimeSpan.FromMinutes(30));
            notes.Email(emp.Email, "Reset your SelfMade HRM password",
                "We received a request to reset your password. This link expires in 30 minutes. If you did not request it, you can ignore this message.", link);
            audit.Record("auth.password.reset_requested", "Employee", emp.Id, actorId: emp.Id);
            await db.SaveChangesAsync(ct);
        }
        // Same response whether or not the account exists (no account enumeration).
        return Results.Ok(new { message = "If an account exists for that email, a reset link has been sent." });
    }

    /// <summary>Adds a reset token to the context and returns the relative front-end link. Caller saves.</summary>
    public static Task<string> CreateResetLinkAsync(HrmDbContext db, Employee emp, TimeSpan validFor)
    {
        var raw = Tokens.NewOpaque();
        db.PasswordResetTokens.Add(new PasswordResetToken
        {
            EmployeeId = emp.Id,
            TokenHash = Tokens.Hash(raw),
            ExpiresAt = DateTime.UtcNow.Add(validFor)
        });
        return Task.FromResult($"/reset-password?token={Uri.EscapeDataString(raw)}&email={Uri.EscapeDataString(emp.Email)}");
    }

    private static async Task<IResult> Reset(ResetPasswordRequest req, HrmDbContext db, AuditService audit, CancellationToken ct)
    {
        var problem = Passwords.Validate(req.NewPassword);
        if (problem is not null) return new Errors().Add("newPassword", problem).ToResult();

        var email = (req.Email ?? "").Trim().ToLowerInvariant();
        var hash = Tokens.Hash(req.Token ?? "");
        var token = await db.PasswordResetTokens.Include(t => t.Employee)
            .FirstOrDefaultAsync(t => t.TokenHash == hash && t.UsedAt == null && t.ExpiresAt > DateTime.UtcNow, ct);

        if (token?.Employee is null || token.Employee.Email != email || !token.Employee.IsActive)
            return Problems.Bad("This reset link is invalid or has expired. Please request a new one.");

        token.UsedAt = DateTime.UtcNow;
        token.Employee.PasswordHash = Passwords.Hash(req.NewPassword!);
        token.Employee.MustChangePassword = false;
        token.Employee.FailedLoginCount = 0;
        token.Employee.LockoutUntil = null;
        await RevokeAllAsync(db, token.EmployeeId, ct);
        audit.Record("auth.password.reset", "Employee", token.EmployeeId, actorId: token.EmployeeId);
        await db.SaveChangesAsync(ct);
        return Results.Ok(new { message = "Password updated. You can now sign in." });
    }

    private static async Task<IResult> ChangePassword(ChangePasswordRequest req, HrmDbContext db, ICurrentUser me, AuditService audit, CancellationToken ct)
    {
        var errors = new Errors();
        if (string.IsNullOrEmpty(req.CurrentPassword)) errors.Add("currentPassword", "Current password is required.");
        var problem = Passwords.Validate(req.NewPassword);
        if (problem is not null) errors.Add("newPassword", problem);
        if (errors.Any) return errors.ToResult();

        var emp = await db.Employees.FirstAsync(e => e.Id == me.Id, ct);
        if (!Passwords.Verify(req.CurrentPassword!, emp.PasswordHash))
            return new Errors().Add("currentPassword", "Current password is incorrect.").ToResult();
        if (req.CurrentPassword == req.NewPassword)
            return new Errors().Add("newPassword", "New password must be different from the current one.").ToResult();

        emp.PasswordHash = Passwords.Hash(req.NewPassword!);
        emp.MustChangePassword = false;
        audit.Record("auth.password.changed", "Employee", emp.Id);
        await db.SaveChangesAsync(ct);
        return Results.Ok(new { message = "Password changed." });
    }
}
