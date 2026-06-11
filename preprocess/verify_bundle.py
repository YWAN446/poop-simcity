import json
import numpy as np
from pathlib import Path
from poop_simcity_preprocess.encoding import AGENT_WAYPOINT_DTYPE, POOP_EVENT_DTYPE

b = Path("../app/public/data/dataset_00")
m = json.loads((b / "manifest.json").read_text())
assert m["numAgents"] == 1000, m["numAgents"]
assert m["schemaVersion"] == 1

idx = json.loads((b / "agents_index.json").read_text())
agents = np.frombuffer((b / "agents.bin").read_bytes(), dtype=AGENT_WAYPOINT_DTYPE)
assert len(idx) == 1000
assert sum(e["count"] for e in idx) == len(agents)
assert agents["tick"].min() == 0

poops = np.frombuffer((b / "poops.bin").read_bytes(), dtype=POOP_EVENT_DTYPE)
assert np.all(np.diff(poops["tick"].astype(np.int64)) >= 0), "poops must be tick-sorted"

dis = json.loads((b / "disease.json").read_text())
assert len(dis["transmissions"]) > 0

agg = json.loads((b / "aggregates.json").read_text())
n = len(agg["seir"]["S"])
for t in range(n):
    total = sum(agg["seir"][k][t] for k in "SEIR")
    assert total == 1000, (t, total)  # population conserved every hour

ow = m["outbreakWindow"]
assert ow["startTick"] < ow["endTick"]

print("Bundle OK:",
      f"{len(agents)} waypoints, {len(poops)} poops,",
      f"{len(dis['transmissions'])} transmissions,",
      f"outbreak ticks {ow['startTick']}..{ow['endTick']}")
print("Bundle size (MB):",
      round(sum(f.stat().st_size for f in b.iterdir()) / 1e6, 1))
