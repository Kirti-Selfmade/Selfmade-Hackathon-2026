using SelfMade.Hrm.Api.Contracts;
using SelfMade.Hrm.Api.Domain;

namespace SelfMade.Hrm.Api.Endpoints;

public static class Mappers
{
    public static string? AvatarUrl(string? file) => file is null ? null : "/uploads/avatars/" + file;

    public static UserDto ToUser(Employee e) =>
        new(e.Id, e.FullName, e.Email, e.Role.ToString(), e.Designation, e.Department?.Name, AvatarUrl(e.AvatarFile), e.MustChangePassword);

    public static (int Page, int PageSize) Paging(int? page, int? pageSize) =>
        (Math.Max(page ?? 1, 1), Math.Clamp(pageSize ?? 20, 1, 100));

    public static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
