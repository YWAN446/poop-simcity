"""Per-run descriptions of file and column naming.

The two simulation runs shipped with this project name the same logical tables
differently, so every reader takes a profile instead of hardcoding names.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class DatasetProfile:
    name: str
    schema_version: int
    checkin_file: str
    disease_file: str
    poop_file: str
    source_agent_col: str
    checkout_col: str | None


DATASET_00 = DatasetProfile(
    name="dataset_00",
    schema_version=1,
    checkin_file="check_in",
    disease_file="disease_status",
    poop_file="poop_in",
    source_agent_col="source_agent_id",
    checkout_col=None,
)

SDC_10K = DatasetProfile(
    name="dataset_sdc-10k",
    schema_version=2,
    checkin_file="Checkin",
    disease_file="DiseasesStatus",
    poop_file="Poopin",
    source_agent_col="SourceAgentId",
    checkout_col="CheckoutTime",
)

PROFILES = {p.name: p for p in (DATASET_00, SDC_10K)}


def get_profile(name: str) -> DatasetProfile:
    try:
        return PROFILES[name]
    except KeyError:
        known = ", ".join(sorted(PROFILES))
        raise ValueError(f"Unknown dataset profile {name!r}; known profiles are {known}")
