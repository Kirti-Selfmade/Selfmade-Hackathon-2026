using System.ComponentModel.DataAnnotations;

namespace SelfMade.Hrm.Api.Domain;

public enum Role { Employee = 0, Manager = 1, HrAdmin = 2, SuperAdmin = 3 }
public enum LeaveStatus { Pending = 0, Approved = 1, Rejected = 2, Cancelled = 3 }
public enum EmploymentType { FullTime = 0, PartTime = 1, Contract = 2, Intern = 3 }
public enum HolidayKind { Holiday = 0, OfficeOff = 1 }
public enum OutboxStatus { Pending = 0, Sent = 1, Failed = 2 }

public class Department
{
    public int Id { get; set; }
    [MaxLength(100)] public string Name { get; set; } = "";
    [MaxLength(500)] public string? Description { get; set; }
    public bool IsActive { get; set; } = true;
}

public class Employee
{
    public int Id { get; set; }
    [MaxLength(20)] public string EmployeeCode { get; set; } = "";
    [MaxLength(100)] public string FirstName { get; set; } = "";
    [MaxLength(100)] public string LastName { get; set; } = "";
    [MaxLength(200)] public string Email { get; set; } = "";
    [MaxLength(100)] public string PasswordHash { get; set; } = "";
    public Role Role { get; set; } = Role.Employee;
    public bool IsActive { get; set; } = true;
    public bool MustChangePassword { get; set; }
    public int FailedLoginCount { get; set; }
    public DateTime? LockoutUntil { get; set; }

    public int? DepartmentId { get; set; }
    public Department? Department { get; set; }
    public int? ManagerId { get; set; }
    public Employee? Manager { get; set; }

    [MaxLength(100)] public string? Designation { get; set; }
    public EmploymentType EmploymentType { get; set; } = EmploymentType.FullTime;
    [MaxLength(100)] public string? Location { get; set; }
    public DateOnly JoinDate { get; set; }
    public DateOnly? DateOfBirth { get; set; }
    [MaxLength(20)] public string? Gender { get; set; }
    [MaxLength(30)] public string? Phone { get; set; }
    [MaxLength(300)] public string? LocalAddress { get; set; }
    [MaxLength(300)] public string? PermanentAddress { get; set; }
    [MaxLength(100)] public string? FatherName { get; set; }

    [MaxLength(100)] public string? EmergencyContactName { get; set; }
    [MaxLength(30)] public string? EmergencyContactPhone { get; set; }
    [MaxLength(50)] public string? EmergencyContactRelation { get; set; }

    // Sensitive payroll fields: visible only to the employee and HR
    [MaxLength(100)] public string? BankAccountHolder { get; set; }
    [MaxLength(100)] public string? BankName { get; set; }
    [MaxLength(40)] public string? BankAccountNumber { get; set; }
    [MaxLength(20)] public string? BankIfsc { get; set; }
    [MaxLength(30)] public string? TaxId { get; set; }

    [MaxLength(100)] public string? AvatarFile { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? DisabledAt { get; set; }
    [MaxLength(500)] public string? DisabledReason { get; set; }

    /// <summary>When set, the daily job disables this employee once <see cref="ScheduledDisableDate"/> arrives (org time zone).</summary>
    public DateOnly? ScheduledDisableDate { get; set; }
    [MaxLength(500)] public string? ScheduledDisableReason { get; set; }

    [Timestamp] public byte[] RowVersion { get; set; } = [];

    public string FullName => $"{FirstName} {LastName}".Trim();
}

public class RefreshToken
{
    public int Id { get; set; }
    public int EmployeeId { get; set; }
    public Employee? Employee { get; set; }
    [MaxLength(100)] public string TokenHash { get; set; } = "";
    public DateTime ExpiresAt { get; set; }
    public DateTime? RevokedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class PasswordResetToken
{
    public int Id { get; set; }
    public int EmployeeId { get; set; }
    public Employee? Employee { get; set; }
    [MaxLength(100)] public string TokenHash { get; set; } = "";
    public DateTime ExpiresAt { get; set; }
    public DateTime? UsedAt { get; set; }
}

public class LeaveType
{
    public int Id { get; set; }
    [MaxLength(60)] public string Name { get; set; } = "";
    [MaxLength(10)] public string Code { get; set; } = "";
    [MaxLength(9)] public string Color { get; set; } = "#0EA5A4";
    public decimal DefaultAnnualDays { get; set; }
    /// <summary>When false (e.g. unpaid leave) no balance is enforced.</summary>
    public bool TracksBalance { get; set; } = true;
    public bool AllowHalfDay { get; set; } = true;
    public bool IsPaid { get; set; } = true;
    public bool IsActive { get; set; } = true;
}

public class LeaveBalance
{
    public int Id { get; set; }
    public int EmployeeId { get; set; }
    public Employee? Employee { get; set; }
    public int LeaveTypeId { get; set; }
    public LeaveType? LeaveType { get; set; }
    public int Year { get; set; }
    public decimal Total { get; set; }
    public decimal Used { get; set; }
}

public class LeaveApplication
{
    public int Id { get; set; }
    public int EmployeeId { get; set; }
    public Employee? Employee { get; set; }
    public int LeaveTypeId { get; set; }
    public LeaveType? LeaveType { get; set; }
    public DateOnly StartDate { get; set; }
    public DateOnly EndDate { get; set; }
    public bool IsHalfDay { get; set; }
    public decimal Days { get; set; }
    [MaxLength(1000)] public string Reason { get; set; } = "";
    public LeaveStatus Status { get; set; } = LeaveStatus.Pending;
    public DateTime AppliedAt { get; set; } = DateTime.UtcNow;
    public int? DecidedById { get; set; }
    public Employee? DecidedBy { get; set; }
    public DateTime? DecidedAt { get; set; }
    [MaxLength(1000)] public string? DecisionComment { get; set; }
    public bool IsDeleted { get; set; }
    [Timestamp] public byte[] RowVersion { get; set; } = [];
    public List<LeaveEvent> Events { get; set; } = [];
}

public class LeaveEvent
{
    public int Id { get; set; }
    public int LeaveApplicationId { get; set; }
    public LeaveApplication? LeaveApplication { get; set; }
    [MaxLength(30)] public string Kind { get; set; } = "";
    public int? ActorId { get; set; }
    public Employee? Actor { get; set; }
    [MaxLength(1000)] public string? Comment { get; set; }
    public DateTime At { get; set; } = DateTime.UtcNow;
}

public class Holiday
{
    public int Id { get; set; }
    [MaxLength(150)] public string Name { get; set; } = "";
    public DateOnly Date { get; set; }
    public HolidayKind Kind { get; set; } = HolidayKind.Holiday;
}

public class Announcement
{
    public int Id { get; set; }
    [MaxLength(200)] public string Title { get; set; } = "";
    [MaxLength(4000)] public string Body { get; set; } = "";
    public bool IsPinned { get; set; }
    public bool IsPublished { get; set; } = true;
    public DateTime PublishedAt { get; set; } = DateTime.UtcNow;
    public int? CreatedById { get; set; }
    public Employee? CreatedBy { get; set; }
}

public class Notification
{
    public int Id { get; set; }
    public int EmployeeId { get; set; }
    public Employee? Employee { get; set; }
    [MaxLength(200)] public string Title { get; set; } = "";
    [MaxLength(1000)] public string Message { get; set; } = "";
    [MaxLength(300)] public string? Link { get; set; }
    public bool IsRead { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>Transactional outbox: written in the same transaction as the business change, sent by a background worker.</summary>
public class EmailOutbox
{
    public int Id { get; set; }
    [MaxLength(200)] public string ToEmail { get; set; } = "";
    [MaxLength(300)] public string Subject { get; set; } = "";
    public string Body { get; set; } = "";
    public OutboxStatus Status { get; set; } = OutboxStatus.Pending;
    public int Attempts { get; set; }
    [MaxLength(500)] public string? LastError { get; set; }
    [MaxLength(80)] public string? CorrelationId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? SentAt { get; set; }
}

public class AuditEvent
{
    public long Id { get; set; }
    public int? ActorId { get; set; }
    public Employee? Actor { get; set; }
    [MaxLength(80)] public string Action { get; set; } = "";
    [MaxLength(60)] public string EntityType { get; set; } = "";
    [MaxLength(40)] public string? EntityId { get; set; }
    public string? BeforeJson { get; set; }
    public string? AfterJson { get; set; }
    [MaxLength(60)] public string? IpAddress { get; set; }
    public DateTime At { get; set; } = DateTime.UtcNow;
}
