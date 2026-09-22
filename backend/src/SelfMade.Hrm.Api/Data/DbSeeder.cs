using Microsoft.EntityFrameworkCore;
using SelfMade.Hrm.Api.Domain;
using SelfMade.Hrm.Api.Infrastructure;

namespace SelfMade.Hrm.Api.Data;

/// <summary>
/// Development seed data (only runs when Seed:Enabled is true AND the database has no employees).
/// All demo accounts use the password  Password@123
/// </summary>
public static class DbSeeder
{
    public const string DemoPassword = "Password@123";

    public static async Task SeedAsync(HrmDbContext db, DateOnly today)
    {
        if (await db.Employees.AnyAsync()) return;

        var eng = new Department { Name = "Engineering", Description = "Product engineering and QA" };
        var hr = new Department { Name = "Human Resources", Description = "People operations" };
        var fin = new Department { Name = "Finance", Description = "Accounts and payroll" };
        var sales = new Department { Name = "Sales", Description = "Customer acquisition" };
        db.Departments.AddRange(eng, hr, fin, sales);

        var cl = new LeaveType { Name = "Casual Leave", Code = "CL", Color = "#0EA5A4", DefaultAnnualDays = 6 };
        var sl = new LeaveType { Name = "Sick Leave", Code = "SL", Color = "#EF4444", DefaultAnnualDays = 6 };
        var el = new LeaveType { Name = "Earned Leave", Code = "EL", Color = "#6366F1", DefaultAnnualDays = 15 };
        var wfh = new LeaveType { Name = "Work From Home", Code = "WFH", Color = "#F59E0B", DefaultAnnualDays = 24, IsPaid = true };
        var ul = new LeaveType { Name = "Unpaid Leave", Code = "UL", Color = "#64748B", DefaultAnnualDays = 0, TracksBalance = false, IsPaid = false };
        db.LeaveTypes.AddRange(cl, sl, el, wfh, ul);
        await db.SaveChangesAsync();

        var hash = Passwords.Hash(DemoPassword);
        Employee Make(int n, string first, string last, string email, Role role, Department dept, string title, Employee? boss, DateOnly join, DateOnly dob, string gender) => new()
        {
            EmployeeCode = $"EMP{n:D4}", FirstName = first, LastName = last, Email = email, PasswordHash = hash, Role = role,
            Department = dept, Designation = title, Manager = boss, JoinDate = join, DateOfBirth = dob, Gender = gender,
            Location = "Pune", EmploymentType = EmploymentType.FullTime, Phone = "+91 98765 4" + (1000 + n)
        };

        var admin = Make(1, "System", "Admin", "admin@selfmade.tech", Role.SuperAdmin, eng, "Platform Administrator", null, today.AddYears(-6), new DateOnly(1985, 3, 14), "Male");
        var hrAdmin = Make(2, "Priya", "Sharma", "hr@selfmade.tech", Role.HrAdmin, hr, "HR Manager", admin, today.AddYears(-4).AddDays(-12), BirthdayIn(today, 3, 1991), "Female");
        var manager = Make(3, "Rahul", "Deshmukh", "manager@selfmade.tech", Role.Manager, eng, "Engineering Manager", admin, today.AddYears(-5), new DateOnly(1988, 7, 9), "Male");
        var shreyas = Make(4, "Shreyas", "Kanawade", "shreyas@selfmade.tech", Role.Employee, eng, "Software Engineer (M1)", manager, today.AddYears(-3).AddMonths(-4), new DateOnly(1997, 11, 2), "Male");
        var anita = Make(5, "Anita", "Joshi", "anita@selfmade.tech", Role.Employee, eng, "QA Engineer", manager, today.AddYears(-2), BirthdayIn(today, 9, 1996), "Female");
        var vikram = Make(6, "Vikram", "Patil", "vikram@selfmade.tech", Role.Employee, fin, "Accounts Executive", hrAdmin, today.AddYears(-1).AddDays(10), new DateOnly(1994, 1, 21), "Male");
        var neha = Make(7, "Neha", "Kulkarni", "neha@selfmade.tech", Role.Employee, sales, "Sales Associate", hrAdmin, AnniversaryIn(today, 5, 2), new DateOnly(1999, 5, 30), "Female");
        db.Employees.AddRange(admin, hrAdmin, manager, shreyas, anita, vikram, neha);
        await db.SaveChangesAsync();

        // Company holidays for this and next year (fixed-date public holidays).
        foreach (var y in new[] { today.Year, today.Year + 1 })
        {
            db.Holidays.AddRange(
                new Holiday { Name = "Republic Day", Date = new DateOnly(y, 1, 26) },
                new Holiday { Name = "Maharashtra Day", Date = new DateOnly(y, 5, 1) },
                new Holiday { Name = "Independence Day", Date = new DateOnly(y, 8, 15) },
                new Holiday { Name = "Gandhi Jayanti", Date = new DateOnly(y, 10, 2) },
                new Holiday { Name = "Christmas", Date = new DateOnly(y, 12, 25) },
                new Holiday { Name = "Company Foundation Day (Office Off)", Date = new DateOnly(y, 11, 14), Kind = HolidayKind.OfficeOff });
        }

        db.Announcements.Add(new Announcement
        {
            Title = "Welcome to the new SelfMade HRM",
            Body = "Apply for leave, track approvals, check the calendar and update your profile - all in one place. Managers now get a dedicated approvals workspace.",
            IsPinned = true, CreatedBy = hrAdmin
        });

        // A little history so dashboards are not empty.
        var past = PreviousWeekday(today.AddDays(-3));
        var soon = NextWeekday(today.AddDays(3));
        var approved = new LeaveApplication
        {
            Employee = shreyas, LeaveType = sl, StartDate = past, EndDate = past, Days = 1, Reason = "Fever and doctor's appointment",
            Status = LeaveStatus.Approved, AppliedAt = DateTime.UtcNow.AddDays(-4), DecidedBy = manager, DecidedAt = DateTime.UtcNow.AddDays(-3), DecisionComment = "Get well soon"
        };
        approved.Events.Add(new LeaveEvent { Kind = "Submitted", Actor = shreyas, Comment = approved.Reason });
        approved.Events.Add(new LeaveEvent { Kind = "Approved", Actor = manager, Comment = "Get well soon" });
        var pending = new LeaveApplication
        {
            Employee = anita, LeaveType = cl, StartDate = soon, EndDate = soon, Days = 1, Reason = "Family function",
            Status = LeaveStatus.Pending, AppliedAt = DateTime.UtcNow.AddDays(-1)
        };
        pending.Events.Add(new LeaveEvent { Kind = "Submitted", Actor = anita, Comment = pending.Reason });
        db.LeaveApplications.AddRange(approved, pending);
        if (past.Year == today.Year)
            db.LeaveBalances.Add(new LeaveBalance { Employee = shreyas, LeaveType = sl, Year = past.Year, Total = sl.DefaultAnnualDays, Used = 1 });

        db.Notifications.Add(new Notification { EmployeeId = manager.Id, Title = "Leave request from Anita Joshi", Message = "Anita Joshi applied for 1 day(s) of leave. Please review it.", Link = "/approvals" });
        await db.SaveChangesAsync();
    }

    private static DateOnly NextWeekday(DateOnly d)
    {
        while (d.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday) d = d.AddDays(1);
        return d;
    }

    private static DateOnly PreviousWeekday(DateOnly d)
    {
        while (d.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday) d = d.AddDays(-1);
        return d;
    }

    /// <summary>A date of birth whose birthday falls <paramref name="daysAhead"/> days from today.</summary>
    private static DateOnly BirthdayIn(DateOnly today, int daysAhead, int birthYear)
    {
        var t = today.AddDays(daysAhead);
        return new DateOnly(birthYear, t.Month, Math.Min(t.Day, DateTime.DaysInMonth(birthYear, t.Month)));
    }

    /// <summary>A joining date whose work anniversary falls <paramref name="daysAhead"/> days from today.</summary>
    private static DateOnly AnniversaryIn(DateOnly today, int daysAhead, int yearsAgo)
    {
        var t = today.AddDays(daysAhead);
        var y = today.Year - yearsAgo;
        return new DateOnly(y, t.Month, Math.Min(t.Day, DateTime.DaysInMonth(y, t.Month)));
    }
}
