using System.Net;
using SelfMade.Hrm.Api.Data;
using SelfMade.Hrm.Api.Domain;

namespace SelfMade.Hrm.Api.Infrastructure;

/// <summary>
/// Creates in-app notifications and outbox e-mails inside the caller's unit of work, so a
/// notification can never be lost between the DB commit and the background sender.
/// </summary>
public class NotificationService(HrmDbContext db, IConfiguration cfg)
{
    private string FrontendUrl => (cfg["App:FrontendUrl"] ?? "").TrimEnd('/');

    public void Notify(Employee to, string title, string message, string? link = null, bool email = true, string? correlationId = null)
    {
        db.Notifications.Add(new Notification { EmployeeId = to.Id, Title = title, Message = message, Link = link });
        if (email) Email(to.Email, title, message, link, correlationId);
    }

    public void Email(string toEmail, string subject, string message, string? link = null, string? correlationId = null)
    {
        var safeMessage = WebUtility.HtmlEncode(message).Replace("\n", "<br/>");
        var button = link is null ? "" :
            $"<p><a href=\"{WebUtility.HtmlEncode(FrontendUrl + link)}\" style=\"background:#0f766e;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none\">Open in SelfMade HRM</a></p>";
        var body = $"<div style=\"font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#0f172a\"><h3>{WebUtility.HtmlEncode(subject)}</h3><p>{safeMessage}</p>{button}<p style=\"color:#64748b;font-size:12px\">SelfMade HRM automated message</p></div>";

        db.EmailOutbox.Add(new EmailOutbox
        {
            ToEmail = toEmail,
            Subject = subject,
            Body = body,
            CorrelationId = correlationId ?? Guid.NewGuid().ToString("N")
        });
    }
}
