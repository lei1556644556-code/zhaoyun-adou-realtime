export type DeploymentEnvironment = "local" | "preview" | "production";

export interface RuntimeConfig {
  deploymentEnvironment: DeploymentEnvironment;
  serverUrl: string | null;
  supabase: {
    url: string;
    publishableKey: string;
  };
}

function requireValue(name: string, value: string | undefined) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`缺少客户端运行配置：${name}`);
  return normalized;
}

export function loadRuntimeConfig(): RuntimeConfig {
  const rawEnvironment = requireValue("VITE_DEPLOY_ENV", import.meta.env.VITE_DEPLOY_ENV);
  if (rawEnvironment !== "local" && rawEnvironment !== "preview" && rawEnvironment !== "production") {
    throw new Error(`无效的客户端运行环境：${rawEnvironment}`);
  }

  const url = requireValue("VITE_SUPABASE_URL", import.meta.env.VITE_SUPABASE_URL);
  const publishableKey = requireValue(
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  );
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("VITE_SUPABASE_URL 不是有效 URL");
  }
  if (rawEnvironment === "production" && parsedUrl.protocol !== "https:") {
    throw new Error("生产 Supabase 地址必须使用 HTTPS");
  }
  if (/service[_-]?role/i.test(publishableKey)) {
    throw new Error("浏览器配置禁止使用 Supabase service role key");
  }

  const rawServerUrl = import.meta.env.VITE_SERVER_URL?.trim();
  if (rawEnvironment === "production" && !rawServerUrl) throw new Error("生产环境缺少 VITE_SERVER_URL");
  let serverUrl: string | null = null;
  if (rawServerUrl) {
    const parsedServer = new URL(rawServerUrl);
    if (rawEnvironment === "production" && parsedServer.protocol !== "https:") {
      throw new Error("生产权威服务器地址必须使用 HTTPS");
    }
    serverUrl = parsedServer.toString().replace(/\/$/, "");
  }

  return {
    deploymentEnvironment: rawEnvironment,
    serverUrl,
    supabase: { url: parsedUrl.toString().replace(/\/$/, ""), publishableKey },
  };
}
