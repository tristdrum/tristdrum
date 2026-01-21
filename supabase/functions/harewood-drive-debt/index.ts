import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const PASSWORDS: Record<string, string> = {
  martin: "creditor",
  tristan: "debtor",
};

const DEBT_DATA = {
  schemaVersion: 1,
  property: {
    label: "28 Harewood Drive",
    erf: "Erf 10520, East London",
    registrationDate: "2025-09-17"
  },
  parties: {
    debtorDisplayName: "Tristan",
    creditorDisplayName: "Martin"
  },
  agreement: {
    principal: 333000,
    interestMarginBelowRepo: 0.025,
    graceMonths: 5,
    minimumMonthlyPayment: 3149.17
  },
  repoRateTimeline: [
    {
      effectiveFrom: "2025-09-01T00:00:00+02:00",
      repoRate: 0.07
    },
    {
      effectiveFrom: "2025-11-20T15:00:00+02:00",
      repoRate: 0.0675
    }
  ],
  payments: []
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-password",
  "Access-Control-Allow-Methods": "GET, OPTIONS"
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const password = req.headers.get("x-password")?.toLowerCase();
  const role = password ? PASSWORDS[password] : undefined;

  if (!role) {
    return new Response(
      JSON.stringify({ error: "Invalid password" }),
      {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }

  return new Response(
    JSON.stringify({ ...DEBT_DATA, role }),
    {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    }
  );
});
