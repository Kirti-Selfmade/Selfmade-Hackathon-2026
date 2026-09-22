using Microsoft.EntityFrameworkCore;
using SelfMade.Hrm.Api.Contracts;
using SelfMade.Hrm.Api.Data;
using SelfMade.Hrm.Api.Domain;
using SelfMade.Hrm.Api.Infrastructure;

namespace SelfMade.Hrm.Api.Endpoints;

/// <summary>In-app notification centre and the company notice board (announcements).</summary>
public static class CommsEndpoints
{
    public static void MapComms(this RouteGroupBuilder api)
    {
        var n = api.MapGroup("/notifications").WithTags("Notifications");
        n.MapGet("", ListNotifications);
        n.MapGet("/unread-count", UnreadCount);
        n.MapPost("/{id:int}/read", MarkRead);
        n.MapPost("/read-all", MarkAllRead);

        var a = api.MapGroup("/announcements").WithTags("Announcements");
        a.MapGet("", ListAnnouncements);
        a.MapGet("/manage", ManageAnnouncements).RequireAuthorization("Hr");
        a.MapPost("", CreateAnnouncement).RequireAuthorization("Hr");
        a.MapPut("/{id:int}", UpdateAnnouncement).RequireAuthorization("Hr");
        a.MapDelete("/{id:int}", DeleteAnnouncement).RequireAuthorization("Hr");
    }

    // ---------- notifications ----------

    private static async Task<IResult> ListNotifications(bool? unreadOnly, int? page, int? pageSize, HrmDbContext db, ICurrentUser me, CancellationToken ct)
    {
        var (p, ps) = Mappers.Paging(page, pageSize);
        var q = db.Notifications.AsNoTracking().Where(n => n.EmployeeId == me.Id);
        if (unreadOnly == true) q = q.Where(n => !n.IsRead);
        var total = await q.CountAsync(ct);
        var unread = await db.Notifications.CountAsync(n => n.EmployeeId == me.Id && !n.IsRead, ct);
        var items = await q.OrderByDescending(n => n.CreatedAt).ThenByDescending(n => n.Id).Skip((p - 1) * ps).Take(ps)
            .Select(n => new NotificationDto(n.Id, n.Title, n.Message, n.Link, n.IsRead, n.CreatedAt)).ToListAsync(ct);
        return Results.Ok(new { items, total, page = p, pageSize = ps, unread });
    }

    private static async Task<IResult> UnreadCount(HrmDbContext db, ICurrentUser me, CancellationToken ct) =>
        Results.Ok(new { unread = await db.Notifications.CountAsync(n => n.EmployeeId == me.Id && !n.IsRead, ct) });

    private static async Task<IResult> MarkRead(int id, HrmDbContext db, ICurrentUser me, CancellationToken ct)
    {
        var n = await db.Notifications.FirstOrDefaultAsync(x => x.Id == id && x.EmployeeId == me.Id, ct);
        if (n is null) return Problems.NotFound();
        n.IsRead = true;
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    private static async Task<IResult> MarkAllRead(HrmDbContext db, ICurrentUser me, CancellationToken ct)
    {
        await db.Notifications.Where(n => n.EmployeeId == me.Id && !n.IsRead)
            .ExecuteUpdateAsync(s => s.SetProperty(n => n.IsRead, true), ct);
        return Results.NoContent();
    }

    // ---------- announcements ----------

    private static async Task<List<AnnouncementDto>> QueryAsync(IQueryable<Announcement> q, int skip, int take, CancellationToken ct) =>
        (await q.OrderByDescending(a => a.IsPinned).ThenByDescending(a => a.PublishedAt).ThenByDescending(a => a.Id).Skip(skip).Take(take)
            .Select(a => new { a.Id, a.Title, a.Body, a.IsPinned, a.IsPublished, a.PublishedAt, First = a.CreatedBy != null ? a.CreatedBy.FirstName : null, Last = a.CreatedBy != null ? a.CreatedBy.LastName : null })
            .ToListAsync(ct))
        .Select(a => new AnnouncementDto(a.Id, a.Title, a.Body, a.IsPinned, a.IsPublished, a.PublishedAt, a.First is null ? null : (a.First + " " + a.Last).Trim())).ToList();

    private static async Task<IResult> ListAnnouncements(int? page, int? pageSize, HrmDbContext db, CancellationToken ct)
    {
        var (p, ps) = Mappers.Paging(page, pageSize);
        var q = db.Announcements.AsNoTracking().Where(a => a.IsPublished);
        var total = await q.CountAsync(ct);
        return Results.Ok(new PagedResult<AnnouncementDto>(await QueryAsync(q, (p - 1) * ps, ps, ct), total, p, ps));
    }

    private static async Task<IResult> ManageAnnouncements(int? page, int? pageSize, HrmDbContext db, CancellationToken ct)
    {
        var (p, ps) = Mappers.Paging(page, pageSize);
        var q = db.Announcements.AsNoTracking();
        var total = await q.CountAsync(ct);
        return Results.Ok(new PagedResult<AnnouncementDto>(await QueryAsync(q, (p - 1) * ps, ps, ct), total, p, ps));
    }

    private static Errors Validate(AnnouncementRequest r) =>
        new Errors().Required(r.Title, "title", "Title", 200).Required(r.Body, "body", "Message", 4000);

    private static async Task<IResult> CreateAnnouncement(AnnouncementRequest req, HrmDbContext db, ICurrentUser me, AuditService audit, NotificationService notes, CancellationToken ct)
    {
        var errors = Validate(req);
        if (errors.Any) return errors.ToResult();

        var a = new Announcement
        {
            Title = req.Title!.Trim(), Body = req.Body!.Trim(), IsPinned = req.IsPinned ?? false,
            IsPublished = req.IsPublished ?? true, PublishedAt = DateTime.UtcNow, CreatedById = me.Id
        };
        db.Announcements.Add(a);

        if (a.IsPublished)
        {
            var people = await db.Employees.Where(e => e.IsActive && e.Id != me.Id).ToListAsync(ct);
            foreach (var p in people) notes.Notify(p, $"Announcement: {a.Title}", a.Body.Length > 200 ? a.Body[..200] + "..." : a.Body, "/", email: false);
        }

        await db.SaveChangesAsync(ct);
        audit.Record("announcement.create", "Announcement", a.Id, null, new { a.Title, a.IsPinned, a.IsPublished });
        await db.SaveChangesAsync(ct);
        return Results.Created($"/api/v1/announcements/{a.Id}", new { a.Id });
    }

    private static async Task<IResult> UpdateAnnouncement(int id, AnnouncementRequest req, HrmDbContext db, AuditService audit, CancellationToken ct)
    {
        var errors = Validate(req);
        if (errors.Any) return errors.ToResult();
        var a = await db.Announcements.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (a is null) return Problems.NotFound("Announcement not found.");

        var before = new { a.Title, a.Body, a.IsPinned, a.IsPublished };
        a.Title = req.Title!.Trim();
        a.Body = req.Body!.Trim();
        if (req.IsPinned is bool pin) a.IsPinned = pin;
        if (req.IsPublished is bool pub) a.IsPublished = pub;
        audit.Record("announcement.update", "Announcement", a.Id, before, new { a.Title, a.Body, a.IsPinned, a.IsPublished });
        await db.SaveChangesAsync(ct);
        return Results.Ok(new { a.Id });
    }

    private static async Task<IResult> DeleteAnnouncement(int id, HrmDbContext db, AuditService audit, CancellationToken ct)
    {
        var a = await db.Announcements.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (a is null) return Problems.NotFound("Announcement not found.");
        audit.Record("announcement.delete", "Announcement", a.Id, new { a.Title });
        db.Announcements.Remove(a);
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }
}
