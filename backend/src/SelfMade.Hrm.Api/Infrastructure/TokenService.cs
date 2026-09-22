using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using SelfMade.Hrm.Api.Data;
using SelfMade.Hrm.Api.Domain;

namespace SelfMade.Hrm.Api.Infrastructure;

public record TokenPair(string AccessToken, string RefreshToken, int ExpiresInSeconds);

public class TokenService(IConfiguration cfg, HrmDbContext db)
{
    private int AccessMinutes => cfg.GetValue("Jwt:AccessTokenMinutes", 30);
    private int RefreshDays => cfg.GetValue("Jwt:RefreshTokenDays", 7);

    public static SymmetricSecurityKey SigningKey(IConfiguration cfg) =>
        new(Encoding.UTF8.GetBytes(cfg["Jwt:Key"] ?? throw new InvalidOperationException("Jwt:Key is not configured.")));

    /// <summary>Creates an access token and a new refresh token. The caller must SaveChanges.</summary>
    public TokenPair Issue(Employee e)
    {
        var claims = new List<Claim>
        {
            new("sub", e.Id.ToString()),
            new("name", e.FullName),
            new("email", e.Email),
            new("role", e.Role.ToString())
        };

        var descriptor = new SecurityTokenDescriptor
        {
            Subject = new ClaimsIdentity(claims),
            Issuer = cfg["Jwt:Issuer"],
            Audience = cfg["Jwt:Audience"],
            Expires = DateTime.UtcNow.AddMinutes(AccessMinutes),
            SigningCredentials = new SigningCredentials(SigningKey(cfg), SecurityAlgorithms.HmacSha256)
        };
        var access = new JsonWebTokenHandler().CreateToken(descriptor);

        var raw = Tokens.NewOpaque();
        db.RefreshTokens.Add(new RefreshToken
        {
            EmployeeId = e.Id,
            TokenHash = Tokens.Hash(raw),
            ExpiresAt = DateTime.UtcNow.AddDays(RefreshDays)
        });

        return new TokenPair(access, raw, AccessMinutes * 60);
    }
}
