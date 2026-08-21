#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const householdId = "8fd0d696-888c-44b3-ba50-ea4153a85bab";
const projectRef = "akvlarrmhlbnuvnfpvic";
const services = {
  cleaner: {
    app: "tristdrum-airbnb-cleaner",
    role: "airbnb_cleaner_runtime",
    capability: "airbnb_cleaner_worker",
  },
  stock: {
    app: "tristdrum-airbnb-stock",
    role: "airbnb_stock_runtime",
    capability: "airbnb_stock_worker",
    schedulerEnvironmentKey: "AIRBNB_STOCK_SCHEDULER_SECRET",
    schedulerVaultName: "tristdrum_airbnb_stock_scheduler_secret",
  },
  support: {
    app: "tristdrum-airbnb-support",
    role: "airbnb_support_runtime",
    capability: "airbnb_support_worker",
    schedulerEnvironmentKey: "AIRBNB_SUPPORT_SCHEDULER_SECRET",
    schedulerVaultName: "tristdrum_airbnb_support_scheduler_secret",
  },
};

const identifierPattern = /^[a-z][a-z0-9_]{0,62}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function run(command, args, { input = null, inheritOutput = false } = {}) {
  const result = spawnSync(command, args, {
    input,
    encoding: "utf8",
    stdio: input == null && inheritOutput ? "inherit" : undefined,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed while provisioning the Airbnb runtime.`);
  }
  if (inheritOutput) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlIdentifier(value) {
  if (!identifierPattern.test(value)) throw new Error(`Invalid PostgreSQL identifier: ${value}`);
  return `"${value}"`;
}

function databaseUrl(role, password) {
  const url = new URL(`postgresql://db.${projectRef}.supabase.co:5432/postgres`);
  url.port = "5432";
  url.username = role;
  url.password = password;
  url.searchParams.set("sslmode", "require");
  return url.toString();
}

function validateService(name, service) {
  if (!uuidPattern.test(householdId)) throw new Error("Configured Airbnb household ID is invalid.");
  if (!/^[a-z]{20}$/.test(projectRef)) throw new Error("Configured Supabase project ref is invalid.");
  if (!/^[a-z0-9-]+$/.test(service.app)) throw new Error(`Invalid Fly app name for ${name}.`);
  sqlIdentifier(service.role);
  sqlIdentifier(service.capability);

  const parsed = new URL(databaseUrl(service.role, "dry-run-placeholder"));
  if (
    parsed.protocol !== "postgresql:"
    || parsed.hostname !== `db.${projectRef}.supabase.co`
    || parsed.port !== "5432"
    || parsed.pathname !== "/postgres"
    || parsed.username !== service.role
    || parsed.searchParams.get("sslmode") !== "require"
  ) {
    throw new Error(`Invalid database connection shape for ${name}.`);
  }
}

function provisionRole(name, service, password) {
  const role = sqlIdentifier(service.role);
  const sql = `
    do $provision$
    begin
      if not exists (select 1 from pg_roles where rolname = ${sqlLiteral(service.role)}) then
        create role ${role} login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls
          password ${sqlLiteral(password)};
      else
        alter role ${role} login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls
          password ${sqlLiteral(password)};
      end if;
    end
    $provision$;
    revoke airbnb_cleaner_worker, airbnb_stock_worker, airbnb_support_worker from ${role};
    grant ${service.capability} to ${role};
    insert into airbnb.worker_identities (role_name, household_id, service)
    values (${sqlLiteral(service.role)}, ${sqlLiteral(householdId)}::uuid, ${sqlLiteral(name)})
    on conflict (role_name)
    do update set household_id = excluded.household_id,
                  service = excluded.service,
                  updated_at = now();
  `;
  run("supabase", ["db", "query", "--linked", "--file", "/dev/stdin"], { input: sql });
}

function stageFlySecrets(service, password, schedulerSecret) {
  const entries = [
    `AIRBNB_DATABASE_URL=${databaseUrl(service.role, password)}`,
    `AIRBNB_HOUSEHOLD_ID=${householdId}`,
  ];
  if (service.schedulerEnvironmentKey) {
    entries.push(`${service.schedulerEnvironmentKey}=${schedulerSecret}`);
  }
  run("/Users/tristdrum/.local/bin/fly-personal", ["secrets", "import", "--stage", "--app", service.app], {
    input: `${entries.join("\n")}\n`,
    inheritOutput: true,
  });
}

function storeSchedulerSecret(service, schedulerSecret) {
  if (!service.schedulerVaultName) return;
  const sql = `
    do $vault$
    declare
      existing_id uuid;
    begin
      select id into existing_id
      from vault.secrets
      where name = ${sqlLiteral(service.schedulerVaultName)}
      order by created_at desc
      limit 1;

      if existing_id is null then
        perform vault.create_secret(
          ${sqlLiteral(schedulerSecret)},
          ${sqlLiteral(service.schedulerVaultName)},
          'Scheduler credential for the private Airbnb observer.'
        );
      else
        perform vault.update_secret(
          existing_id,
          new_secret := ${sqlLiteral(schedulerSecret)},
          new_name := ${sqlLiteral(service.schedulerVaultName)},
          new_description := 'Scheduler credential for the private Airbnb observer.'
        );
      end if;
    end
    $vault$;
  `;
  run("supabase", ["db", "query", "--linked", "--file", "/dev/stdin"], { input: sql });
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  const name = process.argv.slice(2).find((argument) => argument !== "--dry-run");
  const service = services[name];
  if (!service) {
    throw new Error("Usage: provision-airbnb-runtime.mjs <cleaner|stock|support> [--dry-run]");
  }
  validateService(name, service);

  if (dryRun) {
    const stagedSecrets = [
      "AIRBNB_DATABASE_URL",
      "AIRBNB_HOUSEHOLD_ID",
      service.schedulerEnvironmentKey,
    ].filter(Boolean);
    console.log(`${name}: validation passed`);
    console.log(`Fly app: ${service.app}`);
    console.log(`PostgreSQL role: ${service.role} -> ${service.capability}`);
    console.log(`Staged Fly secret names: ${stagedSecrets.join(", ")}`);
    if (service.schedulerVaultName) {
      console.log(`Vault secret name: ${service.schedulerVaultName}`);
    }
    return;
  }

  const password = randomBytes(36).toString("base64url");
  const schedulerSecret = service.schedulerVaultName ? randomBytes(36).toString("base64url") : null;
  provisionRole(name, service, password);
  stageFlySecrets(service, password, schedulerSecret);
  storeSchedulerSecret(service, schedulerSecret);
  console.log(`${name}: runtime role and staged Fly secrets are ready`);
}

main();
