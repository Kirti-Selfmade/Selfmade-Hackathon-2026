using System.Net;
using System.Net.Mail;
using System.Text;
using Microsoft.EntityFrameworkCore;
using SelfMade.Hrm.Api.Data;
using SelfMade.Hrm.Api.Domain;

namespace SelfMade.Hrm.Api.Infrastructure;

public interface IMailSender
{
    Task SendAsync(string to, string subject, string htmlBody, CancellationToken ct);
}

/// <summary>
/// SMTP sender. When Smtp:Host is empty (typical for local development) messages are written to the
/// log instead so flows like "forgot password" remain testable without a mail server.
/// </summary>
public class SmtpMailSender(IConfiguration cfg, ILogger<SmtpMailSender> log) : IMailSender
{
    public async Task SendAsync(string to, string subject, string htmlBody, CancellationToken ct)
    {
        var host = cfg["Smtp:Host"];
        if (string.IsNullOrWhiteSpace(host))
        {
            log.LogInformation("[DEV MAIL - SMTP not configured] To: {To} | Subject: {Subject}\n{Body}", to, subject, htmlBody);
            return;
        }

        using var client = new SmtpClient(host, cfg.GetValue("Smtp:Port", 587))
        {
            EnableSsl = cfg.GetValue("Smtp:EnableSsl", true)
        };
        var user = cfg["Smtp:User"];
        if (!string.IsNullOrEmpty(user))
            client.Credentials = new NetworkCredential(user, cfg["Smtp:Password"]);

        using var msg = new MailMessage(cfg["Smtp:From"] ?? "hr@localhost", to, subject, htmlBody) { IsBodyHtml = true };
        await client.SendMailAsync(msg, ct);
    }
}

/// <summary>Drains the e-mail outbox with retries so notifications survive SMTP outages and restarts.</summary>
public class EmailOutboxWorker(IServiceScopeFactory scopes, ILogger<EmailOutboxWorker> log) : BackgroundService
{
    private const int MaxAttempts = 5;

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        while (!stop.IsCancellationRequested)
        {
            try { await ProcessBatchAsync(stop); }
            catch (OperationCanceledException) { break; }
            catch (Exception ex) { log.LogError(ex, "Email outbox batch failed"); }

            try { await Task.Delay(TimeSpan.FromSeconds(15), stop); }
            catch (OperationCanceledException) { break; }
        }
    }

    private async Task ProcessBatchAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<HrmDbContext>();
        var sender = scope.ServiceProvider.GetRequiredService<IMailSender>();

        var batch = await db.EmailOutbox
            .Where(x => x.Status == OutboxStatus.Pending && x.Attempts < MaxAttempts)
            .OrderBy(x => x.Id).Take(20).ToListAsync(ct);

        foreach (var item in batch)
        {
            try
            {
                await sender.SendAsync(item.ToEmail, item.Subject, item.Body, ct);
                item.Status = OutboxStatus.Sent;
                item.SentAt = DateTime.UtcNow;
                item.LastError = null;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                item.Attempts++;
                var msg = ex.Message;
                item.LastError = msg.Length > 500 ? msg[..500] : msg;
                if (item.Attempts >= MaxAttempts) item.Status = OutboxStatus.Failed;
                log.LogWarning(ex, "Email {Id} to {To} failed (attempt {Attempts})", item.Id, item.ToEmail, item.Attempts);
            }
        }

        if (batch.Count > 0) await db.SaveChangesAsync(ct);
    }
}

/// <summary>Once a day (after the configured hour, org time zone): leave digest, birthday and work-anniversary e-mails.</summary>
public class DailyJobsWorker(IServiceScopeFactory scopes, OrgClock clock, IConfiguration cfg, ILogger<DailyJobsWorker> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        try { await Task.Delay(TimeSpan.FromSeconds(30), stop); }
        catch (OperationCanceledException) { return; }

        while (!stop.IsCancellationRequested)
        {
            try
            {
                if (clock.Now.Hour >= cfg.GetValue("Org:DigestHour", 8))
                    await RunOnceAsync(stop);
            }
            catch (OperationCanceledException) { break; }
            catch (Exception ex) { log.LogError(ex, "Daily jobs failed"); }

            try { await Task.Delay(TimeSpan.FromMinutes(5), stop); }
            catch (OperationCanceledException) { break; }
        }
    }

    private async Task RunOnceAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<HrmDbContext>();
        var notes = scope.ServiceProvider.GetRequiredService<NotificationService>();

        var today = clock.Today;
        var marker = today.ToString("yyyy-MM-dd");
        if (await db.AuditEvents.AnyAsync(a => a.Action == "job.daily" && a.EntityId == marker, ct)) return;

        var corr = $"daily-{today:yyyyMMdd}";
        var people = await db.Employees.Where(e => e.IsActive).ToListAsync(ct);

        // 1) Daily leave digest for HR (everyone) and managers (direct reports).
        var onLeave = await db.LeaveApplications.AsNoTracking()
            .Where(a => a.Status == LeaveStatus.Approved && a.StartDate <= today && a.EndDate >= today)
            .Select(a => new { a.EmployeeId, Name = a.Employee!.FirstName + " " + a.Employee.LastName, Type = a.LeaveType!.Name, a.IsHalfDay, a.EndDate })
            .ToListAsync(ct);

        if (onLeave.Count > 0)
        {
            string Render(IEnumerable<int> ids)
            {
                var sb = new StringBuilder($"People on leave today ({today:dd MMM yyyy}):\n");
                foreach (var l in onLeave.Where(x => ids.Contains(x.EmployeeId)))
                    sb.AppendLine($"- {l.Name}: {l.Type}{(l.IsHalfDay ? " (half day)" : "")}, until {l.EndDate:dd MMM}");
                return sb.ToString();
            }

            foreach (var hr in people.Where(p => p.Role is Role.HrAdmin or Role.SuperAdmin))
                notes.Email(hr.Email, $"Daily leave digest - {today:dd MMM yyyy}", Render(onLeave.Select(x => x.EmployeeId)), "/leaves/manage", corr);

            foreach (var mgr in people.Where(p => p.Role == Role.Manager))
            {
                var reportIds = people.Where(p => p.ManagerId == mgr.Id).Select(p => p.Id).ToHashSet();
                if (!onLeave.Any(x => reportIds.Contains(x.EmployeeId))) continue;
                notes.Email(mgr.Email, $"Daily leave digest - {today:dd MMM yyyy}", Render(reportIds), "/leaves/manage", corr);
            }
        }

        // 2) Birthdays and 3) work anniversaries.
        foreach (var p in people)
        {
            if (p.DateOfBirth is { } dob && dob.Month == today.Month && dob.Day == today.Day)
                notes.Notify(p, $"Happy birthday, {p.FirstName}!", "Everyone at SelfMade wishes you a wonderful birthday.", "/", true, corr);

            if (p.JoinDate.Month == today.Month && p.JoinDate.Day == today.Day && p.JoinDate.Year < today.Year)
            {
                var years = today.Year - p.JoinDate.Year;
                notes.Notify(p, $"Happy work anniversary, {p.FirstName}!", $"Congratulations on {years} year{(years == 1 ? "" : "s")} with SelfMade. Thank you for everything you do.", "/", true, corr);
            }
        }

        db.AuditEvents.Add(new AuditEvent { Action = "job.daily", EntityType = "Job", EntityId = marker });
        await db.SaveChangesAsync(ct);
        log.LogInformation("Daily jobs completed for {Date}", marker);
    }
}
