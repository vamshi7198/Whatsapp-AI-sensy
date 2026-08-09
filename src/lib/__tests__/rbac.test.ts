import { describe, expect, it } from "vitest";

import { can, permissionsFor } from "../rbac";

const admin = { role: "ADMIN" as const, isActive: true };
const manager = { role: "MANAGER" as const, isActive: true };
const agent = { role: "AGENT" as const, isActive: true };

describe("can()", () => {
  it("grants ADMIN every permission it knows about", () => {
    expect(can(admin, "settings:whatsapp")).toBe(true);
    expect(can(admin, "campaign:delete")).toBe(true);
    expect(can(admin, "logs:view")).toBe(true);
  });

  it("lets MANAGER run campaigns but not delete them", () => {
    expect(can(manager, "campaign:send")).toBe(true);
    expect(can(manager, "campaign:cancel")).toBe(true);
    expect(can(manager, "campaign:delete")).toBe(false);
  });

  it("keeps MANAGER out of API configuration", () => {
    expect(can(manager, "settings:whatsapp")).toBe(false);
    expect(can(manager, "settings:users")).toBe(false);
    expect(can(manager, "logs:view")).toBe(false);
  });

  it("limits AGENT to inbox and contacts", () => {
    expect(can(agent, "inbox:view")).toBe(true);
    expect(can(agent, "inbox:reply")).toBe(true);
    expect(can(agent, "contact:view")).toBe(true);
    expect(can(agent, "contact:edit")).toBe(true);
  });

  it("blocks AGENT from campaigns, config and bulk data egress", () => {
    expect(can(agent, "campaign:view")).toBe(false);
    expect(can(agent, "campaign:send")).toBe(false);
    expect(can(agent, "campaign:delete")).toBe(false);
    expect(can(agent, "settings:whatsapp")).toBe(false);
    expect(can(agent, "contact:delete")).toBe(false);
    expect(can(agent, "contact:export")).toBe(false);
  });

  it("denies everything to a deactivated user regardless of role", () => {
    const deactivated = { role: "ADMIN" as const, isActive: false };
    expect(can(deactivated, "dashboard:view")).toBe(false);
    expect(can(deactivated, "settings:whatsapp")).toBe(false);
  });

  it("denies everything when there is no user", () => {
    expect(can(null, "dashboard:view")).toBe(false);
    expect(can(undefined, "contact:view")).toBe(false);
  });
});

describe("permissionsFor()", () => {
  it("returns a strictly narrowing set from ADMIN to AGENT", () => {
    const adminPerms = permissionsFor("ADMIN");
    const managerPerms = permissionsFor("MANAGER");
    const agentPerms = permissionsFor("AGENT");

    expect(adminPerms.size).toBeGreaterThan(managerPerms.size);
    expect(managerPerms.size).toBeGreaterThan(agentPerms.size);

    // Every lower-role permission must exist at the higher role. If this ever
    // fails, someone has granted an AGENT something an ADMIN cannot do.
    for (const p of agentPerms) expect(managerPerms.has(p)).toBe(true);
    for (const p of managerPerms) expect(adminPerms.has(p)).toBe(true);
  });
});
