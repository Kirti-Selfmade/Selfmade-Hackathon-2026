using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.FileProviders;
using Microsoft.IdentityModel.Tokens;
using SelfMade.Hrm.Api.Data;
using SelfMade.Hrm.Api.Endpoints;
using SelfMade.Hrm.Api.Infrastructure;

var builder = WebApplication.CreateBuilder(args);
var cfg = builder.Configuration;

// ---- Fail fast with helpful messages on missing configuration ----
var connection = cfg.GetConnectionString("Default");
if (string.IsNullOrWhiteSpace(connection))
    throw new InvalidOperationException("ConnectionStrings:Default is not configured. Set it in appsettings.Development.json or with 'dotnet user-secrets'.");
var jwtKey = cfg["Jwt:Key"];
if (string.IsNullOrWhiteSpace(jwtKey) || jwtKey.Length < 32)
    throw new InvalidOperationException("Jwt:Key must be set to a random string of at least 32 characters (use user-secrets or an environment variable, never source control).");

// ---- Services ----
builder.Services.AddDbContext<HrmDbContext>(o => o.UseSqlServer(connection));
builder.Services.AddMemoryCache();
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICurrentUser, CurrentUser>();
builder.Services.AddScoped<TeamScope>();
builder.Services.AddScoped<AuditService>();
builder.Services.AddScoped<NotificationService>();
builder.Services.AddScoped<LeaveService>();
builder.Services.AddScoped<TokenService>();
builder.Services.AddSingleton<OrgClock>();
builder.Services.AddSingleton<IMailSender, SmtpMailSender>();
builder.Services.AddHostedService<EmailOutboxWorker>();
builder.Services.AddHostedService<DailyJobsWorker>();

builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.AddProblemDetails(o => o.CustomizeProblemDetails = ctx =>
{
    ctx.ProblemDetails.Extensions["correlationId"] = ctx.HttpContext.TraceIdentifier;
});
builder.Services.AddOpenApi();

var origins = cfg.GetSection("Cors:Origins").Get<string[]>() ?? [];
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .WithOrigins(origins).AllowAnyHeader().AllowAnyMethod()
    .WithExposedHeaders("X-Correlation-Id", "Content-Disposition")));

builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy("auth", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 15, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
});

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(o =>
{
    o.MapInboundClaims = false;
    o.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer = true, ValidIssuer = cfg["Jwt:Issuer"],
        ValidateAudience = true, ValidAudience = cfg["Jwt:Audience"],
        ValidateIssuerSigningKey = true, IssuerSigningKey = TokenService.SigningKey(cfg),
        ValidateLifetime = true, ClockSkew = TimeSpan.FromSeconds(30),
        NameClaimType = "name", RoleClaimType = "role"
    };
    o.Events = new JwtBearerEvents
    {
        // Re-check the account on (cached) every request so disabling an employee or changing a role
        // takes effect within seconds instead of waiting for the access token to expire.
        OnTokenValidated = async ctx =>
        {
            if (!int.TryParse(ctx.Principal?.FindFirst("sub")?.Value, out var id)) { ctx.Fail("Invalid token."); return; }
            var cache = ctx.HttpContext.RequestServices.GetRequiredService<IMemoryCache>();
            var key = $"acct:{id}";
            if (!cache.TryGetValue(key, out AccountState? state) || state is null)
            {
                var db = ctx.HttpContext.RequestServices.GetRequiredService<HrmDbContext>();
                var row = await db.Employees.AsNoTracking().Where(e => e.Id == id)
                    .Select(e => new { e.IsActive, e.Role }).FirstOrDefaultAsync();
                state = new AccountState(row?.IsActive == true, row?.Role.ToString() ?? "");
                cache.Set(key, state, TimeSpan.FromSeconds(20));
            }
            if (!state.Active) ctx.Fail("Account disabled.");
            else if (ctx.Principal?.FindFirst("role")?.Value != state.Role) ctx.Fail("Role changed; please refresh your session.");
        }
    };
});

builder.Services.AddAuthorizationBuilder()
    .AddPolicy("Manager", p => p.RequireRole("Manager", "HrAdmin", "SuperAdmin"))
    .AddPolicy("Hr", p => p.RequireRole("HrAdmin", "SuperAdmin"))
    .AddPolicy("SuperAdmin", p => p.RequireRole("SuperAdmin"));

var app = builder.Build();

// ---- Database ----
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<HrmDbContext>();
    if (app.Environment.IsDevelopment() || cfg.GetValue("Database:AutoMigrate", false))
    {
        // Uses migrations when they exist (dotnet ef migrations add InitialCreate), otherwise creates the schema directly.
        if (db.Database.GetMigrations().Any()) await db.Database.MigrateAsync();
        else await db.Database.EnsureCreatedAsync();
    }
    if (cfg.GetValue("Seed:Enabled", false))
        await DbSeeder.SeedAsync(db, scope.ServiceProvider.GetRequiredService<OrgClock>().Today);
}

// ---- Pipeline ----
app.UseExceptionHandler();
app.UseStatusCodePages();

app.Use(async (ctx, next) =>
{
    var incoming = ctx.Request.Headers["X-Correlation-Id"].FirstOrDefault();
    var id = !string.IsNullOrEmpty(incoming) && incoming.Length <= 64 && incoming.All(c => char.IsLetterOrDigit(c) || c is '-' or '_')
        ? incoming : Guid.NewGuid().ToString("N");
    ctx.TraceIdentifier = id;
    ctx.Response.Headers["X-Correlation-Id"] = id;
    ctx.Response.Headers["X-Content-Type-Options"] = "nosniff";
    ctx.Response.Headers["X-Frame-Options"] = "DENY";
    ctx.Response.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
    var logger = ctx.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("Request");
    using (logger.BeginScope(new Dictionary<string, object> { ["CorrelationId"] = id }))
        await next();
});

if (!app.Environment.IsDevelopment())
{
    app.UseHsts();
    app.UseHttpsRedirection();
}

app.UseCors();

var uploads = Path.Combine(app.Environment.ContentRootPath, "uploads");
Directory.CreateDirectory(Path.Combine(uploads, "avatars"));
app.UseStaticFiles(new StaticFileOptions { FileProvider = new PhysicalFileProvider(uploads), RequestPath = "/uploads" });

app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

if (app.Environment.IsDevelopment()) app.MapOpenApi();

app.MapGet("/health", () => Results.Ok(new { status = "ok" })).AllowAnonymous();
app.MapGet("/health/ready", async (HrmDbContext db, CancellationToken ct) =>
    await db.Database.CanConnectAsync(ct) ? Results.Ok(new { status = "ready" }) : Results.Problem("Database unavailable", statusCode: 503)).AllowAnonymous();

var api = app.MapGroup("/api/v1").RequireAuthorization();
api.MapAuth();
api.MapEmployees();
api.MapOrg();
api.MapLeaves();
api.MapDashboard();
api.MapComms();
api.MapReports();

app.Run();

internal sealed record AccountState(bool Active, string Role);

public partial class Program;
