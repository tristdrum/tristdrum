function required(name, env) {
  const value = String(env[name] ?? "").trim();
  if (!value) throw new Error(`Missing required environment variable ${name}.`);
  return value;
}

export function createAirbnbDatabase({ env = process.env, url = null, postgresFactory } = {}) {
  if (typeof postgresFactory !== "function") throw new Error("postgresFactory is required.");
  const connectionUrl = url ?? required("AIRBNB_DATABASE_URL", env);
  const householdId = required("AIRBNB_HOUSEHOLD_ID", env);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(householdId)) {
    throw new Error("AIRBNB_HOUSEHOLD_ID must be a UUID.");
  }
  const sql = postgresFactory(connectionUrl, {
    max: 2,
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: false,
    transform: postgresFactory.camel,
    connection: {
      application_name: String(env.AIRBNB_SERVICE_NAME ?? "airbnb-worker"),
      statement_timeout: 60_000,
      lock_timeout: 5_000,
    },
  });

  return {
    sql,
    async householdId() {
      return householdId;
    },
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}

export async function recordJobStart(sql, {
  householdId,
  service,
  jobName,
  runId,
  targetDate = null,
  startedAt,
}) {
  try {
    await sql.begin(async (transaction) => {
      await transaction`
        update airbnb.job_runs
        set status = 'error',
            error_code = 'STALE_RUN',
            error_message = 'Previous run exceeded the fifteen-minute lock window.',
            completed_at = ${startedAt}
        where service = ${service}
          and status = 'started'
          and started_at < ${startedAt}::timestamptz - interval '15 minutes'
      `;
      await transaction`
        insert into airbnb.job_runs (
          household_id, service, job_name, run_id, target_date, status, started_at
        ) values (
          ${householdId}, ${service}, ${jobName}, ${runId}, ${targetDate}, 'started', ${startedAt}
        )
      `;
    });
  } catch (error) {
    if (error?.code === "23505") {
      const overlap = new Error(`${service} run already in progress.`);
      overlap.code = "RUN_IN_PROGRESS";
      throw overlap;
    }
    throw error;
  }
}

export async function recordJobFinish(sql, {
  service,
  runId,
  status,
  receipt,
  errorCode = null,
  errorMessage = null,
  completedAt,
}) {
  await sql`
    update airbnb.job_runs
    set status = ${status},
        receipt = ${sql.json(receipt)},
        error_code = ${errorCode},
        error_message = ${errorMessage},
        completed_at = ${completedAt}
    where service = ${service}
      and run_id = ${runId}
  `;
}

export function redactCredentialText(value) {
  return String(value ?? "")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]")
    .replace(/\b(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|cookie|credentials?)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s&,;}]+)/gi, "$1=[REDACTED]")
    .replace(/\b(postgres(?:ql)?:\/\/)[^\s'",]+/gi, "$1[REDACTED]");
}

export function sanitizedError(error) {
  return {
    name: redactCredentialText(error?.name ?? "Error").slice(0, 100),
    code: error?.code == null ? null : redactCredentialText(error.code).slice(0, 100),
    message: redactCredentialText(error?.message ?? "Unknown error").slice(0, 300),
  };
}
