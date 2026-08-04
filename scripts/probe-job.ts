const id = process.argv[2];
if (!id) throw new Error("usage: probe-job <jobId>");
const j = await (await fetch(`http://127.0.0.1:3001/v1/jobs/${id}`)).json();
console.log(
  JSON.stringify(
    {
      status: j.job?.status,
      acceptance: j.acceptance,
      deliverables: (j.deliverables ?? []).map((d: { name: string; mimeType?: string; size?: number }) => ({
        name: d.name,
        mime: d.mimeType,
        size: d.size,
      })),
      recentEvents: (j.events ?? []).slice(-12),
    },
    null,
    2,
  ),
);
