using Microsoft.EntityFrameworkCore;
using SelfMade.Hrm.Api.Data;
using SelfMade.Hrm.Api.Domain;

namespace SelfMade.Hrm.Api.Infrastructure;

/// <summary>
/// Relationship-based scope rules (RBAC + scope): HR sees everyone, a manager sees themselves and
/// their direct/indirect reports, an employee sees only themselves.
/// </summary>
public class TeamScope(HrmDbContext db, ICurrentUser me)
{
    /// <summary>Returns null when the caller is unrestricted (HR / Super Admin).</summary>
    public async Task<int[]?> VisibleIdsAsync(CancellationToken ct)
    {
        if (me.IsHr) return null;
        var set = new HashSet<int> { me.Id };
        if (me.Role != Role.Manager) return [.. set];

        var pairs = await db.Employees.AsNoTracking()
            .Where(e => e.IsActive && e.ManagerId != null)
            .Select(e => new { e.Id, ManagerId = e.ManagerId!.Value })
            .ToListAsync(ct);
        var byManager = pairs.GroupBy(p => p.ManagerId).ToDictionary(g => g.Key, g => g.Select(x => x.Id).ToList());

        var queue = new Queue<int>();
        queue.Enqueue(me.Id);
        while (queue.Count > 0)
        {
            var m = queue.Dequeue();
            if (!byManager.TryGetValue(m, out var kids)) continue;
            foreach (var k in kids)
                if (set.Add(k)) queue.Enqueue(k);
        }
        return [.. set];
    }

    public async Task<bool> CanSeeAsync(int employeeId, CancellationToken ct)
    {
        var ids = await VisibleIdsAsync(ct);
        return ids is null || ids.Contains(employeeId);
    }
}
