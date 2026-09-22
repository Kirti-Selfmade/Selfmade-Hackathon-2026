using Microsoft.EntityFrameworkCore;
using SelfMade.Hrm.Api.Domain;

namespace SelfMade.Hrm.Api.Data;

public class HrmDbContext(DbContextOptions<HrmDbContext> options) : DbContext(options)
{
    public DbSet<Department> Departments => Set<Department>();
    public DbSet<Employee> Employees => Set<Employee>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<PasswordResetToken> PasswordResetTokens => Set<PasswordResetToken>();
    public DbSet<LeaveType> LeaveTypes => Set<LeaveType>();
    public DbSet<LeaveBalance> LeaveBalances => Set<LeaveBalance>();
    public DbSet<LeaveApplication> LeaveApplications => Set<LeaveApplication>();
    public DbSet<LeaveEvent> LeaveEvents => Set<LeaveEvent>();
    public DbSet<Holiday> Holidays => Set<Holiday>();
    public DbSet<Announcement> Announcements => Set<Announcement>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<EmailOutbox> EmailOutbox => Set<EmailOutbox>();
    public DbSet<AuditEvent> AuditEvents => Set<AuditEvent>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Department>(e =>
        {
            e.HasIndex(x => x.Name).IsUnique();
        });

        b.Entity<Employee>(e =>
        {
            e.HasIndex(x => x.Email).IsUnique();
            e.HasIndex(x => x.EmployeeCode).IsUnique();
            e.HasIndex(x => new { x.IsActive, x.ManagerId });
            e.HasIndex(x => x.DepartmentId);
            e.Property(x => x.Role).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.EmploymentType).HasConversion<string>().HasMaxLength(20);
            e.Ignore(x => x.FullName);
            e.HasOne(x => x.Manager).WithMany().HasForeignKey(x => x.ManagerId);
        });

        b.Entity<RefreshToken>(e => e.HasIndex(x => x.TokenHash));
        b.Entity<PasswordResetToken>(e => e.HasIndex(x => x.TokenHash));

        b.Entity<LeaveType>(e =>
        {
            e.HasIndex(x => x.Code).IsUnique();
            e.Property(x => x.DefaultAnnualDays).HasPrecision(5, 1);
        });

        b.Entity<LeaveBalance>(e =>
        {
            e.HasIndex(x => new { x.EmployeeId, x.LeaveTypeId, x.Year }).IsUnique();
            e.Property(x => x.Total).HasPrecision(5, 1);
            e.Property(x => x.Used).HasPrecision(5, 1);
        });

        b.Entity<LeaveApplication>(e =>
        {
            e.HasQueryFilter(x => !x.IsDeleted);
            e.HasIndex(x => new { x.EmployeeId, x.StartDate });
            e.HasIndex(x => new { x.Status, x.AppliedAt });
            e.Property(x => x.Days).HasPrecision(5, 1);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.HasMany(x => x.Events).WithOne(x => x.LeaveApplication).HasForeignKey(x => x.LeaveApplicationId);
            e.HasOne(x => x.DecidedBy).WithMany().HasForeignKey(x => x.DecidedById);
        });

        b.Entity<LeaveEvent>(e =>
        {
            e.HasIndex(x => x.LeaveApplicationId);
            e.HasOne(x => x.Actor).WithMany().HasForeignKey(x => x.ActorId);
        });

        b.Entity<Holiday>(e =>
        {
            e.HasIndex(x => x.Date).IsUnique();
            e.Property(x => x.Kind).HasConversion<string>().HasMaxLength(20);
        });

        b.Entity<Announcement>(e =>
        {
            e.HasIndex(x => new { x.IsPublished, x.IsPinned, x.PublishedAt });
            e.HasOne(x => x.CreatedBy).WithMany().HasForeignKey(x => x.CreatedById);
        });

        b.Entity<Notification>(e => e.HasIndex(x => new { x.EmployeeId, x.IsRead, x.CreatedAt }));

        b.Entity<EmailOutbox>(e =>
        {
            e.ToTable("EmailOutbox");
            e.HasIndex(x => new { x.Status, x.CreatedAt });
            e.HasIndex(x => x.CorrelationId);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
        });

        b.Entity<AuditEvent>(e =>
        {
            e.HasIndex(x => x.At);
            e.HasIndex(x => new { x.EntityType, x.EntityId });
            e.HasIndex(x => x.ActorId);
            e.HasOne(x => x.Actor).WithMany().HasForeignKey(x => x.ActorId);
        });

        // Avoid SQL Server "multiple cascade paths" errors and accidental data loss:
        // history is never cascade-deleted (records are soft-deleted / disabled instead).
        foreach (var fk in b.Model.GetEntityTypes().SelectMany(t => t.GetForeignKeys()))
            fk.DeleteBehavior = DeleteBehavior.Restrict;
    }
}
