import json, sys
d = json.load(sys.stdin)
qs = d.get("quotas", [])
want = (
    "CPUS",
    "N2D_CPUS",
    "N2_CPUS",
    "E2_CPUS",
    "C2_CPUS",
    "IN_USE_ADDRESSES",
    "DISKS_TOTAL_GB",
    "PREEMPTIBLE_CPUS",
    "COMMITTED_N2D_CPUS",
)
for q in qs:
    m = q.get("metric", "")
    if m in want or "N2D" in m or "SEV" in m or "CONFIDENTIAL" in m:
        print(f"{m}: limit={q.get('limit')} usage={q.get('usage')}")
