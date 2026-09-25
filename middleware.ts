import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, tokenFor } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next(); // no gate configured

  const expected = await tokenFor(password);
  if (req.cookies.get(AUTH_COOKIE)?.value === expected) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = req.nextUrl.pathname === "/" ? "" : `?next=${req.nextUrl.pathname}`;
  return NextResponse.redirect(url);
}

export const config = {
  // /media stays behind the gate too — rendered videos are the product.
  matcher: ["/((?!login|api/login|_next|favicon.ico|icon.svg).*)"],
};
