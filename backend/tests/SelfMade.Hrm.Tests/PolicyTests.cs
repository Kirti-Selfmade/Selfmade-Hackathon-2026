using SelfMade.Hrm.Api.Infrastructure;
using Xunit;

namespace SelfMade.Hrm.Tests;

public class LeaveDayCountingTests
{
    private static readonly HashSet<DateOnly> NoHolidays = [];

    // 2026-09-21 is a Monday.
    [Fact]
    public void Single_weekday_counts_as_one_day() =>
        Assert.Equal(1m, LeaveService.CountDays(new DateOnly(2026, 9, 21), new DateOnly(2026, 9, 21), false, NoHolidays));

    [Fact]
    public void Half_day_on_a_working_day_counts_as_half() =>
        Assert.Equal(0.5m, LeaveService.CountDays(new DateOnly(2026, 9, 21), new DateOnly(2026, 9, 21), true, NoHolidays));

    [Fact]
    public void Half_day_over_a_range_is_not_allowed() =>
        Assert.Equal(0m, LeaveService.CountDays(new DateOnly(2026, 9, 21), new DateOnly(2026, 9, 22), true, NoHolidays));

    [Fact]
    public void Weekends_are_excluded_from_a_range()
    {
        // Mon 21 Sep -> Mon 28 Sep = 6 working days (Sat 26, Sun 27 skipped)
        Assert.Equal(6m, LeaveService.CountDays(new DateOnly(2026, 9, 21), new DateOnly(2026, 9, 28), false, NoHolidays));
    }

    [Fact]
    public void Holidays_are_excluded()
    {
        var holidays = new HashSet<DateOnly> { new(2026, 9, 23) };
        Assert.Equal(2m, LeaveService.CountDays(new DateOnly(2026, 9, 22), new DateOnly(2026, 9, 24), false, holidays));
    }

    [Fact]
    public void A_weekend_only_selection_counts_zero() =>
        Assert.Equal(0m, LeaveService.CountDays(new DateOnly(2026, 9, 26), new DateOnly(2026, 9, 27), false, NoHolidays));

    [Fact]
    public void Half_day_on_a_holiday_counts_zero()
    {
        var holidays = new HashSet<DateOnly> { new(2026, 9, 21) };
        Assert.Equal(0m, LeaveService.CountDays(new DateOnly(2026, 9, 21), new DateOnly(2026, 9, 21), true, holidays));
    }

    [Fact]
    public void End_before_start_counts_zero() =>
        Assert.Equal(0m, LeaveService.CountDays(new DateOnly(2026, 9, 22), new DateOnly(2026, 9, 21), false, NoHolidays));
}

public class PasswordPolicyTests
{
    [Theory]
    [InlineData("short1A")]
    [InlineData("alllowercase123")]
    [InlineData("ALLUPPERCASE123")]
    [InlineData("NoDigitsHereAtAll")]
    public void Weak_passwords_are_rejected(string password) => Assert.NotNull(Passwords.Validate(password));

    [Fact]
    public void Strong_password_is_accepted() => Assert.Null(Passwords.Validate("Password@123"));

    [Fact]
    public void Generated_passwords_satisfy_the_policy()
    {
        for (var i = 0; i < 50; i++) Assert.Null(Passwords.Validate(Passwords.Generate()));
    }

    [Fact]
    public void Hash_verifies_and_rejects_wrong_password()
    {
        var hash = Passwords.Hash("Password@123");
        Assert.True(Passwords.Verify("Password@123", hash));
        Assert.False(Passwords.Verify("Password@124", hash));
    }
}

public class TokenTests
{
    [Fact]
    public void Opaque_tokens_are_unique_and_hash_is_stable()
    {
        var a = Tokens.NewOpaque();
        var b = Tokens.NewOpaque();
        Assert.NotEqual(a, b);
        Assert.Equal(Tokens.Hash(a), Tokens.Hash(a));
        Assert.NotEqual(Tokens.Hash(a), Tokens.Hash(b));
    }
}
