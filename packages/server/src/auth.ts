import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export interface AuthenticatedUser {
  userId: string;
  email: string | null;
}

interface AuthServiceOptions {
  authRequired: boolean;
  supabaseUrl?: string;
  supabaseJwtSecret?: string;
  supabaseJwtAudience: string;
}

function normalizeSupabaseIssuer(url?: string): string | null {
  if (!url) {
    return null;
  }
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return null;
  }
  return `${trimmed}/auth/v1`;
}

function extractBearerToken(authorization?: string): string | null {
  if (!authorization) {
    return null;
  }
  const [scheme, token] = authorization.trim().split(/\s+/);
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return null;
  }
  return token;
}

export class AuthService {
  private readonly issuer: string | null;
  private readonly jwks;
  private readonly secretKey?: Uint8Array;

  constructor(private readonly options: AuthServiceOptions) {
    this.issuer = normalizeSupabaseIssuer(options.supabaseUrl);
    this.secretKey = options.supabaseJwtSecret
      ? new TextEncoder().encode(options.supabaseJwtSecret)
      : undefined;
    this.jwks = this.issuer
      ? createRemoteJWKSet(new URL(`${this.issuer}/.well-known/jwks.json`))
      : undefined;

    if (options.authRequired && !this.secretKey && !this.jwks) {
      throw new Error("认证已开启，但未配置 SUPABASE_URL 或 SUPABASE_JWT_SECRET");
    }
  }

  isAuthRequired(): boolean {
    return this.options.authRequired;
  }

  getTokenFromSocketAuth(authToken: unknown, authorizationHeader?: string): string | null {
    if (typeof authToken === "string" && authToken.trim()) {
      return authToken.trim();
    }
    return extractBearerToken(authorizationHeader);
  }

  getTokenFromAuthorizationHeader(authorizationHeader?: string): string | null {
    return extractBearerToken(authorizationHeader);
  }

  async verifyAccessToken(token: string): Promise<AuthenticatedUser> {
    if (!token) {
      throw new Error("缺少访问令牌");
    }

    const verifyOptions = {
      audience: this.options.supabaseJwtAudience,
      ...(this.issuer ? { issuer: this.issuer } : {}),
    };

    let payload: JWTPayload | null = null;

    if (this.secretKey) {
      payload = (await jwtVerify(token, this.secretKey, verifyOptions)).payload;
    } else if (this.jwks) {
      payload = (await jwtVerify(token, this.jwks, verifyOptions)).payload;
    }

    if (!payload) {
      throw new Error("令牌校验失败");
    }

    if (typeof payload.sub !== "string" || !payload.sub) {
      throw new Error("令牌缺少用户标识");
    }

    return {
      userId: payload.sub,
      email: typeof payload.email === "string" ? payload.email : null,
    };
  }
}
