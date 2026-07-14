const PRODUCTION_AUTH_REDIRECT_URL = "https://yunzhixu620-stack.github.io/mindgrow/";

export function getAuthRedirectUrl() {
  if (typeof window === "undefined") return PRODUCTION_AUTH_REDIRECT_URL;

  const basePath = process.env.NODE_ENV === "production" ? "/mindgrow/" : "/";
  return `${window.location.origin}${basePath}`;
}
