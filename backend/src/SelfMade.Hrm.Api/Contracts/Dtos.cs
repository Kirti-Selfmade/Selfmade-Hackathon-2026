namespace SelfMade.Hrm.Api.Contracts;

public record PagedResult<T>(List<T> Items, int Total, int Page, int PageSize);

// ---------- Auth ----------
public record LoginRequest(string? Email, string? Password);
public record RefreshRequest(string? RefreshToken);
public record ForgotPasswordRequest(string? Email);
public record ResetPasswordRequest(string? Email, string? Token, string? NewPassword);
public record ChangePasswordRequest(string? CurrentPassword, string? NewPassword);
public record UserDto(int Id, string Name, string Email, string Role, string? Designation, string? Department, string? AvatarUrl, bool MustChangePassword);
public record AuthResponse(string AccessToken, string RefreshToken, int ExpiresIn, UserDto User);

// ---------- Employees ----------
public record EmployeeListItem(
    int Id, string EmployeeCode, string Name, string Email, string Role, string? Designation,
    int? DepartmentId, string? Department, int? ManagerId, string? Manager,
    string EmploymentType, string? Location, DateOnly JoinDate, bool IsActive, string? AvatarUrl,
    DateOnly? ScheduledDisableDate);

public record DirectoryItem(int Id, string Name, string Email, string? Phone, string? Designation, string? Department, string? Manager, string? Location, string? AvatarUrl);

public record EmployeeDetail(
    int Id, string EmployeeCode, string FirstName, string LastName, string Email, string Role, bool IsActive,
    int? DepartmentId, string? Department, int? ManagerId, string? Manager,
    string? Designation, string EmploymentType, string? Location, DateOnly JoinDate, DateOnly? DateOfBirth,
    string? Gender, string? Phone, string? LocalAddress, string? PermanentAddress, string? FatherName,
    string? EmergencyContactName, string? EmergencyContactPhone, string? EmergencyContactRelation,
    string? BankAccountHolder, string? BankName, string? BankAccountNumber, string? BankIfsc, string? TaxId,
    string? AvatarUrl, int ProfileCompleteness, bool SensitiveVisible,
    DateOnly? ScheduledDisableDate, string? ScheduledDisableReason);

public record EmployeeUpsertRequest(
    string? EmployeeCode, string? FirstName, string? LastName, string? Email, string? Role,
    int? DepartmentId, int? ManagerId, string? Designation, string? EmploymentType, string? Location,
    DateOnly? JoinDate, DateOnly? DateOfBirth, string? Gender, string? Phone, string? LocalAddress,
    string? PermanentAddress, string? FatherName,
    string? EmergencyContactName, string? EmergencyContactPhone, string? EmergencyContactRelation,
    string? BankAccountHolder, string? BankName, string? BankAccountNumber, string? BankIfsc, string? TaxId);

public record UpdateProfileRequest(
    string? Phone, string? LocalAddress, string? PermanentAddress,
    string? EmergencyContactName, string? EmergencyContactPhone, string? EmergencyContactRelation);

public record ReasonRequest(string? Reason);
public record DisableRequest(string? Reason, DateOnly? EffectiveDate);

// ---------- Organisation ----------
public record DepartmentDto(int Id, string Name, string? Description, bool IsActive, int EmployeeCount);
public record DepartmentRequest(string? Name, string? Description, bool? IsActive);

public record LeaveTypeDto(int Id, string Name, string Code, string Color, decimal DefaultAnnualDays, bool TracksBalance, bool AllowHalfDay, bool IsPaid, bool IsActive);
public record LeaveTypeRequest(string? Name, string? Code, string? Color, decimal? DefaultAnnualDays, bool? TracksBalance, bool? AllowHalfDay, bool? IsPaid, bool? IsActive);

public record HolidayDto(int Id, string Name, DateOnly Date, string Kind);
public record HolidayRequest(string? Name, DateOnly? Date, string? Kind);

public record AnnouncementDto(int Id, string Title, string Body, bool IsPinned, bool IsPublished, DateTime PublishedAt, string? CreatedBy);
public record AnnouncementRequest(string? Title, string? Body, bool? IsPinned, bool? IsPublished);

// ---------- Leaves ----------
public record LeaveSlotDto(int LeaveTypeId, DateOnly StartDate, DateOnly? EndDate, bool IsHalfDay, string? Reason);
public record ApplyLeaveRequest(List<LeaveSlotDto>? Slots, string? Reason);

public record SlotCheckDto(
    int Index, int LeaveTypeId, DateOnly StartDate, DateOnly EndDate, bool IsHalfDay, decimal Days,
    decimal? AvailableBefore, decimal? AvailableAfter, List<string> Errors, List<string> Warnings);

public record BalanceDto(int LeaveTypeId, string Name, string Code, string Color, bool TracksBalance, decimal Total, decimal Used, decimal Pending, decimal Available);

public record LeaveRow(
    int Id, int EmployeeId, string EmployeeName, string? Department, int LeaveTypeId, string LeaveType, string LeaveTypeCode, string Color,
    DateOnly StartDate, DateOnly EndDate, bool IsHalfDay, decimal Days, string Reason, string Status,
    DateTime AppliedAt, string? DecidedBy, DateTime? DecidedAt, string? DecisionComment, int AgeDays);

public record LeaveEventDto(string Kind, string? Actor, string? Comment, DateTime At);
public record LeaveConflictDto(int EmployeeId, string EmployeeName, DateOnly StartDate, DateOnly EndDate, string Status);
public record LeaveDetail(LeaveRow Leave, List<LeaveEventDto> Events, List<LeaveConflictDto> Conflicts, BalanceDto? Balance);

public record DecisionRequest(bool Approve, string? Comment);
public record CancelRequest(string? Comment);
public record EditLeaveRequest(int LeaveTypeId, DateOnly StartDate, DateOnly? EndDate, bool IsHalfDay, string? Reason, string? ChangeReason);

// ---------- Calendar / notifications / audit ----------
public record CalendarEvent(DateOnly Date, string Type, string Title, int? EmployeeId, string? Status, string? Color);
public record NotificationDto(int Id, string Title, string Message, string? Link, bool IsRead, DateTime CreatedAt);
public record AuditDto(long Id, string? Actor, string Action, string EntityType, string? EntityId, string? BeforeJson, string? AfterJson, string? IpAddress, DateTime At);
