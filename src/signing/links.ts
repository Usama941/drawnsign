import { appBaseUrl } from "@/lib/base-url";

export function appUrl(): string {
  return appBaseUrl();
}

export function signingUrl(token: string): string {
  return `${appUrl()}/sign/${token}`;
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
