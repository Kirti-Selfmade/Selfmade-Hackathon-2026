using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using SelfMade.Hrm.Api.Data;
using SelfMade.Hrm.Api.Domain;

namespace SelfMade.Hrm.Api.Infrastructure;

public interface ICurrentUser
{
    int Id { get; }
    Role Role { get; }
    bool IsAuthenticated { get; }
    bool IsHr { get; }
    bool IsManagerOrAbove { get; }
    string? Ip { get; }
}

public class CurrentUser(IHttpContextAccessor accessor) : ICurrentUser
{
    private ClaimsPrincipal? Principal => accessor.HttpContext?.User;

    public int Id => int.TryParse(Principal?.FindFirstValue("sub"), out var id) ? id : 0;
    public bool IsAuthenticated => Id != 0;
    public Role Role => Enum.TryParse<Role>(Principal?.FindFirstValue("role"), out var r) ? r : Role.Employee;
    public bool IsHr => Role is Role.HrAdmin or Role.SuperAdmin;
    public bool IsManagerOrAbove => Role is Role.Manager or Role.HrAdmin or Role.SuperAdmin;
    public string? Ip => accessor.HttpContext?.Connection.RemoteIpAddress?.ToString();
}

/// <summary>Collects field-level validation errors and turns them into an RFC 7807 validation problem.</summary>
public sealed class Errors
{
    private readonly Dictionary<string, List<string>> _errors = new();
    public bool Any => _errors.Count > 0;

    public Errors Add(string key, string message)
    {
        if (!_errors.TryGetValue(key, out var list)) _errors[key] = list = [];
        list.Add(message);
        return this;
    }

    public Errors Required(string? value, string key, string label, int max = int.MaxValue)
    {
        if (string.IsNullOrWhiteSpace(value)) Add(key, $"{label} is required.");
        else if (value.Trim().Length > max) Add(key, $"{label} must be at most {max} characters.");
        return this;
    }

    public Errors Optional(string? value, string key, string label, int max)
    {
        if (!string.IsNullOrWhiteSpace(value) && value.Trim().Length > max)
            Add(key, $"{label} must be at most {max} characters.");
        return this;
    }

    public IResult ToResult() =>
        Results.ValidationProblem(_errors.ToDictionary(k => k.Key, k => k.Value.ToArray()));
}

public static class Problems
{
    public static IResult NotFound(string detail = "The requested item was not found.") =>
        Results.Problem(title: "Not found", detail: detail, statusCode: 404);
    public static IResult Forbidden(string detail = "You do not have permission to do that.") =>
        Results.Problem(title: "Forbidden", detail: detail, statusCode: 403);
    public static IResult Conflict(string detail) =>
        Results.Problem(title: "Conflict", detail: detail, statusCode: 409);
    public static IResult Bad(string detail) =>
        Results.Problem(title: "Bad request", detail: detail, statusCode: 400);
}

public static class Passwords
{
    // Pre-computed hash used to keep login timing similar when the account does not exist.
    private static readonly string Dummy = BCrypt.Net.BCrypt.HashPassword("dummy-password-for-timing", 11);

    public static string Hash(string password) => BCrypt.Net.BCrypt.HashPassword(password, 11);
    public static bool Verify(string password, string? hash) =>
        BCrypt.Net.BCrypt.Verify(password, string.IsNullOrEmpty(hash) ? Dummy : hash);

    public static string? Validate(string? password)
    {
        if (string.IsNullOrEmpty(password) || password.Length < 10)
            return "Password must be at least 10 characters.";
        if (!password.Any(char.IsUpper) || !password.Any(char.IsLower) || !password.Any(char.IsDigit))
            return "Password must include an uppercase letter, a lowercase letter and a digit.";
        return null;
    }

    public static string Generate()
    {
        const string upper = "ABCDEFGHJKLMNPQRSTUVWXYZ", lower = "abcdefghijkmnopqrstuvwxyz", digits = "23456789", all = upper + lower + digits;
        var chars = new List<char> { upper[RandomNumberGenerator.GetInt32(upper.Length)], lower[RandomNumberGenerator.GetInt32(lower.Length)], digits[RandomNumberGenerator.GetInt32(digits.Length)] };
        while (chars.Count < 12) chars.Add(all[RandomNumberGenerator.GetInt32(all.Length)]);
        return new string(chars.OrderBy(_ => RandomNumberGenerator.GetInt32(1000)).ToArray());
    }
}

public static class Tokens
{
    public static string NewOpaque() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(48))
        .Replace('+', '-').Replace('/', '_').TrimEnd('=');

    public static string Hash(string raw) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(raw)));
}

/// <summary>Organisation clock so "today" is evaluated in the company time zone, not the server's.</summary>
public class OrgClock
{
    private readonly TimeZoneInfo _tz;

    public OrgClock(IConfiguration cfg)
    {
        var id = cfg["Org:TimeZoneId"] ?? "Asia/Kolkata";
        try { _tz = TimeZoneInfo.FindSystemTimeZoneById(id); }
        catch { _tz = TimeZoneInfo.Local; }
    }

    public DateTime Now => TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, _tz);
    public DateOnly Today => DateOnly.FromDateTime(Now);
}

/// <summary>Writes audit events into the current unit of work (saved by the caller's SaveChanges).</summary>
public class AuditService(HrmDbContext db, ICurrentUser me)
{
    public void Record(string action, string entityType, object? entityId = null, object? before = null, object? after = null, int? actorId = null)
    {
        db.AuditEvents.Add(new AuditEvent
        {
            ActorId = actorId ?? (me.Id == 0 ? null : me.Id),
            Action = action,
            EntityType = entityType,
            EntityId = entityId?.ToString(),
            BeforeJson = before is null ? null : JsonSerializer.Serialize(before),
            AfterJson = after is null ? null : JsonSerializer.Serialize(after),
            IpAddress = me.Ip,
            At = DateTime.UtcNow
        });
    }
}
