import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDevLanHosts } from "./dev-origins";

describe("development LAN hosts", () => {
  it("accepts exact addresses and hostnames", () => {
    expect(parseDevLanHosts("192.168.1.20")).toEqual(["192.168.1.20"]);
    expect(parseDevLanHosts(" 10.0.0.5 , my-laptop.local ")).toEqual(["10.0.0.5", "my-laptop.local"]);
    // A full address is reduced to its hostname.
    expect(parseDevLanHosts("http://192.168.1.20:3000/jobs")).toEqual(["192.168.1.20"]);
  });

  it("ignores wildcards and anything that isn't a plain host", () => {
    expect(parseDevLanHosts(undefined)).toEqual([]);
    expect(parseDevLanHosts("")).toEqual([]);
    expect(parseDevLanHosts("*")).toEqual([]);
    expect(parseDevLanHosts("**")).toEqual([]);
    expect(parseDevLanHosts("*.local,**.example.com,192.168.*.*")).toEqual([]);
    expect(parseDevLanHosts("999.1.1.1,bad host,-bad.example")).toEqual([]);
  });

  it("applies only to the development server and leaves Server Action checks alone", () => {
    const config = readFileSync("next.config.ts", "utf8");
    expect(config).toContain('process.env.NODE_ENV === "development"');
    expect(config).toContain("allowedDevOrigins");
    expect(config).not.toMatch(/serverActions|allowedOrigins:/);
    // No address is committed in the config itself.
    expect(config.replace(/\/\/.*$/gm, "")).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });
});
