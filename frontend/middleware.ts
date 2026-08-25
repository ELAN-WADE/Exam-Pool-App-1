import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const COOKIE_NAME = "__exampool_session";

type Role = "student" | "teacher" | "operator" | "guardian";

const routeRoleMap: { pattern: RegExp; role: Role }[] = [
  { pattern: /^\/student\/(?!$)/, role: "student" },
  { pattern: /^\/teacher\/(?!$)/, role: "teacher" },
  { pattern: /^\/ADMIN\/(?!$)/, role: "operator" },
  { pattern: /^\/guardian\/(?!$)/, role: "guardian" },
];

const publicRoutes = ["/", "/register", "/setup", "/forgot-password", "/kiosk", "/ADMIN", "/teacher", "/guardian"];

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1];
    const decoded = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/_next") || pathname.startsWith("/api") || pathname.includes(".")) {
    return NextResponse.next();
  }

  // Redirect legacy /operator routes directly to /ADMIN
  if (pathname.startsWith("/operator")) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.replace(/^\/operator/, "/ADMIN") || "/ADMIN/dashboard/";
    return NextResponse.redirect(url);
  }

  const isPublic = publicRoutes.some((r) => pathname === r || pathname === r + "/");
  if (isPublic) return NextResponse.next();

  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    const url = request.nextUrl.clone();
    if (pathname.startsWith("/teacher")) {
      url.pathname = "/teacher";
    } else if (pathname.startsWith("/ADMIN")) {
      url.pathname = "/ADMIN";
    } else if (pathname.startsWith("/guardian")) {
      url.pathname = "/guardian";
    } else {
      url.pathname = "/";
    }
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  const payload = decodeJwtPayload(token);
  if (!payload) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.startsWith("/guardian") ? "/guardian" : pathname.startsWith("/teacher") ? "/teacher" : pathname.startsWith("/ADMIN") ? "/ADMIN" : "/";
    return NextResponse.redirect(url);
  }

  const userRole = payload.role as Role | undefined;
  if (!userRole) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.startsWith("/guardian") ? "/guardian" : pathname.startsWith("/teacher") ? "/teacher" : pathname.startsWith("/ADMIN") ? "/ADMIN" : "/";
    return NextResponse.redirect(url);
  }

  const exp = payload.exp as number | undefined;
  if (exp && exp < Date.now() / 1000) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.startsWith("/guardian") ? "/guardian" : pathname.startsWith("/teacher") ? "/teacher" : pathname.startsWith("/ADMIN") ? "/ADMIN" : "/";
    return NextResponse.redirect(url);
  }

  const matched = routeRoleMap.find((r) => r.pattern.test(pathname));
  if (matched && matched.role !== userRole) {
    const url = request.nextUrl.clone();
    if (userRole === "teacher") {
      url.pathname = "/teacher/dashboard/";
    } else if (userRole === "operator") {
      url.pathname = "/ADMIN/dashboard/";
    } else if (userRole === "guardian") {
      url.pathname = "/guardian/dashboard/";
    } else {
      url.pathname = "/student/dashboard/";
    }
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/).*)",
  ],
};
